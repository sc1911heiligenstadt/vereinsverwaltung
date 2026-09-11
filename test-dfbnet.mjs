// Pruefstand fuer den DFBnet-Abgleich (11.09.2026).
//
// Faehrt den ECHTEN Worker-Code gegen das ECHTE Schema (node:sqlite mit
// duennem D1-Aufsatz, schema-kompakt.sql eingespielt) und dazu die
// ECHTEN Lesefunktionen aus dfbnet.js.
//
//   node test-dfbnet.mjs
//
// Abschnitte:
//   A  Die Datei lesen (Kopfzeile finden, Datum, Mannschaft aus dem Blatt)
//   B  Der Abgleich gegen die echte Datenbank
//   C  Doppelte Zeilen zusammenfassen
//   D  Das Jahrgangsfenster kommt aus der Datei
//   E  Die Rechtegrenze der Passstelle
//   F  Gegenproben und Mutationen
//   G  Die Handzuordnung
//   H  Die Filterfelder
//   I  Die gespeicherte Meldeliste
//   J  Der Vorfilter der Vorschlaege
//   K  Die Luecken im Bestand (Bugjagd 11.09.2026)
//   L  Zuordnungen ohne Zeile in der Meldeliste (Abnahme 11.09.2026)
//
// ⚠️ ALLE Namen und Geburtsdaten hier sind ERFUNDEN und muessen es
// bleiben. Dieses Repo ist oeffentlich, und es geht um minderjaehrige
// Mitglieder. Am 10.09.2026 standen in einem Pruefstand dieses Repos
// zuerst die echten Namen aus einem Screenshot -- gefunden erst nach dem
// Push. Ein Testwert, der wie ein echter aussieht, ist meistens einer.

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
    // ⚠️ Ein batch ist in D1 EIN Rundlauf, egal wie viele Anweisungen
    // darin stehen. Der Aufsatz muss das nachbilden, sonst misst F7b die
    // Anweisungen statt der Rundlaeufe -- und ein blockweiser Import
    // saehe aus wie eine Schleife.
    async batch(liste) {
      const vorher = lauf.abfragen;
      const out = [];
      for (const a of liste) out.push(a.run());
      lauf.abfragen = vorher + 1;
      return out;
    }
  };
}

// --- Der echte Code ---------------------------------------------------

const rohWorker = readFileSync(REPO + "/vereinsverwaltung-worker.js", "utf8");
const schnitt = rohWorker.indexOf("export default");
if (schnitt < 0) throw new Error("export default nicht gefunden");
const W = new Function(rohWorker.slice(0, schnitt) +
  "\nreturn { handleDfbnetAbgleich, handleDfbnetImport, handleDfbnetZuordnen, " +
  "handleMigration, ladeRolle, kodexSchluessel, DFBNET_MAX_ZEILEN, " +
  "namensIndex, namensKandidaten, kodexTeileListe, kodexAehnlichkeit, " +
  "KODEX_VORSCHLAG_PUNKTE };")();

// dfbnet.js benutzt $, esc, datumDe und XLSX erst beim ZEICHNEN. Die drei
// Lesefunktionen kommen ohne aus -- genau deshalb stehen sie getrennt.
const rohClient = readFileSync(REPO + "/dfbnet.js", "utf8");
const C = new Function(rohClient +
  "\nreturn { dfbKopfFinden, dfbDatum, dfbMannschaftAusBlatt, dfbKopfWort, " +
  "dfbSuchform, dfbNameTrifft, dfbLuecke, dfbVerwaisteKarte };")();
// ⚠️ dfbnet.js ruft esc() und datumDe() als FREIE Variablen -- im Browser
// kommen sie aus app.js. Hier werden die ECHTEN Funktionen aus app.js
// herausgeschnitten statt nachgebaut: eine eigene Attrappe prüfte sonst
// das Escaping der Attrappe, nicht das ausgelieferte.
const rohApp = readFileSync(REPO + "/app.js", "utf8");
const escQuelle = (rohApp.match(/function esc\(wert\)[\s\S]*?\n\}/) || [""])[0];
const datQuelle = (rohApp.match(/function datumDe\(iso\)[\s\S]*?\n\}/) || [""])[0];
if (!escQuelle || !datQuelle) throw new Error("esc/datumDe nicht aus app.js zu holen");
const H = new Function(escQuelle + "\n" + datQuelle + "\nreturn { esc, datumDe };")();
globalThis.esc = H.esc;
globalThis.datumDe = H.datumDe;

// ======================================================================
console.log("A  Die Datei lesen");
// ======================================================================

// Der echte Export traegt drei Kopfzeilen ueber der Tabelle. Nachgebaut,
// nicht abgeschrieben: Aufbau originalgetreu, Inhalte erfunden.
const BLATT = [
  [null, "1. SC 1911 Heiligenstadt e.V", null, null, null, null, null],
  [null, "  DFBnet  ", null, null, null, null, null],
  [null, null, null, null, null, null, null],
  ["D-Junioren II - 17 Spieler   (Stand 11.09.2026)", null, null, null, null, null, null],
  [null, null, null, null, null, null, null],
  ["Nr.", "Nachname", "Vorname", "Geburtsdatum", "Jahrgang", "Alter", "aktiv"],
  ["1", "Bergmoser", "Jarno", new Date(2008, 2, 9), "2008", "18", "ja"]
];

const kopf = C.dfbKopfFinden(BLATT);
pruefe("A1 Die Kopfzeile wird gefunden, nicht geraten", kopf && kopf.zeile === 5,
       kopf ? "Zeile " + kopf.zeile : "nicht gefunden");
pruefe("A2 Nachname, Vorname und Geburtsdatum sind zugeordnet",
       kopf && kopf.spalten.nachname === 1 && kopf.spalten.vorname === 2
       && kopf.spalten.geburt === 3, JSON.stringify(kopf && kopf.spalten));
pruefe("A3 Ohne Mannschaftsspalte bleibt sie unbesetzt",
       kopf && kopf.spalten.mannschaft === undefined);

// ⚠️ Die Gegenprobe: ein Blatt OHNE Geburtsdatum darf nicht als Tabelle
// durchgehen. Ohne diese Zusage waere A1 auch dann gruen, wenn die
// Erkennung schon bei zwei Spalten zuschlaegt -- und der Server lehnte
// anschliessend jede Zeile ab, ohne dass jemand wuesste warum.
pruefe("A4 Zwei von drei Spalten reichen NICHT",
       C.dfbKopfFinden([["Nachname", "Vorname", "Mannschaft"], ["Bergmoser", "Jarno", "D2"]])
         === null);

// Die Uebersicht des Exports hat keine dieser Spalten.
pruefe("A5 Ein Blatt ohne Namensspalten wird uebergangen",
       C.dfbKopfFinden([["Mannschaft", "Spieler", "Jahrgaenge"], ["D-Junioren", 17, "2015"]])
         === null);

pruefe("A6 Der Mannschaftsname kommt aus der Titelzeile",
       C.dfbMannschaftAusBlatt(BLATT, 5, "D-Junioren II") === "D-Junioren II",
       C.dfbMannschaftAusBlatt(BLATT, 5, "D-Junioren II"));

pruefe("A7 Ohne Titelzeile taugt der Blattname",
       C.dfbMannschaftAusBlatt([[null]], 1, "C-Junioren") === "C-Junioren");

// ⚠️ Aus "Alle Spieler" darf KEIN Mannschaftsname werden -- das Blatt
// fuehrt die Mannschaft in einer eigenen Spalte, und "Alle Spieler" als
// Mannschaft stuende hinterher in der Auswertung.
pruefe("A8 Generische Blattnamen werden nicht zur Mannschaft",
       C.dfbMannschaftAusBlatt([[null]], 1, "Alle Spieler") === "" &&
       C.dfbMannschaftAusBlatt([[null]], 1, "Zuordnung getroffen") === "" &&
       C.dfbMannschaftAusBlatt([[null]], 1, "Tabelle1") === "");

// --- Das Datum --------------------------------------------------------
//
// ⚠️ Der wichtigste Fall zuerst: ein Date-Objekt auf Mitternacht. Ueber
// toISOString() kaeme in deutscher Sommerzeit der VORTAG heraus -- und
// ein um einen Tag verschobenes Geburtsdatum bricht den
// Abgleichsschluessel lautlos.
pruefe("A9 Ein Date auf Mitternacht behaelt seinen Tag",
       C.dfbDatum(new Date(2008, 2, 9)) === "2008-03-09",
       C.dfbDatum(new Date(2008, 2, 9)));
pruefe("A10 Auch der Monatserste, wo die Verschiebung ins Vormonatsende faellt",
       C.dfbDatum(new Date(2015, 6, 1)) === "2015-07-01",
       C.dfbDatum(new Date(2015, 6, 1)));
pruefe("A11 Deutsches Datum als Text", C.dfbDatum("9.3.2008") === "2008-03-09");
pruefe("A12 Einstellige Tage und Monate werden aufgefuellt",
       C.dfbDatum("1.7.2015") === "2015-07-01", C.dfbDatum("1.7.2015"));
pruefe("A13 ISO bleibt ISO", C.dfbDatum("2008-03-09 00:00:00") === "2008-03-09");
pruefe("A14 Unbrauchbares wird leer, nicht geraten",
       C.dfbDatum("") === "" && C.dfbDatum(null) === "" && C.dfbDatum("k. A.") === "");

// ======================================================================
console.log("B  Der Abgleich gegen die echte Datenbank");
// ======================================================================

const db = new DatabaseSync(":memory:");
for (const anw of readFileSync(REPO + "/schema-kompakt.sql", "utf8")
                    .split(";").map((s) => s.trim()).filter(Boolean)) {
  db.exec(anw + ";");
}
const env = { VV_DB: d1(db) };
const cors = {};
const WER = "'2020-01-01', 'pruefer'";

const ADMIN = { username: "admin", isAdmin: true, canEdit: true, canAdmin: true };
const PASS = { username: "pass.stelle", isAdmin: false, canEdit: true, canAdmin: false };
db.exec("INSERT INTO benutzer_rolle (id, username, rolle, sparte_id, erstellt_am, " +
        "erstellt_von) VALUES ('r-pass', 'pass.stelle', 'passstelle', NULL, " + WER + ")");

await W.handleMigration(env, ADMIN, cors);

function sparte(id, name) {
  db.exec("INSERT INTO sparte (id, name, aktiv, erstellt_am, erstellt_von) VALUES ('" +
          id + "', '" + name + "', 1, " + WER + ") ON CONFLICT(id) DO NOTHING");
}
sparte("sp-fu", "Fussball");
sparte("sp-tu", "Turnen");

function legeAn(id, vorname, nachname, geburt, nr, sparteId, status, austritt) {
  db.exec("INSERT INTO person (id, vorname, nachname, geburtsdatum, erstellt_am, " +
          "erstellt_von) VALUES ('" + id + "', '" + vorname + "', '" + nachname +
          "', '" + geburt + "', " + WER + ")");
  db.exec("INSERT INTO mitgliedschaft (id, person_id, mitgliedsnummer, art, eintritt, " +
          "austritt, status, erstellt_am, erstellt_von) VALUES ('m-" + id + "', '" + id +
          "', '" + nr + "', 'ordentlich', '2020-01-01', " +
          (austritt ? "'" + austritt + "'" : "NULL") + ", '" + (status || "aktiv") + "', " +
          WER + ")");
  if (sparteId) {
    db.exec("INSERT INTO mitgliedschaft_sparte (id, mitgliedschaft_id, sparte_id, " +
            "eintritt, erstellt_am, erstellt_von) VALUES ('ms-" + id + "', 'm-" + id +
            "', '" + sparteId + "', '2020-01-01', " + WER + ")");
  }
}

