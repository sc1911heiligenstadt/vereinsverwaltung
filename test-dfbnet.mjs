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
    async batch(liste) {
      lauf.abfragen++;
      const out = [];
      for (const a of liste) out.push(a.run());
      return out;
    }
  };
}

// --- Der echte Code ---------------------------------------------------

const rohWorker = readFileSync(REPO + "/vereinsverwaltung-worker.js", "utf8");
const schnitt = rohWorker.indexOf("export default");
if (schnitt < 0) throw new Error("export default nicht gefunden");
const W = new Function(rohWorker.slice(0, schnitt) +
  "\nreturn { handleDfbnetAbgleich, handleMigration, ladeRolle, kodexSchluessel, " +
  "DFBNET_MAX_ZEILEN };")();

// dfbnet.js benutzt $, esc, datumDe und XLSX erst beim ZEICHNEN. Die drei
// Lesefunktionen kommen ohne aus -- genau deshalb stehen sie getrennt.
const rohClient = readFileSync(REPO + "/dfbnet.js", "utf8");
const C = new Function(rohClient +
  "\nreturn { dfbKopfFinden, dfbDatum, dfbMannschaftAusBlatt, dfbKopfWort };")();

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

const antwort = await (await W.handleDfbnetAbgleich(
  { spieler: DATEI, stichtag: STICHTAG }, env, ADMIN, cors)).json();

const lage = (name) => (antwort.offen.find((o) => o.name.indexOf(name) >= 0) || {}).lage;
const offenZu = (name) => antwort.offen.find((o) => o.name.indexOf(name) >= 0) || {};

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
const doppelAntwort = await (await W.handleDfbnetAbgleich({ stichtag: STICHTAG, spieler: [
  { nachname: "Bergmoser", vorname: "Jarno", geburtsdatum: "2008-03-09",
    mannschaft: "A-Junioren", aktiv: "nein" },
  { nachname: "Bergmoser", vorname: "Jarno", geburtsdatum: "2008-03-09",
    mannschaft: "B-Junioren", aktiv: "ja" }
] }, env, ADMIN, cors)).json();
pruefe("C5 Aktives Spielrecht schlaegt ruhendes",
       doppelAntwort.treffer[0] && doppelAntwort.treffer[0].aktiv === "ja",
       doppelAntwort.treffer[0] && doppelAntwort.treffer[0].aktiv);
pruefe("C6 Ein ruhendes Spielrecht bleibt sonst stehen",
       offenZu("Zaubermann").aktiv === "nein", offenZu("Zaubermann").aktiv);

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
const weitAntwort = await (await W.handleDfbnetAbgleich({ stichtag: STICHTAG, spieler: [
  { nachname: "Bergmoser", vorname: "Jarno", geburtsdatum: "2008-03-09",
    mannschaft: "A-Junioren", aktiv: "ja" },
  { nachname: "Neumann", vorname: "Pepe", geburtsdatum: "2019-03-03",
    mannschaft: "F-Junioren", aktiv: "ja" }
] }, env, ADMIN, cors)).json();
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

const pAntwort = await (await W.handleDfbnetAbgleich(
  { spieler: DATEI, stichtag: STICHTAG }, env, PASS, cors)).json();

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
const fRes = await W.handleDfbnetAbgleich({ spieler: DATEI }, env, FREMD, cors);
pruefe("E15 Ohne Rolle: 403", fRes.status === 403, "" + fRes.status);

// ======================================================================
console.log("F  Gegenproben und Mutationen");
// ======================================================================

const leer = await W.handleDfbnetAbgleich({ spieler: [] }, env, ADMIN, cors);
pruefe("F1 Keine Zeile: 400", leer.status === 400, "" + leer.status);

const nurOhneDatum = await W.handleDfbnetAbgleich({ spieler: [
  { nachname: "Ohnedatum", vorname: "Nora", geburtsdatum: "", mannschaft: "", aktiv: "ja" }
] }, env, ADMIN, cors);
pruefe("F2 Nur Zeilen ohne Geburtsdatum: 400 mit Begruendung",
       nurOhneDatum.status === 400, "" + nurOhneDatum.status);

const zuViel = await W.handleDfbnetAbgleich({ spieler:
  Array.from({ length: W.DFBNET_MAX_ZEILEN + 1 }, (_, i) => ({
    nachname: "N" + i, vorname: "V", geburtsdatum: "2012-01-01", mannschaft: "", aktiv: "ja" }))
}, env, ADMIN, cors);
pruefe("F3 Zu viele Zeilen: 400", zuViel.status === 400, "" + zuViel.status);

// ⚠️ Ohne die Abteilung Fussball wird NICHT ungefiltert geliefert. Eine
// Liste aller Mitglieder saehe wie ein Ergebnis aus und waere falsch.
db.exec("UPDATE sparte SET aktiv = 0 WHERE id = 'sp-fu'");
const ohneFu = await W.handleDfbnetAbgleich({ spieler: DATEI, stichtag: STICHTAG },
                                            env, ADMIN, cors);
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
await W.handleDfbnetAbgleich({ spieler: DATEI, stichtag: STICHTAG }, env, ADMIN, cors);
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
await W.handleDfbnetAbgleich({ spieler: DATEI, stichtag: STICHTAG }, env, ADMIN, cors);
const rundlaeufe = env.VV_DB.lauf.abfragen - vorAbfragen;
pruefe("F6 Ein Lauf braucht hoechstens fuenf Rundlaeufe", rundlaeufe <= 5,
       rundlaeufe + " Rundlaeufe");

// ⚠️ Und er bleibt dabei, wenn die Datei zehnmal so gross ist. Ohne diese
// Zeile waere F6 auch mit einer Schleife gruen, solange die Datei klein
// ist -- und im Echtbetrieb mit 146 Spielern stuerbe der Worker.
const viele = [];
for (let i = 0; i < 300; i++) {
  viele.push({ nachname: "Pruefling" + i, vorname: "Ann", geburtsdatum: "2012-05-05",
               mannschaft: "C-Junioren", aktiv: "ja" });
}
const vorViele = env.VV_DB.lauf.abfragen;
await W.handleDfbnetAbgleich({ spieler: viele, stichtag: STICHTAG }, env, ADMIN, cors);
pruefe("F7 300 Spieler brauchen nicht mehr Rundlaeufe als sieben",
       env.VV_DB.lauf.abfragen - vorViele <= 5,
       (env.VV_DB.lauf.abfragen - vorViele) + " Rundlaeufe");

// ⚠️ Der strenge Schluessel bleibt streng: die Nachsicht der Vorschlaege
// darf NIE nach oben wandern. Sonst gaelte ein Kind als gemeldet, das nur
// aehnlich heisst -- und die Spielberechtigung haengt daran.
pruefe("F8 Grünbaum und Grunbaum sind fuer den Schluessel zwei Kinder",
       W.kodexSchluessel("Mira", "Grünbaum", "2012-03-04") !==
       W.kodexSchluessel("Mira", "Grunbaum", "2012-03-04"));
pruefe("F9 Deshalb wurde der Umlaut-Fall NICHT als Treffer gebucht",
       !antwort.treffer.some((t) => t.name.indexOf("Grunbaum") >= 0));

// ======================================================================
console.log("");
console.log("Zusagen: " + ok + " gruen, " + fehler + " rot");
if (fehler) {
  console.log("");
  for (const f of fehlerListe) console.log("  ✗ " + f);
  process.exit(1);
}
