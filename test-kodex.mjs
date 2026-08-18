// Pruefstand fuer das Nachreichen des Elternkodex (2026-08-18).
//
// Faehrt den ECHTEN Worker-Code gegen das ECHTE Schema (node:sqlite mit
// duennem D1-Aufsatz, schema-kompakt.sql eingespielt). Die Funktionen
// werden aus der Datei gezogen, nicht nachgebaut -- ein Nachbau prueft
// den Nachbau. Gleiches Geruest wie test-nachwuchs.mjs.
//
//   node test-kodex.mjs
//
// Abschnitte:
//   A  Migration (Tabelle, eindeutiger Index, Schalter kodex_offen)
//   B  Der Abgleichsschluessel
//   C  pruefeKodex (Weissliste und Pflichtfelder)
//   D  Absenden gegen die echte Datenbank
//   E  Der Abgleich in handleKodexListe
//   F  Zuordnen, Aufheben, Loeschen
//   G  Das Fenster zwischen Deploy und erster Migration
//   H  Zusagen der Browser-Seiten

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

const NAMEN = ["kodexSchluessel", "kodexNamensteil", "pruefeKodex", "hatKodexTabelle",
               "handleKodexInfo", "handleKodexSenden", "handleKodexListe",
               "handleKodexDetail", "handleKodexZuordnen", "handleKodexLoeschen",
               "handleMigration", "KODEX_SCHEMA", "ELTERNKODEX_VERSION",
               "KODEX_JE_IP_STUNDE", "KODEX_JE_IP_TAG", "EINSTELLUNGEN", "alterAm"];

// ⚠️ Eigener Kontext je Aufruf. hatKodexTabelle() merkt sich das Ja in
// einer Modulvariablen -- genau wie hatNachwuchsSpalten. Abschnitt G
// braucht deshalb einen FRISCHEN Worker, sonst traegt der Merker aus
// Abschnitt D das Ja herueber und der Abschnitt prueft nichts.
function neuerWorker() {
  return new Function(quelle + "\nreturn {" + NAMEN.join(",") + "};")();
}
const W = neuerWorker();

// --- Datenbank aufsetzen ----------------------------------------------

const db = new DatabaseSync(":memory:");
const schema = readFileSync(REPO + "/schema-kompakt.sql", "utf8");
for (const anw of schema.split(";").map((s) => s.trim()).filter(Boolean)) {
  db.exec(anw + ";");
}
const env = { VV_DB: d1(db) };

const me = { username: "pruefer", isAdmin: true, canEdit: true, canAdmin: true };
const cors = {};
const HEUTE = "2026-08-18";
const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

