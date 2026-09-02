// Pruefstand fuer den Zahlungsrhythmus des Beitragslaufs (2026-08-10).
//
// Faehrt den ECHTEN Worker-Code gegen das ECHTE Schema (node:sqlite mit
// duennem D1-Aufsatz, schema-kompakt.sql eingespielt). Anlass: Michel
// wollte den Beitragslauf nicht nur fuers Gesamtjahr, sondern auch
// halb- und vierteljaehrlich fahren koennen.
//
//   node test-rhythmus.mjs
//
// Die zwei Zusagen, an denen alles haengt:
//   * Ein JAHRESLAUF rechnet bitgleich wie vor dieser Aenderung.
//   * Die Summe aller Raten ist auf den Cent genau der Jahresbeitrag --
//     ein Rhythmus teilt, er vervielfacht nicht.
//
// Abschnitte:
//   A  Aufbau: Beitragsordnung und Bestand mit bekannter Kontrollzahl
//   B  Der Jahreslauf als Bezugsgroesse
//   C  Vierteljaehrlich: vier Laeufe, Summe gleich, Restcent
//   D  Halbjaehrlich
//   E  Der Bestandsfilter folgt der Periode, nicht dem Kalenderjahr
//   F  Anteilig innerhalb einer Rate
//   G  handleLaufAnlegen: Termine, Bezeichnungen, Doppelpruefung, Rechte
//   H  Altbestand: periode 'jaehrlich' rechnet wie ein Jahreslauf
//   I  SEPA: Rate im Verwendungszweck und in den Kennungen
//   J  Die reinen Rechenregeln einzeln

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

const namen = ["ladeRolle", "handleMigration", "handleLaufAnlegen", "handleLaufVorschau",
               "handleLaufAusfuehren", "handleLaufDetail", "handleSepaErzeugen",
               "handleVorabankuendigung", "berechneBetrag", "rateAusJahressatz",
               "periodeGrenzen", "periodeInfo", "verschiebeMonate", "RHYTHMEN"];
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

const ADMIN  = { username: "admin", isAdmin: true, canEdit: true, canAdmin: true };
const SCHATZ = { username: "schatz.meister", isAdmin: false, canEdit: true, canAdmin: false };
const GST    = { username: "gesch.stelle", isAdmin: false, canEdit: true, canAdmin: false };
const OHNE   = { username: "ohne.rolle", isAdmin: false, canEdit: false, canAdmin: false };

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

// Die echte Beitragsordnung, dazu eine bewusst KRUMME Klasse: 99,99 EUR
// geht durch vier nicht auf und ist damit der einzige Fall, an dem sich
// die Restcent-Regel ueberhaupt messen laesst.
const KLASSEN = [
  { id: "k-erw",    name: "Erwachsener",         betrag: 9600 },
  { id: "k-kind",   name: "Kinder/Jugendliche",  betrag: 7200 },
  { id: "k-fam",    name: "Erwachsener (Familie)", betrag: 4800 },
  { id: "k-krumm",  name: "Sondersatz",          betrag: 9999 }
];
for (const k of KLASSEN) {
  db.prepare("INSERT INTO beitragsklasse (id, name, sortierung, aktiv, erstellt_am, erstellt_von) " +
             "VALUES (?,?,?,1,?,?)").run(k.id, k.name, 100, "2026-01-01", "test");
  db.prepare("INSERT INTO beitragssatz (id, beitragsklasse_id, gueltig_ab, betrag_cent, " +
             "erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?)")
    .run("s-" + k.id, k.id, "2020-01-01", k.betrag, "2026-01-01", "test");
}

// Bestand mit bekannter Kontrollzahl. eintritt/austritt sind absichtlich
// so gesetzt, dass Abschnitt E daran messen kann.
const BESTAND = [
  { nr: "1001", name: "Anton Beispiel",   klasse: "k-erw",   eintritt: "2010-01-01", austritt: null },
  { nr: "1002", name: "Berta Beispiel",   klasse: "k-erw",   eintritt: "2010-01-01", austritt: null },
  { nr: "1003", name: "Cesar Beispiel",   klasse: "k-erw",   eintritt: "2010-01-01", austritt: null },
  { nr: "1004", name: "Dora Beispiel",    klasse: "k-erw",   eintritt: "2010-01-01", austritt: null },
  { nr: "1005", name: "Emil Beispiel",    klasse: "k-kind",  eintritt: "2010-01-01", austritt: null },
  { nr: "1006", name: "Frida Beispiel",   klasse: "k-kind",  eintritt: "2010-01-01", austritt: null },
  { nr: "1007", name: "Gustav Beispiel",  klasse: "k-fam",   eintritt: "2010-01-01", austritt: null },
  { nr: "1008", name: "Hanna Beispiel",   klasse: "k-fam",   eintritt: "2010-01-01", austritt: null },
  { nr: "1009", name: "Ida Beispiel",     klasse: "k-krumm", eintritt: "2010-01-01", austritt: null }
];
// 4×9600 + 2×7200 + 2×4800 + 9999
const JAHRESSUMME = 4 * 9600 + 2 * 7200 + 2 * 4800 + 9999;