// Der erfundene Bestand.
legeAn("p-ber", "Jarno", "Bergmoser", "2008-03-09", "301", "sp-fu");           // Treffer
legeAn("p-gru", "Mira", "Grünbaum", "2012-03-04", "302", "sp-fu");             // Umlaut-Fall
legeAn("p-ste", "Nele", "Steinweg", "2016-08-22", "303", "sp-tu");             // Turnkind
legeAn("p-fel", "Ansgar", "Feldbach", "2015-01-07", "304", "sp-fu",
       "beendet", "2025-12-31");                                              // ausgetreten
legeAn("p-arn", "Korbinian", "Arnholt", "2013-05-05", "305", "sp-fu");            // nicht gemeldet
legeAn("p-son", "Barbara", "Sonnleitner", "1984-02-02", "306", "sp-fu");      // ausserhalb
legeAn("p-wal", "Ida", "Waldsee", "2019-06-01", "307", "sp-fu");              // ausserhalb
legeAn("p-kel", "Rasmus", "Kellinghusen", "2008-02-14", "308", "sp-fu");      // volljaehrig

// Ein offener Aufnahmeantrag -- die Familie wartet auf den Beschluss.
// ⚠️ Mit einer IBAN im JSON: die Gegenprobe unten weist nach, dass sie in
// keiner Antwort auftaucht.
db.exec("INSERT INTO aufnahmeantrag (id, eingang_am, status, antrag_json, sparten_json) " +
        "VALUES ('a-har', '2026-09-01', 'neu', " +
        "'{\"vorname\":\"Piet\",\"nachname\":\"Harkort\",\"geburtsdatum\":\"2014-02-11\"," +
        "\"iban\":\"DE02100500000054540402\"}', '[]')");

const STICHTAG = "2026-09-11";

// Die gemeldete Liste -- so, wie dfbDateiLesen sie liefert.
const DATEI = [
  { nachname: "Bergmoser", vorname: "Jarno", geburtsdatum: "2008-03-09",
    mannschaft: "A-Junioren", aktiv: "ja" },
  // Umlaut weggelassen: der strenge Schluessel trifft nicht mehr.
  { nachname: "Grunbaum", vorname: "Mira", geburtsdatum: "2012-03-04",
    mannschaft: "C-Junioren", aktiv: "ja" },
  { nachname: "Steinweg", vorname: "Nele", geburtsdatum: "2016-08-22",
    mannschaft: "E-Junioren", aktiv: "ja" },
  { nachname: "Feldbach", vorname: "Ansgar", geburtsdatum: "2015-01-07",
    mannschaft: "D-Junioren", aktiv: "ja" },
  { nachname: "Harkort", vorname: "Piet", geburtsdatum: "2014-02-11",
    mannschaft: "D-Junioren", aktiv: "ja" },
  { nachname: "Zaubermann", vorname: "Ferdinand", geburtsdatum: "2011-11-11",
    mannschaft: "B-Junioren", aktiv: "nein" },
  // Dieselbe Person ein zweites Mal, aus dem Blatt "Zuordnung getroffen".
  { nachname: "Bergmoser", vorname: "Jarno", geburtsdatum: "2008-03-09",
    mannschaft: "B-Junioren", aktiv: "ja" },
  // Eine Zeile ohne Geburtsdatum.
  { nachname: "Ohnedatum", vorname: "Nora", geburtsdatum: "", mannschaft: "C-Junioren",
    aktiv: "ja" }
];

// ⚠️ Zwei Schritte, seit die Liste gespeichert wird: einlesen schreibt
// (darfSchreiben), abgleichen liest (darfNachwuchs). Der Abgleich bekommt
// KEINE Spielerliste mehr im Koerper -- er nimmt die gespeicherte.
const einlesen = (liste, wer) => W.handleDfbnetImport(
  { spieler: liste, dateiname: "pruefstand.xlsx", blaetter: "Alle Spieler (8)" },
  env, wer || ADMIN, cors);
const lauf = async (wer) => (await W.handleDfbnetAbgleich(
  { stichtag: STICHTAG }, env, wer || ADMIN, cors)).json();

const rImport = await einlesen(DATEI);
const antwort = await lauf();

const lage = (name) => (antwort.offen.find((o) => o.name.indexOf(name) >= 0) || {}).lage;
const offenZu = (name) => antwort.offen.find((o) => o.name.indexOf(name) >= 0) || {};

pruefe("B0 Das Einlesen geht durch", rImport.status === 200, "" + rImport.status);
pruefe("B1 Die Antwort kommt durch", antwort.ok === true, JSON.stringify(antwort).slice(0, 200));
// Acht Zeilen, davon eine ohne Geburtsdatum und eine Doppelte: bleiben sechs.
pruefe("B2 Sechs Spieler nach dem Zusammenfassen", antwort.anzahl_gemeldet === 6,
       "" + antwort.anzahl_gemeldet);
pruefe("B2b Treffer und offene Faelle ergeben zusammen genau diese sechs",
       antwort.treffer.length + antwort.offen.length === antwort.anzahl_gemeldet,
       antwort.treffer.length + " + " + antwort.offen.length);
pruefe("B3 Ein Treffer: der exakt passende", antwort.treffer.length === 1,
       antwort.treffer.map((t) => t.name).join(", "));
pruefe("B4 Der Treffer traegt die Mitgliedsnummer",
       antwort.treffer[0] && antwort.treffer[0].mitgliedsnummer === "301",
       antwort.treffer[0] && antwort.treffer[0].mitgliedsnummer);

pruefe("B5 Fuenf Spieler sind nicht als Fussball-Mitglied gefuehrt",
       antwort.offen.length === 5, antwort.offen.map((o) => o.name).join(", "));
pruefe("B6 Das Turnkind steht als andere Abteilung",
       lage("Steinweg") === "andere_abteilung", lage("Steinweg"));
pruefe("B7 Die Abteilung wird benannt",
       /Turnen/.test(offenZu("Steinweg").hinweis), offenZu("Steinweg").hinweis);
pruefe("B8 Der Ausgetretene steht als ausgetreten",
       lage("Feldbach") === "ausgetreten", lage("Feldbach"));
pruefe("B9 Der offene Antrag wird als solcher erkannt",
       lage("Harkort") === "antrag", lage("Harkort"));
pruefe("B10 Der Antrag nennt sein Eingangsdatum",
       /2026-09-01/.test(offenZu("Harkort").hinweis), offenZu("Harkort").hinweis);
pruefe("B11 Der Umlaut-Fall findet keinen exakten Treffer",
       lage("Grunbaum") === "unbekannt", lage("Grunbaum"));
pruefe("B12 Der voellig Unbekannte auch nicht",
       lage("Zaubermann") === "unbekannt", lage("Zaubermann"));

// --- Die Vorschlaege --------------------------------------------------
const vGru = offenZu("Grunbaum").vorschlaege || [];
pruefe("B13 Der Umlaut-Fall bekommt einen Vorschlag", vGru.length >= 1, "" + vGru.length);
pruefe("B14 Und zwar das richtige Kind",
       vGru[0] && vGru[0].name === "Mira Grünbaum", vGru[0] && vGru[0].name);
pruefe("B15 Der Vorschlag nennt seinen Grund",
       vGru[0] && vGru[0].gruende.length >= 2, vGru[0] && (vGru[0].gruende || []).join(" · "));
pruefe("B16 Der Vorschlag ist als Fussball-Mitglied gekennzeichnet",
       vGru[0] && vGru[0].im_fussball === true);

// ⚠️ Die Gegenprobe zum Vorschlagslauf: wer wirklich niemandem aehnelt,
// bekommt auch keinen. Ohne diese Zeile waere B13 auch dann gruen, wenn
// die Bewertung jedem alles vorschlaegt.
pruefe("B17 Der voellig Unbekannte bekommt KEINEN Vorschlag",
       (offenZu("Zaubermann").vorschlaege || []).length === 0,
       (offenZu("Zaubermann").vorschlaege || []).map((v) => v.name).join(", "));

// --- Die Gegenrichtung ------------------------------------------------
const nichtGemeldet = antwort.nicht_gemeldet.map((n) => n.name);
pruefe("B18 Korbinian Arnholt zahlt und ist nicht gemeldet",
       nichtGemeldet.indexOf("Korbinian Arnholt") >= 0, nichtGemeldet.join(", "));
pruefe("B19 Mira Grünbaum steht ebenfalls dort -- der Schluessel traf ja nicht",
       nichtGemeldet.indexOf("Mira Grünbaum") >= 0, nichtGemeldet.join(", "));

// ⚠️ Die Quervernetzung: dasselbe Kind steht links als "kein Mitglied"
// und rechts als "nicht gemeldet". Ohne den Hinweis liest das jeder als
// zwei Faelle -- und sucht nach einem Kind, das es nicht gibt.
const gruZeile = antwort.nicht_gemeldet.find((n) => n.name === "Mira Grünbaum") || {};
pruefe("B20 Sie traegt den Hinweis auf die andere Schreibweise",
       gruZeile.vermutlich === "Mira Grunbaum", gruZeile.vermutlich);
pruefe("B21 Korbinian Arnholt traegt keinen -- ihn hat niemand gemeldet",
       (antwort.nicht_gemeldet.find((n) => n.name === "Korbinian Arnholt") || {}).vermutlich === null);

pruefe("B22 Der ausgetretene Feldbach steht NICHT als 'nicht gemeldet'",
       nichtGemeldet.indexOf("Ansgar Feldbach") < 0, nichtGemeldet.join(", "));
pruefe("B23 Das Turnkind steht NICHT als 'nicht gemeldet'",
       nichtGemeldet.indexOf("Nele Steinweg") < 0, nichtGemeldet.join(", "));
pruefe("B24 Der Treffer steht NICHT als 'nicht gemeldet'",
       nichtGemeldet.indexOf("Jarno Bergmoser") < 0, nichtGemeldet.join(", "));

// ⚠️ Gegenprobe auf das Datenleck: die IBAN steht wirklich im Antrag --
// ohne diese Zeile waere die naechste auch dann gruen, wenn das Feld nie
// gesetzt worden waere.
const ibanDa = db.prepare("SELECT antrag_json FROM aufnahmeantrag WHERE id = 'a-har'").get();
pruefe("B25 Gegenprobe: die IBAN steht in der Datenbank",
       /DE02100500000054540402/.test(ibanDa.antrag_json));
pruefe("B26 ... und in keiner Antwort",
       !/DE02100500000054540402/.test(JSON.stringify(antwort)));

// ======================================================================
console.log("C  Doppelte Zeilen zusammenfassen");
// ======================================================================

pruefe("C1 Die doppelte Zeile wird gezaehlt", antwort.doppelt === 1, "" + antwort.doppelt);
pruefe("C2 Beide Mannschaften bleiben erhalten",
       antwort.treffer[0] && antwort.treffer[0].mannschaft === "A-Junioren, B-Junioren",
       antwort.treffer[0] && antwort.treffer[0].mannschaft);