const tabellen = () => new Set(db.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table'").all().map((z) => z.name));
const indizes = () => new Set(db.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'index'").all().map((z) => z.name));

// Anfrage-Attrappe. Die IP entscheidet ueber die Bremse, also muss sie
// steuerbar sein.
function anfrage(ip) {
  return { headers: { get: (n) =>
    n === "CF-Connecting-IP" ? (ip || "1.2.3.4")
    : n === "User-Agent" ? "Pruefstand" : null } };
}

const koerper = (mehr) => Object.assign({
  kind_vorname: "Anna-Lena",
  kind_nachname: "Mustermann",
  kind_geburtsdatum: "2015-04-12",
  mannschaft: "E1-Junioren",
  erz_name: "Sabine Mustermann",
  erz_email: "sabine@example.org",
  ort: "Heilbad Heiligenstadt",
  einwilligung_kodex: true,
  unterschrift: SIG
}, mehr);

// ======================================================================
console.log("A  Migration");
// ======================================================================

// Altstand herstellen: die Tabelle gibt es live noch nicht.
db.exec("DROP INDEX IF EXISTS idx_kodex_abgleich");
db.exec("DROP TABLE IF EXISTS elternkodex_bestaetigung");

pruefe("A1 Altstand: die Tabelle fehlt", !tabellen().has("elternkodex_bestaetigung"));

const mig1 = await W.handleMigration(env, me, cors);
pruefe("A2 Migration antwortet 200", mig1.status === 200, "status " + mig1.status);
pruefe("A3 Die Tabelle ist da", tabellen().has("elternkodex_bestaetigung"));
pruefe("A4 Der eindeutige Index ist da", indizes().has("idx_kodex_abgleich"));

// Der Index ist die einzige Klammer gegen die Doppelbestaetigung. Ohne
// ihn duerfte das Absenden kein UPSERT sein.
const idxSql = db.prepare(
  "SELECT sql FROM sqlite_master WHERE name = 'idx_kodex_abgleich'").get();
pruefe("A5 Der Index ist UNIQUE", /UNIQUE/i.test(idxSql.sql), idxSql.sql);
pruefe("A6 Der Index steht auf abgleich_schluessel",
       /abgleich_schluessel/.test(idxSql.sql));

const mig2 = await W.handleMigration(env, me, cors);
const mig2b = await mig2.json();
pruefe("A7 Zweiter Lauf ergaenzt nichts mehr", mig2b.ergaenzt === 0, "ergaenzt " + mig2b.ergaenzt);
pruefe("A8 Zweiter Lauf laesst die Tabelle stehen",
       tabellen().has("elternkodex_bestaetigung"));

pruefe("A9 Schalter kodex_offen ist eingerichtet", !!W.EINSTELLUNGEN.kodex_offen);
pruefe("A10 kodex_offen ist NICHT nachwuchs_offen",
       W.EINSTELLUNGEN.kodex_offen !== W.EINSTELLUNGEN.nachwuchs_offen);
pruefe("A11 kodex_offen ist NICHT antrag_offen",
       W.EINSTELLUNGEN.kodex_offen !== W.EINSTELLUNGEN.antrag_offen);
pruefe("A12 kodex_offen liegt in der Gruppe 'antrag'",
       W.EINSTELLUNGEN.kodex_offen.gruppe === "antrag", W.EINSTELLUNGEN.kodex_offen.gruppe);
pruefe("A13 kodex_offen ist ab Werk offen", W.EINSTELLUNGEN.kodex_offen.vorgabe === 1);

// Das Schema im Repo und das, was die Migration baut, muessen dasselbe
// sagen. Sonst laeuft eine frisch eingespielte Datenbank anders als eine
// gewachsene.
const kompakt = readFileSync(REPO + "/schema-kompakt.sql", "utf8");
pruefe("A14 schema-kompakt.sql kennt die Tabelle",
       /elternkodex_bestaetigung/.test(kompakt));
pruefe("A15 schema-kompakt.sql kennt den eindeutigen Index",
       /UNIQUE INDEX[^;]*idx_kodex_abgleich/i.test(kompakt));
pruefe("A16 schema.sql kennt die Tabelle",
       /elternkodex_bestaetigung/.test(readFileSync(REPO + "/schema.sql", "utf8")));

// ======================================================================
console.log("B  Der Abgleichsschluessel");
// ======================================================================

const S = (v, n, g) => W.kodexSchluessel(v, n, g || "2015-04-12");

pruefe("B1 Umlaut wird umgeschrieben",
       S("Max", "Müller") === S("Max", "Mueller"),
       S("Max", "Müller") + " / " + S("Max", "Mueller"));
pruefe("B2 Gross und klein sind gleich", S("MAX", "MÜLLER") === S("max", "müller"));
pruefe("B3 Leerzeichen am Rand zaehlen nicht", S("  Max ", " Müller  ") === S("Max", "Müller"));
pruefe("B4 Vor- und Nachname vertauscht treffen dasselbe",
       S("Max", "Müller") === S("Müller", "Max"),
       S("Max", "Müller") + " / " + S("Müller", "Max"));
pruefe("B5 Bindestrich und Leerzeichen sind gleich",
       S("Anna-Lena", "Weber") === S("Anna Lena", "Weber"));
pruefe("B6 Doppelname in einem Feld trifft dasselbe",
       S("Anna Lena", "Weber") === S("", "Anna Lena Weber"));
pruefe("B7 Komma zaehlt nicht", S("Anna", "Weber") === S("", "Weber, Anna"));
pruefe("B8 Akzent wird abgeworfen",
       S("José", "Garcia") === S("Jose", "Garcia"),
       S("José", "Garcia"));
pruefe("B9 Eszett wird zu ss", S("Hans", "Weiß") === S("Hans", "Weiss"));
// Ein mehrteiliger Nachname zerfaellt in seine Woerter -- alle bleiben
// im Schluessel, keiner faellt weg.
pruefe("B10 Mehrteiliger Nachname behaelt alle Woerter",
       S("Karl", "von der Heide").split("|").length === 5,
       S("Karl", "von der Heide"));
pruefe("B10b Zusammengeschrieben ist NICHT dasselbe",
       S("Karl", "von der Heide") !== S("Karl", "vonderHeide"),
       S("Karl", "von der Heide") + " / " + S("Karl", "vonderHeide"));

// ⚠️ Der Anker. Ohne das Geburtsdatum fielen zwei gleichnamige Kinder
// zusammen -- und mit der Vertauschungstoleranz sogar "Max Thomas" und
// "Thomas Max".
pruefe("B11 Anderes Geburtsdatum ist ein anderer Schluessel",
       S("Max", "Müller", "2015-04-12") !== S("Max", "Müller", "2016-04-12"));
pruefe("B12 Das Geburtsdatum steht im Schluessel",
       S("Max", "Müller").endsWith("|2015-04-12"), S("Max", "Müller"));
pruefe("B13 Verschiedene Namen bleiben verschieden",
       S("Max", "Müller") !== S("Moritz", "Müller"));

pruefe("B14 Ein Name ohne verwertbare Zeichen gibt null",
       W.kodexSchluessel("...", "---", "2015-04-12") === null);
pruefe("B15 Leerer Name gibt null", W.kodexSchluessel("", "", "2015-04-12") === null);
pruefe("B16 Namensteil normalisiert Ziffern nicht weg",
       W.kodexNamensteil("Abc123") === "abc123", W.kodexNamensteil("Abc123"));

// ======================================================================
console.log("C  pruefeKodex");
// ======================================================================

pruefe("C1 Vollstaendig geht durch", !!W.pruefeKodex(koerper(), HEUTE).satz);

pruefe("C2 Ohne Vornamen abgewiesen", !!W.pruefeKodex(koerper({ kind_vorname: "" }), HEUTE).fehler);
pruefe("C3 Ohne Nachnamen abgewiesen", !!W.pruefeKodex(koerper({ kind_nachname: "" }), HEUTE).fehler);
pruefe("C4 Ohne Geburtsdatum abgewiesen",
       !!W.pruefeKodex(koerper({ kind_geburtsdatum: "" }), HEUTE).fehler);
pruefe("C5 Kaputtes Geburtsdatum abgewiesen",
       !!W.pruefeKodex(koerper({ kind_geburtsdatum: "12.04.2015" }), HEUTE).fehler);
pruefe("C6 Geburtsdatum in der Zukunft abgewiesen",
       !!W.pruefeKodex(koerper({ kind_geburtsdatum: "2027-01-01" }), HEUTE).fehler);
pruefe("C7 Unplausibles Geburtsdatum abgewiesen",
       !!W.pruefeKodex(koerper({ kind_geburtsdatum: "1899-01-01" }), HEUTE).fehler);
pruefe("C8 Ohne Namen der Erziehungsberechtigten abgewiesen",
       !!W.pruefeKodex(koerper({ erz_name: "" }), HEUTE).fehler);

// Das Haekchen ist der Kern der Erklaerung. Ohne es belegte die
// Unterschrift nur, dass jemand gezeichnet hat.
pruefe("C9 Ohne Haekchen abgewiesen",
       !!W.pruefeKodex(koerper({ einwilligung_kodex: false }), HEUTE).fehler);
pruefe("C10 Haekchen als Zeichenkette zaehlt nicht",
       !!W.pruefeKodex(koerper({ einwilligung_kodex: "true" }), HEUTE).fehler);
pruefe("C11 Fehlendes Haekchen zaehlt nicht",
       !!W.pruefeKodex(koerper({ einwilligung_kodex: undefined }), HEUTE).fehler);

pruefe("C12 Ohne Unterschrift abgewiesen",
       !!W.pruefeKodex(koerper({ unterschrift: "" }), HEUTE).fehler);
pruefe("C13 Fremdes Bildformat abgewiesen",
       !!W.pruefeKodex(koerper({ unterschrift: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" }),
                       HEUTE).fehler);
pruefe("C14 Externe Adresse als Unterschrift abgewiesen",
       !!W.pruefeKodex(koerper({ unterschrift: "https://example.org/sig.png" }), HEUTE).fehler);

// Die E-Mail ist freiwillig -- eine kaputte ist aber schlechter als
// keine, weil sie eine Erreichbarkeit behauptet.
pruefe("C15 Ohne E-Mail geht durch", !!W.pruefeKodex(koerper({ erz_email: "" }), HEUTE).satz);
pruefe("C16 Kaputte E-Mail abgewiesen",
       !!W.pruefeKodex(koerper({ erz_email: "keine-adresse" }), HEUTE).fehler);
pruefe("C17 Ohne Mannschaft geht durch", !!W.pruefeKodex(koerper({ mannschaft: "" }), HEUTE).satz);
pruefe("C18 Ohne Ort geht durch", !!W.pruefeKodex(koerper({ ort: "" }), HEUTE).satz);

// ⚠️ Die Weissliste. Was der Server selbst setzt, darf der Absender nicht
// bestimmen.
const geschmuggelt = W.pruefeKodex(koerper({
  id: "fremd", eingang_am: "2000-01-01T00:00:00Z", kodex_version: "99.9",
  person_id: "p-fremd", zugeordnet_von: "hacker", signatur_ip: "9.9.9.9",
  abgleich_schluessel: "erfunden"
}), HEUTE).satz;
pruefe("C19 id wird nicht uebernommen", geschmuggelt.id === undefined);
pruefe("C20 eingang_am wird nicht uebernommen", geschmuggelt.eingang_am === undefined);
pruefe("C21 kodex_version wird nicht uebernommen", geschmuggelt.kodex_version === undefined);
pruefe("C22 person_id wird nicht uebernommen", geschmuggelt.person_id === undefined);
pruefe("C23 zugeordnet_von wird nicht uebernommen", geschmuggelt.zugeordnet_von === undefined);
pruefe("C24 signatur_ip wird nicht uebernommen", geschmuggelt.signatur_ip === undefined);
pruefe("C25 Der Schluessel wird selbst gerechnet",
       geschmuggelt.abgleich_schluessel !== "erfunden",
       geschmuggelt.abgleich_schluessel);
pruefe("C26 Der Schluessel passt zu den Namen",
       geschmuggelt.abgleich_schluessel === S("Anna-Lena", "Mustermann"));

// Lange Werte werden gekappt, nicht abgewiesen.
const lang = W.pruefeKodex(koerper({ kind_vorname: "A".repeat(300) }), HEUTE).satz;
pruefe("C27 Zu langer Vorname wird gekappt", lang.kind_vorname.length === 80,
       "" + lang.kind_vorname.length);

// ======================================================================
console.log("D  Absenden gegen die echte Datenbank");
// ======================================================================

// Testdaten: drei Kinder und ein Erwachsener, alle mit Mitgliedschaft.
const WER = "'2020-01-01', 'pruefer'";
function legeAn(id, vorname, nachname, geburt, nr, sparte) {
  db.exec("INSERT INTO person (id, vorname, nachname, geburtsdatum, erstellt_am, " +
          "erstellt_von) VALUES ('" + id + "', '" + vorname + "', '" + nachname + "', '" +
          geburt + "', " + WER + ")");
  db.exec("INSERT INTO mitgliedschaft (id, person_id, mitgliedsnummer, art, eintritt, " +
          "status, erstellt_am, erstellt_von) VALUES ('m-" + id + "', '" + id + "', '" +
          nr + "', 'ordentlich', '2020-01-01', 'aktiv', " + WER + ")");
  if (sparte) {
    db.exec("INSERT INTO sparte (id, name, aktiv, erstellt_am, erstellt_von) VALUES ('" +
            sparte + "', '" + sparte + "', 1, " + WER + ") ON CONFLICT(id) DO NOTHING");
    db.exec("INSERT INTO mitgliedschaft_sparte (id, mitgliedschaft_id, sparte_id, eintritt, " +
            "erstellt_am, erstellt_von) VALUES ('ms-" + id + "', 'm-" + id + "', '" +
            sparte + "', '2020-01-01', " + WER + ")");
  }
}
legeAn("p1", "Anna-Lena", "Mustermann", "2015-04-12", "101", "fussball");
legeAn("p2", "Tom", "Beispiel", "2017-09-01", "102", "fussball");
legeAn("p3", "Mia", "Probst", "2012-01-30", "103", "dart");
legeAn("p4", "Klaus", "Erwachsen", "1980-05-05", "104", "fussball");

const s1 = await W.handleKodexSenden(koerper(), env, anfrage(), cors);
pruefe("D1 Absenden antwortet 200", s1.status === 200, "status " + s1.status);
const s1b = await s1.json();
pruefe("D2 Antwort meldet Erfolg", s1b.ok === true);
pruefe("D3 Antwort nennt die Fassung", s1b.kodex_version === W.ELTERNKODEX_VERSION,
       s1b.kodex_version);

const z1 = db.prepare("SELECT * FROM elternkodex_bestaetigung").all();
pruefe("D4 Genau eine Zeile", z1.length === 1, "" + z1.length);
pruefe("D5 Die Fassung kommt aus dem Server",
       z1[0].kodex_version === W.ELTERNKODEX_VERSION, z1[0].kodex_version);
pruefe("D6 Die Unterschrift steht in der Zeile", z1[0].unterschrift_datei === SIG);
pruefe("D7 Der Schluessel ist gerechnet",
       z1[0].abgleich_schluessel === S("Anna-Lena", "Mustermann"),
       z1[0].abgleich_schluessel);
pruefe("D8 Die IP ist festgehalten", z1[0].signatur_ip === "1.2.3.4");
pruefe("D9 Noch keine Handzuordnung", z1[0].person_id === null);
pruefe("D10 Der Vorgang ist protokolliert",
       db.prepare("SELECT COUNT(*) AS n FROM protokoll WHERE aktion = 'elternkodex-eingegangen'")
         .get().n === 1);

// ⚠️ Der zweite Klick derselben Familie. Er darf keine zweite Zeile
// anlegen und keinen Serverfehler ergeben -- die neuere Erklaerung gilt.
const s2 = await W.handleKodexSenden(
  koerper({ mannschaft: "D2-Junioren", ort: "Leinefelde" }), env, anfrage(), cors);
pruefe("D11 Zweites Absenden antwortet 200", s2.status === 200, "status " + s2.status);
const z2 = db.prepare("SELECT * FROM elternkodex_bestaetigung").all();
pruefe("D12 Immer noch genau eine Zeile", z2.length === 1, "" + z2.length);
pruefe("D13 Die neuere Angabe hat gewonnen", z2[0].mannschaft === "D2-Junioren",
       z2[0].mannschaft);
pruefe("D14 Auch der Ort ist aktualisiert", z2[0].ort === "Leinefelde");

// ⚠️ Die Handzuordnung ist Arbeit der Geschaeftsstelle. Ein zweites
// Absenden der Familie darf sie nicht wegwischen.
db.exec("UPDATE elternkodex_bestaetigung SET person_id = 'p1', " +
        "zugeordnet_am = '2026-08-18T09:00:00Z', zugeordnet_von = 'buero'");
await W.handleKodexSenden(koerper({ mannschaft: "E2" }), env, anfrage(), cors);
const z3 = db.prepare("SELECT * FROM elternkodex_bestaetigung").get();
pruefe("D15 Die Handzuordnung ueberlebt ein zweites Absenden", z3.person_id === "p1",
       "" + z3.person_id);
pruefe("D16 Der Zuordner ueberlebt ebenfalls", z3.zugeordnet_von === "buero");
pruefe("D17 Die neue Angabe ist trotzdem da", z3.mannschaft === "E2");

// Vertauschte Eingabe landet auf DERSELBEN Zeile -- das ist der Nutzen
// der Sortierung, hier gegen die echte Datenbank belegt.
await W.handleKodexSenden(
  koerper({ kind_vorname: "Mustermann", kind_nachname: "Anna Lena" }), env, anfrage(), cors);
pruefe("D18 Vertauschte Eingabe legt keine zweite Zeile an",
       db.prepare("SELECT COUNT(*) AS n FROM elternkodex_bestaetigung").get().n === 1,
       "" + db.prepare("SELECT COUNT(*) AS n FROM elternkodex_bestaetigung").get().n);

// Ein anderes Kind bekommt eine eigene Zeile.
await W.handleKodexSenden(koerper({
  kind_vorname: "Tom", kind_nachname: "Beispiel", kind_geburtsdatum: "2017-09-01"
}), env, anfrage(), cors);
pruefe("D19 Ein anderes Kind bekommt eine eigene Zeile",
       db.prepare("SELECT COUNT(*) AS n FROM elternkodex_bestaetigung").get().n === 2);

// Der Schalter. Ein offener Endpunkt, den man nur per Deploy schliessen
// kann, ist eine Zusage, die man spaeter bereut.
db.exec("INSERT INTO einstellung (schluessel, wert) VALUES ('kodex_offen', '0') " +
        "ON CONFLICT(schluessel) DO UPDATE SET wert = '0'");
const zu = await W.handleKodexSenden(koerper({
  kind_vorname: "Mia", kind_nachname: "Probst", kind_geburtsdatum: "2012-01-30"
}), env, anfrage(), cors);
pruefe("D20 Geschlossen antwortet 403", zu.status === 403, "status " + zu.status);
pruefe("D21 Geschlossen legt nichts an",
       db.prepare("SELECT COUNT(*) AS n FROM elternkodex_bestaetigung").get().n === 2);
const zuText = (await zu.json()).error;
pruefe("D22 Der Text verweist auf die Geschaeftsstelle",
       /Gesch\w+ftsstelle/.test(zuText), zuText);

db.exec("UPDATE einstellung SET wert = '1' WHERE schluessel = 'kodex_offen'");
const wiederAuf = await W.handleKodexSenden(koerper({
  kind_vorname: "Mia", kind_nachname: "Probst", kind_geburtsdatum: "2012-01-30"
}), env, anfrage(), cors);
pruefe("D23 Wieder geoeffnet nimmt an", wiederAuf.status === 200, "status " + wiederAuf.status);

// Ein ungueltiger Koerper darf nichts anlegen.
const vorFehler = db.prepare("SELECT COUNT(*) AS n FROM elternkodex_bestaetigung").get().n;
const ohneHaken = await W.handleKodexSenden(
  koerper({ kind_vorname: "Neu", kind_nachname: "Kind", einwilligung_kodex: false }),
  env, anfrage(), cors);
pruefe("D24 Ohne Haekchen antwortet 400", ohneHaken.status === 400, "status " + ohneHaken.status);
pruefe("D25 Ohne Haekchen wird nichts angelegt",
       db.prepare("SELECT COUNT(*) AS n FROM elternkodex_bestaetigung").get().n === vorFehler);

// Die IP-Bremse. Eigene Grenzen, weil in einem Haushalt mit drei Kindern
// drei Erklaerungen aus demselben Anschluss kommen.
pruefe("D26 Die Stundengrenze liegt ueber der des Antrags", W.KODEX_JE_IP_STUNDE >= 6,
       "" + W.KODEX_JE_IP_STUNDE);
let gebremst = null;
for (let i = 0; i < W.KODEX_JE_IP_STUNDE + 3; i++) {
  const a = await W.handleKodexSenden(koerper({
    kind_vorname: "Bremse" + i, kind_nachname: "Test", kind_geburtsdatum: "2016-03-03"
  }), env, anfrage("9.9.9.9"), cors);
  if (a.status === 429) { gebremst = i; break; }
}
pruefe("D27 Die Bremse greift", gebremst !== null, "nie gebremst");
pruefe("D28 Sie greift nicht zu frueh", gebremst === null || gebremst >= 3, "bei " + gebremst);

// Eine andere IP ist davon nicht betroffen -- sonst sperrte ein
// Vieltipper den ganzen Verein aus.
const andere = await W.handleKodexSenden(koerper({
  kind_vorname: "Andere", kind_nachname: "Leitung", kind_geburtsdatum: "2016-03-03"
}), env, anfrage("5.5.5.5"), cors);
pruefe("D29 Eine andere Leitung bleibt frei", andere.status === 200, "status " + andere.status);

// ======================================================================
console.log("E  Der Abgleich");
// ======================================================================

// Aufraeumen und einen klaren Stand herstellen.
db.exec("DELETE FROM elternkodex_bestaetigung");

// Anna-Lena: Treffer ueber den Schluessel, aber mit vertauschter Eingabe.
await W.handleKodexSenden(koerper({
  kind_vorname: "MUSTERMANN", kind_nachname: "anna lena", kind_geburtsdatum: "2015-04-12"
}), env, anfrage("2.2.2.2"), cors);
// Lucas: gehoert zu keinem Kind im Bestand.
await W.handleKodexSenden(koerper({
  kind_vorname: "Lucas", kind_nachname: "Schreibfehler", kind_geburtsdatum: "2016-06-06",
  erz_name: "Petra Schreibfehler", erz_email: "petra@example.org"
}), env, anfrage("2.2.2.2"), cors);

const l1 = await W.handleKodexListe({ stichtag: HEUTE }, env, me, cors);
pruefe("E1 Liste antwortet 200", l1.status === 200, "status " + l1.status);
const L = await l1.json();

const namenIn = (o) => (o.kinder || []).map((k) => k.vorname + " " + k.nachname).sort();
pruefe("E2 Nur minderjaehrige Mitglieder stehen drin",
       JSON.stringify(namenIn(L)) ===
       JSON.stringify(["Anna-Lena Mustermann", "Mia Probst", "Tom Beispiel"]),
       JSON.stringify(namenIn(L)));
pruefe("E3 Der Erwachsene steht NICHT drin",
       !namenIn(L).some((n) => n.includes("Erwachsen")));

const annaL = L.kinder.find((k) => k.vorname === "Anna-Lena");
pruefe("E4 Die vertauschte Eingabe wird zugeordnet", !!annaL.bestaetigung_id,
       "" + annaL.bestaetigung_id);
pruefe("E5 Sie gilt NICHT als von Hand zugeordnet", annaL.von_hand === false);
pruefe("E6 Der Zeitpunkt steht dabei", !!annaL.bestaetigt_am);
pruefe("E7 Die Fassung steht dabei", annaL.kodex_version === W.ELTERNKODEX_VERSION);

const tom = L.kinder.find((k) => k.vorname === "Tom");
pruefe("E8 Tom ist offen", tom.bestaetigung_id === null);
pruefe("E9 Ein offenes Kind nennt keinen Unterschreiber", tom.erz_name === null);

// ⚠️ Der wichtigste Punkt der ganzen Datei: eine Erklaerung, die zu
// keinem Kind passt, darf nicht lautlos verschwinden.
pruefe("E10 Die unpassende Erklaerung steht in offene_eingaenge",
       (L.offene_eingaenge || []).length === 1, "" + (L.offene_eingaenge || []).length);
const lucas = L.offene_eingaenge[0];
pruefe("E11 Sie nennt den Namen wie eingegeben",
       lucas.kind_vorname === "Lucas" && lucas.kind_nachname === "Schreibfehler");
pruefe("E12 Sie nennt die E-Mail zum Nachfassen",
       lucas.erz_email === "petra@example.org");
pruefe("E13 Sie ist nicht als zugeordnet ausgewiesen", lucas.zugeordnet === false);

// ⚠️ Die Unterschriften bleiben aus der Liste heraus -- 19 KB je Zeile
// mal dreihundert Kinder fuer eine Liste, die keine davon zeigt.
const listenText = JSON.stringify(L);
pruefe("E14 Die Liste schleppt keine Unterschrift mit",
       !listenText.includes("data:image/png"), "Unterschrift in der Liste");
pruefe("E15 Die Liste nennt keine Anschrift", !/strasse|plz/.test(listenText));
pruefe("E16 Die Liste nennt keine Bankdaten", !/iban|bic/i.test(listenText));

pruefe("E17 Der Stichtag wird zurueckgemeldet", L.stichtag === HEUTE, L.stichtag);
pruefe("E18 Die Abteilungen kommen mit", (L.sparten || []).length >= 2);
pruefe("E19 Das Schreibrecht wird mitgeteilt", L.darf_schreiben === true);

// Sparten-Filter: der Kodex gilt dem Jugendfussball, nicht der Dart-Jugend.
const l2 = await W.handleKodexListe({ stichtag: HEUTE, sparte_id: "fussball" }, env, me, cors);
const L2 = await l2.json();
pruefe("E20 Der Sparten-Filter greift",
       JSON.stringify(namenIn(L2)) === JSON.stringify(["Anna-Lena Mustermann", "Tom Beispiel"]),
       JSON.stringify(namenIn(L2)));
pruefe("E21 Mia aus der Dart-Abteilung fehlt dann",
       !namenIn(L2).some((n) => n.includes("Mia")));

const l3 = await W.handleKodexListe({ stichtag: HEUTE, sparte_id: "erfunden" }, env, me, cors);
pruefe("E22 Eine erfundene Abteilung wird abgewiesen", l3.status === 400, "status " + l3.status);

// Ein Stichtag, an dem Mia noch nicht 18, Anna-Lena aber noch nicht
// geboren ist: das Alter wird wirklich zum Stichtag gerechnet.
const l4 = await W.handleKodexListe({ stichtag: "2014-01-01" }, env, me, cors);
const L4 = await l4.json();
pruefe("E23 Der Stichtag wirkt auf den Bestand",
       !namenIn(L4).some((n) => n.includes("Anna-Lena")), JSON.stringify(namenIn(L4)));

// Rechte. darfNachwuchs liest, darfSchreiben aendert.
const nurLesen = { username: "passstelle", isAdmin: false, canAdmin: false };
db.exec("INSERT INTO benutzer_rolle (id, username, rolle, erstellt_am, erstellt_von) " +
        "VALUES ('r1', 'passstelle', 'passstelle', " + WER + ")");
const l5 = await W.handleKodexListe({ stichtag: HEUTE }, env, nurLesen, cors);
pruefe("E24 Die Passstelle darf lesen", l5.status === 200, "status " + l5.status);
const L5 = await l5.json();
pruefe("E25 Ihr wird kein Schreibrecht gemeldet", L5.darf_schreiben === false);

const ohneRolle = { username: "fremd", isAdmin: false, canAdmin: false };
const l6 = await W.handleKodexListe({ stichtag: HEUTE }, env, ohneRolle, cors);
pruefe("E26 Ohne Rolle kein Zugriff", l6.status === 403, "status " + l6.status);

// Das Detail liefert die Unterschrift -- und nur es.
const d1a = await W.handleKodexDetail({ id: annaL.bestaetigung_id }, env, me, cors);
pruefe("E27 Detail antwortet 200", d1a.status === 200, "status " + d1a.status);
const D = await d1a.json();
pruefe("E28 Das Detail traegt die Unterschrift", D.unterschrift === SIG);
pruefe("E29 Das Detail nennt die Fassung", D.kodex_version === W.ELTERNKODEX_VERSION);
pruefe("E30 Das Detail nennt den Zeitpunkt der Signatur", !!D.signatur_zeit);

const d1b = await W.handleKodexDetail({ id: "gibtesnicht" }, env, me, cors);
pruefe("E31 Unbekanntes Detail antwortet 404", d1b.status === 404, "status " + d1b.status);
const d1c = await W.handleKodexDetail({}, env, me, cors);
pruefe("E32 Detail ohne id antwortet 400", d1c.status === 400, "status " + d1c.status);
const d1d = await W.handleKodexDetail({ id: annaL.bestaetigung_id }, env, ohneRolle, cors);
pruefe("E33 Detail ohne Rolle antwortet 403", d1d.status === 403, "status " + d1d.status);

// ======================================================================
console.log("F  Zuordnen, Aufheben, Loeschen");
// ======================================================================

const lucasId = lucas.id;

const zu1 = await W.handleKodexZuordnen({ id: lucasId, person_id: "p2" }, env, me, cors);
pruefe("F1 Zuordnen antwortet 200", zu1.status === 200, "status " + zu1.status);
const ZU1 = await zu1.json();
pruefe("F2 Der Name der Person kommt zurueck", ZU1.person_name === "Tom Beispiel",
       ZU1.person_name);

const l7 = await W.handleKodexListe({ stichtag: HEUTE }, env, me, cors);
const L7 = await l7.json();
const tom2 = L7.kinder.find((k) => k.vorname === "Tom");
pruefe("F3 Tom ist jetzt bestaetigt", tom2.bestaetigung_id === lucasId, "" + tom2.bestaetigung_id);
pruefe("F4 Und zwar von Hand", tom2.von_hand === true);
pruefe("F5 Die Erklaerung ist aus 'nicht zuzuordnen' verschwunden",
       (L7.offene_eingaenge || []).length === 0,
       JSON.stringify((L7.offene_eingaenge || []).map((o) => o.kind_vorname)));

// ⚠️ Die Handzuordnung muss den Namensabgleich ueberstimmen. Waere es
// anders, waere die Korrektur wirkungslos.
db.exec("UPDATE elternkodex_bestaetigung SET abgleich_schluessel = 'passt|zu|niemand' " +
        "WHERE id = '" + lucasId + "'");
const l8 = await W.handleKodexListe({ stichtag: HEUTE }, env, me, cors);
const L8 = await l8.json();
pruefe("F6 Die Handzuordnung traegt auch ohne passenden Schluessel",
       L8.kinder.find((k) => k.vorname === "Tom").bestaetigung_id === lucasId);

// ⚠️ Der echte Konfliktfall, und die Luecke, die eine Mutationsprobe am
// 18.08.2026 aufgedeckt hat: F6 oben belegte den Vorrang NICHT, weil dort
// gar kein Namenstreffer im Weg stand -- ohne Konkurrenz greift die
// Handzuordnung auch dann, wenn sie an zweiter Stelle geprueft wird.
// Hier konkurrieren beide: Erklaerung A ist von Hand auf Tom gelegt,
// Erklaerung B trifft Tom ueber den Namen. A muss gewinnen, sonst waere
// die Korrektur der Geschaeftsstelle wirkungslos.
db.exec("UPDATE elternkodex_bestaetigung SET person_id = 'p2', " +
        "zugeordnet_am = '2026-08-18T09:00:00Z', zugeordnet_von = 'buero', " +
        "abgleich_schluessel = 'passt|zu|niemand' WHERE id = '" + lucasId + "'");
await W.handleKodexSenden(koerper({
  kind_vorname: "Tom", kind_nachname: "Beispiel", kind_geburtsdatum: "2017-09-01",
  erz_name: "Namenstreffer"
}), env, anfrage("3.3.3.3"), cors);

const lK = await W.handleKodexListe({ stichtag: HEUTE }, env, me, cors);
const LK = await lK.json();
const tomK = LK.kinder.find((k) => k.vorname === "Tom");
pruefe("F6b Bei Konkurrenz gewinnt die Handzuordnung",
       tomK.bestaetigung_id === lucasId,
       "gewonnen hat " + tomK.bestaetigung_id + " statt " + lucasId);
pruefe("F6c Sie ist als von Hand ausgewiesen", tomK.von_hand === true);
pruefe("F6d Die verdraengte Erklaerung verschwindet nicht",
       (LK.offene_eingaenge || []).some((o) => o.erz_name === "Namenstreffer"),
       JSON.stringify((LK.offene_eingaenge || []).map((o) => o.erz_name)));

// Den Namenstreffer wieder wegnehmen, damit die folgenden Abschnitte auf
// dem Stand von vorher weiterarbeiten.
db.exec("DELETE FROM elternkodex_bestaetigung WHERE erz_name = 'Namenstreffer'");

// Zwei Erklaerungen auf dasselbe Kind waeren keine Verbesserung
// gegenueber keiner.
const zu2 = await W.handleKodexZuordnen(
  { id: annaL.bestaetigung_id, person_id: "p2" }, env, me, cors);
pruefe("F7 Zweite Zuordnung auf dasselbe Kind antwortet 409", zu2.status === 409,
       "status " + zu2.status);

const zu3 = await W.handleKodexZuordnen({ id: lucasId, person_id: "gibtesnicht" }, env, me, cors);
pruefe("F8 Unbekannte Person antwortet 404", zu3.status === 404, "status " + zu3.status);
const zu4 = await W.handleKodexZuordnen({ id: "gibtesnicht", person_id: "p2" }, env, me, cors);
pruefe("F9 Unbekannte Erklaerung antwortet 404", zu4.status === 404, "status " + zu4.status);
const zu5 = await W.handleKodexZuordnen({ id: lucasId, person_id: "p3" }, env, nurLesen, cors);
pruefe("F10 Die Passstelle darf NICHT zuordnen", zu5.status === 403, "status " + zu5.status);

// Der Rueckweg aus einem Fehlgriff. Ohne ihn bliebe eine falsche
// Zuordnung fuer immer stehen.
const auf = await W.handleKodexZuordnen({ id: lucasId, person_id: "" }, env, me, cors);
pruefe("F11 Aufheben antwortet 200", auf.status === 200, "status " + auf.status);
const nachAuf = db.prepare("SELECT * FROM elternkodex_bestaetigung WHERE id = ?").get(lucasId);
pruefe("F12 Die Zuordnung ist weg", nachAuf.person_id === null);
pruefe("F13 Der Zuordner ist mit weg", nachAuf.zugeordnet_von === null);
pruefe("F14 Die Erklaerung selbst bleibt stehen", nachAuf.unterschrift_datei === SIG);

// Loeschen: fuer Testeintraege und zurueckgezogene Erklaerungen.
const lo1 = await W.handleKodexLoeschen({ id: lucasId }, env, nurLesen, cors);
pruefe("F15 Die Passstelle darf NICHT loeschen", lo1.status === 403, "status " + lo1.status);
const lo2 = await W.handleKodexLoeschen({ id: lucasId }, env, me, cors);
pruefe("F16 Loeschen antwortet 200", lo2.status === 200, "status " + lo2.status);
pruefe("F17 Die Zeile ist weg",
       db.prepare("SELECT COUNT(*) AS n FROM elternkodex_bestaetigung WHERE id = ?")
         .get(lucasId).n === 0);
pruefe("F18 Das Loeschen ist protokolliert",
       db.prepare("SELECT COUNT(*) AS n FROM protokoll WHERE aktion = 'elternkodex-geloescht'")
         .get().n === 1);
const lo3 = await W.handleKodexLoeschen({ id: lucasId }, env, me, cors);
pruefe("F19 Zweites Loeschen antwortet 404", lo3.status === 404, "status " + lo3.status);

// Nach dem Loeschen steht das Kind wieder offen.
const l9 = await W.handleKodexListe({ stichtag: HEUTE }, env, me, cors);
const L9 = await l9.json();
pruefe("F20 Tom ist wieder offen",
       L9.kinder.find((k) => k.vorname === "Tom").bestaetigung_id === null);

// ======================================================================
console.log("G  Das Fenster vor der ersten Migration");
// ======================================================================

// Frische Datenbank OHNE die Tabelle -- und ein frischer Worker, damit
// der Merker aus Abschnitt D nicht herueberträgt.
const dbLeer = new DatabaseSync(":memory:");
for (const anw of schema.split(";").map((s) => s.trim()).filter(Boolean)) {
  dbLeer.exec(anw + ";");
}
dbLeer.exec("DROP INDEX IF EXISTS idx_kodex_abgleich");
dbLeer.exec("DROP TABLE IF EXISTS elternkodex_bestaetigung");
const envLeer = { VV_DB: d1(dbLeer) };
const W2 = neuerWorker();

pruefe("G1 Der frische Worker sieht die Tabelle nicht",
       (await W2.hatKodexTabelle(envLeer)) === false);

const g1 = await W2.handleKodexSenden(koerper(), envLeer, anfrage(), cors);
pruefe("G2 Absenden antwortet 503, nicht 500", g1.status === 503, "status " + g1.status);
const g1t = (await g1.json()).error;
pruefe("G3 Der Text bittet um einen zweiten Versuch",
       /noch einmal|wenigen Minuten/i.test(g1t), g1t);

const g2 = await W2.handleKodexListe({}, envLeer, me, cors);
pruefe("G4 Die Liste meldet die fehlende Einrichtung", g2.status === 409, "status " + g2.status);
pruefe("G5 Und nennt sie so", /Einrichtung/.test((await g2.json()).error));

// ⚠️ Die Info-Aktion muss OHNE Tabelle antworten koennen. Sonst sieht die
// Familie im Deploy-Fenster einen Serverfehler statt der Seite.
const g3 = await W2.handleKodexInfo(envLeer, cors);
pruefe("G6 Die Info-Aktion antwortet trotzdem 200", g3.status === 200, "status " + g3.status);
const G3 = await g3.json();
pruefe("G7 Sie nennt den Vereinsnamen", /1\. SC 1911/.test(G3.verein), G3.verein);
pruefe("G8 Sie nennt die Fassung", G3.kodex_version === W2.ELTERNKODEX_VERSION);

// Nach der Migration greift derselbe Worker.
await W2.handleMigration(envLeer, me, cors);
const g4 = await W2.handleKodexSenden(koerper(), envLeer, anfrage(), cors);
pruefe("G9 Nach der Migration nimmt derselbe Worker an", g4.status === 200,
       "status " + g4.status);

// ======================================================================
console.log("H  Zusagen der Browser-Seiten");
// ======================================================================

const kodexHtml = readFileSync(REPO + "/kodex.html", "utf8");
const kodexJs = readFileSync(REPO + "/kodex.js", "utf8");
const kodexVerw = readFileSync(REPO + "/kodex-verwaltung.js", "utf8");
const dbAntrag = readFileSync(REPO + "/db-antrag.js", "utf8");
const indexHtml = readFileSync(REPO + "/index.html", "utf8");
const appJs = readFileSync(REPO + "/app.js", "utf8");

pruefe("H1 Die Seite laedt das Unterschriftenfeld", /signature-pad\.js/.test(kodexHtml));
pruefe("H2 Sie laedt den geteilten Helferkern", /antrag-felder\.js/.test(kodexHtml));
pruefe("H3 Sie laedt den login-losen Zugriff", /db-antrag\.js/.test(kodexHtml));
pruefe("H4 Sie verlangt kein config.js",
       !/src="config\.js/.test(kodexHtml), "config.js auf der oeffentlichen Seite");
pruefe("H5 Sie steht auf noindex", /name="robots" content="noindex"/.test(kodexHtml));
pruefe("H6 Der Kodex ist herunterladbar", /elternkodex\.pdf\?v=/.test(kodexHtml));

// ⚠️ Das Canvas darf erst gebaut werden, wenn das Formular sichtbar ist:
// hinter hidden ist es 0x0 und bleibt leer.
const reihenfolge = kodexJs.indexOf('$("formular").hidden = false') <
                    kodexJs.indexOf("createSignaturePad");
pruefe("H7 Das Unterschriftenfeld entsteht NACH dem Einblenden", reihenfolge);
pruefe("H8 Und wird danach vermessen", /createSignaturePad[\s\S]{0,120}sigPad\.resize\(\)/.test(kodexJs));
pruefe("H9 Beim naechsten Kind wird es neu vermessen",
       /function weiteresKind\(\)[\s\S]*?sigPad\.resize\(\)/.test(kodexJs));
pruefe("H10 Beim naechsten Kind wird die Unterschrift geleert",
       /function weiteresKind\(\)[\s\S]*?sigPad\.clear\(\)/.test(kodexJs));

// Die Fassung kommt aus dem Server -- ein alter Cache darf keine andere
// Zahl behaupten als die, die mitgespeichert wird.
pruefe("H11 Die Fassung wird aus der Antwort gesetzt",
       /k-version-text[\s\S]{0,120}kodexInfo\.kodex_version/.test(kodexJs));
pruefe("H12 Der Vereinsname kommt ebenfalls aus dem Server",
       /verein-name[\s\S]{0,120}kodexInfo\.verein/.test(kodexJs));

// ⚠️ Auf einem Weg ohne Anmeldung ist 401 keine Aussage ueber den
// Aufrufer, sondern heisst: der Worker kennt die Aktion nicht.
pruefe("H13 Ein 401 wird nicht als 'Nicht angemeldet' gezeigt",
       /e\.status === 401/.test(kodexJs));
pruefe("H14 Der Status wird dafuer durchgereicht", /fehler\.status = res\.status/.test(dbAntrag));
pruefe("H15 Die Ersatzmeldung nennt die Geschaeftsstelle",
       /noch nicht freigeschaltet[\s\S]{0,220}612206/.test(kodexJs));

pruefe("H16 Eigener Changelog-Block fuer diese Seite", /const KODEX_CHANGELOG/.test(dbAntrag));
pruefe("H17 Eigene Aktion zum Absenden", /vv-kodex-senden/.test(dbAntrag));
pruefe("H18 Eigene Aktion fuer die Info", /vv-kodex-info/.test(dbAntrag));

// Die Verwaltung.
pruefe("H19 Der Reiter steht in der Leiste", /id="nav-kodex"/.test(indexHtml));
pruefe("H20 Der Abschnitt ist da", /id="tab-kodex"/.test(indexHtml));
pruefe("H21 Der Reiter haengt an darfNachwuchs",
       /nav-kodex"\)\.hidden = !meineRechte\.darfNachwuchs/.test(appJs));
pruefe("H22 Die Verwaltung wird verdrahtet", /verdrahteKodex\(\)/.test(appJs));
pruefe("H23 Die Karte 'nicht zuzuordnen' ist eigenstaendig",
       /id="ko-offen-karte"/.test(indexHtml));
pruefe("H24 Sie wird aus offene_eingaenge gefuellt",
       /offene_eingaenge/.test(kodexVerw));
pruefe("H25 Der Link zum Verteilen steht in der Verwaltung",
       /KO_ADRESSE\s*=\s*"https:\/\/sc1911heiligenstadt\.github\.io\/vereinsverwaltung\/kodex\.html"/
         .test(kodexVerw));
pruefe("H26 Die Karte mit dem Link haengt am Schreibrecht",
       /darf_schreiben[\s\S]{0,160}ko-verteilen-karte/.test(kodexVerw));

// Der Anmeldeweg und dieser Weg muessen dieselbe Fassung unterschreiben.
const nachwuchsJs = readFileSync(REPO + "/nachwuchs.js", "utf8");
const fassungAnmeldung = (nachwuchsJs.match(/ELTERNKODEX_VERSION\s*=\s*"([^"]+)"/) || [])[1];
pruefe("H27 Anmeldung und Nachreichen nennen dieselbe Fassung",
       fassungAnmeldung === W.ELTERNKODEX_VERSION,
       "Anmeldung " + fassungAnmeldung + " / Server " + W.ELTERNKODEX_VERSION);

// ======================================================================

console.log("");
console.log("─".repeat(60));
if (fehler) {
  console.log(ok + " GRUEN, " + fehler + " ROT");
  for (const f of fehlerListe) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("ALLE " + ok + " PRUEFUNGEN GRUEN");
