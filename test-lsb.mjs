// Pruefstand fuer die Bestandsmeldung an den Landessportbund (2026-08-10).
//
// Faehrt den ECHTEN Worker-Code gegen das ECHTE Schema (node:sqlite mit
// duennem D1-Aufsatz, schema-kompakt.sql eingespielt) und die ECHTE
// Client-Funktion aus lsb.js -- nichts davon ist nachgebaut.
//
//   node test-lsb.mjs
//
// Abschnitte:
//   A  Migration legt dosb_sportart_nr an, Wiederholung ist folgenlos
//   B  Die Nummer setzen: Rechte, Grenzen, Leeren
//   C  Die Meldedatei: Inhalt, Vollstaendigkeit, Rechtegrenze
//   D  Die CSV traegt die Kopfzeile der LSB-Vorlage
//   E  Sammelposten aufteilen: Vorschau, Ausfuehren, Wiederholung
//   F  Ohne die Spalte faellt nichts um (eigener Worker-Kontext)
//   G  Oberflaeche und Rechte-Gates sind verdrahtet

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

const NAMEN = ["ladeRolle", "handleMigration", "handleSpartenListe", "handleSparteSportart",
               "handleLsbExport", "handleSparteAufteilen", "handleBestandsmeldung"];
function ladeWorker() {
  return new Function(quelle + "\nreturn {" + NAMEN.join(",") + "};")();
}
const W = ladeWorker();

// --- Datenbank aufsetzen ----------------------------------------------

const db = new DatabaseSync(":memory:");
const schema = readFileSync(REPO + "/schema-kompakt.sql", "utf8");
for (const anw of schema.split(";").map((s) => s.trim()).filter(Boolean)) db.exec(anw + ";");
const env = { VV_DB: d1(db) };
const cors = {};

const STICHTAG = "2026-01-01";

const GST   = { username: "gesch.stelle", isAdmin: false, canEdit: true, canAdmin: false };
const ABT   = { username: "abt.leiter",   isAdmin: false, canEdit: true, canAdmin: false };
const VOR   = { username: "vor.stand",    isAdmin: false, canEdit: false, canAdmin: false };
const OHNE  = { username: "ohne.rolle",   isAdmin: false, canEdit: false, canAdmin: false };

function rolleGeben(username, rolle, sparteId) {
  db.exec("INSERT INTO benutzer_rolle (id, username, rolle, sparte_id, erstellt_am, erstellt_von) " +
          "VALUES ('r-" + username + "-" + rolle + "', '" + username + "', '" + rolle + "', " +
          (sparteId ? "'" + sparteId + "'" : "NULL") + ", '2026-01-01', 'test')");
}

function sparte(id, name, nr) {
  db.exec("INSERT INTO sparte (id, name, aktiv, zuschlag_cent, erstellt_am, erstellt_von) " +
          "VALUES ('" + id + "', '" + name + "', 1, 0, '2026-01-01', 'test')");
  if (nr) db.exec("UPDATE sparte SET dosb_sportart_nr = " + nr + " WHERE id = '" + id + "'");
}

// Ein Mitglied samt Person und Haushalt. Die Reihenfolge Haushalt →
// Person → Mitgliedschaft ist wegen des Fremdschluessel-Zirkels zwingend
// (siehe CLAUDE.md, Gotchas).
function mitglied(id, vorname, nachname, geschlecht, geburtsdatum, sparten) {
  db.exec("INSERT INTO haushalt (id, bezeichnung, erstellt_am, erstellt_von) " +
          "VALUES ('h-" + id + "', '" + nachname + "', '2026-01-01', 'test')");
  db.exec("INSERT INTO person (id, haushalt_id, vorname, nachname, geschlecht, geburtsdatum, " +
          "erstellt_am, erstellt_von) VALUES ('p-" + id + "', 'h-" + id + "', '" + vorname +
          "', '" + nachname + "', " + (geschlecht ? "'" + geschlecht + "'" : "NULL") + ", " +
          (geburtsdatum ? "'" + geburtsdatum + "'" : "NULL") + ", '2026-01-01', 'test')");
  db.exec("INSERT INTO mitgliedschaft (id, person_id, mitgliedsnummer, art, status, eintritt, " +
          "erstellt_am, erstellt_von) VALUES ('m-" + id + "', 'p-" + id + "', '" + id +
          "', 'ordentlich', 'aktiv', '2015-07-01', '2026-01-01', 'test')");
  (sparten || []).forEach((sp, i) => {
    db.exec("INSERT INTO mitgliedschaft_sparte (id, mitgliedschaft_id, sparte_id, eintritt, " +
            "erstellt_am, erstellt_von) VALUES ('ms-" + id + "-" + i + "', 'm-" + id + "', '" +
            sp + "', '2015-07-01', '2026-01-01', 'test')");
  });
}

