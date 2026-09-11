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
  "dfbnetIndex, dfbnetKandidaten, kodexTeileListe, kodexAehnlichkeit, " +
  "KODEX_VORSCHLAG_PUNKTE };")();

// dfbnet.js benutzt $, esc, datumDe und XLSX erst beim ZEICHNEN. Die drei
// Lesefunktionen kommen ohne aus -- genau deshalb stehen sie getrennt.
const rohClient = readFileSync(REPO + "/dfbnet.js", "utf8");
const C = new Function(rohClient +
  "\nreturn { dfbKopfFinden, dfbDatum, dfbMannschaftAusBlatt, dfbKopfWort, " +
  "dfbSuchform, dfbNameTrifft };")();

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

const jKarte = W.dfbnetIndex(jPool);
function jUeberIndex(g) {
  const raus = [];
  for (const p of W.dfbnetKandidaten(jKarte, g.teile, g.geburtsdatum)) {
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
  jPaareIndex += W.dfbnetKandidaten(jKarte, g.teile, g.geburtsdatum).size;
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
console.log("");
console.log("Zusagen: " + ok + " gruen, " + fehler + " rot");
if (fehler) {
  console.log("");
  for (const f of fehlerListe) console.log("  ✗ " + f);
  process.exit(1);
}