function legeMitgliedAn(m) {
  const [vorname, nachname] = m.name.split(" ");
  const hh = "hh-" + m.nr, pid = "p-" + m.nr;
  db.prepare("INSERT INTO haushalt (id, erstellt_am, erstellt_von) VALUES (?,?,?)")
    .run(hh, "2026-01-01", "test");
  db.prepare("INSERT INTO person (id, haushalt_id, vorname, nachname, geburtsdatum, strasse, " +
             "plz, ort, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(pid, hh, vorname, nachname, "1980-01-01", "Musterweg 1", "37308",
         "Heilbad Heiligenstadt", "2026-01-01", "test");
  db.prepare("UPDATE haushalt SET zahler_person_id = ? WHERE id = ?").run(pid, hh);
  db.prepare("INSERT INTO mitgliedschaft (id, person_id, mitgliedsnummer, art, eintritt, austritt, " +
             "status, beitragsklasse_id, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run("m-" + m.nr, pid, m.nr, "ordentlich", m.eintritt, m.austritt, "aktiv", m.klasse,
         "2026-01-01", "test");
  db.prepare("INSERT INTO sepa_mandat (id, haushalt_id, referenz, kontoinhaber, iban, " +
             "erteilt_am, quelle, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,?,?,?)")
    .run("md-" + m.nr, hh, "M-" + m.nr, m.name, IBAN, "2020-01-01", "import",
         "2026-01-01", "test");
}
for (const m of BESTAND) legeMitgliedAn(m);

pruefe("A2  neun Mitglieder im Bestand",
       zaehle("SELECT COUNT(*) AS n FROM mitgliedschaft") === 9);
pruefe("A3  Kontrollzahl des Aufbaus steht bei 723,99 EUR", JAHRESSUMME === 72399,
       String(JAHRESSUMME));

// Einen Lauf komplett durchfahren (blockweise, wie der Client es tut)
// und zurueckgeben, was dabei entstanden ist.
async function fahreLauf(id) {
  let runden = 0;
  for (;;) {
    const r = await ruf(W.handleLaufAusfuehren, { lauf_id: id }, env, SCHATZ, cors);
    if (r.status !== 200) return { status: r.status, daten: r.daten, runden };
    runden++;
    if (r.daten.fertig || runden > 20) break;
  }
  const summe = db.prepare("SELECT COALESCE(SUM(betrag_cent),0) AS s, COUNT(*) AS n " +
                           "FROM forderung WHERE beitragslauf_id = ?").get(id);
  return { status: 200, runden, summeCent: summe.s, anzahl: summe.n };
}

// =====================================================================
// B  Der Jahreslauf als Bezugsgroesse
// =====================================================================

const jahresLauf = await ruf(W.handleLaufAnlegen,
  { jahr: 2027, faelligkeit: "2027-03-15", stichtag: "2027-01-01" }, env, SCHATZ, cors);
pruefe("B1  Jahreslauf wird angelegt", jahresLauf.status === 200, "Status " + jahresLauf.status);
pruefe("B2  ohne Rhythmus entsteht GENAU EIN Lauf", jahresLauf.daten.ids.length === 1,
       "ids " + JSON.stringify(jahresLauf.daten.ids));
pruefe("B3  Rhythmus meldet sich als jaehrlich", jahresLauf.daten.rhythmus === "jaehrlich",
       jahresLauf.daten.rhythmus);

const JAHR_ID = jahresLauf.daten.id;
pruefe("B4  periode steht als 'jahr' in der Datenbank",
       db.prepare("SELECT periode FROM beitragslauf WHERE id = ?").get(JAHR_ID).periode === "jahr");
pruefe("B5  Bezeichnung unveraendert 'Jahresbeitrag 2027'",
       db.prepare("SELECT bezeichnung FROM beitragslauf WHERE id = ?").get(JAHR_ID)
         .bezeichnung === "Jahresbeitrag 2027");

const vorschau = await ruf(W.handleLaufVorschau, { lauf_id: JAHR_ID }, env, SCHATZ, cors);
pruefe("B6  Vorschau nennt die Kontrollzahl", vorschau.daten.summeCent === JAHRESSUMME,
       "summeCent " + vorschau.daten.summeCent + " statt " + JAHRESSUMME);
pruefe("B7  Vorschau schreibt nichts", zaehle("SELECT COUNT(*) AS n FROM forderung") === 0);

const jahrGefahren = await fahreLauf(JAHR_ID);
pruefe("B8  Jahreslauf erzeugt neun Forderungen", jahrGefahren.anzahl === 9,
       "anzahl " + jahrGefahren.anzahl);
pruefe("B9  ⚠️ KONTROLLZAHL: der Jahreslauf rechnet unveraendert",
       jahrGefahren.summeCent === JAHRESSUMME,
       "summe " + jahrGefahren.summeCent + " statt " + JAHRESSUMME);
pruefe("B10 forderung.periode steht auf 'jahr'",
       zaehle("SELECT COUNT(*) AS n FROM forderung WHERE periode = 'jahr'") === 9);

// Ein zweiter Durchlauf desselben Laufs darf nichts hinzufuegen -- das
// ist der Index idx_ford_lauf_eindeutig, und daran haengt die doppelte
// Abbuchung beim Mitglied.
db.prepare("UPDATE beitragslauf SET fortschritt_ab = NULL, status = 'entwurf' WHERE id = ?")
  .run(JAHR_ID);
const nochmal = await fahreLauf(JAHR_ID);
pruefe("B11 ein zweiter Durchlauf legt nichts doppelt an",
       nochmal.anzahl === 9 && nochmal.summeCent === JAHRESSUMME,
       "anzahl " + nochmal.anzahl + ", summe " + nochmal.summeCent);