sparte("sp-fuss", "Fussball", 81);
sparte("sp-breit", "Breitensport", null);
sparte("sp-wander", "Wandern", 291);
sparte("sp-turn", "Turnen", 95);

rolleGeben("gesch.stelle", "geschaeftsstelle", null);
rolleGeben("abt.leiter", "abteilungsleiter", "sp-fuss");
rolleGeben("vor.stand", "vorstand", null);

// Alter jeweils zum 01.01.2026 gerechnet.
mitglied("1001", "Anna",   "Alt",    "w", "1960-03-05", ["sp-breit"]);                 // 65
mitglied("1002", "Bernd",  "Jung",   "m", "2010-06-01", ["sp-breit"]);                 // 15
mitglied("1003", "Clara",  "Doppel", "w", "1950-01-01", ["sp-breit", "sp-wander"]);    // 76
mitglied("1004", "Dieter", "Ohne",   "m", "1980-01-01", []);                           // ohne Abteilung
mitglied("1005", "Emil",   "Zwei",   "d", "1990-05-05", ["sp-fuss", "sp-turn"]);       // zwei Sportarten
mitglied("1006", "Frida",  "Unbek",  "w", null,          ["sp-breit"]);                // ohne Geburtsdatum
mitglied("1007", "Gustav", "Neutral", null, "2000-01-01", ["sp-fuss"]);                // ohne Geschlecht

// ======================================================================
console.log("A  Migration");
// ======================================================================

// Das kompakte Schema bringt die Spalte inzwischen mit -- der Alt-Zustand
// wird deshalb hier selbst hergestellt. Ohne das erbte der Abschnitt sein
// Gruen vom Schema und pruefte nichts (dieselbe Falle wie in
// test-beitragslauf Abschnitt 0b).
db.exec("ALTER TABLE sparte DROP COLUMN dosb_sportart_nr");
const spaltenVorher = db.prepare("PRAGMA table_info(sparte)").all().map((s) => s.name);
pruefe("A1 Ausgangslage: die Spalte fehlt", !spaltenVorher.includes("dosb_sportart_nr"));

const mig1 = await W.handleMigration(env, GST, cors);
pruefe("A2 Migration laeuft durch", mig1.status === 200, "status " + mig1.status);
const spaltenNachher = db.prepare("PRAGMA table_info(sparte)").all().map((s) => s.name);
pruefe("A3 dosb_sportart_nr ist da", spaltenNachher.includes("dosb_sportart_nr"));

const mig2 = await W.handleMigration(env, GST, cors);
pruefe("A4 Wiederholung wirft nicht", mig2.status === 200, "status " + mig2.status);
pruefe("A5 Wiederholung legt nichts zweites an",
       db.prepare("PRAGMA table_info(sparte)").all()
         .filter((s) => s.name === "dosb_sportart_nr").length === 1);

// Die Migration hat die Spalte neu angelegt -- die Werte von oben sind
// dabei verlorengegangen und werden ueber die echte Aktion neu gesetzt.
for (const [id, nr] of [["sp-fuss", 81], ["sp-wander", 291], ["sp-turn", 95]]) {
  const r = await W.handleSparteSportart({ sparte_id: id, nummer: nr }, env, GST, cors);
  pruefe("A6 Nummer " + nr + " gesetzt", r.status === 200, "status " + r.status);
}

// ======================================================================
console.log("B  Die Nummer setzen");
// ======================================================================

const bGesetzt = db.prepare("SELECT dosb_sportart_nr AS nr FROM sparte WHERE id = 'sp-wander'").get();
pruefe("B1 Wandern traegt 291", bGesetzt.nr === 291, String(bGesetzt.nr));

const bLeer = await W.handleSparteSportart({ sparte_id: "sp-turn", nummer: "" }, env, GST, cors);
pruefe("B2 Leeren ist erlaubt", bLeer.status === 200, "status " + bLeer.status);
pruefe("B3 und schreibt NULL",
       db.prepare("SELECT dosb_sportart_nr AS nr FROM sparte WHERE id = 'sp-turn'").get().nr === null);
