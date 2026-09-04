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
//   I  Spalten und Sortierung der Kinderliste
//   J  Ersetzen hinterlaesst eine Spur (Sicherheits-Review 18.08.2026)
//   K  Die Kenntnisnahme aus der ANMELDUNG zaehlt mit (04.09.2026)

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
               "KODEX_JE_IP_STUNDE", "KODEX_JE_IP_TAG", "EINSTELLUNGEN", "alterAm",
               "istKodexSparte", "KODEX_SPARTE_NAMEN"];

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
// ⚠️ Nur die Abteilung Fussball. Mia liegt im Dart und gehoert deshalb
// NICHT in die Liste -- der Kodex gilt ihr nicht.
pruefe("E2 Nur minderjaehrige Fussball-Mitglieder stehen drin",
       JSON.stringify(namenIn(L)) ===
       JSON.stringify(["Anna-Lena Mustermann", "Tom Beispiel"]),
       JSON.stringify(namenIn(L)));
pruefe("E3 Der Erwachsene steht NICHT drin",
       !namenIn(L).some((n) => n.includes("Erwachsen")));
pruefe("E3b Das Kind aus einer anderen Abteilung steht NICHT drin",
       !namenIn(L).some((n) => n.includes("Mia")), JSON.stringify(namenIn(L)));
pruefe("E3c Die Antwort nennt die zugrunde gelegte Abteilung",
       /fussball/i.test(L.abteilung || ""), "abteilung=" + L.abteilung);

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
// ⚠️ KEIN Abteilungs-Filter in der Antwort mehr: die Abteilung ist eine
// Festlegung des Vereins, keine Auswahl. Stattdessen ihr Name.
pruefe("E18 Es gibt keine Abteilungs-Auswahl mehr", L.sparten === undefined);
pruefe("E18b Ein mitgeschicktes sparte_id wird ignoriert", await (async () => {
  const a = await W.handleKodexListe({ stichtag: HEUTE, sparte_id: "dart" }, env, me, cors);
  const A = await a.json();
  return a.status === 200 &&
         JSON.stringify(namenIn(A)) === JSON.stringify(namenIn(L));
})(), "eine fremde Abteilung im Koerper hat gewirkt");
pruefe("E19 Das Schreibrecht wird mitgeteilt", L.darf_schreiben === true);

// Die Namenserkennung der Abteilung. Exakt, nicht mit Platzhalter --
// "Freizeit-Fussball" hat keine Jugendmannschaften und darf nicht
// mitgezogen werden.
pruefe("E20 'Fussball' wird erkannt", W.istKodexSparte("Fussball"));
pruefe("E20b 'Fußball' mit Eszett ebenso", W.istKodexSparte("Fußball"));
pruefe("E20c Gross und klein egal", W.istKodexSparte("FUSSBALL"));
pruefe("E20d Leerzeichen am Rand egal", W.istKodexSparte("  Fussball "));
pruefe("E20e 'Freizeit-Fussball' wird NICHT erkannt",
       !W.istKodexSparte("Freizeit-Fussball"));
pruefe("E20f 'Fussball Herren' wird NICHT erkannt",
       !W.istKodexSparte("Fussball Herren"));
pruefe("E20g Andere Abteilungen nicht", !W.istKodexSparte("Turnen")
       && !W.istKodexSparte("Darts") && !W.istKodexSparte("Handball"));
pruefe("E20h Leer nicht", !W.istKodexSparte("") && !W.istKodexSparte(null));

// ⚠️ Eine Erklaerung fuer ein Kind aus einer anderen Abteilung ist KEIN
// Schreibfehler. Ohne die Unterscheidung sucht die Geschaeftsstelle in
// "Nicht zuzuordnen" nach einem Tippfehler, den es nicht gibt.
await W.handleKodexSenden(koerper({
  kind_vorname: "Mia", kind_nachname: "Probst", kind_geburtsdatum: "2012-01-30",
  erz_name: "Jan Probst"
}), env, anfrage("4.4.4.4"), cors);
const lMia = await W.handleKodexListe({ stichtag: HEUTE }, env, me, cors);
const LMia = await lMia.json();
const eintragMia = (LMia.offene_eingaenge || []).find((o) => o.kind_vorname === "Mia");
pruefe("E21 Die Erklaerung fuer das Dart-Kind steht in offene_eingaenge", !!eintragMia,
       JSON.stringify((LMia.offene_eingaenge || []).map((o) => o.kind_vorname)));
pruefe("E21b Und ist als andere Abteilung ausgewiesen",
       eintragMia && eintragMia.andere_abteilung === true,
       "andere_abteilung=" + (eintragMia && eintragMia.andere_abteilung));
pruefe("E21c Der echte Schreibfehler ist NICHT so ausgewiesen",
       (LMia.offene_eingaenge || []).find((o) => o.kind_vorname === "Lucas")
         .andere_abteilung === false);
db.exec("DELETE FROM elternkodex_bestaetigung WHERE kind_vorname = 'Mia'");

// ⚠️ Fehlt die Abteilung, wird NICHT ungefiltert geliefert. Eine Liste
// aller minderjaehrigen Mitglieder saehe wie ein Ergebnis aus und waere
// fachlich falsch.
db.exec("UPDATE sparte SET name = 'Fussball (alt)' WHERE id = 'fussball'");
const lOhne = await W.handleKodexListe({ stichtag: HEUTE }, env, me, cors);
pruefe("E22 Ohne die Abteilung antwortet die Liste 409", lOhne.status === 409,
       "status " + lOhne.status);
const lOhneT = (await lOhne.json()).error;
pruefe("E22b Der Text nennt die Abteilung", /Fussball/.test(lOhneT), lOhneT);
pruefe("E22c Und liefert KEINE Kinder", !/kinder/.test(lOhneT));
db.exec("UPDATE sparte SET name = 'fussball' WHERE id = 'fussball'");

// Eine stillgelegte Abteilung zaehlt ebenfalls nicht -- die Abfrage
// nimmt nur aktive.
db.exec("UPDATE sparte SET aktiv = 0 WHERE id = 'fussball'");
const lStill = await W.handleKodexListe({ stichtag: HEUTE }, env, me, cors);
pruefe("E22d Eine stillgelegte Abteilung fuehrt auf 409", lStill.status === 409,
       "status " + lStill.status);
db.exec("UPDATE sparte SET aktiv = 1 WHERE id = 'fussball'");

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