pruefe("C3 Die Zeile ohne Geburtsdatum wird gemeldet, nicht verschluckt",
       antwort.ohne_geburtsdatum === 1, "" + antwort.ohne_geburtsdatum);
pruefe("C4 Und sie wird namentlich genannt",
       (antwort.ohne_geburtsdatum_namen || []).join("") === "Nora Ohnedatum",
       (antwort.ohne_geburtsdatum_namen || []).join(", "));

// ⚠️ Ein ruhendes Spielrecht darf ein aktives nicht ueberschreiben --
// sonst entschiede die Blattreihenfolge ueber die Auskunft.
await einlesen([
  { nachname: "Bergmoser", vorname: "Jarno", geburtsdatum: "2008-03-09",
    mannschaft: "A-Junioren", aktiv: "nein" },
  { nachname: "Bergmoser", vorname: "Jarno", geburtsdatum: "2008-03-09",
    mannschaft: "B-Junioren", aktiv: "ja" }
]);
const doppelAntwort = await lauf();
pruefe("C5 Aktives Spielrecht schlaegt ruhendes",
       doppelAntwort.treffer[0] && doppelAntwort.treffer[0].aktiv === "ja",
       doppelAntwort.treffer[0] && doppelAntwort.treffer[0].aktiv);
pruefe("C6 Ein ruhendes Spielrecht bleibt sonst stehen",
       offenZu("Zaubermann").aktiv === "nein", offenZu("Zaubermann").aktiv);

// Zurueck auf die volle Liste -- die folgenden Abschnitte rechnen damit.
await einlesen(DATEI);

// ======================================================================
console.log("D  Das Jahrgangsfenster kommt aus der Datei");
// ======================================================================

pruefe("D1 Das Fenster ist 2008 bis 2016",
       antwort.jahrgang_von === 2008 && antwort.jahrgang_bis === 2016,
       antwort.jahrgang_von + "-" + antwort.jahrgang_bis);

// ⚠️ Der eigentliche Sinn: ohne das Fenster stuenden die Erwachsene von
// 1984 und das Kind von 2019 als "nicht gemeldet" da -- eine Liste, die
// niemand durchsieht, und der Reiter waere wertlos.
pruefe("D2 Die Erwachsene von 1984 faellt heraus",
       nichtGemeldet.indexOf("Barbara Sonnleitner") < 0, nichtGemeldet.join(", "));
pruefe("D3 Das Kind von 2019 faellt heraus",
       nichtGemeldet.indexOf("Ida Waldsee") < 0, nichtGemeldet.join(", "));

// Gegenprobe: ein Export, der bis 2019 reicht, holt das Kind herein.
await einlesen([
  { nachname: "Bergmoser", vorname: "Jarno", geburtsdatum: "2008-03-09",
    mannschaft: "A-Junioren", aktiv: "ja" },
  { nachname: "Neumann", vorname: "Pepe", geburtsdatum: "2019-03-03",
    mannschaft: "F-Junioren", aktiv: "ja" }
]);
const weitAntwort = await lauf();
await einlesen(DATEI);
pruefe("D4 Reicht die Datei bis 2019, steht Ida Waldsee darin",
       weitAntwort.nicht_gemeldet.some((n) => n.name === "Ida Waldsee"),
       weitAntwort.nicht_gemeldet.map((n) => n.name).join(", "));
pruefe("D5 Die Erwachsene von 1984 bleibt trotzdem draussen",
       !weitAntwort.nicht_gemeldet.some((n) => n.name === "Barbara Sonnleitner"));

pruefe("D6 Die Bestandszahl zaehlt nur das Fenster",
       antwort.anzahl_bestand === 4, "" + antwort.anzahl_bestand);

// ======================================================================
console.log("E  Die Rechtegrenze der Passstelle");
// ======================================================================

const pAntwort = await lauf(PASS);

pruefe("E1 Die Passstelle bekommt den Abgleich", pAntwort.ok === true,
       JSON.stringify(pAntwort).slice(0, 200));
pruefe("E2 Sie sieht dieselben Faelle", pAntwort.offen.length === antwort.offen.length,
       pAntwort.offen.length + " / " + antwort.offen.length);

// ⚠️ Gegenprobe zuerst: die Mitgliedsnummern stehen sehr wohl in der
// Datenbank. Ohne sie waere E4 auch dann gruen, wenn nie eine vergeben
// worden waere.
pruefe("E3 Gegenprobe: die Nummern stehen in der Antwort fuer die Geschaeftsstelle",
       antwort.treffer[0].mitgliedsnummer === "301" &&
       antwort.nicht_gemeldet.every((n) => n.mitgliedsnummer !== null));
pruefe("E4 Die Passstelle bekommt KEINE Mitgliedsnummer",
       pAntwort.treffer.every((t) => t.mitgliedsnummer === null) &&
       pAntwort.nicht_gemeldet.every((n) => n.mitgliedsnummer === null));
pruefe("E5 ... und keine 301 irgendwo sonst in der Antwort",
       !/"301"/.test(JSON.stringify(pAntwort)));

pruefe("E6 Sie erfaehrt nicht, in WELCHER anderen Abteilung jemand steht",
       !/Turnen/.test(JSON.stringify(pAntwort)), "Turnen steht in der Antwort");
pruefe("E7 Sie bekommt keine Vorschlaege",
       pAntwort.offen.every((o) => (o.vorschlaege || []).length === 0));
pruefe("E8 Und keine Namen der Zeilen ohne Geburtsdatum",
       (pAntwort.ohne_geburtsdatum_namen || []).length === 0);
pruefe("E9 Die Zahl der Zeilen ohne Geburtsdatum steht trotzdem da",
       pAntwort.ohne_geburtsdatum === 1, "" + pAntwort.ohne_geburtsdatum);

// ⚠️ Der volljaehrige Fussballer waere neu fuer sie -- handleKodexListe
// liefert ihr nur Minderjaehrige. Diese Aktion ist nicht der Ort, an dem
// eine Rechtegrenze stillschweigend weiter wird.
pruefe("E10 Gegenprobe: die Geschaeftsstelle sieht den Volljaehrigen",
       nichtGemeldet.indexOf("Rasmus Kellinghusen") >= 0, nichtGemeldet.join(", "));
pruefe("E11 Die Passstelle sieht ihn NICHT",
       !pAntwort.nicht_gemeldet.some((n) => n.name === "Rasmus Kellinghusen"),
       pAntwort.nicht_gemeldet.map((n) => n.name).join(", "));
pruefe("E12 Sie erfaehrt aber, DASS jemand fehlt",
       pAntwort.volljaehrig_verborgen === 1, "" + pAntwort.volljaehrig_verborgen);
pruefe("E13 Die minderjaehrigen Fussballkinder sieht sie weiterhin",
       pAntwort.nicht_gemeldet.some((n) => n.name === "Korbinian Arnholt"),
       pAntwort.nicht_gemeldet.map((n) => n.name).join(", "));
pruefe("E14 Das Flag vollbild sagt der Oberflaeche Bescheid",
       antwort.vollbild === true && pAntwort.vollbild === false);

// Ein angemeldetes Konto ohne Rolle bekommt nichts.
const FREMD = { username: "ohne.rolle", isAdmin: false, canEdit: false, canAdmin: false };
const fRes = await W.handleDfbnetAbgleich({}, env, FREMD, cors);
pruefe("E15 Ohne Rolle: 403", fRes.status === 403, "" + fRes.status);

// ======================================================================
console.log("F  Gegenproben und Mutationen");
// ======================================================================

const leer = await einlesen([]);
pruefe("F1 Keine Zeile: 400", leer.status === 400, "" + leer.status);

const nurOhneDatum = await einlesen([
  { nachname: "Ohnedatum", vorname: "Nora", geburtsdatum: "", mannschaft: "", aktiv: "ja" }
]);
pruefe("F2 Nur Zeilen ohne Geburtsdatum: 400 mit Begruendung",
       nurOhneDatum.status === 400, "" + nurOhneDatum.status);

const zuViel = await einlesen(
  Array.from({ length: W.DFBNET_MAX_ZEILEN + 1 }, (_, i) => ({
    nachname: "N" + i, vorname: "V", geburtsdatum: "2012-01-01", mannschaft: "", aktiv: "ja" })));
pruefe("F3 Zu viele Zeilen: 400", zuViel.status === 400, "" + zuViel.status);

// ⚠️ Gegenprobe: keiner dieser drei Fehlversuche darf die gespeicherte
// Liste angetastet haben. Ein abgewiesener Import, der vorher schon
// geleert hat, waere der schlechteste Ausgang -- die alte Liste weg, die
// neue nicht da.
pruefe("F3b Nach drei abgewiesenen Importen steht die Liste unveraendert",
       db.prepare("SELECT COUNT(*) AS n FROM dfbnet_spieler").get().n === 6,
       "" + db.prepare("SELECT COUNT(*) AS n FROM dfbnet_spieler").get().n);

// ⚠️ Ohne die Abteilung Fussball wird NICHT ungefiltert geliefert. Eine
// Liste aller Mitglieder saehe wie ein Ergebnis aus und waere falsch.
db.exec("UPDATE sparte SET aktiv = 0 WHERE id = 'sp-fu'");
const ohneFu = await W.handleDfbnetAbgleich({ stichtag: STICHTAG }, env, ADMIN, cors);
pruefe("F4 Ohne aktive Abteilung Fussball: 409 statt ungefiltert",
       ohneFu.status === 409, "" + ohneFu.status);
db.exec("UPDATE sparte SET aktiv = 1 WHERE id = 'sp-fu'");

// ⚠️ Die Kernzusage: es wird NICHTS geschrieben. Gemessen ueber die
// Zeilenzahl jeder Tabelle vor und nach einem vollen Lauf -- eine
// Behauptung im Kommentar ist keine Zusage.
const tabellen = db.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
).all().map((z) => z.name);
const vorher = {};
for (const t of tabellen) {
  vorher[t] = db.prepare("SELECT COUNT(*) AS n FROM " + t).get().n;
}
await lauf();
let geaendert = [];
for (const t of tabellen) {
  const n = db.prepare("SELECT COUNT(*) AS n FROM " + t).get().n;
  if (n !== vorher[t]) geaendert.push(t + ": " + vorher[t] + " → " + n);
}
pruefe("F5 Der Abgleich schreibt in KEINE der " + tabellen.length + " Tabellen",
       geaendert.length === 0, geaendert.join(", "));
console.log("   (gemessen an " + tabellen.length + " Tabellen)");

// ⚠️ Mengenbasiert, nicht je Spieler eine Abfrage. Genau daran ist dieser
// Worker schon zweimal gestorben.
const vorAbfragen = env.VV_DB.lauf.abfragen;
await lauf();
const rundlaeufe = env.VV_DB.lauf.abfragen - vorAbfragen;
// Meldeliste + Importzeile + Sparten + Mitglieder + Zuordnungen +
// Antraege. Eine feste Obergrenze, damit eine spaeter eingebaute
// Schleife auffaellt.
pruefe("F6 Ein Lauf braucht hoechstens sieben Rundlaeufe", rundlaeufe <= 7,
       rundlaeufe + " Rundlaeufe");