await W.handleSparteSportart({ sparte_id: "sp-turn", nummer: 95 }, env, GST, cors);

for (const [wert, name] of [[0, "Null"], [10000, "fuenfstellig"], ["abc", "Buchstaben"],
                            [12.5, "Kommazahl"], [-5, "negativ"]]) {
  const r = await W.handleSparteSportart({ sparte_id: "sp-fuss", nummer: wert }, env, GST, cors);
  pruefe("B4 " + name + " wird abgewiesen", r.status === 400, "status " + r.status);
}
pruefe("B5 Fussball traegt nach den Abweisungen unveraendert 81",
       db.prepare("SELECT dosb_sportart_nr AS nr FROM sparte WHERE id = 'sp-fuss'").get().nr === 81);

const bAbt = await W.handleSparteSportart({ sparte_id: "sp-fuss", nummer: 1 }, env, ABT, cors);
pruefe("B6 Abteilungsleiter darf nicht", bAbt.status === 403, "status " + bAbt.status);
const bVor = await W.handleSparteSportart({ sparte_id: "sp-fuss", nummer: 1 }, env, VOR, cors);
pruefe("B7 Vorstand darf nicht", bVor.status === 403, "status " + bVor.status);
const bWeg = await W.handleSparteSportart({ sparte_id: "gibt-es-nicht", nummer: 1 }, env, GST, cors);
pruefe("B8 Unbekannte Abteilung: 404", bWeg.status === 404, "status " + bWeg.status);
const bOhneId = await W.handleSparteSportart({ nummer: 1 }, env, GST, cors);
pruefe("B9 Ohne Abteilung: 400", bOhneId.status === 400, "status " + bOhneId.status);

const bListe = await (await W.handleSpartenListe(env, GST, cors)).json();
pruefe("B10 Die Liste liefert die Nummer mit",
       (bListe.sparten.find((s) => s.id === "sp-fuss") || {}).dosb_sportart_nr === 81);

// ======================================================================
console.log("C  Die Meldedatei");
// ======================================================================

const cRes = await W.handleLsbExport({ stichtag: STICHTAG }, env, GST, cors);
pruefe("C1 Geschaeftsstelle bekommt die Liste", cRes.status === 200, "status " + cRes.status);
const c = await cRes.json();

pruefe("C2 Alle sieben Mitglieder stehen drin", c.mitglieder === 7, String(c.mitglieder));
const finde = (nachname) => c.zeilen.find((z) => z.nachname === nachname);

pruefe("C3 Wer keine Abteilung hat, fehlt NICHT", !!finde("Ohne"),
       "Dieter Ohne ist aus der Meldung gefallen");
pruefe("C4 und wird namentlich gemeldet",
       c.ohne_abteilung.length === 1 && c.ohne_abteilung[0].nummer === "1004");

pruefe("C5 Geburtsdatum als TT.MM.JJJJ", finde("Alt").geburtsdatum === "05.03.1960",
       finde("Alt").geburtsdatum);
pruefe("C6 Fehlendes Geburtsdatum bleibt leer", finde("Unbek").geburtsdatum === "");
pruefe("C7 und wird namentlich gemeldet",
       c.ohne_geburtsdatum.length === 1 && c.ohne_geburtsdatum[0].nummer === "1006");

pruefe("C8 Geschlecht w bleibt w", finde("Alt").geschlecht === "w");
pruefe("C9 Geschlecht d bleibt d", finde("Zwei").geschlecht === "d");
pruefe("C10 Fehlendes Geschlecht wird zu o", finde("Neutral").geschlecht === "o");
pruefe("C11 und wird gezaehlt", c.ohne_geschlecht === 1, String(c.ohne_geschlecht));

pruefe("C12 Zwei Sportarten geben zwei Nummern",
       finde("Zwei").nummern.length === 2 &&
       finde("Zwei").nummern.includes(81) && finde("Zwei").nummern.includes(95));
pruefe("C13 Eine Abteilung ohne Nummer liefert keine",
       finde("Alt").nummern.length === 0 && finde("Alt").sparten.includes("Breitensport"));
pruefe("C14 Clara meldet nur Wandern", finde("Doppel").nummern.join() === "291");