// ⚠️ Loeschen heisst GANZ loeschen -- auch die ersetzten Fassungen im
// Verlauf. Bis zum 18.08.2026 blieben die dort stehen, samt Namen,
// Geburtsdatum, E-Mail, IP und Unterschrift, und ohne Zeile, zu der sie
// gehoerten. Eine zurueckgezogene Erklaerung war damit nur halb weg.
const KIND_WEG = {
  kind_vorname: "Nina", kind_nachname: "Beispiel", kind_geburtsdatum: "2014-02-02",
  erz_name: "Petra Beispiel", erz_email: "petra@example.org", einwilligung_kodex: true
};
await W.handleKodexSenden(Object.assign({}, KIND_WEG, { unterschrift: SIG }),
                          env, anfrage("9.9.9.1"), cors);
await W.handleKodexSenden(Object.assign({}, KIND_WEG, { unterschrift: SIG + "zwei" }),
                          env, anfrage("9.9.9.2"), cors);
const wegId = db.prepare(
  "SELECT id FROM elternkodex_bestaetigung WHERE kind_nachname = 'Beispiel'").get().id;
pruefe("F21 Die Ersetzung hat eine Verlaufszeile angelegt",
       db.prepare("SELECT COUNT(*) AS n FROM elternkodex_verlauf WHERE bestaetigung_id = ?")
         .get(wegId).n === 1);

// Eine Zeile, die schon vor dem Fix verwaist ist -- die alte Fassung hat
// solche liegen gelassen, und sie muessen ebenfalls verschwinden.
db.exec("INSERT INTO elternkodex_verlauf (id, bestaetigung_id, abgleich_schluessel, " +
        "ersetzt_am, eingang_am, kind_nachname, unterschrift_datei) VALUES " +
        "('altwaise', 'zeile-gibt-es-nicht-mehr', 'x|2010-01-01', " +
        "'2026-08-17T10:00:00.000Z', '2026-08-16T10:00:00.000Z', 'Altfall', 'sig')");

const lo4 = await W.handleKodexLoeschen({ id: wegId }, env, me, cors);
pruefe("F22 Loeschen mit Verlauf antwortet 200", lo4.status === 200, "status " + lo4.status);
pruefe("F23 Der Verlauf der geloeschten Erklaerung ist mit weg",
       db.prepare("SELECT COUNT(*) AS n FROM elternkodex_verlauf WHERE bestaetigung_id = ?")
         .get(wegId).n === 0);
pruefe("F24 Und die vor dem Fix verwaiste Zeile ebenfalls",
       db.prepare("SELECT COUNT(*) AS n FROM elternkodex_verlauf WHERE id = 'altwaise'")
         .get().n === 0);
pruefe("F25 Verlaufszeilen anderer Erklaerungen bleiben stehen",
       db.prepare("SELECT COUNT(*) AS n FROM elternkodex_verlauf v JOIN " +
                  "elternkodex_bestaetigung b ON b.id = v.bestaetigung_id").get().n ===
       db.prepare("SELECT COUNT(*) AS n FROM elternkodex_verlauf").get().n);

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

// ⚠️ Und sie sagt VORHER, dass noch nichts angenommen werden kann. Ohne
// die Angabe fuellte eine Familie das Formular aus, unterschriebe -- und
// erfuehre erst beim Absenden vom 503.
pruefe("G8b Sie meldet die fehlende Ablage", G3.bereit === false, "bereit=" + G3.bereit);
pruefe("G8c Der Schalter steht trotzdem auf offen", G3.offen === true);

// Nach der Migration greift derselbe Worker.
await W2.handleMigration(envLeer, me, cors);
const g4 = await W2.handleKodexSenden(koerper(), envLeer, anfrage(), cors);
pruefe("G9 Nach der Migration nimmt derselbe Worker an", g4.status === 200,
       "status " + g4.status);

const g5 = await W2.handleKodexInfo(envLeer, cors);
pruefe("G10 Und die Info meldet dann Bereitschaft", (await g5.json()).bereit === true);

// Die Seite darf das Formular nicht zeigen, solange bereit false ist.
pruefe("G11 Die Seite wertet bereit aus",
       /kodexInfo\.bereit === false/.test(readFileSync(REPO + "/kodex.js", "utf8")));
pruefe("G12 Und zeigt dann kein Formular",
       /kodexInfo\.bereit === false[\s\S]{0,600}return;/.test(
         readFileSync(REPO + "/kodex.js", "utf8")));

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

// ⚠️ Art. 13 DSGVO. Die Seite war am 18.08.2026 bereits offen, ohne dass
// hier etwas stand -- gefunden beim Datenschutz-Durchgang desselben Tages.
// Wer hier unterschreibt, hat kein Vereinskonto: diese Seite ist der
// einzige Ort, an dem er nachlesen kann, was mit den Angaben geschieht.
const nachwuchsHtml = readFileSync(REPO + "/nachwuchs.html", "utf8");
pruefe("H16a Die Seite traegt den Art.-13-Block",
       /Information nach Art\. 13 DSGVO/.test(kodexHtml));
pruefe("H16b Er steht VOR dem Absenden-Knopf, nicht irgendwo",
       kodexHtml.indexOf("Information nach Art. 13 DSGVO") > -1 &&
       kodexHtml.indexOf("Information nach Art. 13 DSGVO") <
       kodexHtml.indexOf('id="btn-kodex-senden"'));
pruefe("H16c Er nennt den Verantwortlichen", /<strong>Verantwortlich<\/strong>/.test(kodexHtml));
pruefe("H16d Er nennt eine Speicherdauer",
       /Wie lange wir speichern[\s\S]{0,200}Mitglied/.test(kodexHtml));
pruefe("H16e Er nennt die Betroffenenrechte und die Aufsichtsbehoerde",
       /Ihre Rechte[\s\S]{0,900}Landesbeauftragten/.test(kodexHtml));
pruefe("H16f Er sagt, dass IP und Geraetekennung gespeichert werden",
       /Internetadresse und Gerätekennung/.test(kodexHtml));
pruefe("H16g Er sagt, dass ersetzte Fassungen aufbewahrt werden",
       /vorherige Fassung[\s\S]{0,80}Nachweis/.test(kodexHtml));
pruefe("H16h Der Anmeldeweg nennt den Elternkodex im Art.-13-Block",
       /<li>Die Kenntnisnahme des Elternkodex/.test(nachwuchsHtml));

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

// ⚠️ Die Begrenzung auf den Fussball muss UEBERALL stehen, wo der Kodex
// auftaucht -- Michel-Vorgabe vom 18.08.2026. Eine Seite, die sie nicht
// nennt, laedt Eltern anderer Abteilungen zu einer Erklaerung ein, die
// niemand braucht.
pruefe("H28 Die Eltern-Seite nennt die Abteilung",
       /Abteilung Fußball/.test(kodexHtml), "kodex.html nennt sie nicht");
pruefe("H29 Sie sagt es VOR dem Formular, nicht erst im Info-Reiter",
       kodexHtml.indexOf("Abteilung Fußball") < kodexHtml.indexOf('id="k-kind-vorname"'));