// ⚠️ Und er bleibt dabei, wenn die Datei zehnmal so gross ist. Ohne diese
// Zeile waere F6 auch mit einer Schleife gruen, solange die Datei klein
// ist -- und im Echtbetrieb mit 146 Spielern stuerbe der Worker.
const viele = [];
for (let i = 0; i < 300; i++) {
  viele.push({ nachname: "Pruefling" + i, vorname: "Ann", geburtsdatum: "2012-05-05",
               mannschaft: "C-Junioren", aktiv: "ja" });
}
await einlesen(viele);
const vorViele = env.VV_DB.lauf.abfragen;
await lauf();
pruefe("F7 300 Spieler kosten den Abgleich keinen Rundlauf mehr",
       env.VV_DB.lauf.abfragen - vorViele <= 7,
       (env.VV_DB.lauf.abfragen - vorViele) + " Rundlaeufe");

// ⚠️ Und das Einlesen selbst bleibt blockweise: 300 Spieler sind drei
// Bloecke zu hundert, nicht 300 Rundlaeufe. Genau daran ist dieser
// Worker schon zweimal gestorben.
const vorSchreiben = env.VV_DB.lauf.abfragen;
await einlesen(viele);
// Rolle + drei Bloecke zu hundert + Protokoll = fuenf. Waere das
// Einlesen eine Schleife, stuenden hier 300.
pruefe("F7b 300 Spieler einlesen kostet fuenf Rundlaeufe, nicht 300",
       env.VV_DB.lauf.abfragen - vorSchreiben <= 5,
       (env.VV_DB.lauf.abfragen - vorSchreiben) + " Rundlaeufe");
await einlesen(DATEI);

// ⚠️ Der strenge Schluessel bleibt streng: die Nachsicht der Vorschlaege
// darf NIE nach oben wandern. Sonst gaelte ein Kind als gemeldet, das nur
// aehnlich heisst -- und die Spielberechtigung haengt daran.
pruefe("F8 Grünbaum und Grunbaum sind fuer den Schluessel zwei Kinder",
       W.kodexSchluessel("Mira", "Grünbaum", "2012-03-04") !==
       W.kodexSchluessel("Mira", "Grunbaum", "2012-03-04"));
pruefe("F9 Deshalb wurde der Umlaut-Fall NICHT als Treffer gebucht",
       !antwort.treffer.some((t) => t.name.indexOf("Grunbaum") >= 0));


// ======================================================================
console.log("G  Die Handzuordnung");
// ======================================================================

const zu = (roh, personId, wer) => W.handleDfbnetZuordnen(
  { vorname: roh.vorname, nachname: roh.nachname, geburtsdatum: roh.geburtsdatum,
    person_id: personId }, env, wer || ADMIN, cors);
const GRU = { vorname: "Mira", nachname: "Grunbaum", geburtsdatum: "2012-03-04" };

pruefe("G1 Die Tabelle entsteht in der Migration",
       !!db.prepare("SELECT name FROM sqlite_master WHERE name = 'dfbnet_zuordnung'").get());

// --- Der Fall, um den es geht ----------------------------------------
const r1 = await zu(GRU, "p-gru");
pruefe("G2 Zuordnen geht durch", r1.status === 200, "" + r1.status);

const a1 = await lauf();
pruefe("G3 Der Umlaut-Fall ist jetzt ein Treffer",
       a1.treffer.some((t) => t.name === "Mira Grunbaum"),
       a1.treffer.map((t) => t.name).join(", "));
pruefe("G4 ... und steht nicht mehr unter den offenen Faellen",
       !a1.offen.some((o) => o.name === "Mira Grunbaum"),
       a1.offen.map((o) => o.name).join(", "));
pruefe("G5 Das Mitglied verschwindet aus 'nicht gemeldet'",
       !a1.nicht_gemeldet.some((n) => n.name === "Mira Grünbaum"),
       a1.nicht_gemeldet.map((n) => n.name).join(", "));
const tGru = a1.treffer.find((t) => t.name === "Mira Grunbaum") || {};
pruefe("G6 Der Treffer ist als 'von Hand' gekennzeichnet", tGru.von_hand === true);
pruefe("G7 Er nennt das zugeordnete Mitglied", tGru.mitglied === "Mira Grünbaum", tGru.mitglied);
pruefe("G8 Die Antwort zaehlt die Handzuordnungen", a1.von_hand === 1, "" + a1.von_hand);
pruefe("G9 Die Rohfelder kommen zurueck, damit sich die Zuordnung aufheben laesst",
       tGru.vorname === "Mira" && tGru.nachname === "Grunbaum",
       tGru.vorname + " / " + tGru.nachname);

// ⚠️ Gegenprobe: ohne die Zuordnung ist es wieder ein offener Fall.
// Ohne diese Zeile waere G3 auch dann gruen, wenn der Schluessel ihn
// laengst von selbst getroffen haette.
await zu(GRU, null);
const a2 = await lauf();
pruefe("G10 Aufheben macht ihn wieder zum offenen Fall",
       a2.offen.some((o) => o.name === "Mira Grunbaum") &&
       !a2.treffer.some((t) => t.name === "Mira Grunbaum"));
pruefe("G11 Und das Mitglied steht wieder unter 'nicht gemeldet'",
       a2.nicht_gemeldet.some((n) => n.name === "Mira Grünbaum"));
pruefe("G12 Die Zeile ist danach wirklich weg",
       !db.prepare("SELECT 1 FROM dfbnet_zuordnung").get());

// --- Die Handzuordnung schlaegt den Namensschluessel ------------------
//
// ⚠️ Das ist die eigentliche Zusage. Der gemeldete Bergmoser trifft
// ueber den Namen auf p-ber; von Hand auf p-arn gesetzt, muss p-arn
// gewinnen -- sonst waere die Korrektur wirkungslos, und zwar lautlos.
const BER = { vorname: "Jarno", nachname: "Bergmoser", geburtsdatum: "2008-03-09" };
await zu(BER, "p-arn");
const a3 = await lauf();
const tBer = a3.treffer.find((t) => t.name === "Jarno Bergmoser") || {};
pruefe("G13 Die Handzuordnung schlaegt den Namenstreffer",
       tBer.mitglied === "Korbinian Arnholt", tBer.mitglied);
pruefe("G14 Der ueber den Namen passende steht nun als 'nicht gemeldet'",
       a3.nicht_gemeldet.some((n) => n.name === "Jarno Bergmoser"),
       a3.nicht_gemeldet.map((n) => n.name).join(", "));
await zu(BER, null);

// --- Zuordnung auf ein Kind einer anderen Abteilung -------------------
await zu(GRU, "p-ste");
const a4 = await lauf();
const oGru = a4.offen.find((o) => o.name === "Mira Grunbaum") || {};
pruefe("G15 Zuordnung auf ein Turnkind bleibt ein offener Fall",
       oGru.lage === "andere_abteilung", oGru.lage);
pruefe("G16 ... ist aber als 'von Hand' gekennzeichnet", oGru.von_hand === true);
pruefe("G17 ... und bekommt keine Vorschlaege mehr",
       (oGru.vorschlaege || []).length === 0);
await zu(GRU, null);

// --- Eine Zuordnung ins Leere ----------------------------------------
//
// ⚠️ Sie darf NICHT stillschweigend auf den Namensschluessel
// zurueckfallen. Sonst sieht die Zeile aus wie ein normaler Treffer, und
// die falsche Zuordnung bleibt fuer immer unentdeckt in der Tabelle.
db.exec("INSERT INTO person (id, vorname, nachname, geburtsdatum, erstellt_am, erstellt_von) " +
        "VALUES ('p-ohne', 'Ohne', 'Mitgliedschaft', '2012-01-01', " + WER + ")");
await zu(GRU, "p-ohne");
const a5 = await lauf();
const oLeer = a5.offen.find((o) => o.name === "Mira Grunbaum") || {};
pruefe("G18 Eine Zuordnung auf jemanden ohne Mitgliedschaft wird gemeldet",
       /von Hand ein Mitglied hinterlegt/.test(oLeer.hinweis || ""), oLeer.hinweis);
pruefe("G19 Sie faellt NICHT auf den Namensschluessel zurueck",
       !a5.treffer.some((t) => t.name === "Mira Grunbaum"));
await zu(GRU, null);

// --- Weissliste und Rechte -------------------------------------------
//
// ⚠️ Der Schluessel wird im SERVER gebildet. Ein mitgeschickter
// abgleich_schluessel darf nichts bewirken -- sonst liesse sich eine
// Zuordnung unter fremdem Schluessel ablegen.
await W.handleDfbnetZuordnen({ vorname: "Mira", nachname: "Grunbaum",
  geburtsdatum: "2012-03-04", person_id: "p-gru",
  abgleich_schluessel: "boesartig|1999-01-01" }, env, ADMIN, cors);
const zeile = db.prepare("SELECT abgleich_schluessel FROM dfbnet_zuordnung").get();
pruefe("G20 Der Schluessel kommt aus dem Server, nicht aus dem Koerper",
       zeile && zeile.abgleich_schluessel ===
         W.kodexSchluessel("Mira", "Grunbaum", "2012-03-04"),
       zeile && zeile.abgleich_schluessel);

// Zweimal dasselbe: kein Duplikat, kein Fehler.
const r2 = await zu(GRU, "p-arn");
pruefe("G21 Ein zweites Zuordnen ueberschreibt, statt zu scheitern", r2.status === 200,
       "" + r2.status);
pruefe("G22 Es bleibt bei EINER Zeile",
       db.prepare("SELECT COUNT(*) AS n FROM dfbnet_zuordnung").get().n === 1);
await zu(GRU, null);

const rPass = await zu(GRU, "p-gru", PASS);
pruefe("G23 Die Passstelle darf NICHT zuordnen", rPass.status === 403, "" + rPass.status);
pruefe("G24 ... und hat dabei auch nichts geschrieben",
       db.prepare("SELECT COUNT(*) AS n FROM dfbnet_zuordnung").get().n === 0);

const rFremd = await zu(GRU, "gibt-es-nicht");
pruefe("G25 Eine unbekannte Person: 404", rFremd.status === 404, "" + rFremd.status);
const rOhneDatum = await W.handleDfbnetZuordnen(
  { vorname: "Mira", nachname: "Grunbaum", person_id: "p-gru" }, env, ADMIN, cors);
pruefe("G26 Ohne Geburtsdatum: 400", rOhneDatum.status === 400, "" + rOhneDatum.status);

// Das Protokoll haelt beides fest.
await zu(GRU, "p-gru");
await zu(GRU, null);
const prot = db.prepare(
  "SELECT aktion FROM protokoll WHERE objekt_typ = 'dfbnet_zuordnung' ORDER BY zeit").all()
  .map((z) => z.aktion);
pruefe("G27 Zuordnen und Aufheben stehen im Protokoll",
       prot.indexOf("dfbnet-zugeordnet") >= 0 && prot.indexOf("dfbnet-zuordnung-aufgehoben") >= 0,
       prot.join(", "));

// ⚠️ Die Passstelle sieht eine Handzuordnung, kann sie aber nicht
// aendern -- und bekommt weiterhin keine person_id, mit der sie es
// versuchen koennte.
await zu(GRU, "p-gru");
const aPass = await lauf(PASS);
pruefe("G28 Die Passstelle sieht den Treffer", aPass.treffer.some((t) => t.von_hand === true));
pruefe("G29 ... bekommt aber keine person_id",
       aPass.treffer.every((t) => t.person_id === null) &&
       aPass.nicht_gemeldet.every((n) => n.person_id === null));