// =====================================================================
// C  Vierteljaehrlich
// =====================================================================

const viertel = await ruf(W.handleLaufAnlegen,
  { jahr: 2028, faelligkeit: "2028-03-15", stichtag: "2028-01-01",
    rhythmus: "vierteljaehrlich" }, env, SCHATZ, cors);
pruefe("C1  vierteljaehrlich wird angelegt", viertel.status === 200, "Status " + viertel.status);
pruefe("C2  es entstehen VIER Laeufe", viertel.daten.ids.length === 4,
       "ids " + viertel.daten.ids.length);
pruefe("C3  mit den Perioden q1..q4",
       JSON.stringify(viertel.daten.angelegt.map((a) => a.periode)) ===
       JSON.stringify(["q1", "q2", "q3", "q4"]),
       JSON.stringify(viertel.daten.angelegt.map((a) => a.periode)));
pruefe("C4  Termine im Abstand von drei Monaten",
       JSON.stringify(viertel.daten.angelegt.map((a) => a.faelligkeit)) ===
       JSON.stringify(["2028-03-15", "2028-06-15", "2028-09-15", "2028-12-15"]),
       JSON.stringify(viertel.daten.angelegt.map((a) => a.faelligkeit)));
pruefe("C5  die Bezeichnung nennt die Rate",
       viertel.daten.angelegt[2].bezeichnung === "Mitgliedsbeitrag 2028 - 3. Quartal",
       viertel.daten.angelegt[2].bezeichnung);

let viertelSumme = 0;
const viertelAnzahl = [];
for (const a of viertel.daten.angelegt) {
  const g = await fahreLauf(a.id);
  viertelSumme += g.summeCent;
  viertelAnzahl.push(g.anzahl);
}
pruefe("C6  jeder der vier Laeufe erzeugt neun Forderungen",
       viertelAnzahl.every((n) => n === 9), JSON.stringify(viertelAnzahl));
pruefe("C7  ⚠️ KONTROLLZAHL: vier Raten ergeben zusammen den Jahresbeitrag",
       viertelSumme === JAHRESSUMME, "summe " + viertelSumme + " statt " + JAHRESSUMME);

// Der Restcent: 9999 durch vier geht nicht auf. Er gehoert auf die
// ERSTE Rate, nicht ans Jahresende.
const krummQ = viertel.daten.angelegt.map((a) =>
  db.prepare("SELECT betrag_cent FROM forderung WHERE beitragslauf_id = ? AND mitgliedschaft_id = ?")
    .get(a.id, "m-1009").betrag_cent);
pruefe("C8  Restcent liegt auf der ersten Rate",
       JSON.stringify(krummQ) === JSON.stringify([2502, 2499, 2499, 2499]),
       JSON.stringify(krummQ));
pruefe("C9  und die vier Raten ergeben genau 99,99 EUR",
       krummQ.reduce((s, x) => s + x, 0) === 9999, String(krummQ.reduce((s, x) => s + x, 0)));

// Eine glatte Klasse teilt sich glatt.
const erwQ = viertel.daten.angelegt.map((a) =>
  db.prepare("SELECT betrag_cent FROM forderung WHERE beitragslauf_id = ? AND mitgliedschaft_id = ?")
    .get(a.id, "m-1001").betrag_cent);
pruefe("C10 96 EUR werden zu viermal 24 EUR",
       JSON.stringify(erwQ) === JSON.stringify([2400, 2400, 2400, 2400]), JSON.stringify(erwQ));

pruefe("C11 forderung.periode traegt die Rate",
       zaehle("SELECT COUNT(*) AS n FROM forderung WHERE periode = 'q3'") === 9);

// ⚠️ Die vier Laeufe sind vier EIGENSTAENDIGE Laeufe -- der eindeutige
// Index greift je Lauf, nicht ueber alle.
pruefe("C12 dasselbe Mitglied hat vier Forderungen fuer 2028",
       zaehle("SELECT COUNT(*) AS n FROM forderung WHERE mitgliedschaft_id = 'm-1001' " +
              "AND jahr = 2028") === 4);

// =====================================================================
// D  Halbjaehrlich
// =====================================================================

const halb = await ruf(W.handleLaufAnlegen,
  { jahr: 2029, faelligkeit: "2029-02-15", stichtag: "2029-01-01",
    rhythmus: "halbjaehrlich" }, env, SCHATZ, cors);
pruefe("D1  es entstehen ZWEI Laeufe", halb.daten.ids.length === 2, "ids " + halb.daten.ids.length);
pruefe("D2  Termine im Abstand von sechs Monaten",
       JSON.stringify(halb.daten.angelegt.map((a) => a.faelligkeit)) ===
       JSON.stringify(["2029-02-15", "2029-08-15"]),
       JSON.stringify(halb.daten.angelegt.map((a) => a.faelligkeit)));

let halbSumme = 0;
for (const a of halb.daten.angelegt) halbSumme += (await fahreLauf(a.id)).summeCent;
pruefe("D3  ⚠️ KONTROLLZAHL: zwei Raten ergeben zusammen den Jahresbeitrag",
       halbSumme === JAHRESSUMME, "summe " + halbSumme + " statt " + JAHRESSUMME);