// Anna 0, Bernd 0, Clara 1, Dieter 0, Emil 2, Frida 0, Gustav 1
pruefe("C15 Vier Meldungen an Fachverbaende", c.meldungen === 4, String(c.meldungen));

const breit = (c.ohne_nummer || []).find((s) => s.name === "Breitensport");
pruefe("C16 Breitensport wird als Abteilung ohne Nummer gemeldet", !!breit);
pruefe("C17 mit allen vier Betroffenen", breit && breit.anzahl === 4, breit && String(breit.anzahl));
pruefe("C18 Abteilungen MIT Nummer tauchen dort nicht auf",
       !(c.ohne_nummer || []).some((s) => s.name === "Fussball" || s.name === "Wandern"));

// Die Rechtegrenze: diese Antwort traegt Klarnamen.
for (const [wer, name] of [[ABT, "Abteilungsleiter"], [VOR, "Vorstand"], [OHNE, "Konto ohne Rolle"]]) {
  const r = await W.handleLsbExport({ stichtag: STICHTAG }, env, wer, cors);
  pruefe("C19 " + name + " bekommt 403", r.status === 403, "status " + r.status);
}

// Gegenprobe gegen die bestehende Auswertung: dieselben Daten, andere
// Sicht. Die Summe der Bestandsmeldung zaehlt Abteilungs-Mitgliedschaften
// (8), die Meldedatei zaehlt Personen (7).
const cMeldung = await (await W.handleBestandsmeldung({ stichtag: STICHTAG }, env, GST, cors)).json();
pruefe("C20 Die Auswertung zaehlt Zuordnungen, nicht Personen",
       cMeldung.gesamt === 8 && c.mitglieder === 7,
       "Auswertung " + cMeldung.gesamt + ", Datei " + c.mitglieder);

// Ein beendetes Mitglied gehoert nicht in die Meldung.
db.exec("UPDATE mitgliedschaft SET status = 'beendet', austritt = '2025-12-31' WHERE id = 'm-1007'");
const cOhneBeendet = await (await W.handleLsbExport({ stichtag: STICHTAG }, env, GST, cors)).json();
pruefe("C21 Wer zum Stichtag ausgetreten ist, fehlt", cOhneBeendet.mitglieder === 6,
       String(cOhneBeendet.mitglieder));
db.exec("UPDATE mitgliedschaft SET status = 'aktiv', austritt = NULL WHERE id = 'm-1007'");

// ======================================================================
console.log("D  Die CSV");
// ======================================================================

// Der echte Client-Code, aus der Datei gezogen -- nicht nachgebaut.
const lsbJs = readFileSync(REPO + "/lsb.js", "utf8");
const C = new Function(lsbJs + "\nreturn { lsbCsvText, LSB_KOPF, LSB_SPALTEN_FUER_NUMMERN };")();

const csv = C.lsbCsvText(c);
const zeilen = csv.split("\r\n");

// Byte-genau die Kopfzeile der Vorlage des LSB (Mitgliederliste.csv):
// fuenf benannte Spalten und zwei leere.
pruefe("D1 Kopfzeile wie in der Vorlage",
       zeilen[0].replace(/^﻿/, "") === "Name;Vorname;Geschlecht;Geburtsdatum;Abteilungen;;",
       zeilen[0]);
pruefe("D2 BOM steht davor", csv.charCodeAt(0) === 0xFEFF);
pruefe("D3 Eine Zeile je Mitglied plus Kopf", zeilen.length === 8, String(zeilen.length));
pruefe("D4 Semikolon als Trenner, sieben Felder",
       zeilen.every((z) => z.split(";").length === 7));

const emilZeile = zeilen.find((z) => z.startsWith("Zwei;"));
pruefe("D5 Zwei Sportarten stehen in zwei Spalten",
       emilZeile === "Zwei;Emil;d;05.05.1990;81;95;" || emilZeile === "Zwei;Emil;d;05.05.1990;95;81;",
       emilZeile);
pruefe("D6 Ohne Sportart bleiben die drei Spalten leer",
       zeilen.some((z) => z === "Ohne;Dieter;m;01.01.1980;;;"),
       zeilen.find((z) => z.startsWith("Ohne;")));
pruefe("D7 Der Nachname steht in der ERSTEN Spalte (die Vorlage nennt sie „Name“)",
       zeilen.some((z) => z.startsWith("Alt;Anna;")));
pruefe("D8 Drei Spalten fuer Nummern", C.LSB_SPALTEN_FUER_NUMMERN === 3);