pruefe("G30 Gegenprobe: die Geschaeftsstelle bekommt sie",
       (await lauf()).nicht_gemeldet.every((n) => !!n.person_id));
await zu(GRU, null);


// ======================================================================
console.log("H  Die Filterfelder");
// ======================================================================
//
// ⚠️ Die Suche ist umlautblind. Das ist keine Bequemlichkeit: dieser
// Reiter existiert wegen der drei Schreibweisen Grünbaum / Gruenbaum /
// Grunbaum, und ein Filter, der bei genau dieser Abweichung leer bleibt,
// liest sich wie "gibt es nicht".

pruefe("H1 Umlaut, ue-Schreibung und weggelassener Umlaut fallen zusammen",
       C.dfbSuchform("Grünbaum") === C.dfbSuchform("Gruenbaum") &&
       C.dfbSuchform("Gruenbaum") === C.dfbSuchform("Grunbaum"),
       C.dfbSuchform("Grünbaum") + " / " + C.dfbSuchform("Gruenbaum") + " / " +
       C.dfbSuchform("Grunbaum"));

pruefe("H2 Die Suche nach 'Grünbaum' findet 'Grunbaum'",
       C.dfbNameTrifft("Mira Grunbaum", C.dfbSuchform("Grünbaum")));
pruefe("H3 ... und umgekehrt",
       C.dfbNameTrifft("Mira Grünbaum", C.dfbSuchform("grunbaum")));
pruefe("H4 Bindestrich und Leerzeichen stoeren nicht",
       C.dfbNameTrifft("Mira Gruenbaum-Wittenhagen", C.dfbSuchform("baumwit")));
pruefe("H5 ss und ß sind dasselbe",
       C.dfbNameTrifft("Strauß", C.dfbSuchform("strauss")));

// ⚠️ Gegenprobe: die Nachsicht darf nicht so weit gehen, dass alles auf
// alles passt. Ohne diese Zeile waere H2 auch dann gruen, wenn
// dfbSuchform jeden Namen auf den leeren String abbildete.
pruefe("H6 Ein anderer Name wird NICHT gefunden",
       !C.dfbNameTrifft("Korbinian Arnholt", C.dfbSuchform("Grünbaum")));
pruefe("H7 Und der leere Filter laesst alles durch",
       C.dfbNameTrifft("Korbinian Arnholt", "") &&
       C.dfbNameTrifft("", ""));
// ⚠️ Und sie greift nur bei Umlauten. "Reibsen" und "Raibsen" bleiben
// zwei Namen -- sonst waere die Suche kein Filter mehr, sondern ein
// Vorschlag.
pruefe("H8 Reibsen und Raibsen bleiben verschieden",
       C.dfbSuchform("Reibsen") !== C.dfbSuchform("Raibsen"),
       C.dfbSuchform("Reibsen") + " / " + C.dfbSuchform("Raibsen"));

// ======================================================================
console.log("I  Die gespeicherte Meldeliste");
// ======================================================================

const zaehle = (t) => db.prepare("SELECT COUNT(*) AS n FROM " + t).get().n;

await einlesen(DATEI);
pruefe("I1 Die sechs eindeutigen Spieler stehen in der Datenbank",
       zaehle("dfbnet_spieler") === 6, "" + zaehle("dfbnet_spieler"));
pruefe("I2 Es gibt genau EINE Importzeile", zaehle("dfbnet_import") === 1);

const imp = db.prepare("SELECT * FROM dfbnet_import").get();
pruefe("I3 Sie merkt sich Dateiname, Anzahl und Doppelte",
       imp.dateiname === "pruefstand.xlsx" && imp.anzahl === 6 && imp.doppelt === 1,
       imp.dateiname + " / " + imp.anzahl + " / " + imp.doppelt);
pruefe("I4 Und die Namen der Zeilen ohne Geburtsdatum",
       JSON.parse(imp.ohne_geburtsdatum_namen || "[]").join("") === "Nora Ohnedatum",
       imp.ohne_geburtsdatum_namen);
pruefe("I5 Der Abgleich gibt das Einlesedatum weiter",
       (await lauf()).eingelesen_am === imp.eingang_am);

// ⚠️ Ein neuer Export ERSETZT. Waechst die Tabelle stattdessen, stuenden
// nach dem dritten Import Spieler darin, die der Verband laengst
// abgemeldet hat -- und niemand saehe es, weil die Namen echt aussehen.
await einlesen([
  { nachname: "Bergmoser", vorname: "Jarno", geburtsdatum: "2008-03-09",
    mannschaft: "A-Junioren", aktiv: "ja" }
]);
pruefe("I6 Ein neuer Export ersetzt den alten, statt ihn zu ergaenzen",
       zaehle("dfbnet_spieler") === 1, "" + zaehle("dfbnet_spieler"));
pruefe("I7 Und es bleibt bei einer Importzeile", zaehle("dfbnet_import") === 1);

// Die Handzuordnungen ueberleben einen neuen Export -- derselbe
// Schreibfehler kommt beim naechsten Mal wieder.
await zu(GRU, "p-gru");
await einlesen(DATEI);
pruefe("I8 Eine Handzuordnung ueberlebt den naechsten Export",
       zaehle("dfbnet_zuordnung") === 1, "" + zaehle("dfbnet_zuordnung"));
pruefe("I9 ... und wirkt danach weiterhin",
       (await lauf()).treffer.some((t) => t.name === "Mira Grunbaum" && t.von_hand));

// Loeschen raeumt die Liste, nicht die Entscheidungen.
const rWeg = await W.handleDfbnetImport({ loeschen: true }, env, ADMIN, cors);
pruefe("I10 Loeschen geht durch", rWeg.status === 200, "" + rWeg.status);
pruefe("I11 Die Liste ist leer", zaehle("dfbnet_spieler") === 0 && zaehle("dfbnet_import") === 0);
pruefe("I12 Die Handzuordnungen bleiben stehen", zaehle("dfbnet_zuordnung") === 1);

const leerLauf = await lauf();
pruefe("I13 Ohne Liste antwortet der Abgleich 'leer', nicht mit einem Fehler",
       leerLauf.ok === true && leerLauf.leer === true, JSON.stringify(leerLauf).slice(0, 120));
pruefe("I14 Er sagt trotzdem, ob der Aufrufer schreiben darf",
       leerLauf.vollbild === true && (await lauf(PASS)).vollbild === false);

// ⚠️ Einlesen und Loeschen sind Schreibvorgaenge. Die Passstelle liest
// den Abgleich -- sie legt keine Meldeliste an.
const pImport = await einlesen(DATEI, PASS);
pruefe("I15 Die Passstelle darf nicht einlesen", pImport.status === 403, "" + pImport.status);
pruefe("I16 ... und hat dabei nichts geschrieben", zaehle("dfbnet_spieler") === 0);
const pWeg = await W.handleDfbnetImport({ loeschen: true }, env, PASS, cors);
pruefe("I17 Die Passstelle darf auch nicht loeschen", pWeg.status === 403, "" + pWeg.status);

// Das Protokoll haelt beides fest.
await einlesen(DATEI);
await W.handleDfbnetImport({ loeschen: true }, env, ADMIN, cors);
const protI = db.prepare(
  "SELECT aktion FROM protokoll WHERE objekt_typ = 'dfbnet_import'").all().map((z) => z.aktion);
pruefe("I18 Einlesen und Loeschen stehen im Protokoll",
       protI.indexOf("dfbnet-liste-eingelesen") >= 0 &&
       protI.indexOf("dfbnet-liste-geloescht") >= 0, protI.join(", "));

// ⚠️ Der Abgleichsschluessel ist PRIMARY KEY. Das Zusammenfassen der
// neun Blaetter ist damit nicht nur eine Rechnung im Code, sondern eine
// Zusage der Datenbank -- die Gegenprobe: dieselbe Person zweimal in
// EINEM Import landet als eine Zeile, nicht als Fehler.
await einlesen(DATEI.concat(DATEI));
pruefe("I19 Dieselbe Datei zweimal aneinander ergibt dieselben sechs Zeilen",
       zaehle("dfbnet_spieler") === 6, "" + zaehle("dfbnet_spieler"));

await einlesen(DATEI);


// ======================================================================
console.log("J  Der Vorfilter der Vorschlaege");
// ======================================================================
//
// ⚠️ Hier ist der Worker am 11.09.2026 gestorben. 146 ungeklaerte Faelle
// mal 540 Mitglieder sind 78.840 Bewertungen mit Levenshtein darin --
// gemessen 223 ms reine Rechenzeit, und ein harter Abbruch schickt keine
// CORS-Kopfzeilen: im Browser stand nur "Server nicht erreichbar".
//
// Der Vorfilter darf dabei NICHTS verlieren. Diese Zusagen messen genau
// das: derselbe Bestand, einmal vollstaendig durchgerechnet und einmal
// ueber den Index -- das Ergebnis muss Zeichen fuer Zeichen dasselbe sein.

// Ein erfundener Bestand in der Groessenordnung des echten.
const jPool = [];
const jSilben = ["bran", "holt", "wies", "kamp", "stein", "tal", "berg", "feld",
                 "dorf", "hof", "bach", "see", "moor", "hain", "rott", "wald"];
const jVor = ["Anne", "Bent", "Caro", "Dora", "Emil", "Finn", "Grit", "Hanno",
              "Ilka", "Jost", "Kira", "Lino", "Mira", "Nils", "Ove", "Pina"];
for (let i = 0; i < 540; i++) {
  const vorname = jVor[i % jVor.length] + (i % 5 === 0 ? "s" : "");
  const nachname = jSilben[i % jSilben.length] + jSilben[(i * 7 + 3) % jSilben.length] +
                   (i % 4 === 0 ? "er" : "");
  jPool.push({
    person_id: "jp" + i, name: vorname + " " + nachname,
    geburtsdatum: (2008 + (i % 10)) + "-0" + (1 + (i % 9)) + "-1" + (i % 9),
    teile: W.kodexTeileListe(vorname, nachname),
    im_fussball: i % 3 === 0, im_bestand: true, sparten: "Turnen", status: "aktiv",
    mitgliedsnummer: "" + (1000 + i)
  });
}

// Die gemeldeten Spieler: ein Teil trifft, ein Teil nicht -- und ein paar
// treffen nur ueber eine der drei Stufen.
const jGemeldet = [];
for (let i = 0; i < 150; i++) {
  const q = jPool[i % jPool.length];
  let vorname, nachname, geb;
  if (i % 5 === 0) {
    // Umlaut-Variante: "anders geschrieben"
    vorname = q.name.split(" ")[0].replace(/a/, "ä");
    nachname = q.name.split(" ")[1];
    geb = q.geburtsdatum;
  } else if (i % 5 === 1) {
    // Tippfehler: nur "fast gleich"
    vorname = q.name.split(" ")[0];
    nachname = q.name.split(" ")[1].slice(0, -1) + "z";
    geb = "2011-07-07";
  } else if (i % 5 === 2) {
    // Tag und Monat vertauscht
    vorname = q.name.split(" ")[0];
    nachname = q.name.split(" ")[1];
    const t = q.geburtsdatum.split("-");
    geb = t[0] + "-" + t[2] + "-" + t[1];
  } else {
    // gar kein Treffer
    vorname = "Zaubermann" + i;
    nachname = "Ohnegleichen" + i;
    geb = "1955-03-0" + (1 + (i % 9));
  }
  jGemeldet.push({ teile: W.kodexTeileListe(vorname, nachname), geburtsdatum: geb });
}