const krummH = halb.daten.angelegt.map((a) =>
  db.prepare("SELECT betrag_cent FROM forderung WHERE beitragslauf_id = ? AND mitgliedschaft_id = ?")
    .get(a.id, "m-1009").betrag_cent);
pruefe("D4  99,99 EUR teilen sich in 50,00 und 49,99",
       JSON.stringify(krummH) === JSON.stringify([5000, 4999]), JSON.stringify(krummH));

// =====================================================================
// E  Der Bestandsfilter folgt der PERIODE
// =====================================================================
//
// ⚠️ Das ist die Stelle, an der ein Ratenlauf falsch wird, ohne dass es
// auffaellt: wer im August eintritt, darf keine Forderung fuer das erste
// Quartal bekommen -- die Rate berechnete einen Zeitraum, den es beim
// Mitglied nie gab.

legeMitgliedAn({ nr: "2001", name: "Neu Beispiel", klasse: "k-erw",
                 eintritt: "2030-08-01", austritt: null });
legeMitgliedAn({ nr: "2002", name: "Weg Beispiel", klasse: "k-erw",
                 eintritt: "2010-01-01", austritt: "2030-03-31" });

const eLauf = await ruf(W.handleLaufAnlegen,
  { jahr: 2030, faelligkeit: "2030-03-15", stichtag: "2030-01-01",
    rhythmus: "vierteljaehrlich" }, env, SCHATZ, cors);
const eIds = eLauf.daten.angelegt;
for (const a of eIds) await fahreLauf(a.id);

function hat(laufId, mitglied) {
  return zaehle("SELECT COUNT(*) AS n FROM forderung WHERE beitragslauf_id = ? " +
                "AND mitgliedschaft_id = ?", laufId, mitglied) === 1;
}
pruefe("E1  Eintritt im August: KEINE Forderung im 1. Quartal", !hat(eIds[0].id, "m-2001"));
pruefe("E2  Eintritt im August: KEINE Forderung im 2. Quartal", !hat(eIds[1].id, "m-2001"));
pruefe("E3  Eintritt im August: Forderung im 3. Quartal",       hat(eIds[2].id, "m-2001"));
pruefe("E4  Eintritt im August: Forderung im 4. Quartal",       hat(eIds[3].id, "m-2001"));
pruefe("E5  Austritt Ende Maerz: Forderung im 1. Quartal",      hat(eIds[0].id, "m-2002"));
pruefe("E6  Austritt Ende Maerz: KEINE im 2. Quartal",         !hat(eIds[1].id, "m-2002"));
pruefe("E7  Austritt Ende Maerz: KEINE im 4. Quartal",         !hat(eIds[3].id, "m-2002"));

// Gegenprobe: derselbe Bestand als JAHRESLAUF nimmt beide mit -- der
// Filter ist also wirklich die Periode und nicht etwa ein Fehler, der
// Mitglieder verschluckt.
const eJahr = await ruf(W.handleLaufAnlegen,
  { jahr: 2030, faelligkeit: "2030-03-15", stichtag: "2030-01-01", trotzdem: true },
  env, SCHATZ, cors);
await fahreLauf(eJahr.daten.id);
pruefe("E8  Gegenprobe: der Jahreslauf nimmt den Augusteintritt mit",
       hat(eJahr.daten.id, "m-2001"));
pruefe("E9  Gegenprobe: und den Maerzaustritt ebenfalls", hat(eJahr.daten.id, "m-2002"));

// ⚠️ Ohne "anteilig" zahlt auch der Augusteintritt die VOLLE Rate seines
// Quartals -- das ist die geltende Vereinsregel, nicht ein vergessener
// Sonderfall.
pruefe("E10 ohne Haekchen zahlt der Augusteintritt die volle Quartalsrate",
       db.prepare("SELECT betrag_cent FROM forderung WHERE beitragslauf_id = ? " +
                  "AND mitgliedschaft_id = ?").get(eIds[2].id, "m-2001").betrag_cent === 2400);

// ⚠️ Hier misst der Abschnitt den SQL-Filter selbst, nicht nur sein
// Ergebnis. Ohne die Periodengrenzen in sammleLaufZeilen liefen dieselben
// Mitglieder ueber berechneBetrag heraus -- die Forderungen stimmten also
// weiterhin, aber sie landeten als "im Zeitraum nicht Mitglied"
// NAMENTLICH im Ausschlussbericht des Schatzmeisters. Genau diese
// Mutation ist beim ersten Gegenlauf durch alle Prueflinge geschluepft.
const eVorschau = await ruf(W.handleLaufVorschau, { lauf_id: eIds[0].id }, env, SCHATZ, cors);
const eNamen = (eVorschau.daten.ausschluesse || [])
  .flatMap((g) => (g.beispiele || []).map((b) => b.mitgliedsnummer));
pruefe("E11 der Augusteintritt steht NICHT im Ausschlussbericht des 1. Quartals",
       !eNamen.includes("2001"), JSON.stringify(eVorschau.daten.ausschluesse));
pruefe("E12 das 1. Quartal meldet ueberhaupt keinen Ausschluss",
       eVorschau.daten.ausschlussGesamt === 0,
       "ausschlussGesamt " + eVorschau.daten.ausschlussGesamt);

