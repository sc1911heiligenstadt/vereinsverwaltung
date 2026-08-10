// Pruefstand fuer das Loeschen eines Beitragslaufs (2026-08-10).
//
// Faehrt den ECHTEN Worker-Code gegen das ECHTE Schema (node:sqlite mit
// duennem D1-Aufsatz, schema-kompakt.sql eingespielt). Anlass: Michel
// hatte zwei Laeufe fuer 2027 nebeneinander stehen und brauchte einen
// Weg, einen davon wieder loszuwerden -- fuer Probelaeufe und fuer den
// Fall, dass beim Anlegen etwas schiefgegangen ist.
//
//   node test-lauf-loeschen.mjs
//
// Abschnitte:
//   A  Aufbau: zwei Laeufe, SEPA-Datei, Sammelbuchung
//   B  Rechte: nur der Schatzmeister loescht
//   C  Sperre: verbuchte Zahlungen
//   D  Sperre: Uebernahme in die Buchhaltung
//   E  Sperre: festgeschrieben
//   F  Die Probe zaehlt und schreibt nichts
//   G  Das Loeschen selbst -- mit SEPA-Vermerk, der frueher hart sperrte
//   H  Der zweite Lauf und alles Fremde bleiben unangetastet
//   I  Fail-safe ohne Buchhaltungstabelle (der Live-Zustand)

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
               "handleSammelZurueck", "handleLaufVerwerfen", "handleLaufListe"];
function ladeWorker() {
  return new Function(quelle + "\nreturn {" + namen.join(",") + "};")();
}
const W = ladeWorker();

// --- Datenbank aufsetzen ----------------------------------------------

const db = new DatabaseSync(":memory:");
const schema = readFileSync(REPO + "/schema-kompakt.sql", "utf8");
for (const anw of schema.split(";").map((s) => s.trim()).filter(Boolean)) {
  db.exec(anw + ";");
}
const env = { VV_DB: d1(db) };
const cors = {};

// ⚠️ Neutrales Standard-Testkonto (Landesbank Berlin), NICHT die
// Vereins-IBAN. Dieses Repo ist oeffentlich.
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

function zaehle(sql, ...werte) {
  return db.prepare(sql).get(...werte).n;
}

// =====================================================================
// A  Aufbau
// =====================================================================

const migration = await ruf(W.handleMigration, env, ADMIN, cors);
pruefe("A1  Migration laeuft durch", migration.status === 200, "Status " + migration.status);

for (const [s, w] of [["verein_name", "1. SC 1911 Heilbad Heiligenstadt"],
                      ["verein_iban", IBAN],
                      ["glaeubiger_id", "DE98ZZZ09999999999"]]) {
  db.prepare("INSERT OR REPLACE INTO einstellung (schluessel, wert) VALUES (?,?)").run(s, w);
}

function legeLaufAn(id, bezeichnung, status) {
  db.prepare("INSERT INTO beitragslauf (id, bezeichnung, jahr, periode, stichtag, faelligkeit, " +
             "status, anzahl_erzeugt, summe_cent, erstellt_am, erstellt_von) " +
             "VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, bezeichnung, 2027, "jahr", "2027-01-01", "2027-03-15", status, 0, 0,
         "2026-08-10", "test");
}

// Der gemeldete Zustand: zwei Laeufe fuer dasselbe Jahr nebeneinander.
const LAUF = "lauf-1";
const LAUF2 = "lauf-2";
legeLaufAn(LAUF, "Jahresbeitrag 2027", "fertig");
legeLaufAn(LAUF2, "Jahresbeitrag 2027 (zweiter Versuch)", "fertig");