pruefe("H30 Der Info-Reiter nennt sie ebenfalls",
       (kodexHtml.match(/Abteilung Fußball/g) || []).length >= 2,
       "" + (kodexHtml.match(/Abteilung Fußball/g) || []).length);
pruefe("H31 Der Seitentitel nennt sie", /<title>[^<]*Fußball/.test(kodexHtml));

pruefe("H32 Die Verwaltung nennt die Begrenzung",
       /nur der Abteilung Fußball/.test(indexHtml));
pruefe("H33 Es gibt keinen Abteilungs-Filter mehr",
       !/id="ko-sparte"/.test(indexHtml) && !/ko-sparte/.test(kodexVerw));
pruefe("H34 Der Stand nennt die Abteilung mit",
       /koDaten\.abteilung/.test(kodexVerw));
pruefe("H35 Der Vermerk 'andere Abteilung' wird gezeigt",
       /andere_abteilung/.test(kodexVerw));
pruefe("H36 Der Zugriff schickt keine Abteilung mit",
       /function ladeKodexListe\(\)/.test(readFileSync(REPO + "/db.js", "utf8")));

// Der Server ist die Wahrheit, nicht der Browser.
pruefe("H37 Die Abteilung ist im Server festgelegt",
       W.KODEX_SPARTE_NAMEN instanceof Set && W.KODEX_SPARTE_NAMEN.has("fussball"));

// ======================================================================
console.log("I  Spalten und Sortierung der Kinderliste");
// ======================================================================

// ⚠️ Die ECHTEN Sortierschluessel aus der Datei gezogen, nicht nachgebaut.
// Die Datei enthaelt nur Deklarationen -- kein Aufruf beim Laden, deshalb
// laesst sie sich hier ohne DOM auswerten.
const V = new Function(
  readFileSync(REPO + "/kodex-verwaltung.js", "utf8") +
  ";\nreturn { KO_SPALTEN, koSortiert };")();

const spalte = (k) => V.KO_SPALTEN.find((sp) => sp.schluessel === k);

pruefe("I1 Es gibt eine eigene Spalte fuer den Zeitpunkt", !!spalte("wann"));
pruefe("I2 Sie heisst 'Unterschrieben am'", spalte("wann").text === "Unterschrieben am",
       spalte("wann").text);
pruefe("I3 Der Stand steht in einer eigenen Spalte daneben", !!spalte("stand"));
pruefe("I4 Alle sechs Spalten sind sortierbar", V.KO_SPALTEN.length === 6,
       "" + V.KO_SPALTEN.length);
pruefe("I5 Jede hat einen Sortierschluessel",
       V.KO_SPALTEN.every((sp) => typeof sp.wert === "function"));

// ⚠️ Sortiert wird das ISO-Datum, nicht die deutsche Anzeige. Als Text
// stuende "17.11.2015" vor "31.03.2015" -- genau der Fall aus Michels
// Liste vom 18.08.2026.
const kindA = { vorname: "Damian", nachname: "Aghajauyan", geburtsdatum: "2015-03-31",
                mitgliedsnummer: "658", bestaetigung_id: null, bestaetigt_am: null,
                erz_name: null };
const kindB = { vorname: "Carlos", nachname: "Alex", geburtsdatum: "2015-11-17",
                mitgliedsnummer: "594", bestaetigung_id: "b2",
                bestaetigt_am: "2026-08-17T10:00:00Z", erz_name: "Maria Alex" };
pruefe("I6 Das Geburtsdatum sortiert nach ISO, nicht nach Anzeige",
       spalte("geboren").wert(kindA) < spalte("geboren").wert(kindB),
       spalte("geboren").wert(kindA) + " vs " + spalte("geboren").wert(kindB));

// ⚠️ Die Mitgliedsnummer numerisch. Als Text stuende "1816" vor "594".
const kindC = { ...kindA, mitgliedsnummer: "1816" };
pruefe("I7 Die Nummer sortiert numerisch",
       spalte("nummer").wert(kindB) < spalte("nummer").wert(kindC),
       spalte("nummer").wert(kindB) + " vs " + spalte("nummer").wert(kindC));
// Testnummern (GLOB-Filter in naechsteMitgliedsnummer laesst sie zu)
// fallen hinter die Zahlen statt die Reihenfolge zu zerreissen.
const kindT = { ...kindA, mitgliedsnummer: "T417293841" };
pruefe("I8 Eine nicht numerische Nummer sortiert hinten",
       spalte("nummer").wert(kindT) > spalte("nummer").wert(kindC));
pruefe("I9 Eine fehlende Nummer ebenso",
       spalte("nummer").wert({ mitgliedsnummer: null }) === Number.MAX_SAFE_INTEGER);

pruefe("I10 Offen sortiert vor bestaetigt",
       spalte("stand").wert(kindA) < spalte("stand").wert(kindB));
pruefe("I11 Der Name sortiert ohne Ruecksicht auf Gross und klein",
       spalte("name").wert({ vorname: "A", nachname: "MUELLER" }) ===
       spalte("name").wert({ vorname: "a", nachname: "mueller" }));
pruefe("I12 Ein fehlender Unterschreiber gibt einen leeren Schluessel",
       spalte("vonwem").wert(kindA) === "");
pruefe("I13 Ein fehlender Zeitpunkt gibt einen leeren Schluessel",
       spalte("wann").wert(kindA) === "");

// Die Verdrahtung: Kopf klickbar UND per Tastatur bedienbar.
pruefe("I14 Die Koepfe tragen die Flottenklasse",
       /class="sortierbar/.test(kodexVerw));
pruefe("I15 Der Pfeil zeigt die aktive Spalte",
       /koSortAb \? "▼" : "▲"/.test(kodexVerw));
pruefe("I16 Klick sortiert", /addEventListener\("click", sortiere\)/.test(kodexVerw));
pruefe("I17 Enter und Leertaste ebenfalls",
       /"Enter" \|\| e\.key === " "/.test(kodexVerw));
pruefe("I18 Ein zweiter Klick dreht um",
       /if \(koSort === schluessel\) koSortAb = !koSortAb;/.test(kodexVerw));
pruefe("I19 Eine neue Spalte beginnt aufsteigend",
       /koSort = schluessel; koSortAb = false;/.test(kodexVerw));

// ⚠️ Leere Werte gehoeren in BEIDEN Richtungen nach hinten. Sonst sucht
// man die neuesten Unterschriften und sieht zuerst offene Zeilen.
pruefe("I20 Leere Werte werden ausdruecklich nach hinten gestellt",
       /leerA !== leerB\) return leerA \? 1 : -1/.test(kodexVerw));