// Ein Semikolon im Namen darf die Datei nicht zerlegen.
const csvHeikel = C.lsbCsvText({ zeilen: [
  { nachname: 'Mu;ller "Kurz"', vorname: "Anna", geschlecht: "w", geburtsdatum: "01.01.2000",
    nummern: [81] }] });
pruefe("D9 Semikolon und Anfuehrungszeichen werden geschuetzt",
       csvHeikel.split("\r\n")[1] === '"Mu;ller ""Kurz""";Anna;w;01.01.2000;81;;',
       csvHeikel.split("\r\n")[1]);

// ======================================================================
console.log("E  Sammelposten aufteilen");
// ======================================================================

const teilen = (extra) => W.handleSparteAufteilen(Object.assign({
  quelle_id: "sp-breit", ziel_ab_id: "sp-wander", ziel_unter_id: "sp-turn",
  grenze: 50, stichtag: STICHTAG
}, extra || {}), env, GST, cors);

const zaehleBreit = () => db.prepare(
  "SELECT COUNT(*) AS n FROM mitgliedschaft_sparte WHERE sparte_id = 'sp-breit' AND austritt IS NULL"
).get().n;

pruefe("E1 Ausgangslage: vier in Breitensport", zaehleBreit() === 4, String(zaehleBreit()));

const eVor = await (await teilen()).json();
pruefe("E2 Vorschau ist als solche gekennzeichnet", eVor.vorschau === true);
pruefe("E3 Eine Person ab 50 geht nach Wandern", eVor.ab.anzahl === 1, String(eVor.ab.anzahl));
pruefe("E4 Eine darunter geht nach Turnen", eVor.unter.anzahl === 1, String(eVor.unter.anzahl));
pruefe("E5 Zwei bleiben stehen", eVor.bleibt.length === 2, String(eVor.bleibt.length));
pruefe("E6 Naemlich Clara (schon in Wandern) und Frida (ohne Geburtsdatum)",
       eVor.bleibt.map((b) => b.mitgliedsnummer).sort().join() === "1003,1006",
       eVor.bleibt.map((b) => b.mitgliedsnummer).join());
pruefe("E7 Die Vorschau hat NICHTS geschrieben", zaehleBreit() === 4, String(zaehleBreit()));

const eTun = await (await teilen({ ausfuehren: true })).json();
pruefe("E8 Ausfuehren meldet dieselben Zahlen",
       eTun.vorschau === false && eTun.ab.anzahl === 1 && eTun.unter.anzahl === 1);
pruefe("E9 Anna steht jetzt in Wandern",
       db.prepare("SELECT sparte_id AS s FROM mitgliedschaft_sparte WHERE mitgliedschaft_id = 'm-1001'")
         .get().s === "sp-wander");
pruefe("E10 Bernd steht jetzt in Turnen",
       db.prepare("SELECT sparte_id AS s FROM mitgliedschaft_sparte WHERE mitgliedschaft_id = 'm-1002'")
         .get().s === "sp-turn");
pruefe("E11 In Breitensport bleiben zwei", zaehleBreit() === 2, String(zaehleBreit()));

// ⚠️ Umgehaengt, nicht neu angelegt: am Eintrittsdatum haengt die
// Beitragsgeschichte, und ein beendeter Sammelposten-Eintrag wuerde in
// derselben Meldung ein zweites Mal mitgezaehlt.
pruefe("E12 Das Eintrittsdatum ist unveraendert",
       db.prepare("SELECT eintritt AS e FROM mitgliedschaft_sparte WHERE mitgliedschaft_id = 'm-1001'")
         .get().e === "2015-07-01");
pruefe("E13 Es ist dieselbe Zeile, keine zweite",
       db.prepare("SELECT COUNT(*) AS n FROM mitgliedschaft_sparte WHERE mitgliedschaft_id = 'm-1001'")
         .get().n === 1);
pruefe("E14 Niemand hat eine Zuordnung verloren",
       db.prepare("SELECT COUNT(*) AS n FROM mitgliedschaft_sparte").get().n === 8);

const eNochmal = await (await teilen({ ausfuehren: true })).json();
pruefe("E15 Ein zweiter Lauf haengt nichts mehr um",
       eNochmal.ab.anzahl === 0 && eNochmal.unter.anzahl === 0,
       eNochmal.ab.anzahl + "/" + eNochmal.unter.anzahl);