function jVollstaendig(g) {
  const raus = [];
  for (const p of jPool) {
    const a = W.kodexAehnlichkeit(g.teile, g.geburtsdatum, p.teile, p.geburtsdatum);
    if (a.signale < 1 || a.punkte < W.KODEX_VORSCHLAG_PUNKTE) continue;
    raus.push(p.person_id + "|" + a.punkte + "|" + a.gruende.join(","));
  }
  return raus.sort();
}

const jKarte = W.namensIndex(jPool);
function jUeberIndex(g) {
  const raus = [];
  for (const p of W.namensKandidaten(jKarte, g.teile, g.geburtsdatum)) {
    const a = W.kodexAehnlichkeit(g.teile, g.geburtsdatum, p.teile, p.geburtsdatum);
    if (a.signale < 1 || a.punkte < W.KODEX_VORSCHLAG_PUNKTE) continue;
    raus.push(p.person_id + "|" + a.punkte + "|" + a.gruende.join(","));
  }
  return raus.sort();
}

let jAbweichungen = 0, jTreffer = 0, jPaareIndex = 0;
let jBeispiel = "";
for (const g of jGemeldet) {
  const voll = jVollstaendig(g);
  const idx = jUeberIndex(g);
  jTreffer += voll.length;
  jPaareIndex += W.namensKandidaten(jKarte, g.teile, g.geburtsdatum).size;
  if (voll.join(";") !== idx.join(";")) {
    jAbweichungen++;
    if (!jBeispiel) jBeispiel = "voll " + voll.length + " / index " + idx.length;
  }
}

// ⚠️ Gegenprobe ZUERST: der vollstaendige Lauf muss ueberhaupt etwas
// finden. Ohne diese Zeile waere J2 auch dann gruen, wenn beide Wege
// nichts liefern -- und der Vorfilter waere ungeprueft.
pruefe("J1 Gegenprobe: der vollstaendige Lauf findet ueberhaupt Vorschlaege",
       jTreffer > 50, jTreffer + " Treffer");
pruefe("J2 Der Vorfilter liefert bei 150 Faellen dasselbe wie der volle Lauf",
       jAbweichungen === 0, jAbweichungen + " Abweichungen, z. B. " + jBeispiel);

// ⚠️ Und er ist wirklich billiger. Ohne diese Zusage koennte jemand den
// Index gegen "nimm einfach alle" austauschen: J2 bliebe gruen, der
// Worker stuerbe wieder.
// ⚠️ Die Schranke ist absichtlich grosszuegig: dieser Testbestand ist aus
// sechzehn Silben gebaut und teilt sich deshalb viel mehr Namensanfaenge
// als ein echter. An den echten Namen gemessen waren es 96 Paare statt
// 78.840.
pruefe("J3 Er bewertet einen Bruchteil der Paare",
       jPaareIndex < jGemeldet.length * jPool.length / 10,
       jPaareIndex + " statt " + (jGemeldet.length * jPool.length));

// Die drei Stufen einzeln: jede muss den Vorfilter ueberleben.
const jEins = (v, n, g) => jUeberIndex({ teile: W.kodexTeileListe(v, n), geburtsdatum: g });
const jQ = jPool[0];
const jTeil = jQ.name.split(" ");
pruefe("J4 Umlaut-Variante kommt durch",
       jEins(jTeil[0].replace(/a/, "ä"), jTeil[1], jQ.geburtsdatum).length > 0);
// ⚠️ Diese beiden kommen ueber das GEBURTSDATUM herein, nicht ueber die
// Enden-Schluessel: ein reiner Tippfehler wiegt 12 Punkte, die Schwelle
// liegt bei 50. Ein Vorschlag entsteht also ohnehin nur mit passendem
// Datum oder einem exakt gleichen Namensteil. Die Enden-Schluessel sind
// eine Reserve fuer den Tag, an dem jemand die Gewichte aendert -- die
// Mutationsprobe "Enden-Schluessel raus" bleibt heute gruen, und das
// steht so auch im Worker.
pruefe("J5 Tippfehler am Wortende ueberlebt den Vorfilter",
       jEins(jTeil[0], jTeil[1].slice(0, -1) + "z", jQ.geburtsdatum).length > 0);
pruefe("J6 Tippfehler am Wortanfang ueberlebt den Vorfilter",
       jEins(jTeil[0], "z" + jTeil[1].slice(1), jQ.geburtsdatum).length > 0);
const jT = jQ.geburtsdatum.split("-");
pruefe("J7 Vertauschter Tag und Monat kommt durch",
       jEins(jTeil[0], jTeil[1], jT[0] + "-" + jT[2] + "-" + jT[1]).length > 0);
pruefe("J8 Wer zu niemandem passt, bekommt auch nichts",
       jEins("Xaverina", "Unverwechselbar", "1901-01-01").length === 0);


// ======================================================================
console.log("K  Die Luecken im Bestand (Bugjagd 11.09.2026)");
// ======================================================================
//
// Vier Funde aus der Bugjagd, jeder mit eigenen Zusagen. Alle vier waren
// VORHER gruen -- der Pruefstand hat sie nicht gesehen, weil er nur
// saubere Bestaende kannte. Ein Bestand ohne Doppeleintrag, ohne Luecke
// und ohne Sonderzeichen misst genau die Faelle nicht, die hier
// schiefgehen.

// Eigene Datenbank: die Faelle sollen die Abschnitte davor nicht stoeren.
const kdb = new DatabaseSync(":memory:");
for (const anw of readFileSync(REPO + "/schema-kompakt.sql", "utf8")
                    .split(";").map((x) => x.trim()).filter(Boolean)) {
  kdb.exec(anw + ";");
}
const kenv = { VV_DB: d1(kdb) };
kdb.exec("INSERT INTO benutzer_rolle (id, username, rolle, sparte_id, erstellt_am, " +
         "erstellt_von) VALUES ('kr-pass', 'pass.stelle', 'passstelle', NULL, " + WER + ")");
await W.handleMigration(kenv, ADMIN, cors);
kdb.exec("INSERT INTO sparte (id, name, aktiv, erstellt_am, erstellt_von) " +
         "VALUES ('sp-fu', 'Fussball', 1, " + WER + ")");

function kPerson(pid, vorname, nachname, geb) {
  kdb.exec("INSERT INTO person (id, vorname, nachname, geburtsdatum, erstellt_am, " +
           "erstellt_von) VALUES ('" + pid + "', '" + vorname + "', '" + nachname + "', " +
           (geb ? "'" + geb + "'" : "NULL") + ", " + WER + ")");
}
function kMitgliedschaft(mid, pid, nr) {
  kdb.exec("INSERT INTO mitgliedschaft (id, person_id, mitgliedsnummer, art, eintritt, " +
           "austritt, status, erstellt_am, erstellt_von) VALUES ('" + mid + "', '" + pid +
           "', '" + nr + "', 'ordentlich', '2020-01-01', NULL, 'aktiv', " + WER + ")");
  kdb.exec("INSERT INTO mitgliedschaft_sparte (id, mitgliedschaft_id, sparte_id, eintritt, " +
           "erstellt_am, erstellt_von) VALUES ('kms-" + mid + "', '" + mid +
           "', 'sp-fu', '2020-01-01', " + WER + ")");
}

// ⚠️ DASSELBE KIND ZWEIMAL -- zwei person-Zeilen, gleicher Name, gleiches
// Geburtsdatum. Entsteht auf dem Normalweg: handleAntragAnnehmen legt bei
// jeder Annahme eine neue Person an, ohne auf Name und Geburtsdatum zu
// pruefen.
kPerson("k-dop1", "Mira", "Talberg", "2014-06-06"); kMitgliedschaft("km-dop1", "k-dop1", "601");
kPerson("k-dop2", "Mira", "Talberg", "2014-06-06"); kMitgliedschaft("km-dop2", "k-dop2", "602");
// Eine Person mit ZWEI laufenden Mitgliedschaften (auf
// mitgliedschaft.person_id liegt keine UNIQUE-Klammer).
kPerson("k-zwei", "Jarno", "Bergmoser", "2013-05-05");
kMitgliedschaft("km-zwei1", "k-zwei", "603"); kMitgliedschaft("km-zwei2", "k-zwei", "604");
// Ein Fussballkind OHNE Geburtsdatum, nicht gemeldet.
kPerson("k-ohne", "Korbinian", "Arnholt", null); kMitgliedschaft("km-ohne", "k-ohne", "605");
// Ein ganz normales, nicht gemeldetes Kind als Gegenprobe.
kPerson("k-fehlt", "Ansgar", "Feldbach", "2015-01-07");
kMitgliedschaft("km-fehlt", "k-fehlt", "606");

const K_DATEI = [
  { nachname: "Talberg", vorname: "Mira", geburtsdatum: "2014-06-06",
    mannschaft: "D-Junioren", aktiv: "ja" },
  { nachname: "Bergmoser", vorname: "Jarno", geburtsdatum: "2013-05-05",
    mannschaft: "D-Junioren", aktiv: "ja" },
  // Zwei Namen, aus denen sich kein Abgleichsschluessel bilden laesst.
  { nachname: "Петров", vorname: "Иван", geburtsdatum: "2015-02-02",
    mannschaft: "D-Junioren", aktiv: "ja" },
  { nachname: "Иванов", vorname: "Пётр", geburtsdatum: "2015-03-03",
    mannschaft: "D-Junioren", aktiv: "ja" },
  // Eine Zeile ohne Geburtsdatum, damit beide Zaehler nebeneinander stehen.
  { nachname: "Ohnedatum", vorname: "Nora", geburtsdatum: "", mannschaft: "E-Junioren",
    aktiv: "ja" },
  // ⚠️ Diese Zeile haelt das JAHRGANGSFENSTER offen. Beim ersten Bau
  // stand sie nicht hier, und K4 und K9 waren rot -- nicht weil der Code
  // falsch rechnete, sondern weil die beiden verworfenen Zeilen (2015)
  // das Fenster auf 2013-2014 zusammenschnurren liessen und Feldbach
  // damit ausserhalb lag. Das Fenster kommt aus der DATEI, und was nicht
  // gespeichert wird, spannt es auch nicht auf.
  { nachname: "Zaubermann", vorname: "Ferdinand", geburtsdatum: "2015-09-09",
    mannschaft: "E-Junioren", aktiv: "ja" }
];

const kImport = JSON.parse(await (await W.handleDfbnetImport(
  { spieler: K_DATEI, dateiname: "bugjagd.xlsx", blaetter: "Alle Spieler (5)" },
  kenv, ADMIN, cors)).text());
const kA = JSON.parse(await (await W.handleDfbnetAbgleich({}, kenv, ADMIN, cors)).text());
const kNamen = (liste) => liste.map((x) => x.name);

// --- Fund 1: das doppelt erfasste Kind --------------------------------
pruefe("K1 Das doppelt erfasste Kind steht als Treffer",
       kNamen(kA.treffer).indexOf("Mira Talberg") >= 0, JSON.stringify(kNamen(kA.treffer)));