const HAUSHALTE = [
  { id: "hh-1", nr: "1001", name: "Anton Beispiel", betrag: 9600, mandat: true },
  { id: "hh-2", nr: "1002", name: "Berta Beispiel", betrag: 9600, mandat: true },
  { id: "hh-3", nr: "1003", name: "Cesar Beispiel", betrag: 7200, mandat: true },
  { id: "hh-4", nr: "1004", name: "Dora Beispiel",  betrag: 7200, mandat: false }
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
db.prepare("UPDATE beitragslauf SET anzahl_erzeugt = 4, summe_cent = 33600 WHERE id = ?")
  .run(LAUF);

// Eine Forderung am ZWEITEN Lauf -- sie darf beim Loeschen des ersten
// nicht mitgehen.
db.prepare("INSERT INTO forderung (id, beitragslauf_id, mitgliedschaft_id, haushalt_id, art, " +
           "bezeichnung, jahr, betrag_cent, faellig_am, status, erstellt_am, erstellt_von) " +
           "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
  .run("f-zweit", LAUF2, "m-hh-1", "hh-1", "beitrag", "Mitgliedsbeitrag 2027 (zweiter Lauf)",
       2027, 9600, "2027-03-15", "offen", "2026-08-10", "test");
db.prepare("UPDATE beitragslauf SET anzahl_erzeugt = 1, summe_cent = 9600 WHERE id = ?")
  .run(LAUF2);

const sepa = await ruf(W.handleSepaErzeugen,
  { lauf_id: LAUF, ausfuehrung_am: "2027-03-15" }, env, SCHATZ, cors);
pruefe("A2  SEPA-Datei wird erzeugt", sepa.status === 200, "Status " + sepa.status);

const DATEI = db.prepare("SELECT * FROM sepa_datei WHERE beitragslauf_id = ?").get(LAUF);
pruefe("A3  Datei ist vermerkt", !!DATEI);

const gebucht = await ruf(W.handleZahlungSammel,
  { sepa_datei_id: DATEI.id, eingang_am: "2027-03-15" }, env, SCHATZ, cors);
pruefe("A4  Sammelbuchung laeuft", gebucht.status === 200, "Status " + gebucht.status);
pruefe("A5  drei Forderungen gebucht", gebucht.daten.anzahl === 3,
       "anzahl " + gebucht.daten.anzahl);

// =====================================================================
// B  Rechte
// =====================================================================

for (const [wer, konto] of [["Geschaeftsstelle", GST], ["ohne Rolle", OHNE]]) {
  const r = await ruf(W.handleLaufVerwerfen, { lauf_id: LAUF, pruefen: true }, env, konto, cors);
  pruefe("B  " + wer + " darf nicht loeschen", r.status === 403, "Status " + r.status);
}
const unbekannt = await ruf(W.handleLaufVerwerfen,
  { lauf_id: "gibt-es-nicht", pruefen: true }, env, SCHATZ, cors);
pruefe("B3  unbekannter Lauf -> 404", unbekannt.status === 404, "Status " + unbekannt.status);

// ⚠️ Gegenprobe: nach den drei Abweisungen steht der Lauf noch da. Ohne
// diese Zeile waere B auch dann gruen, wenn die Rechtepruefung erst NACH
// dem Loeschen kaeme.
pruefe("B4  nach allen Abweisungen steht der Lauf unveraendert",
       zaehle("SELECT COUNT(*) AS n FROM beitragslauf WHERE id = ?", LAUF) === 1);

// =====================================================================
// C  Sperre: verbuchte Zahlungen
// =====================================================================

const mitZahlung = await ruf(W.handleLaufVerwerfen, { lauf_id: LAUF }, env, SCHATZ, cors);
pruefe("C1  ein Lauf mit verbuchten Zahlungen wird abgewiesen", mitZahlung.status === 409,
       "Status " + mitZahlung.status);
pruefe("C2  mit dem Code zahlungen", mitZahlung.daten.code === "zahlungen",
       "code " + mitZahlung.daten.code);
pruefe("C3  und nennt Anzahl und Summe", mitZahlung.daten.anzahl === 3 &&
       mitZahlung.daten.summeCent === 26400,
       JSON.stringify({ a: mitZahlung.daten.anzahl, s: mitZahlung.daten.summeCent }));
pruefe("C4  der Text weist den Weg zur Ruecknahme",
       /Sammelbuchung/.test(mitZahlung.daten.error || ""), mitZahlung.daten.error);
pruefe("C5  die Forderungen stehen unangetastet da",
       zaehle("SELECT COUNT(*) AS n FROM forderung WHERE beitragslauf_id = ?", LAUF) === 4);

// Auch die Probe muss sperren -- sonst zeigte sie einen Bericht fuer
// etwas, das anschliessend gar nicht geht.
const probeGesperrt = await ruf(W.handleLaufVerwerfen,
  { lauf_id: LAUF, pruefen: true }, env, SCHATZ, cors);
pruefe("C6  auch die Probe sperrt", probeGesperrt.status === 409,
       "Status " + probeGesperrt.status);

// Die Ruecknahme oeffnet den Weg wieder.
const zurueck = await ruf(W.handleSammelZurueck,
  { sepa_datei_id: DATEI.id, grund: "Einzug hat nicht stattgefunden" }, env, SCHATZ, cors);
pruefe("C7  die Sammelbuchung laesst sich zuruecknehmen", zurueck.status === 200,
       "Status " + zurueck.status);

// =====================================================================
// D  Sperre: Uebernahme in die Buchhaltung
// =====================================================================

db.prepare("INSERT INTO geschaeftsjahr (id, jahr, beginn, ende, status, erstellt_am, " +
           "erstellt_von) VALUES (?,?,?,?,?,?,?)")
  .run("gj-2027", 2027, "2027-01-01", "2027-12-31", "offen", "2026-08-10", "test");

function bucheAuf(id, typ, quelleId, nummer) {
  db.prepare("INSERT INTO buchung (id, geschaeftsjahr_id, belegnummer, belegdatum, " +
             "buchungsdatum, text, summe_cent, art, quelle_typ, quelle_id, erstellt_am, " +
             "erstellt_von) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, "gj-2027", nummer, "2027-03-15", "2027-03-15", "Sollstellung", 33600, "normal",
         typ, quelleId, "2026-08-10", "test");
}

bucheAuf("bu-1", "beitragslauf", LAUF, 1);
const inBuch = await ruf(W.handleLaufVerwerfen, { lauf_id: LAUF }, env, SCHATZ, cors);
pruefe("D1  ein uebernommener Lauf wird abgewiesen", inBuch.status === 409,
       "Status " + inBuch.status);
pruefe("D2  mit dem Code in_buchhaltung", inBuch.daten.code === "in_buchhaltung",
       "code " + inBuch.daten.code);
pruefe("D3  und nennt die Belegnummer", /Beleg 1\b/.test(inBuch.daten.error || ""),
       inBuch.daten.error);

// Eine stornierte Buchung sperrt NICHT -- sonst bliebe ein Lauf fuer
// immer haengen, nur weil er einmal versehentlich gebucht wurde.
db.prepare("UPDATE buchung SET storniert_am = ?, storniert_von = ? WHERE id = ?")
  .run("2027-03-20", "schatz.meister", "bu-1");
const nachStorno = await ruf(W.handleLaufVerwerfen,
  { lauf_id: LAUF, pruefen: true }, env, SCHATZ, cors);
pruefe("D4  eine stornierte Buchung sperrt nicht mehr", nachStorno.status === 200,
       "Status " + nachStorno.status);

// ⚠️ Der zweite Weg: die Buchung haengt nicht am Lauf, sondern an SEINER
// SEPA-Datei (so bucht handleUebernahme den Einzug). Ohne diesen Zweig
// liesse sich der Lauf unter einer gebuchten Zahlungsseite wegloeschen.
bucheAuf("bu-2", "sepa_datei", DATEI.id, 2);
const ueberDatei = await ruf(W.handleLaufVerwerfen, { lauf_id: LAUF }, env, SCHATZ, cors);
pruefe("D5  auch eine Buchung auf die SEPA-Datei sperrt", ueberDatei.status === 409,
       "Status " + ueberDatei.status);
pruefe("D6  mit dem Code in_buchhaltung", ueberDatei.daten.code === "in_buchhaltung");
pruefe("D7  und nennt deren Belegnummer", /Beleg 2\b/.test(ueberDatei.daten.error || ""),
       ueberDatei.daten.error);

db.prepare("UPDATE buchung SET storniert_am = ?, storniert_von = ? WHERE id = ?")
  .run("2027-03-20", "schatz.meister", "bu-2");

// =====================================================================
// E  Sperre: festgeschrieben
// =====================================================================

db.prepare("UPDATE beitragslauf SET status = 'festgeschrieben' WHERE id = ?").run(LAUF);
const fest = await ruf(W.handleLaufVerwerfen, { lauf_id: LAUF }, env, SCHATZ, cors);
pruefe("E1  ein festgeschriebener Lauf wird abgewiesen", fest.status === 409,
       "Status " + fest.status);
pruefe("E2  mit dem Code festgeschrieben", fest.daten.code === "festgeschrieben",
       "code " + fest.daten.code);
pruefe("E3  auch fuer den Administrator",
       (await ruf(W.handleLaufVerwerfen, { lauf_id: LAUF }, env, ADMIN, cors)).status === 409);
pruefe("E4  und er steht danach noch da",
       zaehle("SELECT COUNT(*) AS n FROM beitragslauf WHERE id = ?", LAUF) === 1);
db.prepare("UPDATE beitragslauf SET status = 'fertig' WHERE id = ?").run(LAUF);

// =====================================================================
// F  Die Probe zaehlt und schreibt nichts
// =====================================================================

const probe = await ruf(W.handleLaufVerwerfen, { lauf_id: LAUF, pruefen: true }, env, SCHATZ, cors);
pruefe("F1  die Probe laeuft", probe.status === 200, "Status " + probe.status);
pruefe("F2  sie nennt die Bezeichnung", probe.daten.bezeichnung === "Jahresbeitrag 2027",
       probe.daten.bezeichnung);
pruefe("F3  vier Forderungen", probe.daten.forderungen === 4, "" + probe.daten.forderungen);
pruefe("F4  Summe 336,00 Euro", probe.daten.summeCent === 33600, "" + probe.daten.summeCent);
pruefe("F5  ein SEPA-Vermerk", probe.daten.sepaDateien === 1, "" + probe.daten.sepaDateien);
// Genau das ist der Punkt, an dem der Nutzer merkt, dass die stornierten
// Zahlungen mitgehen -- sonst verschwaenden sie unangekuendigt.
pruefe("F6  drei stornierte Zahlungen werden gemeldet", probe.daten.zahlungenStorniert === 3,
       "" + probe.daten.zahlungenStorniert);
pruefe("F7  die Probe schreibt nichts (Lauf)",
       zaehle("SELECT COUNT(*) AS n FROM beitragslauf WHERE id = ?", LAUF) === 1);
pruefe("F8  die Probe schreibt nichts (Forderungen)",
       zaehle("SELECT COUNT(*) AS n FROM forderung WHERE beitragslauf_id = ?", LAUF) === 4);
pruefe("F9  die Probe schreibt nichts (SEPA-Datei)",
       zaehle("SELECT COUNT(*) AS n FROM sepa_datei WHERE beitragslauf_id = ?", LAUF) === 1);
pruefe("F10 die Probe schreibt nichts (Zahlungen)",
       zaehle("SELECT COUNT(*) AS n FROM zahlung WHERE sepa_datei_id = ?", DATEI.id) === 3);
pruefe("F11 und legt keinen Protokolleintrag an",
       zaehle("SELECT COUNT(*) AS n FROM protokoll WHERE aktion = 'beitragslauf-geloescht'") === 0);

// =====================================================================
// G  Das Loeschen
// =====================================================================

// Eine fremde stornierte Zahlung, die nur ueber die SEPA-Datei an diesem
// Lauf haengt: ihre Forderung gehoert dem ZWEITEN Lauf. Sie darf nicht
// mitgeloescht, sondern nur von der Datei geloest werden.
db.prepare("INSERT INTO zahlung (id, forderung_id, haushalt_id, sepa_datei_id, betrag_cent, " +
           "eingang_am, art, storniert_am, storniert_von, erstellt_am, erstellt_von) " +
           "VALUES (?,?,?,?,?,?,?,?,?,?,?)")
  .run("z-fremd", "f-zweit", "hh-1", DATEI.id, 9600, "2027-03-15", "lastschrift",
       "2027-03-20", "test", "2026-08-10", "test");

// ⚠️ Die Probe muss die beiden Faelle GETRENNT melden. Eine gemeinsame
// Zahl waere die Ankuendigung, vier Zahlungen zu loeschen -- geloescht
// werden aber drei, die vierte wird nur von der Datei geloest.
const probeFremd = await ruf(W.handleLaufVerwerfen,
  { lauf_id: LAUF, pruefen: true }, env, SCHATZ, cors);
pruefe("G0a drei Zahlungen gehen mit", probeFremd.daten.zahlungenStorniert === 3,
       "" + probeFremd.daten.zahlungenStorniert);
pruefe("G0b die fremde wird nur geloest", probeFremd.daten.zahlungenGeloest === 1,
       "" + probeFremd.daten.zahlungenGeloest);

const geloescht = await ruf(W.handleLaufVerwerfen, { lauf_id: LAUF }, env, SCHATZ, cors);
pruefe("G1  das Loeschen laeuft", geloescht.status === 200, "Status " + geloescht.status);
pruefe("G2  es meldet die Bezeichnung zurueck",
       geloescht.daten.bezeichnung === "Jahresbeitrag 2027", geloescht.daten.bezeichnung);
pruefe("G3  und die Zahl der Forderungen", geloescht.daten.forderungen === 4,
       "" + geloescht.daten.forderungen);
pruefe("G4  der Lauf ist weg",
       zaehle("SELECT COUNT(*) AS n FROM beitragslauf WHERE id = ?", LAUF) === 0);
pruefe("G5  seine Forderungen sind weg",
       zaehle("SELECT COUNT(*) AS n FROM forderung WHERE beitragslauf_id = ?", LAUF) === 0);
pruefe("G6  die SEPA-Datei ist weg",
       zaehle("SELECT COUNT(*) AS n FROM sepa_datei WHERE beitragslauf_id = ?", LAUF) === 0);
pruefe("G7  die drei stornierten Zahlungen des Laufs sind weg",
       zaehle("SELECT COUNT(*) AS n FROM zahlung WHERE sepa_datei_id = ?", DATEI.id) === 0);

// ⚠️ Der eigentliche Grund fuer diesen Prueflauf: frueher war ein
// SEPA-Vermerk eine harte Sperre. Er ist es nicht mehr -- die Datei wird
// nirgends gespeichert, ein Vermerk ist kein Beleg dafuer, dass etwas bei
// der Bank liegt.
pruefe("G8  ein SEPA-Vermerk sperrt nicht mehr hart", geloescht.daten.sepaDateien === 1,
       "" + geloescht.daten.sepaDateien);

const prot = db.prepare("SELECT * FROM protokoll WHERE aktion = 'beitragslauf-geloescht'").all();
pruefe("G9  ein Protokolleintrag entsteht", prot.length === 1, "gefunden " + prot.length);
if (prot.length) {
  const d = JSON.parse(prot[0].detail_json || "{}");
  pruefe("G10 er haelt die Bezeichnung fest", d.bezeichnung === "Jahresbeitrag 2027");
  pruefe("G11 er haelt die Zahl der Forderungen fest", d.anzahl === 4, "" + d.anzahl);
  pruefe("G12 er haelt die geloeschten Zahlungen fest", d.zahlungenGeloescht === 3,
         "" + d.zahlungenGeloescht);
  pruefe("G13 mit dem Urheber", prot[0].username === SCHATZ.username, prot[0].username);
}

// =====================================================================
// H  Alles Fremde bleibt stehen
// =====================================================================

pruefe("H1  der zweite Lauf steht unveraendert",
       zaehle("SELECT COUNT(*) AS n FROM beitragslauf WHERE id = ?", LAUF2) === 1);
pruefe("H2  seine Forderung ebenfalls",
       zaehle("SELECT COUNT(*) AS n FROM forderung WHERE beitragslauf_id = ?", LAUF2) === 1);
// Die fremde Zahlung bleibt bestehen, verliert aber den Verweis auf die
// geloeschte Datei -- ein Fremdschluessel ins Leere waere schlimmer als
// ein fehlender Verweis.
const fremd = db.prepare("SELECT * FROM zahlung WHERE id = 'z-fremd'").get();
pruefe("H3  die fremde Zahlung steht noch da", !!fremd);
pruefe("H4  sie zeigt nicht mehr auf die geloeschte Datei", fremd && !fremd.sepa_datei_id,
       fremd && fremd.sepa_datei_id);
pruefe("H5  ihr Betrag ist unangetastet", fremd && fremd.betrag_cent === 9600);
pruefe("H6  keine Person oder Mitgliedschaft ist verschwunden",
       zaehle("SELECT COUNT(*) AS n FROM person") === 4 &&
       zaehle("SELECT COUNT(*) AS n FROM mitgliedschaft") === 4);
pruefe("H7  die SEPA-Mandate bleiben stehen",
       zaehle("SELECT COUNT(*) AS n FROM sepa_mandat") === 3);
const fkPruefung = db.prepare("PRAGMA foreign_key_check").all();
pruefe("H8  PRAGMA foreign_key_check ist leer", fkPruefung.length === 0,
       JSON.stringify(fkPruefung));

const liste = await ruf(W.handleLaufListe, env, SCHATZ, cors);
pruefe("H9  die Liste zeigt nur noch den zweiten Lauf",
       (liste.daten.laeufe || []).length === 1 && liste.daten.laeufe[0].id === LAUF2,
       JSON.stringify((liste.daten.laeufe || []).map((l) => l.id)));
pruefe("H10 und meldet das Loeschrecht mit", liste.daten.darfBuchen === true);

const listeGst = await ruf(W.handleLaufListe, env, GST, cors);
pruefe("H11 der Geschaeftsstelle meldet sie darfBuchen false",
       listeGst.daten.darfBuchen === false, "" + listeGst.daten.darfBuchen);

// =====================================================================
// I  Fail-safe ohne Buchhaltungstabelle (der Live-Zustand)
// =====================================================================

// ⚠️ In der Live-D1 gibt es `buchung` nicht -- die Buchhaltung ist dort
// nicht eingerichtet. Ein SELECT darauf wuerde die ganze Aktion werfen.
// Der Zustand wird hier selbst hergestellt, nicht vom Schema geerbt
// (dieselbe Falle wie in test-sammel-zurueck.mjs Abschnitt F).
db.exec("DROP TABLE IF EXISTS buchungszeile;");
db.exec("DROP TABLE IF EXISTS buchung;");
pruefe("I1  buchung ist wirklich weg",
       db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='buchung'")
         .get().n === 0);

const ohneBuch = await ruf(W.handleLaufVerwerfen, { lauf_id: LAUF2 }, env, SCHATZ, cors);
pruefe("I2  ohne Buchhaltungstabelle laeuft das Loeschen durch", ohneBuch.status === 200,
       "Status " + ohneBuch.status + " " + (ohneBuch.daten.error || ""));
pruefe("I3  der zweite Lauf ist danach ebenfalls weg",
       zaehle("SELECT COUNT(*) AS n FROM beitragslauf") === 0);
pruefe("I4  und seine Forderung mit ihm",
       zaehle("SELECT COUNT(*) AS n FROM forderung") === 0);
// Die fremde Zahlung haengt jetzt an einer geloeschten Forderung -- sie
// gehoerte zu diesem Lauf und geht deshalb mit.
pruefe("I5  keine Zahlung zeigt ins Leere", zaehle("SELECT COUNT(*) AS n FROM zahlung") === 0);
pruefe("I6  PRAGMA foreign_key_check bleibt leer",
       db.prepare("PRAGMA foreign_key_check").all().length === 0);

// =====================================================================

console.log("");
console.log("  " + ok + " Pruefungen gruen, " + fehler + " rot");
if (fehlerListe.length) {
  console.log("");
  for (const f of fehlerListe) console.log("  ✗ " + f);
  console.log("");
  process.exit(1);
}
console.log("");