pruefe("E16 und laesst den Bestand in Ruhe", zaehleBreit() === 2, String(zaehleBreit()));

const eDanach = await (await W.handleLsbExport({ stichtag: STICHTAG }, env, GST, cors)).json();
pruefe("E17 Die Meldung hat danach mehr Fachverbands-Meldungen", eDanach.meldungen === 6,
       String(eDanach.meldungen));
pruefe("E18 Die Mitgliederzahl bleibt gleich", eDanach.mitglieder === 7, String(eDanach.mitglieder));

for (const [extra, name] of [
  [{ ziel_ab_id: "sp-breit" }, "Ziel gleich Quelle"],
  [{ grenze: 0 }, "Grenze 0"],
  [{ grenze: 200 }, "Grenze 200"],
  [{ grenze: 12.5 }, "Grenze mit Komma"],
  [{ quelle_id: "" }, "ohne Quelle"],
  [{ ziel_unter_id: "" }, "ohne zweites Ziel"]
]) {
  const r = await teilen(Object.assign({ ausfuehren: true }, extra));
  pruefe("E19 " + name + " wird abgewiesen", r.status === 400, "status " + r.status);
}
const eAbt = await W.handleSparteAufteilen({
  quelle_id: "sp-breit", ziel_ab_id: "sp-wander", ziel_unter_id: "sp-turn",
  grenze: 50, ausfuehren: true }, env, ABT, cors);
pruefe("E20 Abteilungsleiter darf nicht aufteilen", eAbt.status === 403, "status " + eAbt.status);
pruefe("E21 Der Bestand steht nach allen Abweisungen unveraendert", zaehleBreit() === 2);

// ======================================================================
console.log("F  Ohne die Spalte");
// ======================================================================

// EIGENER Worker-Kontext: hatSportartSpalte merkt sich das Ja fuer die
// Lebensdauer des Isolate. Ohne einen zweiten Kontext truege der Merker
// aus Abschnitt A herueber und dieser Abschnitt pruefte nichts.
const db2 = new DatabaseSync(":memory:");
for (const anw of schema.split(";").map((s) => s.trim()).filter(Boolean)) db2.exec(anw + ";");
db2.exec("ALTER TABLE sparte DROP COLUMN dosb_sportart_nr");
db2.exec("INSERT INTO sparte (id, name, aktiv, zuschlag_cent, erstellt_am, erstellt_von) " +
         "VALUES ('sp-1', 'Fussball', 1, 0, '2026-01-01', 'test')");
db2.exec("INSERT INTO benutzer_rolle (id, username, rolle, sparte_id, erstellt_am, erstellt_von) " +
         "VALUES ('r2', 'gesch.stelle', 'geschaeftsstelle', NULL, '2026-01-01', 'test')");
db2.exec("INSERT INTO haushalt (id, bezeichnung, erstellt_am, erstellt_von) VALUES ('h2','X','2026-01-01','test')");
db2.exec("INSERT INTO person (id, haushalt_id, vorname, nachname, geschlecht, geburtsdatum, " +
         "erstellt_am, erstellt_von) VALUES ('p2','h2','Hans','Test','m','1990-01-01','2026-01-01','test')");
db2.exec("INSERT INTO mitgliedschaft (id, person_id, mitgliedsnummer, art, status, eintritt, " +
         "erstellt_am, erstellt_von) VALUES ('m2','p2','2001','ordentlich','aktiv','2015-01-01','2026-01-01','test')");
db2.exec("INSERT INTO mitgliedschaft_sparte (id, mitgliedschaft_id, sparte_id, eintritt, " +
         "erstellt_am, erstellt_von) VALUES ('ms2','m2','sp-1','2015-01-01','2026-01-01','test')");

const W2 = ladeWorker();
const env2 = { VV_DB: d1(db2) };

const fListe = await W2.handleSpartenListe(env2, GST, cors);
pruefe("F1 Die Abteilungsliste faellt ohne die Spalte nicht um", fListe.status === 200,
       "status " + fListe.status);
pruefe("F2 und liefert die Nummer als leer",
       (await fListe.json()).sparten[0].dosb_sportart_nr === null);

