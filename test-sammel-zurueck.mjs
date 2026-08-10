// Pruefstand fuer die Ruecknahme einer Sammelbuchung (2026-08-10).
//
// Faehrt den ECHTEN Worker-Code gegen das ECHTE Schema (node:sqlite mit
// duennem D1-Aufsatz, schema-kompakt.sql eingespielt). Anlass: der
// Download der SEPA-Datei ging verloren, die Datei war nie bei der Bank --
// gebucht war sie trotzdem. Damit stand ein ganzer Lauf auf 'bezahlt',
// ohne dass ein Cent geflossen war.
//
//   node test-sammel-zurueck.mjs
//
// Abschnitte:
//   A  Aufbau: Lauf, Datei, Sammelbuchung -- der Ausgangszustand
//   B  Rechte: nur der Schatzmeister nimmt zurueck
//   C  Die Ruecknahme selbst (Probe und Ausfuehrung)
//   D  Storniert statt geloescht, Status abgeleitet
//   E  Sperren: nicht gebucht, zweimal, Buchhaltung
//   F  Fail-safe ohne Buchhaltungstabelle (der Live-Zustand)
//   G  Fremde Zahlungen bleiben unangetastet
//   H  Der Kreis schliesst sich: danach ist wieder einziehbar

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const REPO = new URL(".", import.meta.url).pathname.replace(/^\//, "");

let ok = 0, fehler = 0;
const fehlerListe = [];
function pruefe(name, bedingung, zusatz) {
  if (bedingung) { ok++; return; }
  fehler++;
  fehlerListe.push(name + (zusatz ? "  → " + zusatz : ""));
}

// --- D1-Aufsatz -------------------------------------------------------

function d1(db) {
  const lauf = { abfragen: 0 };
  return {
    lauf,
    prepare(sql) {
      const self = {
        _sql: sql, _werte: [],
        bind(...w) { const k = Object.create(self); k._werte = w; return k; },
        first() {
          lauf.abfragen++;
          const r = db.prepare(this._sql).get(...this._werte);
          return r === undefined ? null : r;
        },
        all() {
          lauf.abfragen++;
          return { results: db.prepare(this._sql).all(...this._werte) };
        },
        run() {
          lauf.abfragen++;
          db.prepare(this._sql).run(...this._werte);
          return { success: true };
        }
      };
      return self;
    },
    async batch(liste) {
      lauf.abfragen++;
      const out = [];
      for (const a of liste) out.push(a.run());
      return out;
    }
  };
}

// --- Worker-Code laden ------------------------------------------------

const roh = readFileSync(REPO + "/vereinsverwaltung-worker.js", "utf8");
const schnitt = roh.indexOf("export default");
if (schnitt < 0) throw new Error("export default nicht gefunden");
const quelle = roh.slice(0, schnitt);

const namen = ["ladeRolle", "handleMigration", "handleSepaErzeugen", "handleZahlungSammel",
               "handleSammelZurueck", "handleLaufDetail", "handleVorabankuendigung",
               "handleZahlungErfassen"];
const W = new Function(quelle + "\nreturn {" + namen.join(",") + "};")();

// --- Datenbank aufsetzen ----------------------------------------------

const db = new DatabaseSync(":memory:");
const schema = readFileSync(REPO + "/schema-kompakt.sql", "utf8");
for (const anw of schema.split(";").map((s) => s.trim()).filter(Boolean)) {
  db.exec(anw + ";");
}
const env = { VV_DB: d1(db) };
const cors = {};

// ⚠️ Neutrales Standard-Testkonto (Landesbank Berlin), NICHT die
// Vereins-IBAN. Dieses Repo ist oeffentlich -- die echte steht in der
// Datenbank und nirgends im Code. Siehe test-passstelle.mjs.
const IBAN = "DE02100500000054540402";

const ADMIN = { username: "admin", isAdmin: true, canEdit: true, canAdmin: true };
const SCHATZ = { username: "schatz.meister", isAdmin: false, canEdit: true, canAdmin: false };
const GST = { username: "gesch.stelle", isAdmin: false, canEdit: true, canAdmin: false };
const OHNE = { username: "ohne.rolle", isAdmin: false, canEdit: false, canAdmin: false };

function rolleGeben(username, rolle) {
  db.prepare("INSERT INTO benutzer_rolle (id, username, rolle, erstellt_am, erstellt_von) " +
             "VALUES (?,?,?,?,?)")
    .run("br-" + username + "-" + rolle, username, rolle, "2026-01-01", "test");
}
rolleGeben(SCHATZ.username, "schatzmeister");
rolleGeben(GST.username, "geschaeftsstelle");

async function ruf(fn, ...args) {
  const antwort = await fn(...args);
  const daten = await antwort.json();
  return { status: antwort.status, daten };
}

// =====================================================================
// A  Aufbau
// =====================================================================

// Die Migration legt gebucht_am und forderungen_json an -- beide stehen
// NICHT in schema.sql, sondern entstehen zur Laufzeit. Ohne sie gibt es
// weder Sammelbuchung noch Ruecknahme.
const migration = await ruf(W.handleMigration, env, ADMIN, cors);
pruefe("A1  Migration laeuft durch", migration.status === 200,
       "Status " + migration.status);

const spalten = db.prepare("PRAGMA table_info(sepa_datei)").all().map((s) => s.name);
pruefe("A2  sepa_datei hat gebucht_am", spalten.includes("gebucht_am"));
pruefe("A3  sepa_datei hat forderungen_json", spalten.includes("forderungen_json"));

for (const [s, w] of [["verein_name", "1. SC 1911 Heilbad Heiligenstadt"],
                      ["verein_iban", IBAN],
                      ["glaeubiger_id", "DE98ZZZ09999999999"]]) {
  db.prepare("INSERT OR REPLACE INTO einstellung (schluessel, wert) VALUES (?,?)").run(s, w);
}

// Vier Haushalte: drei mit Mandat (werden eingezogen), einer ohne (bleibt
// offen -- das ist der Fall der 36 Haushalte im echten Bestand).
const LAUF = "lauf-1";
db.prepare("INSERT INTO beitragslauf (id, bezeichnung, jahr, periode, stichtag, faelligkeit, " +
           "status, anzahl_erzeugt, summe_cent, erstellt_am, erstellt_von) " +
           "VALUES (?,?,?,?,?,?,?,?,?,?,?)")
  .run(LAUF, "Jahresbeitrag 2027", 2027, "jahr", "2027-01-01", "2027-03-15",
       "fertig", 4, 33600, "2026-08-10", "test");

const HAUSHALTE = [
  { id: "hh-1", nr: "1001", name: "Anton Beispiel",  betrag: 9600, mandat: true },
  { id: "hh-2", nr: "1002", name: "Berta Beispiel",  betrag: 9600, mandat: true },
  { id: "hh-3", nr: "1003", name: "Cesar Beispiel",  betrag: 7200, mandat: true },
  { id: "hh-4", nr: "1004", name: "Dora Beispiel",   betrag: 7200, mandat: false }
];
for (const h of HAUSHALTE) {
  const [vorname, nachname] = h.name.split(" ");
  db.prepare("INSERT INTO haushalt (id, erstellt_am, erstellt_von) VALUES (?,?,?)")
    .run(h.id, "2026-01-01", "test");
  db.prepare("INSERT INTO person (id, haushalt_id, vorname, nachname, geburtsdatum, strasse, " +
             "plz, ort, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run("p-" + h.id, h.id, vorname, nachname, "1980-01-01", "Musterweg 1", "37308",
         "Heilbad Heiligenstadt", "2026-01-01", "test");
  db.prepare("UPDATE haushalt SET zahler_person_id = ? WHERE id = ?").run("p-" + h.id, h.id);
  db.prepare("INSERT INTO mitgliedschaft (id, person_id, mitgliedsnummer, art, eintritt, " +
             "status, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,?,?)")
    .run("m-" + h.id, "p-" + h.id, h.nr, "ordentlich", "2010-01-01", "aktiv",
         "2026-01-01", "test");
  db.prepare("INSERT INTO forderung (id, beitragslauf_id, mitgliedschaft_id, haushalt_id, art, " +
             "bezeichnung, jahr, betrag_cent, faellig_am, status, erstellt_am, erstellt_von) " +
             "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("f-" + h.id, LAUF, "m-" + h.id, h.id, "beitrag", "Mitgliedsbeitrag 2027", 2027,
         h.betrag, "2027-03-15", "offen", "2026-08-10", "test");
  if (h.mandat) {
    db.prepare("INSERT INTO sepa_mandat (id, haushalt_id, referenz, kontoinhaber, iban, " +
               "erteilt_am, quelle, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("md-" + h.id, h.id, "M-" + h.nr, h.name, IBAN, "2020-01-01", "import",
           "2026-01-01", "test");
  }
}

const sepa = await ruf(W.handleSepaErzeugen,
  { lauf_id: LAUF, ausfuehrung_am: "2027-03-15" }, env, SCHATZ, cors);
pruefe("A4  SEPA-Datei wird erzeugt", sepa.status === 200, "Status " + sepa.status);
pruefe("A5  drei Posten, der Haushalt ohne Mandat faellt heraus",
       sepa.daten.anzahl === 3, "anzahl " + sepa.daten.anzahl);
pruefe("A6  Summe 264,00 Euro", sepa.daten.summeCent === 26400,
       "summeCent " + sepa.daten.summeCent);
pruefe("A7  der Haushalt ohne Mandat wird namentlich gemeldet",
       (sepa.daten.uebersprungen || []).some((u) => /kein SEPA-Mandat/.test(u.grund)));

const DATEI = db.prepare("SELECT * FROM sepa_datei WHERE beitragslauf_id = ?").get(LAUF);
pruefe("A8  Datei ist vermerkt", !!DATEI);
pruefe("A9  noch nicht gebucht", DATEI && !DATEI.gebucht_am);

const gebucht = await ruf(W.handleZahlungSammel,
  { sepa_datei_id: DATEI.id, eingang_am: "2027-03-15" }, env, SCHATZ, cors);
pruefe("A10 Sammelbuchung laeuft", gebucht.status === 200, "Status " + gebucht.status);
pruefe("A11 drei Forderungen gebucht", gebucht.daten.anzahl === 3);

const nachBuchung = db.prepare(
  "SELECT status, COUNT(*) AS n FROM forderung GROUP BY status").all();
const bezahltVorher = nachBuchung.find((z) => z.status === "bezahlt");
pruefe("A12 drei Forderungen stehen auf bezahlt",
       bezahltVorher && bezahltVorher.n === 3,
       JSON.stringify(nachBuchung));

// Der Zustand aus Michels Screenshot: nichts mehr einziehbar, obwohl der
// Lauf gar nicht bezahlt wurde.
const leer = await ruf(W.handleSepaErzeugen,
  { lauf_id: LAUF, ausfuehrung_am: "2027-04-15", trotzdem: true }, env, SCHATZ, cors);
pruefe("A13 danach ist kein Posten mehr einziehbar (der gemeldete Fehler)",
       leer.status === 400 && /Kein einziger Posten/.test(leer.daten.error || ""),
       leer.status + " " + (leer.daten.error || ""));

const vorab = await ruf(W.handleVorabankuendigung, { lauf_id: LAUF }, env, SCHATZ, cors);
pruefe("A14 und die Vorabankuendigung meldet 0 Empfaenger (der zweite Befund)",
       vorab.daten.anzahl === 0, "anzahl " + vorab.daten.anzahl);

// =====================================================================
// B  Rechte
// =====================================================================

for (const [wer, konto] of [["Geschaeftsstelle", GST], ["ohne Rolle", OHNE]]) {
  const r = await ruf(W.handleSammelZurueck,
    { sepa_datei_id: DATEI.id, pruefen: true }, env, konto, cors);
  pruefe("B  " + wer + " darf nicht zuruecknehmen", r.status === 403,
         "Status " + r.status);
}
const probeAdmin = await ruf(W.handleSammelZurueck,
  { sepa_datei_id: DATEI.id, pruefen: true }, env, ADMIN, cors);
pruefe("B3  der Administrator darf", probeAdmin.status === 200);

const unbekannt = await ruf(W.handleSammelZurueck,
  { sepa_datei_id: "gibt-es-nicht", pruefen: true }, env, SCHATZ, cors);
pruefe("B4  unbekannte Datei -> 404", unbekannt.status === 404);

// =====================================================================
// C  Die Ruecknahme
// =====================================================================

const probe = await ruf(W.handleSammelZurueck,
  { sepa_datei_id: DATEI.id, pruefen: true }, env, SCHATZ, cors);
pruefe("C1  Probe zaehlt drei Zahlungen", probe.daten.anzahl === 3,
       "anzahl " + probe.daten.anzahl);
pruefe("C2  Probe nennt die Summe", probe.daten.summeCent === 26400,
       "summeCent " + probe.daten.summeCent);
pruefe("C3  Probe schreibt nichts",
       !!db.prepare("SELECT gebucht_am FROM sepa_datei WHERE id = ?").get(DATEI.id).gebucht_am);

const zurueck = await ruf(W.handleSammelZurueck,
  { sepa_datei_id: DATEI.id, grund: "Datei nie bei der Bank eingereicht" }, env, SCHATZ, cors);
pruefe("C4  Ruecknahme laeuft", zurueck.status === 200, "Status " + zurueck.status);
pruefe("C5  drei Zahlungen zurueckgenommen", zurueck.daten.anzahl === 3);
pruefe("C6  Summe wird gemeldet", zurueck.daten.summeCent === 26400);
// Das Mahnwesen ist am 10.08.2026 entfernt worden. Die Ruecknahme darf
// deshalb NICHTS mehr darueber melden -- eine Antwort, die ein Feld aus
// einem abgebauten Bereich weiterfuehrt, ist eine Zusage ins Leere.
pruefe("C7  meldet nichts mehr zu Mahnungen",
       zurueck.daten.mahnungenErledigt === undefined);

// =====================================================================
// D  Storniert statt geloescht, Status abgeleitet
// =====================================================================

const zahlungen = db.prepare("SELECT * FROM zahlung WHERE sepa_datei_id = ?").all(DATEI.id);
pruefe("D1  die Zahlungen stehen weiterhin da (GoBD)", zahlungen.length === 3,
       "gefunden " + zahlungen.length);
pruefe("D2  alle drei tragen storniert_am", zahlungen.every((z) => !!z.storniert_am));
pruefe("D3  mit Urheber", zahlungen.every((z) => z.storniert_von === SCHATZ.username));
pruefe("D4  mit dem angegebenen Grund",
       zahlungen.every((z) => z.storno_grund === "Datei nie bei der Bank eingereicht"));
pruefe("D5  die Betraege sind unangetastet",
       zahlungen.reduce((s, z) => s + z.betrag_cent, 0) === 26400);

const status = db.prepare("SELECT id, status FROM forderung ORDER BY id").all();
pruefe("D6  alle vier Forderungen stehen wieder offen",
       status.every((f) => f.status === "offen"),
       JSON.stringify(status));

const datei2 = db.prepare("SELECT gebucht_am FROM sepa_datei WHERE id = ?").get(DATEI.id);
pruefe("D7  die Datei gilt nicht mehr als gebucht", !datei2.gebucht_am);

const prot = db.prepare("SELECT * FROM protokoll WHERE aktion = 'sepa-buchung-zurueckgenommen'").all();
pruefe("D8  der Vorgang ist protokolliert", prot.length === 1);
pruefe("D9  das Protokoll haelt fest, wann sie gebucht WAR",
       prot.length === 1 && /warGebuchtAm/.test(prot[0].detail_json || ""),
       prot.length ? prot[0].detail_json : "kein Eintrag");

// Ohne Grund faellt ein Standardtext ein -- ein leeres Storno-Feld waere
// in einem Jahr nicht mehr erklaerbar.
const ohneGrundDatei = db.prepare("SELECT * FROM sepa_datei WHERE id = ?").get(DATEI.id);
pruefe("D10 (Vorbereitung) Datei wieder buchbar", !ohneGrundDatei.gebucht_am);

// =====================================================================
// E  Sperren
// =====================================================================

const nochmal = await ruf(W.handleSammelZurueck,
  { sepa_datei_id: DATEI.id }, env, SCHATZ, cors);
pruefe("E1  eine nicht gebuchte Datei laesst sich nicht zuruecknehmen",
       nochmal.status === 409 && nochmal.daten.code === "nicht_gebucht",
       nochmal.status + " " + JSON.stringify(nochmal.daten));

// Erneut buchen, um die Buchhaltungssperre zu pruefen.
const wieder = await ruf(W.handleZahlungSammel,
  { sepa_datei_id: DATEI.id, eingang_am: "2027-03-15" }, env, SCHATZ, cors);
pruefe("E2  erneutes Buchen geht (die Forderungen sind ja wieder offen)",
       wieder.status === 200 && wieder.daten.anzahl === 3,
       wieder.status + " " + JSON.stringify(wieder.daten));

db.exec("INSERT INTO geschaeftsjahr (id, jahr, beginn, ende, status, erstellt_am, erstellt_von) " +
        "VALUES ('gj-1', 2027, '2027-01-01', '2027-12-31', 'offen', '2026-08-10', 'test')");
db.prepare("INSERT INTO buchung (id, geschaeftsjahr_id, belegnummer, belegdatum, buchungsdatum, " +
           "text, summe_cent, art, quelle_typ, quelle_id, erstellt_am, erstellt_von) " +
           "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
  .run("bu-1", "gj-1", 47, "2027-03-15", "2027-03-15", "SEPA-Einzug", 26400, "normal",
       "sepa_datei", DATEI.id, "2026-08-10", "test");

const gesperrt = await ruf(W.handleSammelZurueck,
  { sepa_datei_id: DATEI.id }, env, SCHATZ, cors);
pruefe("E3  in der Buchhaltung uebernommen -> 409",
       gesperrt.status === 409 && gesperrt.daten.code === "in_buchhaltung",
       gesperrt.status + " " + JSON.stringify(gesperrt.daten));
pruefe("E4  und die Meldung nennt die Belegnummer",
       /47/.test(gesperrt.daten.error || ""), gesperrt.daten.error);
pruefe("E5  die Sperre hat nichts angefasst",
       db.prepare("SELECT COUNT(*) AS n FROM zahlung WHERE sepa_datei_id = ? AND " +
                  "storniert_am IS NULL").get(DATEI.id).n === 3);

// Eine stornierte Buchung darf nicht sperren -- sonst haenge der Vorgang
// fest, nachdem die Buchhaltung ihn ordnungsgemaess storniert hat.
db.prepare("UPDATE buchung SET storniert_am = ? WHERE id = 'bu-1'").run("2027-03-20");
const wiederFrei = await ruf(W.handleSammelZurueck,
  { sepa_datei_id: DATEI.id, pruefen: true }, env, SCHATZ, cors);
pruefe("E6  nach dem Storno in der Buchhaltung ist der Weg wieder frei",
       wiederFrei.status === 200 && wiederFrei.daten.anzahl === 3,
       wiederFrei.status + " " + JSON.stringify(wiederFrei.daten));

// =====================================================================
// F  Fail-safe ohne Buchhaltungstabelle -- der Live-Zustand
// =====================================================================
//
// ⚠️ In der Live-Datenbank ist die Buchhaltung nie eingerichtet worden,
// die Tabelle buchung gibt es dort nicht. Ein SELECT darauf wuerde die
// ganze Aktion werfen. Der Zustand wird hier selbst hergestellt, statt
// ihn vom Schema zu erben -- sonst waere dieser Abschnitt gruen-falsch,
// sobald jemand das Schema aendert (die Lehre aus test-beitragslauf 0b).

db.exec("DROP TABLE buchung");
const ohneBuchhaltung = await ruf(W.handleSammelZurueck,
  { sepa_datei_id: DATEI.id, grund: "ohne Buchhaltung" }, env, SCHATZ, cors);
pruefe("F1  ohne Tabelle buchung laeuft die Ruecknahme durch",
       ohneBuchhaltung.status === 200, ohneBuchhaltung.status + " " +
       JSON.stringify(ohneBuchhaltung.daten));
pruefe("F2  und storniert wieder alle drei", ohneBuchhaltung.daten.anzahl === 3);
pruefe("F3  die Forderungen stehen wieder offen",
       db.prepare("SELECT COUNT(*) AS n FROM forderung WHERE status = 'offen'").get().n === 4);

// =====================================================================
// G  Fremde Zahlungen bleiben unangetastet
// =====================================================================

const einzeln = await ruf(W.handleZahlungErfassen,
  { haushalt_id: "hh-4", betrag_cent: 7200, eingang_am: "2027-03-20", art: "ueberweisung" },
  env, SCHATZ, cors);
pruefe("G1  eine Einzelzahlung laesst sich erfassen", einzeln.status === 200,
       einzeln.status + " " + JSON.stringify(einzeln.daten));

const gebucht2 = await ruf(W.handleZahlungSammel,
  { sepa_datei_id: DATEI.id, eingang_am: "2027-03-15" }, env, SCHATZ, cors);
pruefe("G2  Sammelbuchung erneut", gebucht2.status === 200);

const zurueck2 = await ruf(W.handleSammelZurueck,
  { sepa_datei_id: DATEI.id, grund: "Probe" }, env, SCHATZ, cors);
pruefe("G3  Ruecknahme fasst nur die Zahlungen DIESER Datei an",
       zurueck2.daten.anzahl === 3, "anzahl " + zurueck2.daten.anzahl);

const fremd = db.prepare(
  "SELECT * FROM zahlung WHERE sepa_datei_id IS NULL OR sepa_datei_id <> ?").all(DATEI.id);
pruefe("G4  die Einzelzahlung steht unstorniert da",
       fremd.length === 1 && !fremd[0].storniert_am,
       JSON.stringify(fremd.map((z) => [z.art, z.storniert_am])));
pruefe("G5  und der bar zahlende Haushalt gilt weiterhin als bezahlt",
       db.prepare("SELECT status FROM forderung WHERE haushalt_id = 'hh-4'").get().status === "bezahlt");

// =====================================================================
// H  Der Kreis schliesst sich
// =====================================================================

const neueDatei = await ruf(W.handleSepaErzeugen,
  { lauf_id: LAUF, ausfuehrung_am: "2027-04-15", trotzdem: true }, env, SCHATZ, cors);
pruefe("H1  nach der Ruecknahme laesst sich wieder eine SEPA-Datei erzeugen",
       neueDatei.status === 200, neueDatei.status + " " + (neueDatei.daten.error || ""));
pruefe("H2  mit denselben drei Posten", neueDatei.daten.anzahl === 3,
       "anzahl " + neueDatei.daten.anzahl);
pruefe("H3  ueber dieselbe Summe", neueDatei.daten.summeCent === 26400);
pruefe("H4  und die Datei enthaelt wirklich XML",
       /<CstmrDrctDbtInitn>/.test(neueDatei.daten.xml || ""));
pruefe("H5  der Haushalt ohne Mandat bleibt aussen vor",
       !/1004/.test(neueDatei.daten.xml || ""));

const vorab2 = await ruf(W.handleVorabankuendigung, { lauf_id: LAUF }, env, SCHATZ, cors);
pruefe("H6  die Vorabankuendigung findet die Empfaenger wieder",
       vorab2.daten.anzahl === 3, "anzahl " + vorab2.daten.anzahl);

// --- Ergebnis ---------------------------------------------------------

console.log("");
console.log("Pruefstand Ruecknahme der Sammelbuchung");
console.log("  bestanden: " + ok);
console.log("  fehlerhaft: " + fehler);
if (fehler) {
  console.log("");
  for (const f of fehlerListe) console.log("  ✗ " + f);
  process.exitCode = 1;
} else {
  console.log("  alles gruen.");
}