// ⚠️ DAS ist der Fund. Vorher stand dasselbe Kind gleichzeitig unter
// "Passt zusammen" UND unter "spielt ohne Spielerlaubnis" -- und jemand
// haette Eltern angerufen, deren Kind die Spielberechtigung laengst hat.
pruefe("K2 Und NICHT zugleich unter 'nicht gemeldet'",
       kNamen(kA.nicht_gemeldet).indexOf("Mira Talberg") < 0,
       JSON.stringify(kNamen(kA.nicht_gemeldet)));
pruefe("K3 Der Doppeleintrag wird gemeldet, nicht still geschluckt",
       kA.doppelt_erfasst === 1 && kA.doppelt_erfasst_namen.indexOf("Mira Talberg") >= 0,
       kA.doppelt_erfasst + " / " + JSON.stringify(kA.doppelt_erfasst_namen));

// --- Fund 1, zweites Symptom: die Kopfzahl ----------------------------
// Vier Datensaetze mit Geburtsdatum im Jahrgangsfenster: Talberg zweimal
// (zwei person-Zeilen), Bergmoser einmal trotz zweier Mitgliedschaften,
// dazu Feldbach. Vorher zaehlte diese Zahl Mitgliedschaften -- also fuenf.
pruefe("K4 Die Kopfzahl zaehlt Datensaetze, nicht Mitgliedschaften",
       kA.anzahl_bestand === 4, "anzahl_bestand = " + kA.anzahl_bestand);
pruefe("K5 Wer zwei laufende Mitgliedschaften hat, steht trotzdem nur einmal da",
       kNamen(kA.treffer).filter((n) => n === "Jarno Bergmoser").length === 1 &&
       kNamen(kA.nicht_gemeldet).indexOf("Jarno Bergmoser") < 0);

// --- Fund 3: das Kind ohne Geburtsdatum -------------------------------
// ⚠️ Vorher tauchte es in der GANZEN Antwort nirgends auf -- nicht in
// einer Liste, nicht in einer Zahl. Deshalb zuerst die harte Probe ueber
// die ganze Antwort und erst danach der Zaehler.
pruefe("K6 Das Fussballkind ohne Geburtsdatum kommt ueberhaupt vor",
       JSON.stringify(kA).indexOf("Korbinian Arnholt") >= 0);
pruefe("K7 Es steht als eigene Luecke da, mit Namen",
       kA.ohne_geburtsdatum_bestand === 1 &&
       kA.ohne_geburtsdatum_bestand_namen.indexOf("Korbinian Arnholt") >= 0,
       kA.ohne_geburtsdatum_bestand + " / " +
       JSON.stringify(kA.ohne_geburtsdatum_bestand_namen));
pruefe("K8 Und NICHT als 'nicht gemeldet' -- verglichen wurde es ja nie",
       kNamen(kA.nicht_gemeldet).indexOf("Korbinian Arnholt") < 0);
pruefe("K9 Gegenprobe: das normale nicht gemeldete Kind steht weiter dort",
       kNamen(kA.nicht_gemeldet).indexOf("Ansgar Feldbach") >= 0,
       JSON.stringify(kNamen(kA.nicht_gemeldet)));

// --- Fund 4: der Name ohne Abgleichsschluessel ------------------------
pruefe("K10 Zeilen ohne verwertbaren Namen werden beim Einlesen gezaehlt",
       kImport.ohne_schluessel === 2, JSON.stringify(kImport));
const kGespeichert = () =>
  kdb.prepare("SELECT COUNT(*) AS n FROM dfbnet_spieler").get().n;
// ⚠️ Gegen kImport.anzahl geprueft, nicht gegen eine getippte Zahl: sonst
// wird diese Zusage rot, sobald jemand der Datei oben eine Zeile zufuegt
// -- und eine feste Zahl im Pruefstand ist genau die Sorte Rot, die man
// beim naechsten Mal wegklickt.
pruefe("K11 Sie werden NICHT gespeichert -- sonst waeren sie eine Sackgasse",
       kGespeichert() === kImport.anzahl && kImport.anzahl === K_DATEI.length - 3,
       "Zeilen in dfbnet_spieler: " + kGespeichert() + ", gemeldet: " + kImport.anzahl);
pruefe("K12 Kein NULL-Schluessel in der Tabelle",
       kdb.prepare("SELECT COUNT(*) AS n FROM dfbnet_spieler " +
                   "WHERE abgleich_schluessel IS NULL").get().n === 0);
pruefe("K13 Der Abgleich nennt sie samt Namen",
       kA.ohne_schluessel === 2 && kA.ohne_schluessel_namen.length === 2,
       kA.ohne_schluessel + " / " + JSON.stringify(kA.ohne_schluessel_namen));
pruefe("K14 Die Zeile ohne Geburtsdatum wird davon nicht verschluckt",
       kA.ohne_geburtsdatum === 1, "ohne_geburtsdatum = " + kA.ohne_geburtsdatum);

// --- Die Rechtegrenze gilt auch fuer die neuen Felder -----------------
const kPass = JSON.parse(await (await W.handleDfbnetAbgleich({}, kenv, PASS, cors)).text());
pruefe("K15 Die Passstelle bekommt die ZAHLEN der Luecken",
       kPass.ohne_geburtsdatum_bestand === 1 && kPass.doppelt_erfasst === 1 &&
       kPass.ohne_schluessel === 2);
pruefe("K16 ... aber keinen der Namen",
       kPass.ohne_geburtsdatum_bestand_namen.length === 0 &&
       kPass.doppelt_erfasst_namen.length === 0 &&
       kPass.ohne_schluessel_namen.length === 0,
       JSON.stringify([kPass.ohne_geburtsdatum_bestand_namen, kPass.doppelt_erfasst_namen,
                       kPass.ohne_schluessel_namen]));
pruefe("K17 Gegenprobe: der Name steht bei ihr auch sonst nirgends",
       JSON.stringify(kPass).indexOf("Korbinian Arnholt") < 0);

// --- Die Migration ergaenzt die zwei neuen Spalten --------------------
// ⚠️ CREATE TABLE IF NOT EXISTS ergaenzt KEINE Spalte an einer Tabelle,
// die es schon gibt. Michels Datenbank hat dfbnet_import seit heute
// frueh -- ohne die beiden Zaehler. Ohne das ALTER liefe jeder weitere
// Import in einen SQL-Fehler.
const adb = new DatabaseSync(":memory:");
for (const anw of readFileSync(REPO + "/schema-kompakt.sql", "utf8")
                    .split(";").map((x) => x.trim()).filter(Boolean)) {
  adb.exec(anw + ";");
}
adb.exec("DROP TABLE dfbnet_import");
adb.exec("CREATE TABLE dfbnet_import (id TEXT PRIMARY KEY, dateiname TEXT, " +
         "eingang_am TEXT NOT NULL, erstellt_von TEXT NOT NULL, anzahl INTEGER NOT NULL, " +
         "doppelt INTEGER NOT NULL DEFAULT 0, ohne_geburtsdatum INTEGER NOT NULL DEFAULT 0, " +
         "ohne_geburtsdatum_namen TEXT, blaetter TEXT)");
const aSpalten = () => new Set(adb.prepare("PRAGMA table_info(dfbnet_import)")
                                  .all().map((x) => x.name));
pruefe("K18 Gegenprobe: die alte Tabelle hat die Spalten wirklich nicht",
       !aSpalten().has("ohne_schluessel"));
const aenv = { VV_DB: d1(adb) };
await W.handleMigration(aenv, ADMIN, cors);
pruefe("K19 Die Migration ergaenzt sie an der bestehenden Tabelle",
       aSpalten().has("ohne_schluessel") && aSpalten().has("ohne_schluessel_namen"),
       JSON.stringify([...aSpalten()]));
// ⚠️ In try/catch, und das ist keine Vorsicht, sondern eine Lehre: ohne
// das ALTER wirft der Import hier "table dfbnet_import has no column
// named ohne_schluessel" -- genau der Fehler, den Michel beim naechsten
// Einlesen bekaeme. Ungefangen reisst er den ganzen Pruefstand ab, und
// alles danach (K21-K23) laeuft nicht mehr. Beim ersten Bau ist die
// Mutationsprobe genau darauf hereingefallen: keine roten Zeilen, also
// gruen gemeldet -- obwohl node mit Code 1 abgestuerzt war.
let aImport = null, aFehler = "";
try {
  aImport = JSON.parse(await (await W.handleDfbnetImport(
    { spieler: [{ nachname: "Talberg", vorname: "Mira", geburtsdatum: "2014-06-06",
                  mannschaft: "D", aktiv: "ja" }], dateiname: "nach-alter.xlsx" },
    aenv, ADMIN, cors)).text());
} catch (e) { aFehler = String(e && e.message ? e.message : e); }
pruefe("K20 Und ein Import laeuft danach durch", aImport && aImport.ok === true,
       aFehler || JSON.stringify(aImport));

// --- Fund 2: jeder Aktionsname des Clients muss den Worker treffen ----
// ⚠️ Das ist die Zusage, die den ganzen Fehler AUFGEDECKT haette:
// dfbnet.js schickte `vv-mitglieder-liste`, den Fall gibt es im Worker
// nicht, und der Server antwortete mit "Unbekannte Aktion". Kein
// Syntaxfehler, keine Konsolenmeldung, keine Raster-Klasse -- nur ein
// toter Weg. Gemessen wird gegen den ECHTEN Code beider Seiten, nie
// gegen eine von Hand gepflegte Liste.
const workerFaelle = new Set(
  [...rohWorker.matchAll(/case\s+"(vv-[a-z0-9-]+)"/g)].map((m) => m[1]));
pruefe("K21 Gegenprobe: der Worker hat ueberhaupt Faelle", workerFaelle.size > 30,
       workerFaelle.size + " Faelle");
const clientDateien = ["dfbnet.js", "db.js", "kodex-verwaltung.js", "antraege.js",
                       "app.js", "import.js", "lsb.js", "reha.js", "rollen.js",
                       "beitraege.js", "lauf.js", "zahlungen.js", "auswertung.js",
                       "nachwuchs.js", "kodex.js", "antrag.js", "tfv-antrag.js",
                       "db-antrag.js", "sicherung-wiederherstellen.js"];