// Gegenprobe zu E11/E12: der Bericht ist nicht etwa immer leer. Ein
// Ehrenmitglied gehoert dort hinein und steht dort auch.
db.prepare("UPDATE mitgliedschaft SET art = 'ehrenmitglied' WHERE id = 'm-1008'").run();
const eEhren = await ruf(W.handleLaufVorschau, { lauf_id: eIds[0].id }, env, SCHATZ, cors);
pruefe("E13 Gegenprobe: ein Ehrenmitglied steht sehr wohl im Bericht",
       eEhren.daten.ausschlussGesamt === 1 &&
       (eEhren.daten.ausschluesse[0].beispiele || [])[0].mitgliedsnummer === "1008",
       JSON.stringify(eEhren.daten.ausschluesse));
db.prepare("UPDATE mitgliedschaft SET art = 'ordentlich' WHERE id = 'm-1008'").run();

// Und dieselbe Zahl fuer den Fortschrittsbalken: er zaehlt die Menge der
// PERIODE, nicht die des Kalenderjahrs. Ein Balken, der eine andere
// Menge misst als der Lauf verarbeitet, zaehlt nicht -- er wackelt.
pruefe("E14 anzahl_erwartet zaehlt periodengerecht",
       db.prepare("SELECT anzahl_erwartet AS n FROM beitragslauf WHERE id = ?")
         .get(eIds[0].id).n === 10,
       "erwartet " + db.prepare("SELECT anzahl_erwartet AS n FROM beitragslauf WHERE id = ?")
         .get(eIds[0].id).n);

// =====================================================================
// F  Anteilig innerhalb einer Rate
// =====================================================================

const fLauf = await ruf(W.handleLaufAnlegen,
  { jahr: 2031, faelligkeit: "2031-03-15", stichtag: "2031-01-01",
    rhythmus: "vierteljaehrlich", anteilig: true }, env, SCHATZ, cors);
const fIds = fLauf.daten.angelegt;
for (const a of fIds) await fahreLauf(a.id);

// Eintritt 01.08.2030 -- im 3. Quartal 2031 laengst dabei, also volle
// Rate. Ein Mitglied MIT unterjaehrigem Eintritt im Rechenjahr ist
// noetig, damit anteilig ueberhaupt greift.
legeMitgliedAn({ nr: "3001", name: "Anteil Beispiel", klasse: "k-erw",
                 eintritt: "2031-08-20", austritt: null });
const f2 = await ruf(W.handleLaufAnlegen,
  { jahr: 2031, faelligkeit: "2031-03-15", stichtag: "2031-01-01",
    rhythmus: "vierteljaehrlich", anteilig: true, trotzdem: true }, env, SCHATZ, cors);
const f2Ids = f2.daten.angelegt;
for (const a of f2Ids) await fahreLauf(a.id);

function betrag(laufId, mitglied) {
  const r = db.prepare("SELECT betrag_cent FROM forderung WHERE beitragslauf_id = ? " +
                       "AND mitgliedschaft_id = ?").get(laufId, mitglied);
  return r ? r.betrag_cent : null;
}
// Q3 = Juli bis September, Eintritt am 20.08. -> August und September,
// also 2 von 3 Monaten der Rate: 2400 * 2/3 = 1600.
pruefe("F1  anteilig rechnet die Monate INNERHALB der Rate",
       betrag(f2Ids[2].id, "m-3001") === 1600, "betrag " + betrag(f2Ids[2].id, "m-3001"));
pruefe("F2  das vierte Quartal ist danach wieder voll",
       betrag(f2Ids[3].id, "m-3001") === 2400, "betrag " + betrag(f2Ids[3].id, "m-3001"));
pruefe("F3  im ersten Quartal gibt es gar keine Forderung",
       betrag(f2Ids[0].id, "m-3001") === null);
pruefe("F4  anteilig laesst die ganzjaehrigen Mitglieder unberuehrt",
       betrag(f2Ids[2].id, "m-1001") === 2400, "betrag " + betrag(f2Ids[2].id, "m-1001"));

// Dieselbe Regel im Jahreslauf: Eintritt 20.08. = fuenf von zwoelf
// Monaten. Das ist der Stand von vor dieser Aenderung, unveraendert.
const fJahr = await ruf(W.handleLaufAnlegen,
  { jahr: 2031, faelligkeit: "2031-03-15", stichtag: "2031-01-01",
    anteilig: true, trotzdem: true }, env, SCHATZ, cors);
await fahreLauf(fJahr.daten.id);
pruefe("F5  im Jahreslauf gilt die alte Rechnung unveraendert (5/12 von 96 EUR)",
       betrag(fJahr.daten.id, "m-3001") === 4000, "betrag " + betrag(fJahr.daten.id, "m-3001"));

// =====================================================================
// G  handleLaufAnlegen im Einzelnen
// =====================================================================

// Ein selbst gesetzter Termin darf NIE ueberschrieben werden.
const gEigen = await ruf(W.handleLaufAnlegen,
  { jahr: 2032, faelligkeit: "2032-03-15", stichtag: "2032-01-01",
    rhythmus: "vierteljaehrlich",
    termine: ["2032-03-15", "", "2032-08-01", ""] }, env, SCHATZ, cors);
pruefe("G1  ein eigener Termin bleibt stehen",
       gEigen.daten.angelegt[2].faelligkeit === "2032-08-01",
       gEigen.daten.angelegt[2].faelligkeit);
pruefe("G2  die leeren werden abgeleitet",
       gEigen.daten.angelegt[1].faelligkeit === "2032-06-15" &&
       gEigen.daten.angelegt[3].faelligkeit === "2032-12-15",
       JSON.stringify(gEigen.daten.angelegt.map((a) => a.faelligkeit)));