pruefe("I21 Sortiert wird auf einer KOPIE der Antwort",
       /zeilen\.slice\(\)\.sort/.test(kodexVerw));
pruefe("I22 Gleichstand faellt auf den Namen zurueck",
       /Gleichstand: nach Namen/.test(kodexVerw));

// Und der Zeitpunkt steht auch in der Zeile, nicht nur im Kopf.
pruefe("I23 Die Zeile gibt den Zeitpunkt aus",
       /k\.bestaetigt_am \? datumDe\(k\.bestaetigt_am\)/.test(kodexVerw));
pruefe("I24 Der Chip nennt nur noch den Stand",
       /chip aktiv">liegt vor</.test(kodexVerw));

// Der Anmeldeweg und dieser Weg muessen dieselbe Fassung unterschreiben.
const nachwuchsJs = readFileSync(REPO + "/nachwuchs.js", "utf8");
const fassungAnmeldung = (nachwuchsJs.match(/ELTERNKODEX_VERSION\s*=\s*"([^"]+)"/) || [])[1];
pruefe("H27 Anmeldung und Nachreichen nennen dieselbe Fassung",
       fassungAnmeldung === W.ELTERNKODEX_VERSION,
       "Anmeldung " + fassungAnmeldung + " / Server " + W.ELTERNKODEX_VERSION);

// ======================================================================
console.log("J  Ersetzen hinterlaesst eine Spur (Sicherheits-Review 18.08.2026)");
// ======================================================================
//
// Der Fund: der Weg hat bewusst keinen Zugriffscode, und der
// Abgleichsschluessel ist Name plus Geburtstag des Kindes -- beides weiss
// im Verein jeder. Ein zweites Absenden ersetzte die vorhandene Erklaerung
// KOMMENTARLOS, und weil die Bremse ZEILEN zaehlte statt Vorgaengen und ein
// Ersetzen keine neue Zeile anlegt, ging das unbegrenzt oft. Gemessen:
// 22 von 22 Versuchen angenommen bei einer Stundengrenze von 12.

// Ein Kommentar ist kein ausgefuehrter Code. Ohne diesen Filter traefe
// J27 die Kommentarbloecke, in denen der alte Ausdruck erklaert WIRD --
// gleiche Falle wie B5/H3 in test-vereinsname.mjs.
function ohneKommentare(src) {
  return src.split("\n").filter((z) => !/^\s*\/\//.test(z)).join("\n");
}

// Sauberer Stand fuer diesen Abschnitt.
db.exec("DELETE FROM elternkodex_verlauf");
db.exec("DELETE FROM elternkodex_bestaetigung");
db.exec("DELETE FROM protokoll");

const SIG_FAMILIE = "data:image/png;base64,AAAAfamilieAAAA==";
const SIG_FREMD   = "data:image/png;base64,BBBBfremdBBBB==";
const KIND_J = { kind_vorname: "Jonas", kind_nachname: "Beispiel",
                 kind_geburtsdatum: "2014-09-09" };

const jFamilie = await W.handleKodexSenden(Object.assign({}, KIND_J, {
  erz_name: "Petra Beispiel", ort: "Heiligenstadt",
  einwilligung_kodex: true, unterschrift: SIG_FAMILIE }), env, anfrage("10.0.0.1"), cors);
pruefe("J1 Die erste Erklaerung kommt an", jFamilie.status === 200, "status " + jFamilie.status);
const jZeile1 = db.prepare("SELECT * FROM elternkodex_bestaetigung").get();
pruefe("J2 Noch nichts im Verlauf",
       db.prepare("SELECT COUNT(*) AS n FROM elternkodex_verlauf").get().n === 0);

// --- Derselbe Klick zweimal: kein Vorgang, keine Spur, kein Strich ---
const jNochmal = await W.handleKodexSenden(Object.assign({}, KIND_J, {
  erz_name: "Petra Beispiel", ort: "Heiligenstadt",
  einwilligung_kodex: true, unterschrift: SIG_FAMILIE }), env, anfrage("10.0.0.1"), cors);
pruefe("J3 Der identische zweite Klick antwortet 200",
       jNochmal.status === 200, "status " + jNochmal.status);
pruefe("J4 Er legt KEINE Verlaufszeile an",
       db.prepare("SELECT COUNT(*) AS n FROM elternkodex_verlauf").get().n === 0);
pruefe("J5 Er nennt den urspruenglichen Eingang",
       (await jNochmal.json()).eingang_am === jZeile1.eingang_am);
pruefe("J6 Er erzeugt keinen zweiten Protokolleintrag",
       db.prepare("SELECT COUNT(*) AS n FROM protokoll WHERE aktion LIKE 'elternkodex-%'")
         .get().n === 1);

// --- Ein Fremder ersetzt: die alte Fassung MUSS erhalten bleiben ---
const jFremd = await W.handleKodexSenden(Object.assign({}, KIND_J, {
  erz_name: "Fremde Person", ort: "Anderswo",
  einwilligung_kodex: true, unterschrift: SIG_FREMD }), env, anfrage("66.66.66.66"), cors);
pruefe("J7 Die Ersetzung wird angenommen", jFremd.status === 200, "status " + jFremd.status);

const jZeile2 = db.prepare("SELECT * FROM elternkodex_bestaetigung").get();
const jVerlauf = db.prepare("SELECT * FROM elternkodex_verlauf").all();
pruefe("J8 Es steht weiter genau EINE gueltige Erklaerung da",
       db.prepare("SELECT COUNT(*) AS n FROM elternkodex_bestaetigung").get().n === 1);
pruefe("J9 Die neuere Fassung gilt", jZeile2.unterschrift_datei === SIG_FREMD);

// ⚠️ Der Kern des Fundes. Ohne diese Zeile ist die Unterschrift der
// Familie unwiederbringlich fort -- und niemand koennte es sehen.
pruefe("J10 Die ersetzte Fassung ist GESICHERT", jVerlauf.length === 1,
       jVerlauf.length + " Verlaufszeilen");
pruefe("J11 Mit der Unterschrift der Familie",
       jVerlauf[0] && jVerlauf[0].unterschrift_datei === SIG_FAMILIE);
pruefe("J12 Mit ihrem Namen", jVerlauf[0] && jVerlauf[0].erz_name === "Petra Beispiel");
pruefe("J13 Sie haengt an der richtigen Zeile",
       jVerlauf[0] && jVerlauf[0].bestaetigung_id === jZeile1.id);

// ⚠️ Die beiden Anschluesse unterscheiden die Selbstkorrektur der Familie
// von einer fremden Ueberschreibung. Nur einer davon reicht nicht.
pruefe("J14 Der Anschluss der ERSETZENDEN steht dabei",
       jVerlauf[0] && jVerlauf[0].ersetzt_von_ip === "66.66.66.66",
       jVerlauf[0] && jVerlauf[0].ersetzt_von_ip);
pruefe("J15 Der Anschluss der ERSETZTEN ebenfalls",
       jVerlauf[0] && jVerlauf[0].signatur_ip === "10.0.0.1",
       jVerlauf[0] && jVerlauf[0].signatur_ip);

// --- Der Protokolleintrag muss auf eine Zeile zeigen, die es gibt ---
const jProt = db.prepare(
  "SELECT aktion, objekt_id FROM protokoll WHERE aktion LIKE 'elternkodex-%' ORDER BY zeit").all();
const jIds = new Set(db.prepare("SELECT id FROM elternkodex_bestaetigung").all().map((r) => r.id));
pruefe("J16 Das Ersetzen hat eine EIGENE Aktion",
       jProt.some((p) => p.aktion === "elternkodex-ersetzt"),
       jProt.map((p) => p.aktion).join(", "));
pruefe("J17 KEIN Protokolleintrag zeigt ins Leere",
       jProt.every((p) => jIds.has(p.objekt_id)),
       jProt.filter((p) => !jIds.has(p.objekt_id)).length + " verwaist");

// --- Die Bremse zaehlt VORGAENGE, nicht Zeilen ---
// Dieselbe Kind-Kennung immer wieder. Vor dem Fix kam das komplett an der
// Bremse vorbei, weil kein Ersetzen eine neue Zeile anlegte.
let jGebremst = null;
for (let i = 0; i < W.KODEX_JE_IP_STUNDE + 10; i++) {
  const a = await W.handleKodexSenden(Object.assign({}, KIND_J, {
    erz_name: "Angreifer " + i, ort: "Anderswo",
    einwilligung_kodex: true, unterschrift: SIG_FREMD }), env, anfrage("66.66.66.66"), cors);
  if (a.status === 429) { jGebremst = i; break; }
}
pruefe("J18 Wiederholtes Ueberschreiben laeuft in die Bremse", jGebremst !== null,
       "nie gebremst nach " + (W.KODEX_JE_IP_STUNDE + 10) + " Versuchen");
pruefe("J19 Und zwar innerhalb der Stundengrenze",
       jGebremst === null || jGebremst <= W.KODEX_JE_IP_STUNDE, "bei " + jGebremst);

// Eine andere Leitung bleibt frei -- die Bremse ist keine Sperre der Kennung.
const jAndere = await W.handleKodexSenden(Object.assign({}, KIND_J, {
  erz_name: "Wieder Petra", ort: "Heiligenstadt",
  einwilligung_kodex: true, unterschrift: SIG_FAMILIE }), env, anfrage("10.0.0.1"), cors);
pruefe("J20 Die Familie selbst kommt weiterhin durch",
       jAndere.status === 200, "status " + jAndere.status);

// --- Sichtbar in der Verwaltung: sonst waere es gesichert, aber blind ---
const jListe = await W.handleKodexListe({}, env, me, cors);
const jListeB = await jListe.json();
const jOffen = (jListeB.offene_eingaenge || [])[0];
pruefe("J21 Die Liste meldet, wie oft ersetzt wurde",
       !!jOffen && jOffen.ersetzt > 0, jOffen ? "ersetzt=" + jOffen.ersetzt : "kein Eingang");

const jDetail = await W.handleKodexDetail({ id: jZeile1.id }, env, me, cors);
const jDetailB = await jDetail.json();
pruefe("J22 Das Detail liefert den Verlauf",
       Array.isArray(jDetailB.verlauf) && jDetailB.verlauf.length > 0,
       "verlauf=" + (jDetailB.verlauf && jDetailB.verlauf.length));
pruefe("J23 Samt der ersetzten Unterschrift",
       (jDetailB.verlauf || []).some((v) => v.unterschrift === SIG_FAMILIE));
pruefe("J24 Und der Angabe, ob der Anschluss derselbe war",
       (jDetailB.verlauf || []).some((v) => v.gleicher_anschluss === false));

// --- Ohne die Verlaufstabelle wird vorn abgewiesen, nicht hinten ---
// Der Worker schreibt seit dem Fix in BEIDE Tabellen. Fehlt die zweite --
// Worker neu, Migration seither nicht gelaufen --, liefe jede Erklaerung
// in einen nackten SQL-Fehler. Eigener Worker-Kontext, weil
// hatKodexTabelle sich nur das Ja merkt.
const W3 = neuerWorker();
db.exec("DROP TABLE IF EXISTS elternkodex_verlauf");
pruefe("J25 Ohne die Verlaufstabelle meldet die Info NICHT bereit",
       (await (await W3.handleKodexInfo(env, cors)).json()).bereit === false);
const jOhne = await W3.handleKodexSenden(Object.assign({}, KIND_J, {
  erz_name: "Irgendwer", einwilligung_kodex: true, unterschrift: SIG_FREMD
}), env, anfrage("7.7.7.7"), cors);
pruefe("J26 Und das Absenden antwortet 503 statt eines SQL-Fehlers",
       jOhne.status === 503, "status " + jOhne.status);
for (const sql of W.KODEX_SCHEMA) db.exec(sql);

// --- Die Fassung des Anmeldewegs kommt aus dem SERVER ---
// Sie stand bis zum 18.08.2026 als sauber(roh.elternkodex_version) im
// Koerper: der Browser bestimmte, was er unterschrieben zu haben behauptet.
const wOhneKomm = ohneKommentare(quelle);
pruefe("J27 pruefeAntrag liest die Fassung NICHT aus dem Koerper",
       !/roh\.elternkodex_version/.test(wOhneKomm),
       "roh.elternkodex_version steht noch im Code");
pruefe("J28 Sondern setzt die Server-Konstante",
       /kodexVersion = ELTERNKODEX_VERSION/.test(wOhneKomm));

// ⚠️ BEIDE Listen muessen die Zahl zeigen, nicht nur eine. Beim ersten Wurf
// stand der Chip allein in der Kinderliste -- in "Nicht zuzuordnen" fehlte
// er, ausgerechnet dort, wo die ungeklaerten Faelle stehen. Gefunden beim
// Messen im Browser, nicht beim Lesen des Codes; deshalb steht die Zusage
// jetzt hier.
pruefe("J29 Die Kinderliste zeigt die Zahl der Ersetzungen",
       /k\.ersetzt \? ' <span class="chip ruhend">' \+ k\.ersetzt/.test(kodexVerw));
pruefe("J30 Die Liste \u201eNicht zuzuordnen\u201c ebenfalls",
       /b\.ersetzt \? ' <span class="chip ruhend">' \+ b\.ersetzt/.test(kodexVerw));

// ======================================================================
console.log("K  Die Kenntnisnahme aus der ANMELDUNG zaehlt mit");
// ======================================================================

// Der Befund vom 04.09.2026: die Nachwuchs-Anmeldung erhebt den Kodex
// seit dem 18.08.2026 selbst, legt die Unterschrift aber in der SPALTE
// aufnahmeantrag.unterschrift_elternkodex_datei ab. Die Liste las nur
// elternkodex_bestaetigung -- angemeldete und aufgenommene Kinder standen
// deshalb auf "offen", obwohl ihre Eltern unterschrieben hatten.

// Klarer Stand.
db.exec("DELETE FROM elternkodex_verlauf");
db.exec("DELETE FROM elternkodex_bestaetigung");
db.exec("DELETE FROM aufnahmeantrag");

// ⚠️ Der Antrag traegt eine ECHTE IBAN. Ohne sie waere jede Zusage
// darueber, dass Liste und Detail keine Bankdaten ausliefern, auch dann
// gruen, wenn im antrag_json nie eine gestanden haette.
const antragInhalt = (mehr) => Object.assign({
  vorname: "Tom", nachname: "Beispiel", geburtsdatum: "2017-09-01",
  minderjaehrig: true,
  gesetzl_name: "Petra Beispiel",
  gesetzl_verhaeltnis: "Mutter",
  email: "petra@example.org",
  strasse: "Musterweg 3", plz: "37308", ort: "Heilbad Heiligenstadt",
  unterschrift_ort: "Heilbad Heiligenstadt",
  iban: "DE02120300000000202051", bic: "BYLADEM1001",
  einwilligung_elternkodex: true,
  elternkodex_version: W.ELTERNKODEX_VERSION
}, mehr);

function legeAntrag(id, inhalt, mehr) {
  const s = Object.assign({
    quelle: "nachwuchs", status: "angenommen", person_id: null,
    kodex: SIG, zeit: "2026-08-14T09:00:00.000Z"
  }, mehr);
  db.prepare(
    "INSERT INTO aufnahmeantrag (id, eingang_am, antrag_json, unterschrift_datei, " +
    "unterschrift_elternkodex_datei, signatur_zeit, quelle, status, person_id) " +
    "VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(id, s.zeit, JSON.stringify(inhalt), SIG, s.kodex, s.zeit,
        s.quelle, s.status, s.person_id);
}

// Tom: angemeldet, aufgenommen -- person_id steht am Antrag.
legeAntrag("ant-tom", antragInhalt(), { person_id: "p2" });
// ⚠️ Die GEGENPROBE gleich daneben: Anna-Lena hat einen Antrag OHNE
// Unterschrift unter dem Kodex. Ohne diese Zeile waere K7 auch dann
// gruen, wenn die Abfrage jeden Antrag mitzaehlte.
legeAntrag("ant-annalena-ohne", antragInhalt({
  vorname: "Anna-Lena", nachname: "Mustermann", geburtsdatum: "2015-04-12",
  gesetzl_name: "Sabine Mustermann", einwilligung_elternkodex: false,
  elternkodex_version: null
}), { kodex: null, status: "neu" });

const kl1 = await W.handleKodexListe({ stichtag: HEUTE }, env, me, cors);
pruefe("K1 Liste antwortet 200", kl1.status === 200, "status " + kl1.status);
const KL = await kl1.json();
const kTom = (KL.kinder || []).find((k) => k.vorname === "Tom");
const kAnna = (KL.kinder || []).find((k) => k.vorname === "Anna-Lena");

pruefe("K2 Das angemeldete Kind gilt als bestaetigt", !!kTom && kTom.kodex_da === true,
       JSON.stringify(kTom));
pruefe("K3 Die Herkunft steht dabei", kTom.quelle === "anmeldung", "" + kTom.quelle);
pruefe("K4 Es gibt keine nachgereichte Erklaerung dazu", kTom.bestaetigung_id === null,
       "" + kTom.bestaetigung_id);
pruefe("K5 Der Antrag wird benannt", kTom.antrag_id === "ant-tom", "" + kTom.antrag_id);
pruefe("K6 Der Zeitpunkt ist der der Unterschrift",
       kTom.bestaetigt_am === "2026-08-14T09:00:00.000Z", "" + kTom.bestaetigt_am);
pruefe("K6b Die Fassung steht dabei", kTom.kodex_version === W.ELTERNKODEX_VERSION,
       "" + kTom.kodex_version);
pruefe("K6c Der gesetzliche Vertreter ist der Unterschreiber",
       kTom.erz_name === "Petra Beispiel", "" + kTom.erz_name);
pruefe("K6d Sie gilt nicht als von Hand zugeordnet", kTom.von_hand === false);
pruefe("K6e Und nicht als ersetzt", kTom.ersetzt === 0, "" + kTom.ersetzt);

// ⚠️ Die Gegenprobe. Ein Antrag OHNE Unterschrift unter dem Kodex belegt
// nichts -- er darf das Kind nicht als erledigt ausweisen.
pruefe("K7 Ein Antrag ohne Kodex-Unterschrift zaehlt NICHT",
       kAnna.kodex_da === false && kAnna.quelle === null,
       JSON.stringify(kAnna));
pruefe("K7b Ein offenes Kind nennt keinen Unterschreiber", kAnna.erz_name === null);
pruefe("K7c Und keinen Antrag", kAnna.antrag_id === null, "" + kAnna.antrag_id);

// ⚠️ Ein Antrag ist keine herrenlose Erklaerung. Er gehoert NICHT in
// "Nicht zuzuordnen" -- dort suchte die Geschaeftsstelle nach einem
// Tippfehler, wo sie auf einen Vorstandsbeschluss wartet.
pruefe("K8 Kein Antrag steht in offene_eingaenge",
       (KL.offene_eingaenge || []).length === 0,
       JSON.stringify((KL.offene_eingaenge || []).map((o) => o.kind_vorname)));

// ⚠️ Was nicht ausgeliefert wird, steht auch nicht im Netzwerk-Tab.
const kText = JSON.stringify(KL);
pruefe("K9 Die Liste schleppt keine Unterschrift mit", !kText.includes("data:image/png"));
pruefe("K10 Die Liste nennt keine Bankdaten", !/DE0212030000|BYLADEM/.test(kText));
pruefe("K11 Die Liste nennt keine Anschrift", !/Musterweg|37308/.test(kText));
// Gegenprobe zur Gegenprobe: die IBAN steht sehr wohl in der Datenbank.
pruefe("K12 GEGENPROBE Die IBAN steht im antrag_json",
       /DE02120300000000202051/.test(
         db.prepare("SELECT antrag_json FROM aufnahmeantrag WHERE id = 'ant-tom'")
           .get().antrag_json));

// --- Der noch nicht angenommene Antrag --------------------------------
// person_id ist erst nach der Annahme gesetzt. Ein Kind, das schon
// Mitglied ist und sich neu anmeldet (Vereinswechsel), muss deshalb ueber
// den Abgleichsschluessel treffen -- und zwar mit derselben Toleranz wie
// der Nachreich-Weg.
db.exec("DELETE FROM aufnahmeantrag WHERE id = 'ant-annalena-ohne'");
legeAntrag("ant-annalena", antragInhalt({
  vorname: "MUSTERMANN", nachname: "anna lena", geburtsdatum: "2015-04-12",
  gesetzl_name: "Sabine Mustermann"
}), { status: "neu", person_id: null });

const kl2 = await W.handleKodexListe({ stichtag: HEUTE }, env, me, cors);
const KL2 = await kl2.json();
const kAnna2 = KL2.kinder.find((k) => k.vorname === "Anna-Lena");
pruefe("K13 Ein noch nicht angenommener Antrag trifft ueber den Namen",
       kAnna2.kodex_da === true && kAnna2.quelle === "anmeldung", JSON.stringify(kAnna2));
pruefe("K13b Auch mit vertauschter Schreibweise", kAnna2.antrag_id === "ant-annalena");

// --- Der Konfliktfall: beide Wege zugleich ----------------------------
// ⚠️ Ein gebauter Fall, in dem nur EINE Antwort richtig sein kann. Waere
// hier nur der Antrag da, waere die Reihenfolge ungeprueft -- genau der
// Fehler, den die Handzuordnung schon einmal hatte.
await W.handleKodexSenden(koerper({
  kind_vorname: "Tom", kind_nachname: "Beispiel", kind_geburtsdatum: "2017-09-01",
  erz_name: "Nachgereicht Beispiel"
}), env, anfrage("7.7.7.7"), cors);

const kl3 = await W.handleKodexListe({ stichtag: HEUTE }, env, me, cors);
const KL3 = await kl3.json();
const kTom3 = KL3.kinder.find((k) => k.vorname === "Tom");
pruefe("K14 Die nachgereichte Erklaerung schlaegt die Anmeldung",
       kTom3.quelle === "nachreichen", "" + kTom3.quelle);
pruefe("K14b Sie liefert die Kennung der Bestaetigung", !!kTom3.bestaetigung_id);
pruefe("K14c Und nennt keinen Antrag mehr", kTom3.antrag_id === null,
       "" + kTom3.antrag_id);
pruefe("K14d Der Unterschreiber ist der der nachgereichten Erklaerung",
       kTom3.erz_name === "Nachgereicht Beispiel", "" + kTom3.erz_name);
// ⚠️ Der Antrag darf davon NICHT in "Nicht zuzuordnen" rutschen.
pruefe("K14e Der ueberstimmte Antrag steht in keiner offenen Liste",
       !JSON.stringify(KL3.offene_eingaenge || []).includes("ant-tom"));

// --- Das Detail zur Anmeldung -----------------------------------------
const kd1 = await W.handleKodexDetail({ antrag_id: "ant-annalena" }, env, me, cors);
pruefe("K15 Das Detail zum Antrag antwortet 200", kd1.status === 200, "status " + kd1.status);
const KD = await kd1.json();
pruefe("K16 Es nennt seine Herkunft", KD.quelle === "anmeldung", "" + KD.quelle);
pruefe("K17 Es liefert die Unterschrift", KD.unterschrift === SIG);
pruefe("K18 Es nennt die Fassung", KD.kodex_version === W.ELTERNKODEX_VERSION);
pruefe("K19 Es nennt den Unterschreiber", KD.erz_name === "Sabine Mustermann");
pruefe("K20 Es hat keinen Verlauf", Array.isArray(KD.verlauf) && KD.verlauf.length === 0);
pruefe("K21 Es hat keine Kennung einer Bestaetigung", KD.id === null, "" + KD.id);
// ⚠️ Der wichtigste Punkt des Abschnitts: neben dem Kodex steht im
// antrag_json die IBAN. Die Passstelle darf diese Liste lesen -- die
// Bankdaten nicht.
pruefe("K22 Das Detail nennt KEINE Bankdaten",
       !/DE0212030000|BYLADEM/.test(JSON.stringify(KD)), "Bankdaten im Detail");
pruefe("K23 Und keine Anschrift", !/Musterweg|37308/.test(JSON.stringify(KD)));

// Ein Antrag ohne Kodex hat hier nichts zu zeigen.
legeAntrag("ant-ohne-kodex", antragInhalt({ vorname: "Ohne", nachname: "Kodex" }),
           { kodex: null });
const kd2 = await W.handleKodexDetail({ antrag_id: "ant-ohne-kodex" }, env, me, cors);
pruefe("K24 Ein Antrag ohne Kodex antwortet 404", kd2.status === 404, "status " + kd2.status);
const kd3 = await W.handleKodexDetail({ antrag_id: "gibtesnicht" }, env, me, cors);
pruefe("K25 Ein unbekannter Antrag ebenso", kd3.status === 404, "status " + kd3.status);

// Dasselbe Recht wie fuer die Liste, kein zweiter Weg daran vorbei.
const kd4 = await W.handleKodexDetail({ antrag_id: "ant-annalena" }, env, ohneRolle, cors);
pruefe("K26 Ohne Rolle antwortet auch dieser Weg 403", kd4.status === 403,
       "status " + kd4.status);

// --- Die Oberflaeche --------------------------------------------------
const VK = new Function(
  readFileSync(REPO + "/kodex-verwaltung.js", "utf8") +
  ";\nreturn { koDa };")();

pruefe("K27 koDa sagt ja bei kodex_da", VK.koDa({ kodex_da: true, bestaetigung_id: null }));
pruefe("K28 koDa sagt nein ohne beides", !VK.koDa({ kodex_da: false, bestaetigung_id: null }));
// ⚠️ Der Rueckfall fuer das Deploy-Fenster: antwortet ein alter Worker
// ohne kodex_da, darf die Liste nicht den ganzen Verein als offen zeigen.
pruefe("K29 Ohne kodex_da faellt koDa auf bestaetigung_id zurueck",
       VK.koDa({ bestaetigung_id: "b1" }) === true &&
       VK.koDa({ bestaetigung_id: null }) === false);

pruefe("K30 Der Stand zaehlt ueber koDa", /kinder\.filter\(koDa\)/.test(kodexVerw));
pruefe("K31 Die Reiter ebenfalls", /offen: kinder\.filter\(\(k\) => !koDa\(k\)\)/.test(kodexVerw));
pruefe("K32 Der Filter ebenfalls", /koSicht === "offen" && koDa\(k\)/.test(kodexVerw));
pruefe("K33 Die Sortierspalte ebenfalls", /wert: \(k\) => \(koDa\(k\) \? 1 : 0\)/.test(kodexVerw));
// ⚠️ Keine Zeile darf mehr allein an bestaetigung_id haengen -- genau das
// war der Fehler.
pruefe("K34 Nichts zaehlt mehr an bestaetigung_id",
       !/filter\(\(k\) => !?k\.bestaetigung_id\)/.test(kodexVerw));
pruefe("K35 Die Zeile zeigt die Herkunft",
       /chip ruhend">aus der Anmeldung/.test(kodexVerw));
pruefe("K36 Es gibt einen eigenen Ansehen-Knopf fuer den Antrag",
       /data-ko-antrag="/.test(kodexVerw));
pruefe("K37 Er oeffnet dasselbe Detail",
       /zeigeKodexDetail\(null, b\.dataset\.koAntrag\)/.test(kodexVerw));
// ⚠️ Zuordnen, Aufheben und Loeschen gibt es fuer den Antrag nicht: der
// Beleg gehoert zum Antrag und stirbt mit ihm.
pruefe("K38 Die Schreibknoepfe fehlen bei der Anmeldung",
       /d\.darf_schreiben && d\.quelle !== "anmeldung"/.test(kodexVerw));
pruefe("K39 Der Dialog sagt, woher der Beleg kommt",
       /Nachwuchs-Anmeldung<\/strong> abgegeben/.test(kodexVerw));
pruefe("K40 db.js reicht den Antrag durch",
       /antragId \? \{ antrag_id: antragId \} : \{ id \}/
         .test(readFileSync(REPO + "/db.js", "utf8")));

// --- ⚠️ Der ALLGEMEINE Aufnahmeantrag gehoert nicht hierher -----------
//
// Der Elternkodex haengt am Nachwuchs. handleAntragDetail weist der
// Passstelle einen allgemeinen Antrag mit 403 ab; ohne den Filter auf
// quelle gaebe vv-kodex-detail einen zweiten Weg an genau dieser Grenze
// vorbei, sobald ein allgemeiner Antrag jemals eine Kodex-Unterschrift
// traegt.
//
// ⚠️ Heute KANN pruefeAntrag ihm gar keine geben -- die Unterschrift wird
// hier deshalb von Hand in die Datenbank gelegt. Genau das ist der Punkt:
// die Grenze darf nicht davon abhaengen, dass eine andere Funktion sich
// weiterhin richtig verhaelt.
db.exec("DELETE FROM aufnahmeantrag WHERE id = 'ant-annalena'");
legeAntrag("ant-allgemein", antragInhalt({
  vorname: "MUSTERMANN", nachname: "anna lena", geburtsdatum: "2015-04-12",
  gesetzl_name: "Sabine Mustermann"
}), { quelle: "antrag", person_id: "p1" });

const kl4 = await W.handleKodexListe({ stichtag: HEUTE }, env, me, cors);
const KL4 = await kl4.json();
const annaA = KL4.kinder.find((k) => k.vorname === "Anna-Lena");
pruefe("K41 Ein allgemeiner Antrag zaehlt NICHT",
       annaA.kodex_da === false && annaA.quelle === null, JSON.stringify(annaA));
pruefe("K41b Auch der exakte Verweis ueber person_id hilft ihm nicht",
       annaA.antrag_id === null, "" + annaA.antrag_id);

const kd5 = await W.handleKodexDetail({ antrag_id: "ant-allgemein" }, env, me, cors);
pruefe("K42 Sein Detail antwortet 404", kd5.status === 404, "status " + kd5.status);

// ⚠️ Die GEGENPROBE. Ohne sie waeren K41 und K42 auch dann gruen, wenn die
// Abfrage aus einem ganz anderen Grund nichts faende -- falsche Spalte,
// vertippte Id, kaputtes SQL. Einziger Unterschied ist jetzt quelle.
db.exec("UPDATE aufnahmeantrag SET quelle = 'nachwuchs' WHERE id = 'ant-allgemein'");
const kl5 = await W.handleKodexListe({ stichtag: HEUTE }, env, me, cors);
const annaN = (await kl5.json()).kinder.find((k) => k.vorname === "Anna-Lena");
pruefe("K43 GEGENPROBE Als Nachwuchs-Antrag zaehlt derselbe Satz sehr wohl",
       annaN.kodex_da === true && annaN.antrag_id === "ant-allgemein",
       JSON.stringify(annaN));
const kd6 = await W.handleKodexDetail({ antrag_id: "ant-allgemein" }, env, me, cors);
pruefe("K43b GEGENPROBE Und sein Detail antwortet 200", kd6.status === 200,
       "status " + kd6.status);

// --- ⚠️ Ohne die Spalte quelle darf nichts KRACHEN --------------------
//
// Der Filter haengt an ihr. Fehlt sie (Datenbank vor der Migration), liefe
// die Abfrage in einen nackten SQL-Fehler und die GANZE Liste waere weg --
// wegen einer Absicherung, die nur einen Sonderfall betrifft. Lieber keine
// Anmeldung mitzaehlen als die Kinderliste zerlegen.
//
// ⚠️ Eigener Worker-Kontext: hatNachwuchsSpalten merkt sich das Ja in einer
// Modulvariablen und truege es aus den Abschnitten davor herueber.
// Steht ganz am Ende, weil die Spalte danach fehlt.
const WQ = neuerWorker();
db.exec("ALTER TABLE aufnahmeantrag DROP COLUMN quelle");

const kl6 = await WQ.handleKodexListe({ stichtag: HEUTE }, env, me, cors);
pruefe("K44 Ohne die Spalte antwortet die Liste trotzdem 200",
       kl6.status === 200, "status " + kl6.status);
const KL6 = await kl6.json();
pruefe("K44b Sie zaehlt dann keine Anmeldung mit",
       (KL6.kinder || []).every((k) => k.quelle !== "anmeldung"),
       JSON.stringify((KL6.kinder || []).map((k) => k.quelle)));
pruefe("K44c Die nachgereichten Erklaerungen bleiben davon unberuehrt",
       (KL6.kinder || []).some((k) => k.quelle === "nachreichen"),
       JSON.stringify((KL6.kinder || []).map((k) => k.quelle)));

const kd7 = await WQ.handleKodexDetail({ antrag_id: "ant-allgemein" }, env, me, cors);
pruefe("K44d Das Detail antwortet 409 statt eines Serverfehlers",
       kd7.status === 409, "status " + kd7.status);

// ======================================================================

console.log("");
console.log("─".repeat(60));
if (fehler) {
  console.log(ok + " GRUEN, " + fehler + " ROT");
  for (const f of fehlerListe) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("ALLE " + ok + " PRUEFUNGEN GRUEN");