const tote = [];
let gefundeneAufrufe = 0;
for (const datei of clientDateien) {
  let text = "";
  try { text = readFileSync(REPO + "/" + datei, "utf8"); } catch { continue; }
  for (const m of text.matchAll(/vvRequest\(\s*"(vv-[a-z0-9-]+)"/g)) {
    gefundeneAufrufe++;
    if (!workerFaelle.has(m[1])) tote.push(datei + ": " + m[1]);
  }
}
// ⚠️ Erst die Gegenprobe, dann die Zusage: ohne sie waere K23 auch dann
// gruen, wenn der regulaere Ausdruck gar nichts findet.
pruefe("K22 Gegenprobe: es werden ueberhaupt Aufrufe gefunden", gefundeneAufrufe > 20,
       gefundeneAufrufe + " Aufrufe");
pruefe("K23 Kein Client ruft eine Aktion, die es im Worker nicht gibt",
       tote.length === 0, tote.join(" · "));

// --- Der Satz zu den Luecken liest sich in beiden Zahlformen ----------
// ⚠️ Genau EIN Fall ist hier der Normalfall, nicht der Sonderfall. Beim
// ersten Wurf stand da "1 Zeilen ohne Geburtsdatum" und "1 Kinder stehen
// doppelt" -- im Browser gemessen, nicht vermutet.
pruefe("K24 Einzahl", C.dfbLuecke(1, [], "Kind steht doppelt", "Kinder stehen doppelt")
       === "<strong>1 Kind steht doppelt</strong>. ",
       C.dfbLuecke(1, [], "Kind steht doppelt", "Kinder stehen doppelt"));
pruefe("K25 Mehrzahl, mit Namen dahinter",
       C.dfbLuecke(2, ["Mira T", "Jarno B"], "Kind steht doppelt", "Kinder stehen doppelt")
       === "<strong>2 Kinder stehen doppelt</strong> (Mira T, Jarno B). ");
// ⚠️ Bei 0 gar kein Satz: "0 Kinder stehen doppelt" liest man jeden Tag
// und irgendwann gar nicht mehr.
pruefe("K26 Bei null bleibt der Satz ganz weg",
       C.dfbLuecke(0, [], "Kind steht doppelt", "Kinder stehen doppelt") === "");


// ======================================================================
console.log("L  Zuordnungen ohne Zeile in der Meldeliste (Abnahme 11.09.2026)");
// ======================================================================
//
// ⚠️ Eine Handzuordnung speichert Namen und Geburtsdatum des gemeldeten
// Kindes MIT und ueberlebt jeden neuen Export und jedes Loeschen der
// Liste. Das ist Absicht. Nur hing der Knopf "Zuordnung aufheben" an
// einer ZEILE der Meldeliste -- war das Kind im naechsten Export nicht
// mehr dabei oder die Liste geloescht, stand sein Name fuer immer in der
// Datenbank und niemand kam mehr heran. Ein Datenbestand ueber
// Minderjaehrige ohne Loeschweg.

const ldb = new DatabaseSync(":memory:");
for (const anw of readFileSync(REPO + "/schema-kompakt.sql", "utf8")
                    .split(";").map((x) => x.trim()).filter(Boolean)) {
  ldb.exec(anw + ";");
}
const lenv = { VV_DB: d1(ldb) };
ldb.exec("INSERT INTO benutzer_rolle (id, username, rolle, sparte_id, erstellt_am, " +
         "erstellt_von) VALUES ('lr-pass', 'pass.stelle', 'passstelle', NULL, " + WER + ")");
await W.handleMigration(lenv, ADMIN, cors);
ldb.exec("INSERT INTO sparte (id, name, aktiv, erstellt_am, erstellt_von) " +
         "VALUES ('sp-fu', 'Fussball', 1, " + WER + ")");
ldb.exec("INSERT INTO person (id, vorname, nachname, geburtsdatum, erstellt_am, " +
         "erstellt_von) VALUES ('lp1', 'Mira', 'Talberg', '2014-06-06', " + WER + ")");
ldb.exec("INSERT INTO mitgliedschaft (id, person_id, mitgliedsnummer, art, eintritt, " +
         "austritt, status, erstellt_am, erstellt_von) VALUES ('lm1', 'lp1', '801', " +
         "'ordentlich', '2020-01-01', NULL, 'aktiv', " + WER + ")");
ldb.exec("INSERT INTO mitgliedschaft_sparte (id, mitgliedschaft_id, sparte_id, eintritt, " +
         "erstellt_am, erstellt_von) VALUES ('lms1', 'lm1', 'sp-fu', '2020-01-01', " + WER + ")");

// Der gemeldete Name ist anders geschrieben -- genau der Fall, fuer den
// es die Handzuordnung gibt.
await W.handleDfbnetImport({ spieler: [
  { nachname: "Talbergg", vorname: "Mira", geburtsdatum: "2014-06-06",
    mannschaft: "D-Junioren", aktiv: "ja" }
], dateiname: "lauf1.xlsx" }, lenv, ADMIN, cors);
await W.handleDfbnetZuordnen({ vorname: "Mira", nachname: "Talbergg",
  geburtsdatum: "2014-06-06", person_id: "lp1" }, lenv, ADMIN, cors);

const lA = (wer) => W.handleDfbnetAbgleich({}, lenv, wer || ADMIN, cors)
  .then((r) => r.text()).then(JSON.parse);

const l1 = await lA();
pruefe("L1 Solange der Spieler in der Liste steht, ist die Zuordnung nicht verwaist",
       (l1.verwaiste_zuordnungen || []).length === 0,
       JSON.stringify(l1.verwaiste_zuordnungen));
pruefe("L2 Gegenprobe: sie wirkt auch wirklich",
       l1.treffer.length === 1 && l1.treffer[0].von_hand === true);

// ⚠️ Der Alltagsfall: neuer Export, das Kind ist nicht mehr dabei.
await W.handleDfbnetImport({ spieler: [
  { nachname: "Bergmoser", vorname: "Jarno", geburtsdatum: "2013-05-05",
    mannschaft: "D-Junioren", aktiv: "ja" }
], dateiname: "lauf2.xlsx" }, lenv, ADMIN, cors);
const l2 = await lA();
pruefe("L3 Nach einem Export ohne das Kind steht die Zuordnung als verwaist da",
       (l2.verwaiste_zuordnungen || []).length === 1 &&
       l2.verwaiste_zuordnungen[0].name === "Mira Talbergg",
       JSON.stringify(l2.verwaiste_zuordnungen));
// ⚠️ Ueber `|| {}` gelesen, nicht ueber [0] direkt. Ohne das wirft diese
// Zeile bei leerer Liste einen TypeError und reisst den ganzen Pruefstand
// mit -- die Mutation "verwaiste nie melden" sah dadurch aus wie ein
// Absturz statt wie eine gefangene Verschlechterung. Dieselbe Lehre wie
// bei K20.
const l2Eins = (l2.verwaiste_zuordnungen || [])[0] || {};
pruefe("L4 Mit den Feldern, die zum Aufheben noetig sind",
       l2Eins.vorname === "Mira" && l2Eins.nachname === "Talbergg" &&
       l2Eins.geburtsdatum === "2014-06-06", JSON.stringify(l2Eins));

// ⚠️ Und der harte Fall: die ganze Liste geloescht. Vorher war der Reiter
// danach LEER und die Zeile unerreichbar.
await W.handleDfbnetImport({ loeschen: true }, lenv, ADMIN, cors);
const l3 = await lA();
pruefe("L5 Auch die leere Antwort traegt sie", l3.leer === true &&
       (l3.verwaiste_zuordnungen || []).length === 1,
       "leer=" + l3.leer + " verwaist=" + JSON.stringify(l3.verwaiste_zuordnungen));
pruefe("L6 Gegenprobe: die Zeile steht wirklich noch in der Datenbank",
       ldb.prepare("SELECT COUNT(*) AS n FROM dfbnet_zuordnung").get().n === 1);

// Der Weg heraus muss dann auch gehen.
const lWeg = JSON.parse(await (await W.handleDfbnetZuordnen(
  { vorname: "Mira", nachname: "Talbergg", geburtsdatum: "2014-06-06", person_id: "" },
  lenv, ADMIN, cors)).text());
pruefe("L7 Aufheben geht ohne Meldeliste", lWeg.ok === true && lWeg.zugeordnet === false,
       JSON.stringify(lWeg));
pruefe("L8 Und die Zeile ist danach weg",
       ldb.prepare("SELECT COUNT(*) AS n FROM dfbnet_zuordnung").get().n === 0);

// ⚠️ Die Rechtegrenze gilt auch hier: es sind Namen von Kindern, die gar
// nicht mehr gemeldet sind -- ohne diese Zeile waere die Karte ein Weg an
// der Passstellen-Grenze vorbei.
await W.handleDfbnetZuordnen({ vorname: "Mira", nachname: "Talbergg",
  geburtsdatum: "2014-06-06", person_id: "lp1" }, lenv, ADMIN, cors);
const lPass = await lA(PASS);
pruefe("L9 Die Passstelle bekommt die verwaisten Zuordnungen NICHT",
       (lPass.verwaiste_zuordnungen || []).length === 0,
       JSON.stringify(lPass.verwaiste_zuordnungen));
pruefe("L10 Gegenprobe: der Name steht in ihrer Antwort auch sonst nirgends",
       JSON.stringify(lPass).indexOf("Talbergg") < 0);
pruefe("L11 Gegenprobe: die Geschaeftsstelle sieht ihn sehr wohl",
       JSON.stringify(await lA()).indexOf("Talbergg") >= 0);

// ⚠️ Kein zweiter Rundlauf fuer dieselbe Tabelle. Vorher wurde
// dfbnet_zuordnung zweimal abgefragt.
lenv.VV_DB.lauf.abfragen = 0;
await lA();
pruefe("L12 Der Abgleich fragt dfbnet_zuordnung nur EINMAL ab",
       lenv.VV_DB.lauf.abfragen <= 8, lenv.VV_DB.lauf.abfragen + " Rundlaeufe");

// Und die Karte muss gezeichnet werden -- eine gruene Zusage auf ein Feld
// der Antwort belegt nicht, dass es jemand zu sehen bekommt.
const lHtml = C.dfbVerwaisteKarte({ verwaiste_zuordnungen: [
  { name: "Mira Talbergg", vorname: "Mira", nachname: "Talbergg",
    geburtsdatum: "2014-06-06", erstellt_am: "2026-09-11" }] });
pruefe("L13 Die Karte nennt den Namen", lHtml.indexOf("Mira Talbergg") >= 0);
pruefe("L14 ... und traegt einen Aufheben-Knopf mit allen drei Rohfeldern",
       /data-dfb="aufheben"/.test(lHtml) && /data-vorname="Mira"/.test(lHtml) &&
       /data-nachname="Talbergg"/.test(lHtml) && /data-geb="2014-06-06"/.test(lHtml),
       lHtml);
pruefe("L15 Ohne verwaiste Zuordnungen gar keine Karte",
       C.dfbVerwaisteKarte({ verwaiste_zuordnungen: [] }) === "" &&
       C.dfbVerwaisteKarte({}) === "");

// ⚠️ Die Karte muss in BEIDEN Zweigen von dfbZeichne stehen -- im vollen
// UND im leeren. Im leeren ist sie der einzige Weg an diese Daten heran,
// und genau der fehlte. dfbZeichne selbst braucht das DOM, deshalb hier
// die Verdrahtung am Quelltext; im Browser ist sie zusaetzlich gemessen.
const lLeerZweig = (rohClient.match(/if \(!e \|\| e\.leer\) \{[\s\S]*?\n  \}/) || [""])[0];
pruefe("L16 Gegenprobe: der leere Zweig wurde ueberhaupt gefunden",
       lLeerZweig.length > 100, lLeerZweig.length + " Zeichen");
pruefe("L17 Der leere Zweig zeichnet die Karte",
       lLeerZweig.indexOf("dfbVerwaisteKarte") >= 0, lLeerZweig);
// ⚠️ Ohne das `(?<!function )` zaehlt die DEFINITION mit -- beim ersten
// Wurf stand hier 2 erwartet und 3 gemessen, und die Erwartung war falsch,
// nicht der Code.
const lAufrufe = (rohClient.match(/(?<!function )dfbVerwaisteKarte\(e\)/g) || []).length;
pruefe("L18 Die Karte wird an genau ZWEI Stellen gezeichnet (leer und voll)",
       lAufrufe === 2, lAufrufe + " Aufrufe");

// ======================================================================
console.log("");
console.log("Zusagen: " + ok + " gruen, " + fehler + " rot");
if (fehler) {
  console.log("");
  for (const f of fehlerListe) console.log("  ✗ " + f);
  process.exit(1);
}