// ⚠️ Die Doppelpruefung darf nicht innerhalb der Serie zuschlagen --
// sonst stuende nach dem Anlegen genau ein Lauf da und die uebrigen drei
// waeren mit 409 abgewiesen worden.
pruefe("G3  die Serie stolpert nicht ueber ihren eigenen ersten Lauf",
       zaehle("SELECT COUNT(*) AS n FROM beitragslauf WHERE jahr = 2032") === 4);

const gDoppelt = await ruf(W.handleLaufAnlegen,
  { jahr: 2032, faelligkeit: "2032-03-15", rhythmus: "halbjaehrlich" }, env, SCHATZ, cors);
pruefe("G4  ein zweiter Rhythmus fuer dasselbe Jahr wird abgewiesen", gDoppelt.status === 409,
       "Status " + gDoppelt.status);
pruefe("G5  mit dem Code schon_vorhanden", gDoppelt.daten.code === "schon_vorhanden");
pruefe("G6  und es ist wirklich nichts entstanden",
       zaehle("SELECT COUNT(*) AS n FROM beitragslauf WHERE jahr = 2032") === 4);

const gTrotzdem = await ruf(W.handleLaufAnlegen,
  { jahr: 2032, faelligkeit: "2032-03-15", rhythmus: "halbjaehrlich", trotzdem: true },
  env, SCHATZ, cors);
pruefe("G7  mit trotzdem geht es durch", gTrotzdem.status === 200);
pruefe("G8  und legt beide Raten an",
       zaehle("SELECT COUNT(*) AS n FROM beitragslauf WHERE jahr = 2032") === 6);

// Unbekannter Rhythmus faellt auf jaehrlich zurueck statt zu werfen.
const gUnbekannt = await ruf(W.handleLaufAnlegen,
  { jahr: 2033, faelligkeit: "2033-03-15", rhythmus: "monatlich" }, env, SCHATZ, cors);
pruefe("G9  unbekannter Rhythmus faellt auf jaehrlich zurueck",
       gUnbekannt.status === 200 && gUnbekannt.daten.rhythmus === "jaehrlich" &&
       gUnbekannt.daten.ids.length === 1,
       JSON.stringify({ s: gUnbekannt.status, r: gUnbekannt.daten.rhythmus }));

// Eine eigene Bezeichnung wird um die Rate ergaenzt, nicht ersetzt.
const gName = await ruf(W.handleLaufAnlegen,
  { jahr: 2034, faelligkeit: "2034-03-15", rhythmus: "halbjaehrlich",
    bezeichnung: "Sonderumlage Sporthalle" }, env, SCHATZ, cors);
pruefe("G10 eigene Bezeichnung bleibt erhalten und nennt die Rate",
       gName.daten.angelegt[1].bezeichnung === "Sonderumlage Sporthalle - 2. Halbjahr",
       gName.daten.angelegt[1].bezeichnung);

// Rechte -- unveraendert am Schatzmeister.
for (const [wer, konto] of [["Geschaeftsstelle", GST], ["ohne Rolle", OHNE]]) {
  const r = await ruf(W.handleLaufAnlegen,
    { jahr: 2035, faelligkeit: "2035-03-15", rhythmus: "vierteljaehrlich" }, env, konto, cors);
  pruefe("G11 " + wer + " darf keinen Rhythmus anlegen", r.status === 403, "Status " + r.status);
}
pruefe("G12 nach den Abweisungen ist kein Lauf entstanden",
       zaehle("SELECT COUNT(*) AS n FROM beitragslauf WHERE jahr = 2035") === 0);

const gDatum = await ruf(W.handleLaufAnlegen,
  { jahr: 2036, faelligkeit: "keins", rhythmus: "vierteljaehrlich" }, env, SCHATZ, cors);
pruefe("G13 ohne Faelligkeit gibt es keinen Rhythmus", gDatum.status === 400,
       "Status " + gDatum.status);

// =====================================================================
// H  Altbestand: periode 'jaehrlich'
// =====================================================================
//
// ⚠️ Bis zu dieser Aenderung schrieb der Worker "jaehrlich" in eine
// Spalte, deren Schema "jahr" vorsieht. Genau das steht in der Live-D1.

db.prepare("INSERT INTO beitragslauf (id, bezeichnung, jahr, periode, stichtag, faelligkeit, " +
           "status, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,'entwurf',?,?)")
  .run("lauf-alt", "Jahresbeitrag 2040", 2040, "jaehrlich", "2040-01-01", "2040-03-15",
       "2026-08-10", "test");
const altGefahren = await fahreLauf("lauf-alt");
pruefe("H1  ein Altlauf mit periode 'jaehrlich' laeuft durch", altGefahren.status === 200);
pruefe("H2  und rechnet die volle Jahressumme",
       altGefahren.summeCent === JAHRESSUMME + 2 * 9600,
       "summe " + altGefahren.summeCent);

const altDetail = await ruf(W.handleLaufDetail, { lauf_id: "lauf-alt" }, env, SCHATZ, cors);
pruefe("H3  das Detail meldet ihn als Jahreslauf", altDetail.daten.lauf.periode === "jahr",
       altDetail.daten.lauf.periode);
pruefe("H4  ein unbekannter Periodenwert faellt ebenfalls auf jahr zurueck",
       W.periodeInfo("quartal-7").periode === "jahr");