const fExport = await W2.handleLsbExport({ stichtag: STICHTAG }, env2, GST, cors);
pruefe("F3 Die Meldedatei entsteht trotzdem", fExport.status === 200, "status " + fExport.status);
const fE = await fExport.json();
pruefe("F4 mit dem Hinweis, dass die Spalte fehlt", fE.spalte_fehlt === true);
pruefe("F5 und ohne Sportartennummern", fE.meldungen === 0, String(fE.meldungen));
pruefe("F6 Die Person steht trotzdem drin", fE.mitglieder === 1, String(fE.mitglieder));

// Die Aktion zieht die Spalte selbst nach -- der Aufrufer haette sie ueber
// handleMigration ohnehin bekommen.
const fSetzen = await W2.handleSparteSportart({ sparte_id: "sp-1", nummer: 81 }, env2, GST, cors);
pruefe("F7 Die Nummer laesst sich ohne vorherige Migration setzen", fSetzen.status === 200,
       "status " + fSetzen.status);
pruefe("F8 und steht danach in der Datenbank",
       db2.prepare("SELECT dosb_sportart_nr AS nr FROM sparte WHERE id = 'sp-1'").get().nr === 81);

// ======================================================================
console.log("G  Oberflaeche");
// ======================================================================

const indexHtml = readFileSync(REPO + "/index.html", "utf8");
const appJs = readFileSync(REPO + "/app.js", "utf8");
const antraegeJs = readFileSync(REPO + "/antraege.js", "utf8");
const workerJs = roh;
const vorstandHtml = readFileSync(REPO + "/vorstand.html", "utf8");

pruefe("G1 index.html hat die Karte", /id="lsb-karte"/.test(indexHtml));
pruefe("G2 Die Karte startet versteckt", /id="lsb-karte"[^>]*hidden/.test(indexHtml));
pruefe("G3 app.js zeigt sie nur mit darfSchreiben",
       /darfSchreiben[\s\S]{0,600}lsbKarteZeigen\(\)/.test(appJs));
pruefe("G4 index.html laedt lsb.js vor app.js",
       indexHtml.indexOf('lsb.js?v=') > 0 &&
       indexHtml.indexOf('lsb.js?v=') < indexHtml.indexOf('app.js?v='));
pruefe("G5 lsb.js ist mit Cache-Bust eingebunden", /lsb\.js\?v=[0-9.]+/.test(indexHtml));

// ⚠️ Die Vorstandsseite darf diesen Weg nicht kennen: sie laedt bewusst
// keinen Code, der Personendaten anzeigen kann.
pruefe("G6 vorstand.html laedt lsb.js NICHT", !/lsb\.js/.test(vorstandHtml));
pruefe("G7 und ruft vv-lsb-export nicht auf", !/vv-lsb-export/.test(vorstandHtml));
pruefe("G8 Der Export haengt im Worker an darfSchreiben, nicht an darfKennzahlenSehen",
       /handleLsbExport[\s\S]{0,400}rolle\.darfSchreiben/.test(workerJs) &&
       !/handleLsbExport[\s\S]{0,400}darfKennzahlenSehen/.test(workerJs));

pruefe("G9 antraege.js zeigt das Nummernfeld", /an-sp-nr/.test(antraegeJs));
pruefe("G10 und speichert es einzeln ueber vv-sparte-sportart",
       /vv-sparte-sportart/.test(antraegeJs));
pruefe("G11 gespeichert wird beim Verlassen, nicht bei jeder Ziffer",
       /addEventListener\("change", \(\) => setzeSportart/.test(antraegeJs));
pruefe("G12 Der Worker kennt beide neuen Aktionen",
       /case "vv-sparte-sportart"/.test(workerJs) && /case "vv-lsb-export"/.test(workerJs) &&
       /case "vv-sparte-aufteilen"/.test(workerJs));
pruefe("G13 schema.sql und schema-kompakt.sql tragen die Spalte",
       /dosb_sportart_nr/.test(readFileSync(REPO + "/schema.sql", "utf8")) &&
       /dosb_sportart_nr/.test(readFileSync(REPO + "/schema-kompakt.sql", "utf8")));
pruefe("G14 Der Changelog nennt die Neuerung",
       /Landessportbund/.test(readFileSync(REPO + "/config.js", "utf8")));

// ======================================================================
console.log("");
console.log(fehler === 0
  ? "ALLES GRUEN — " + ok + " Zusagen"
  : ok + " gruen, " + fehler + " ROT:\n  " + fehlerListe.join("\n  "));
process.exit(fehler === 0 ? 0 : 1);