// =====================================================================
// I  SEPA
// =====================================================================

const iLauf = await ruf(W.handleLaufAnlegen,
  { jahr: 2041, faelligkeit: "2041-03-15", stichtag: "2041-01-01",
    rhythmus: "vierteljaehrlich" }, env, SCHATZ, cors);
const iIds = iLauf.daten.angelegt;
for (const a of iIds) await fahreLauf(a.id);

const sepaQ2 = await ruf(W.handleSepaErzeugen,
  { lauf_id: iIds[1].id, ausfuehrung_am: "2041-06-15" }, env, SCHATZ, cors);
pruefe("I1  SEPA-Datei fuer das 2. Quartal wird erzeugt", sepaQ2.status === 200,
       "Status " + sepaQ2.status + " " + (sepaQ2.daten.error || ""));
const xmlQ2 = sepaQ2.daten.xml || "";
pruefe("I2  der Verwendungszweck nennt die Rate", /Mitgliedsbeitrag 2041 2\. Quartal/.test(xmlQ2),
       (xmlQ2.match(/<Ustrd>[^<]*<\/Ustrd>/) || [""])[0]);
pruefe("I3  die EndToEndId traegt sie ebenfalls", /<EndToEndId>B2041Q2-/.test(xmlQ2),
       (xmlQ2.match(/<EndToEndId>[^<]*<\/EndToEndId>/) || [""])[0]);
pruefe("I4  und die Nachrichtenkennung auch", /VV2041Q2-/.test(xmlQ2),
       (xmlQ2.match(/<MsgId>[^<]*<\/MsgId>/) || [""])[0]);

const sepaJahr = await ruf(W.handleSepaErzeugen,
  { lauf_id: JAHR_ID, ausfuehrung_am: "2027-03-15" }, env, SCHATZ, cors);
const xmlJahr = sepaJahr.daten.xml || "";
pruefe("I5  ⚠️ ein Jahreslauf schreibt den Zweck unveraendert",
       /<Ustrd>Mitgliedsbeitrag 2027 Nr\./.test(xmlJahr),
       (xmlJahr.match(/<Ustrd>[^<]*<\/Ustrd>/) || [""])[0]);
pruefe("I6  und traegt keine Rate in der Kennung", /<EndToEndId>B2027-/.test(xmlJahr),
       (xmlJahr.match(/<EndToEndId>[^<]*<\/EndToEndId>/) || [""])[0]);

// Gegenprobe: der Zweck ist wirklich verschieden -- ohne sie waere I2
// auch dann gruen, wenn beide Dateien denselben Text truegen.
pruefe("I7  Gegenprobe: die beiden Zwecke sind nicht derselbe Text",
       (xmlQ2.match(/<Ustrd>([^<]*)<\/Ustrd>/) || [])[1] !==
       (xmlJahr.match(/<Ustrd>([^<]*)<\/Ustrd>/) || [])[1]);

const vorab = await ruf(W.handleVorabankuendigung, { lauf_id: iIds[1].id }, env, SCHATZ, cors);
pruefe("I8  die Vorabankuendigung nennt die Rate", vorab.daten.periodeText === "2. Quartal",
       vorab.daten.periodeText);
const vorabJahr = await ruf(W.handleVorabankuendigung, { lauf_id: JAHR_ID }, env, SCHATZ, cors);
pruefe("I9  beim Jahreslauf bleibt sie leer", vorabJahr.daten.periodeText === "",
       JSON.stringify(vorabJahr.daten.periodeText));

// Ein eigenes Muster mit Platzhalter bestimmt die Stelle selbst.
db.prepare("INSERT OR REPLACE INTO einstellung (schluessel, wert) VALUES (?,?)")
  .run("verwendungszweck", "SC1911 {periode} {jahr}");
const sepaQ3 = await ruf(W.handleSepaErzeugen,
  { lauf_id: iIds[2].id, ausfuehrung_am: "2041-09-15" }, env, SCHATZ, cors);
pruefe("I10 {periode} im eigenen Muster wird an seiner Stelle ersetzt",
       /<Ustrd>SC1911 3\. Quartal 2041 Nr\./.test(sepaQ3.daten.xml || ""),
       ((sepaQ3.daten.xml || "").match(/<Ustrd>[^<]*<\/Ustrd>/) || [""])[0]);

// ⚠️ Beim Jahreslauf ist {periode} leer. Ohne das Zusammenziehen stuende
// im Verwendungszweck ein doppeltes Leerzeichen -- sichtbar auf jedem
// Kontoauszug, und die 140 Zeichen sind knapp.
const iJahr = await ruf(W.handleLaufAnlegen,
  { jahr: 2042, faelligkeit: "2042-03-15", stichtag: "2042-01-01" }, env, SCHATZ, cors);
await fahreLauf(iJahr.daten.id);
const sepa2042 = await ruf(W.handleSepaErzeugen,
  { lauf_id: iJahr.daten.id, ausfuehrung_am: "2042-03-15" }, env, SCHATZ, cors);
const zweck2042 = ((sepa2042.daten.xml || "").match(/<Ustrd>([^<]*)<\/Ustrd>/) || [])[1] || "";
pruefe("I11 ein leeres {periode} hinterlaesst keine Luecke",
       zweck2042.startsWith("SC1911 2042 Nr.") && !/ {2}/.test(zweck2042),
       JSON.stringify(zweck2042));

// Und zurueck auf das Standardmuster, damit spaetere Abschnitte nicht
// stillschweigend auf diesem hier aufsetzen.
db.prepare("DELETE FROM einstellung WHERE schluessel = 'verwendungszweck'").run();

// =====================================================================
// J  Die Rechenregeln einzeln
// =====================================================================

pruefe("J1  jaehrlich hat eine Rate, halbjaehrlich zwei, vierteljaehrlich vier",
       W.RHYTHMEN.jaehrlich.length === 1 && W.RHYTHMEN.halbjaehrlich.length === 2 &&
       W.RHYTHMEN.vierteljaehrlich.length === 4);

const gJahr = W.periodeGrenzen(2027, "jahr");
pruefe("J2  Jahresgrenzen 01.01. bis 31.12.",
       gJahr.von === "2027-01-01" && gJahr.bis === "2027-12-31" && gJahr.monate === 12,
       JSON.stringify(gJahr));
const gQ1 = W.periodeGrenzen(2027, "q1");
pruefe("J3  Q1 endet am 31.03.", gQ1.von === "2027-01-01" && gQ1.bis === "2027-03-31",
       JSON.stringify(gQ1));
const gQ2 = W.periodeGrenzen(2027, "q2");
pruefe("J4  Q2 endet am 30.06. -- nicht am 31.",
       gQ2.von === "2027-04-01" && gQ2.bis === "2027-06-30", JSON.stringify(gQ2));
const gH1Schalt = W.periodeGrenzen(2028, "h1");
pruefe("J5  H1 endet am 30.06., auch im Schaltjahr", gH1Schalt.bis === "2028-06-30",
       gH1Schalt.bis);

pruefe("J6  ein glatter Satz teilt sich glatt",
       W.rateAusJahressatz(9600, "q1") === 2400 && W.rateAusJahressatz(9600, "q4") === 2400);
pruefe("J7  ein krummer Satz legt den Rest auf die erste Rate",
       W.rateAusJahressatz(9999, "q1") === 2502 && W.rateAusJahressatz(9999, "q2") === 2499 &&
       W.rateAusJahressatz(9999, "q3") === 2499 && W.rateAusJahressatz(9999, "q4") === 2499);
pruefe("J8  ein Jahreslauf teilt gar nicht", W.rateAusJahressatz(9999, "jahr") === 9999);
pruefe("J9  und die Summe der Raten ist immer der ganze Satz",
       [1, 7, 99, 100, 4999, 9999, 39972].every((satz) =>
         ["q1", "q2", "q3", "q4"].reduce((s, p) => s + W.rateAusJahressatz(satz, p), 0) === satz &&
         ["h1", "h2"].reduce((s, p) => s + W.rateAusJahressatz(satz, p), 0) === satz));

pruefe("J10 ein Monatssprung begrenzt den Tag aufs Monatsende",
       W.verschiebeMonate("2027-01-31", 1) === "2027-02-28",
       W.verschiebeMonate("2027-01-31", 1));
pruefe("J11 im Schaltjahr auf den 29.",
       W.verschiebeMonate("2028-01-31", 1) === "2028-02-29",
       W.verschiebeMonate("2028-01-31", 1));
pruefe("J12 ein Sprung ueber den Jahreswechsel zaehlt das Jahr hoch",
       W.verschiebeMonate("2027-11-15", 3) === "2028-02-15",
       W.verschiebeMonate("2027-11-15", 3));
pruefe("J13 neun Monate ab Maerz landen im Dezember",
       W.verschiebeMonate("2027-03-15", 9) === "2027-12-15",
       W.verschiebeMonate("2027-03-15", 9));

// berechneBetrag einzeln -- ohne Datenbank, genau dafuer ist sie so
// gebaut.
const bJahr = W.berechneBetrag(9600, 2027, "jahr", "2010-01-01", null, false);
pruefe("J14 Jahreslauf: voller Satz, zwoelf Monate",
       bJahr.betrag_cent === 9600 && bJahr.monate === 12, JSON.stringify(bJahr));
const bQ3 = W.berechneBetrag(9600, 2027, "q3", "2010-01-01", null, false);
pruefe("J15 Q3: ein Viertel, drei Monate",
       bQ3.betrag_cent === 2400 && bQ3.monate === 3, JSON.stringify(bQ3));
pruefe("J16 wer im Zeitraum nicht Mitglied war, faellt heraus",
       W.berechneBetrag(9600, 2027, "q1", "2027-08-01", null, false) === null);
pruefe("J17 der Jahressatz steht zur Nachvollziehbarkeit mit in der Herleitung",
       bQ3.satz_jahr_cent === 9600 && bQ3.periode === "q3" && bQ3.periodeText === "3. Quartal",
       JSON.stringify(bQ3));

// =====================================================================

console.log("");
console.log("Pruefstand Zahlungsrhythmus");
console.log("  bestanden: " + ok);
console.log("  gescheitert: " + fehler);
if (fehler) {
  console.log("");
  for (const f of fehlerListe) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("");
console.log("  Kontrollzahlen: Jahreslauf " + (JAHRESSUMME / 100).toFixed(2) + " EUR, " +
            "vier Quartale zusammen " + (viertelSumme / 100).toFixed(2) + " EUR, " +
            "zwei Halbjahre zusammen " + (halbSumme / 100).toFixed(2) + " EUR.");
