// Pruefstand fuer die Nachwuchs-Anmeldung (2026-08-06).
//
// Faehrt den ECHTEN Worker-Code gegen das ECHTE Schema (node:sqlite mit
// duennem D1-Aufsatz, schema-kompakt.sql eingespielt) und die ECHTEN
// Browser-Funktionen aus tfv-antrag.js und antrag-felder.js. Beides wird
// aus den Dateien gezogen, nicht nachgebaut -- ein Nachbau prueft den
// Nachbau.
//
//   node test-nachwuchs.mjs
//
// Abschnitte:
//   A  Migration (nationalitaet, quelle, nachweis_owner)
//   B  pruefeSpielerlaubnis
//   C  pruefeAntrag mit Quelle "nachwuchs"
//   D  Absenden und Annehmen gegen die echte Datenbank
//   E  Das Fenster zwischen Deploy und erster Migration
//   F  Das Raster des Verbandsformulars
//   G  Gleichheit des geteilten Formularkerns

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

const namen = ["pruefeAntrag", "pruefeSpielerlaubnis", "handleMigration",
               "handleAntragSenden", "handleAntragAnnehmen", "handleAntragDetail",
               "handleAntraegeListe", "alterAm", "antragKurz", "ibanGueltig",
               "SPIELERLAUBNIS_ARTEN", "ABMELDEWEGE", "NACHWEIS_OWNER_MUSTER",
               "EINSTELLUNGEN"];
const W = new Function(quelle + "\nreturn {" + namen.join(",") + "};")();

// --- Datenbank aufsetzen ----------------------------------------------

const db = new DatabaseSync(":memory:");
const schema = readFileSync(REPO + "/schema-kompakt.sql", "utf8");
for (const anw of schema.split(";").map((s) => s.trim()).filter(Boolean)) {
  db.exec(anw + ";");
}
const env = { VV_DB: d1(db) };

// Altstand herstellen: die drei neuen Spalten gibt es live noch nicht.
db.exec("ALTER TABLE person DROP COLUMN nationalitaet");
db.exec("ALTER TABLE aufnahmeantrag DROP COLUMN quelle");
db.exec("ALTER TABLE aufnahmeantrag DROP COLUMN nachweis_owner");

const me = { username: "pruefer", isAdmin: true, canEdit: true, canAdmin: true };
const cors = {};
const spalten = (t) => new Set(db.prepare("PRAGMA table_info(" + t + ")").all().map((s) => s.name));

const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const HEUTE = "2026-08-06";
const OWNER = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

// ======================================================================
console.log("A  Migration");
// ======================================================================

pruefe("A1 Altstand: person.nationalitaet fehlt", !spalten("person").has("nationalitaet"));
pruefe("A2 Altstand: aufnahmeantrag.quelle fehlt", !spalten("aufnahmeantrag").has("quelle"));
pruefe("A3 Altstand: aufnahmeantrag.nachweis_owner fehlt",
       !spalten("aufnahmeantrag").has("nachweis_owner"));

const mig1 = await W.handleMigration(env, me, cors);
pruefe("A4 Migration antwortet 200", mig1.status === 200, "status " + mig1.status);
pruefe("A5 person.nationalitaet ist da", spalten("person").has("nationalitaet"));
pruefe("A6 aufnahmeantrag.quelle ist da", spalten("aufnahmeantrag").has("quelle"));
pruefe("A7 aufnahmeantrag.nachweis_owner ist da",
       spalten("aufnahmeantrag").has("nachweis_owner"));

// Die Vorgabe der Spalte ist der Grund, warum ein alter Antrag ohne
// weiteres Zutun als "antrag" gilt.
db.exec("INSERT INTO aufnahmeantrag (id, eingang_am, antrag_json, status) " +
        "VALUES ('alt-1', '2026-07-01T10:00:00Z', '{\"vorname\":\"Alt\",\"nachname\":\"Bestand\"}', 'neu')");
const alt = db.prepare("SELECT quelle FROM aufnahmeantrag WHERE id = 'alt-1'").get();
pruefe("A8 Alter Antrag gilt als 'antrag'", alt.quelle === "antrag", "quelle=" + alt.quelle);

const mig2 = await W.handleMigration(env, me, cors);
const mig2b = await mig2.json();
pruefe("A9 Zweiter Lauf ergaenzt nichts mehr", mig2b.ergaenzt === 0, "ergaenzt " + mig2b.ergaenzt);

pruefe("A10 Schalter nachwuchs_offen ist eingerichtet",
       !!W.EINSTELLUNGEN.nachwuchs_offen);
pruefe("A11 nachwuchs_offen ist NICHT antrag_offen",
       W.EINSTELLUNGEN.nachwuchs_offen !== W.EINSTELLUNGEN.antrag_offen);
pruefe("A12 nachwuchs_offen liegt in der Gruppe 'antrag'",
       W.EINSTELLUNGEN.nachwuchs_offen.gruppe === "antrag",
       W.EINSTELLUNGEN.nachwuchs_offen.gruppe);

// ======================================================================
console.log("B  pruefeSpielerlaubnis");
// ======================================================================

const sp = (mehr) => W.pruefeSpielerlaubnis(Object.assign({ art: "erstausstellung" }, mehr));

pruefe("B1 Erstausstellung geht durch", !!sp({}).wert);
pruefe("B2 Unbekannte Art wird abgewiesen", !!W.pruefeSpielerlaubnis({ art: "quatsch" }).fehler);
pruefe("B3 Fehlende Art wird abgewiesen", !!W.pruefeSpielerlaubnis({}).fehler);

for (const a of ["erstausstellung", "vereinswechsel", "rueckkehrer", "namensaenderung"]) {
  pruefe("B4." + a + " steht in der Weissliste", W.SPIELERLAUBNIS_ARTEN.has(a));
}

pruefe("B5 Vereinswechsel ohne Verein wird abgewiesen",
       !!sp({ art: "vereinswechsel", abmeldeweg: "1" }).fehler);
pruefe("B6 Vereinswechsel ohne Abmeldeweg wird abgewiesen",
       !!sp({ art: "vereinswechsel", letzter_verein: "SV Muster" }).fehler);
pruefe("B7 Vereinswechsel mit Abmeldeweg 3 wird abgewiesen",
       !!sp({ art: "vereinswechsel", letzter_verein: "SV Muster", abmeldeweg: "3" }).fehler);

const wechsel = sp({ art: "vereinswechsel", letzter_verein: "SV Muster 1920",
                     landesverband: "HFV", pass_nr: "12 34 56", abmeldeweg: "2" }).wert;
pruefe("B8 Vereinswechsel vollstaendig geht durch", !!wechsel);
pruefe("B9 Pass-Nr. ohne Leerzeichen", wechsel.pass_nr === "123456", wechsel.pass_nr);
pruefe("B10 Abmeldeweg uebernommen", wechsel.abmeldeweg === "2");
pruefe("B11 Landesverband uebernommen", wechsel.landesverband === "HFV");

// ⚠️ Der Kern: bei einer Erstausstellung darf KEIN Vereinsname stehen
// bleiben. Sonst landet ein Wert aus einem abgebrochenen Formularweg auf
// dem Verbandsbogen.
const erst = sp({ letzter_verein: "SV Muster", landesverband: "HFV", abmeldeweg: "1" }).wert;
pruefe("B12 Erstausstellung verwirft letzter_verein", erst.letzter_verein === null,
       String(erst.letzter_verein));
pruefe("B13 Erstausstellung verwirft landesverband", erst.landesverband === null);
pruefe("B14 Erstausstellung verwirft abmeldeweg", erst.abmeldeweg === null);

pruefe("B15 Marketing-Einwilligung nur bei echtem true",
       sp({ einwilligung_dfb_marketing: "ja" }).wert.einwilligung_dfb_marketing === false);
pruefe("B16 Marketing-Einwilligung wird uebernommen",
       sp({ einwilligung_dfb_marketing: true }).wert.einwilligung_dfb_marketing === true);
pruefe("B17 Ohne Marketing-Angabe steht false",
       sp({}).wert.einwilligung_dfb_marketing === false);

// ======================================================================
console.log("C  pruefeAntrag mit Quelle 'nachwuchs'");
// ======================================================================

const sparten = new Set(["sp-1"]);
db.exec("INSERT INTO sparte (id, name, aktiv, erstellt_am, erstellt_von) " +
        "VALUES ('sp-1', 'Fussball', 1, '2026-01-01', 'test')");

function nw(mehr) {
  return Object.assign({
    vorname: "Max", nachname: "Mustermann", geburtsdatum: "2015-03-14",
    strasse: "Musterweg 1", plz: "37308", ort: "Heilbad Heiligenstadt",
    email: "eltern@example.invalid", art: "ordentlich",
    zahlungsart: "lastschrift", iban: "DE02100500000054540402",
    kontoinhaber: "Erika Mustermann",
    einwilligung_satzung: true, einwilligung_datenschutz: true,
    unterschrift: SIG, unterschrift_gesetzl: SIG, unterschrift_gesetzl2: SIG,
    gesetzl_name: "Erika Mustermann", gesetzl2_name: "Hans Mustermann",
    nationalitaet: "deutsch",
    spielerlaubnis: { art: "erstausstellung" },
    sparten: ["sp-1"]
  }, mehr);
}

const c1 = W.pruefeAntrag(nw(), sparten, HEUTE, "nachwuchs");
pruefe("C1 Vollstaendiger Nachwuchsantrag geht durch", !!c1.satz, c1.fehler);
pruefe("C2 quelle steht auf 'nachwuchs'", c1.satz && c1.satz.quelle === "nachwuchs");
pruefe("C3 Nationalitaet im Inhalt", c1.satz && c1.satz.inhalt.nationalitaet === "deutsch");
pruefe("C4 Spielerlaubnis im Inhalt", c1.satz && !!c1.satz.inhalt.spielerlaubnis);

pruefe("C5 Ohne Nationalitaet wird abgewiesen",
       !!W.pruefeAntrag(nw({ nationalitaet: "" }), sparten, HEUTE, "nachwuchs").fehler);
pruefe("C6 Ohne Spielerlaubnis-Block wird abgewiesen",
       !!W.pruefeAntrag(nw({ spielerlaubnis: undefined }), sparten, HEUTE, "nachwuchs").fehler);

// ⚠️ Der allgemeine Aufnahmeantrag darf sich NICHT geaendert haben: er
// ruft weiterhin mit drei Parametern auf und verlangt nichts davon.
const c7 = W.pruefeAntrag(nw({ nationalitaet: "", spielerlaubnis: undefined }), sparten, HEUTE);
pruefe("C7 Allgemeiner Antrag braucht beides nicht", !!c7.satz, c7.fehler);
pruefe("C8 Allgemeiner Antrag: quelle 'antrag'", c7.satz && c7.satz.quelle === "antrag");
pruefe("C9 Allgemeiner Antrag: nationalitaet null",
       c7.satz && c7.satz.inhalt.nationalitaet === null);
pruefe("C10 Allgemeiner Antrag: spielerlaubnis null",
       c7.satz && c7.satz.inhalt.spielerlaubnis === null);

// Der Owner-Schluessel: nur das Serverformat wird angenommen.
pruefe("C11 Gueltiger Owner wird uebernommen",
       W.pruefeAntrag(nw({ nachweis_owner: OWNER }), sparten, HEUTE, "nachwuchs")
         .satz.nachweis_owner === OWNER);
for (const boese of ["../../etc/passwd", "A1B2C3D4E5F60718293A4B5C6D7E8F90",
                     "a1b2c3", OWNER + "x", "a1b2c3d4-e5f6-0718-293a-4b5c6d7e8f90"]) {
  pruefe("C12 Owner abgewiesen: " + boese.slice(0, 20),
         !!W.pruefeAntrag(nw({ nachweis_owner: boese }), sparten, HEUTE, "nachwuchs").fehler);
}
pruefe("C13 Fehlender Owner ist erlaubt (Nachweis wird nachgereicht)",
       W.pruefeAntrag(nw(), sparten, HEUTE, "nachwuchs").satz.nachweis_owner === null);

// Mitgeschickte Fremdfelder werden ignoriert -- die Weissliste baut den
// Satz selbst.
const c14 = W.pruefeAntrag(nw({ quelle: "antrag", status: "angenommen",
                                person_id: "fremd", id: "fremd",
                                eingang_am: "2000-01-01" }),
                           sparten, HEUTE, "nachwuchs");
pruefe("C14 Mitgeschickte quelle wird ignoriert", c14.satz.quelle === "nachwuchs");
pruefe("C15 Mitgeschickter status kommt nicht durch", c14.satz.status === undefined);
pruefe("C16 Mitgeschickte person_id kommt nicht durch", c14.satz.person_id === undefined);
pruefe("C17 Mitgeschickte id kommt nicht durch", c14.satz.id === undefined);

// Minderjaehrigkeit gilt hier genauso wie im allgemeinen Antrag.
pruefe("C18 Ohne zweite Unterschrift abgewiesen",
       !!W.pruefeAntrag(nw({ unterschrift_gesetzl2: "", gesetzl2_name: "" }),
                        sparten, HEUTE, "nachwuchs").fehler);
pruefe("C19 Alleiniges Sorgerecht genuegt",
       !!W.pruefeAntrag(nw({ unterschrift_gesetzl2: "", gesetzl2_name: "",
                             allein_sorgeberechtigt: true }),
                        sparten, HEUTE, "nachwuchs").satz);
// Ein angekreuztes Alleinsorgerecht VERWIRFT einen mitgeschickten zweiten
// Namen -- sonst stuende beides im Antrag und niemand wuesste, was gilt.
pruefe("C20 Alleinsorge verwirft zweiten Namen",
       W.pruefeAntrag(nw({ allein_sorgeberechtigt: true }), sparten, HEUTE, "nachwuchs")
         .satz.inhalt.gesetzl2_name === null);

// ======================================================================
console.log("D  Absenden und Annehmen gegen die echte Datenbank");
// ======================================================================

const request = {
  headers: { get: (h) => (h === "CF-Connecting-IP" ? "203.0.113.9" : "Pruefstand/1.0") }
};

db.exec("CREATE TABLE IF NOT EXISTS einstellung (schluessel TEXT PRIMARY KEY, wert TEXT, " +
        "geaendert_am TEXT, geaendert_von TEXT)");
db.exec("INSERT OR REPLACE INTO einstellung (schluessel, wert) VALUES ('nachwuchs_offen','1')");
db.exec("INSERT OR REPLACE INTO einstellung (schluessel, wert) VALUES ('antrag_offen','1')");

const d1res = await W.handleAntragSenden(nw({ nachweis_owner: OWNER }), env, request, cors, "nachwuchs");
pruefe("D1 Nachwuchsantrag wird angenommen", d1res.status === 200, "status " + d1res.status);
const d1b = await d1res.json();

const zeile = db.prepare("SELECT * FROM aufnahmeantrag WHERE id = ?").get(d1b.id);
pruefe("D2 quelle in der Spalte", zeile.quelle === "nachwuchs", zeile.quelle);
pruefe("D3 nachweis_owner in der Spalte", zeile.nachweis_owner === OWNER);
const inhalt = JSON.parse(zeile.antrag_json);
pruefe("D4 Nationalitaet gespeichert", inhalt.nationalitaet === "deutsch");
pruefe("D5 Spielerlaubnis gespeichert", inhalt.spielerlaubnis.art === "erstausstellung");
pruefe("D6 Beide Unterschriften gespeichert",
       !!zeile.unterschrift_gesetzl_datei && !!zeile.unterschrift_gesetzl2_datei);

// Der allgemeine Antrag laeuft unveraendert und landet als "antrag".
const d7res = await W.handleAntragSenden(
  nw({ nationalitaet: "", spielerlaubnis: undefined }), env, request, cors, "antrag");
pruefe("D7 Allgemeiner Antrag geht weiter durch", d7res.status === 200, "status " + d7res.status);
const d7b = await d7res.json();
const z7 = db.prepare("SELECT quelle, nachweis_owner FROM aufnahmeantrag WHERE id = ?").get(d7b.id);
pruefe("D8 Allgemeiner Antrag steht auf 'antrag'", z7.quelle === "antrag", z7.quelle);
pruefe("D9 Allgemeiner Antrag ohne Owner", z7.nachweis_owner === null);

// ⚠️ Der EIGENE Schalter: nachwuchs_offen zu, antrag_offen auf.
db.exec("UPDATE einstellung SET wert = '0' WHERE schluessel = 'nachwuchs_offen'");
const d10 = await W.handleAntragSenden(nw(), env, request, cors, "nachwuchs");
pruefe("D10 Zugedrehte Nachwuchs-Anmeldung weist ab", d10.status === 403, "status " + d10.status);
const d11 = await W.handleAntragSenden(
  nw({ nationalitaet: "", spielerlaubnis: undefined }), env, request, cors, "antrag");
pruefe("D11 Der allgemeine Antrag bleibt davon UNBERUEHRT", d11.status === 200,
       "status " + d11.status);
db.exec("UPDATE einstellung SET wert = '1' WHERE schluessel = 'nachwuchs_offen'");

// Gegenprobe in die andere Richtung.
db.exec("UPDATE einstellung SET wert = '0' WHERE schluessel = 'antrag_offen'");
const d12 = await W.handleAntragSenden(nw(), env, request, cors, "nachwuchs");
pruefe("D12 Zugedrehter Aufnahmeantrag laesst den Nachwuchs durch", d12.status === 200,
       "status " + d12.status);
db.exec("UPDATE einstellung SET wert = '1' WHERE schluessel = 'antrag_offen'");

// Detailansicht liefert Quelle und Owner.
const det = await W.handleAntragDetail({ id: d1b.id }, env, me, cors);
const detb = await det.json();
pruefe("D13 Detail liefert quelle", detb.antrag.quelle === "nachwuchs");
pruefe("D14 Detail liefert nachweis_owner", detb.antrag.nachweis_owner === OWNER);
pruefe("D15 Detail liefert die Spielerlaubnis",
       !!detb.antrag.inhalt.spielerlaubnis);

// Liste: quelle und nachweis_da kommen aus der SPALTE.
const lis = await W.handleAntraegeListe({ status: "neu" }, env, me, cors);
const lisb = await lis.json();
const eintrag = lisb.antraege.find((a) => a.id === d1b.id);
pruefe("D16 Liste kennzeichnet die Quelle", eintrag && eintrag.quelle === "nachwuchs");
pruefe("D17 Liste meldet vorhandenen Nachweis", eintrag && eintrag.nachweis_da === true);
const eintrag7 = lisb.antraege.find((a) => a.id === d7b.id);
pruefe("D18 Liste meldet fehlenden Nachweis", eintrag7 && eintrag7.nachweis_da === false);

// Annahme: die Nationalitaet wandert an die PERSON.
db.exec("INSERT INTO beitragsklasse (id, name, aktiv, erstellt_am, erstellt_von) " +
        "VALUES ('bk-1', 'Kind / Jugendlicher', 1, '2026-01-01', 'test')");
db.exec("INSERT INTO beitragssatz (id, beitragsklasse_id, gueltig_ab, betrag_cent, " +
        "erstellt_am, erstellt_von) VALUES ('bs-1','bk-1','2026-01-01',3000,'2026-01-01','test')");

const ann = await W.handleAntragAnnehmen(
  { id: d1b.id, beschluss_am: HEUTE, eintritt: HEUTE,
    beitragsklasse_id: "bk-1", mitgliedsnummer: "9001" },
  env, me, cors);
pruefe("D19 Annahme geht durch", ann.status === 200,
       "status " + ann.status + " " + JSON.stringify(await ann.clone().json()));
if (ann.status === 200) {
  const p = db.prepare("SELECT nationalitaet, geburtsort FROM person WHERE nachname = 'Mustermann' " +
                       "ORDER BY erstellt_am DESC LIMIT 1").get();
  pruefe("D20 Nationalitaet steht an der Person", p && p.nationalitaet === "deutsch",
         p ? String(p.nationalitaet) : "keine Person");
}

// ======================================================================
console.log("E  Fenster zwischen Deploy und erster Migration");
// ======================================================================

const db2 = new DatabaseSync(":memory:");
for (const anw of schema.split(";").map((s) => s.trim()).filter(Boolean)) db2.exec(anw + ";");
db2.exec("ALTER TABLE aufnahmeantrag DROP COLUMN quelle");
db2.exec("ALTER TABLE aufnahmeantrag DROP COLUMN nachweis_owner");
db2.exec("CREATE TABLE IF NOT EXISTS einstellung (schluessel TEXT PRIMARY KEY, wert TEXT, " +
         "geaendert_am TEXT, geaendert_von TEXT)");
db2.exec("INSERT INTO einstellung (schluessel, wert) VALUES ('nachwuchs_offen','1')");
db2.exec("INSERT INTO einstellung (schluessel, wert) VALUES ('antrag_offen','1')");
db2.exec("INSERT INTO sparte (id, name, aktiv, erstellt_am, erstellt_von) " +
         "VALUES ('sp-1', 'Fussball', 1, '2026-01-01', 'test')");

// ⚠️ Frischer Worker-Kontext: die Merker (hatNachwuchsSpalten) sind
// Modul-Zustand. Ohne eigenen Kontext truege der Lauf oben das Ja mit
// herueber und dieser Abschnitt pruefte nichts.
const W2 = new Function(quelle + "\nreturn {handleAntragSenden};")();
const env2 = { VV_DB: d1(db2) };

const e1 = await W2.handleAntragSenden(nw(), env2, request, cors, "nachwuchs");
pruefe("E1 Nachwuchsantrag wird sichtbar abgewiesen (503)", e1.status === 503,
       "status " + e1.status);
const e2 = await W2.handleAntragSenden(
  nw({ nationalitaet: "", spielerlaubnis: undefined }), env2, request, cors, "antrag");
pruefe("E2 Allgemeiner Antrag laeuft trotzdem durch", e2.status === 200, "status " + e2.status);

// ======================================================================
console.log("F  Raster des Verbandsformulars");
// ======================================================================

// Der ECHTE Code aus tfv-antrag.js -- die reinen Funktionen laufen ohne
// Browser. Alles, was document/fetch braucht, wird nicht angefasst.
const tfvRoh = readFileSync(REPO + "/tfv-antrag.js", "utf8");
const T = new Function("window",
  tfvRoh + "\nreturn {tfvWerteAusAntrag, tfvUeberlaengen, tfvZellenMitte, tfvLatin1," +
  " TFV_FELDER, TFV_KREUZE, TFV_SCHRITT, TFV_VORLAGE_BYTES};")({});

pruefe("F1 Elf Kaestchenfelder", Object.keys(T.TFV_FELDER).length === 11,
       String(Object.keys(T.TFV_FELDER).length));
pruefe("F2 Neun Ankreuzfelder", Object.keys(T.TFV_KREUZE).length === 9,
       String(Object.keys(T.TFV_KREUZE).length));
pruefe("F3 Schritt 14,18pt", T.TFV_SCHRITT === 14.18);

// Zellenmitte: die Rechnung, an der jede Zeichenposition haengt.
pruefe("F4 Erste Zelle von nachname", Math.abs(T.tfvZellenMitte("nachname", 0) - 126.79) < 0.01,
       String(T.tfvZellenMitte("nachname", 0)));
pruefe("F5 Letzte Zelle von nachname",
       Math.abs(T.tfvZellenMitte("nachname", 28) - 523.83) < 0.01,
       String(T.tfvZellenMitte("nachname", 28)));
pruefe("F6 Unbekanntes Feld gibt null", T.tfvZellenMitte("gibtsnicht", 0) === null);

// Werte aus dem Antrag.
const tAntrag = {
  inhalt: {
    vorname: "Max", nachname: "Mustermann", geburtsdatum: "2015-03-14",
    geschlecht: "m", nationalitaet: "deutsch",
    strasse: "Musterweg 1", plz: "37308", ort: "Heilbad Heiligenstadt",
    spielerlaubnis: { art: "vereinswechsel", letzter_verein: "SV Muster 1920",
                      landesverband: "HFV", pass_nr: "123456", abmeldeweg: "2",
                      einwilligung_dfb_marketing: true }
  }
};
const wert = T.tfvWerteAusAntrag(tAntrag, "SC 1911 Heiligenstadt");
pruefe("F7 Geburtsdatum als TTMMJJJJ", wert.felder.geburtsdatum === "14032015",
       wert.felder.geburtsdatum);
pruefe("F8 PLZ und Ort zusammen", wert.felder.plz_ort === "37308 Heilbad Heiligenstadt");
pruefe("F9 Vereins-Nr. bleibt LEER (Bogen traegt sie vorgedruckt)",
       wert.felder.vereins_nr === "");
pruefe("F10 maennlich angekreuzt", wert.kreuze.maennlich === true);
pruefe("F11 weiblich nicht angekreuzt", wert.kreuze.weiblich === false);
pruefe("F12 Vereinswechsel angekreuzt", wert.kreuze.vereinswechsel === true);
pruefe("F13 Erstausstellung nicht angekreuzt", wert.kreuze.erstausstellung === false);
pruefe("F14 Abmeldeweg 2 angekreuzt", wert.kreuze.abmeldung2 === true);
pruefe("F15 Abmeldeweg 1 nicht angekreuzt", wert.kreuze.abmeldung1 === false);
pruefe("F16 Marketing angekreuzt", wert.kreuze.marketing === true);

// ⚠️ Der Abmeldeweg darf NUR beim Vereinswechsel ein Kreuz setzen -- sonst
// stuende auf dem Bogen einer Erstausstellung eine Abmeldung.
const tErst = T.tfvWerteAusAntrag(
  { inhalt: { spielerlaubnis: { art: "erstausstellung", abmeldeweg: "1" } } }, "");
pruefe("F17 Erstausstellung setzt kein Abmelde-Kreuz", tErst.kreuze.abmeldung1 === false);

// Ueberlaengen: gemeldet, nicht abgeschnitten.
const lang = T.tfvUeberlaengen({ nachname: "Mustermann-Schmidt-Wolkenkuckucksheim",
                                 vorname: "Max" });
pruefe("F18 Zu langer Name wird gemeldet", lang.length === 1, "gemeldet: " + lang.length);
// "Mustermann-Schmidt-Wolkenkuckucksheim" sind 37 Zeichen, das Raster
// fasst 29 -- also acht zu viel.
pruefe("F19 Meldung nennt die Ueberlaenge", lang[0] && lang[0].zuviel === 8,
       lang[0] ? String(lang[0].zuviel) : "-");
pruefe("F20 Passender Name wird nicht gemeldet",
       T.tfvUeberlaengen({ vorname: "Max" }).length === 0);
pruefe("F21 Genau 29 Zeichen passen noch",
       T.tfvUeberlaengen({ nachname: "x".repeat(29) }).length === 0);
pruefe("F22 30 Zeichen nicht mehr",
       T.tfvUeberlaengen({ nachname: "x".repeat(30) }).length === 1);

// WinAnsi: ein typografisches Anfuehrungszeichen reisst sonst die ganze
// Erzeugung mit.
pruefe("F23 Typografisches Anfuehrungszeichen ersetzt",
       T.tfvLatin1("Muster„Stadt“") === 'Muster"Stadt"');
pruefe("F24 Gedankenstrich ersetzt", T.tfvLatin1("Muster–Stadt") === "Muster-Stadt");
pruefe("F25 Umlaute bleiben", T.tfvLatin1("Grün Öl Ärger ß") === "Grün Öl Ärger ß");
pruefe("F26 Nicht darstellbares wird zum Fragezeichen",
       T.tfvLatin1("Max 中") === "Max ?");

// Die Vorlage im Repo ist die, an der gemessen wurde.
const vorlageGroesse = readFileSync(REPO + "/AO21_spielerlaubnis_national.pdf").length;
pruefe("F27 Vorlage unveraendert", vorlageGroesse === T.TFV_VORLAGE_BYTES,
       vorlageGroesse + " statt " + T.TFV_VORLAGE_BYTES);

// ======================================================================
console.log("G  Gleichheit des geteilten Formularkerns");
// ======================================================================

// ⚠️ Der Punkt dieses Abschnitts: antrag.js und nachwuchs.js duerfen die
// Funktionen aus antrag-felder.js nicht nachbauen. Ein Nachbau faellt erst
// auf, wenn eine Aenderung nur auf einer der beiden Seiten ankommt.
const kern = readFileSync(REPO + "/antrag-felder.js", "utf8");
const aJs = readFileSync(REPO + "/antrag.js", "utf8");
const nJs = readFileSync(REPO + "/nachwuchs.js", "utf8");

const kernFunktionen = [...kern.matchAll(/^function (\w+)/gm)].map((m) => m[1]);
pruefe("G1 Der Kern fuehrt Funktionen", kernFunktionen.length >= 10,
       String(kernFunktionen.length));

for (const f of kernFunktionen) {
  const re = new RegExp("^function " + f + "\\b", "m");
  pruefe("G2 " + f + " steht nicht doppelt in antrag.js", !re.test(aJs));
  pruefe("G3 " + f + " steht nicht doppelt in nachwuchs.js", !re.test(nJs));
}

// Beide Seiten benutzen ihn auch wirklich.
pruefe("G4 antrag.js ruft sammleGemeinsameFelder", /sammleGemeinsameFelder\(/.test(aJs));
pruefe("G5 nachwuchs.js ruft sammleGemeinsameFelder", /sammleGemeinsameFelder\(/.test(nJs));
pruefe("G6 antrag.js ruft pruefeGemeinsameFelder", /pruefeGemeinsameFelder\(/.test(aJs));
pruefe("G7 nachwuchs.js ruft pruefeGemeinsameFelder", /pruefeGemeinsameFelder\(/.test(nJs));

// Beide HTML-Seiten laden ihn, und VOR ihrem eigenen Skript.
for (const [datei, eigenes] of [["antrag.html", "antrag.js"],
                                ["nachwuchs.html", "nachwuchs.js"]]) {
  const html = readFileSync(REPO + "/" + datei, "utf8");
  const iKern = html.indexOf("antrag-felder.js");
  const iEigen = html.indexOf(eigenes + "?");
  pruefe("G8 " + datei + " laedt den Kern", iKern > 0);
  pruefe("G9 " + datei + " laedt ihn VOR dem eigenen Skript", iKern > 0 && iKern < iEigen,
         "Kern bei " + iKern + ", eigen bei " + iEigen);
}

// ⚠️ Der Gleichheitstest zwischen Client und Worker: beide Funktionen aus
// den ECHTEN Dateien gezogen, nicht nachgebaut. Laufen sie auseinander,
// meldet das Formular eine IBAN als gut, die der Server ablehnt.
const K = new Function(kern + "\nreturn {ibanPruefziffer, alterHeute};")();
const IBANS = ["DE02100500000054540402", "DE02120300000000202051", "DE89370400440532013000",
               "AT611904300234573201", "CH9300762011623852957",
               "DE02100500000054540403", "DE0212030000000020205", "XX02100500000054540402",
               "", "DE02 1005 0000 0054 5404 02"];
for (const iban of IBANS) {
  const client = K.ibanPruefziffer(iban);
  const server = W.ibanGueltig(String(iban).replace(/\s+/g, "").toUpperCase());
  pruefe("G10 IBAN gleich bewertet: " + (iban || "(leer)"), client === server,
         "Client " + client + ", Server " + server);
}

// ======================================================================
console.log("H  Passbild und Ablage des erzeugten Formulars");
// ======================================================================

// ⚠️ Der Bogen hat KEIN Bildfeld. Das ist die Grundlage der Entscheidung,
// das Passbild nicht aufs Blatt zu drucken, sondern es der
// Geschaeftsstelle fuer DFBnet zum Download zu geben. Hier gegen die
// echte Vorlage nachgemessen statt behauptet.
const pdfRoh = readFileSync(REPO + "/AO21_spielerlaubnis_national.pdf", "latin1");
const bildStellen = [...pdfRoh.matchAll(/\/Subtype\s*\/Image/g)].length;
pruefe("H1 Die Vorlage traegt genau EIN Bild (das Verbandslogo)", bildStellen === 1,
       String(bildStellen));
for (const wort of ["Lichtbild", "Passbild", "Lichtbildes"]) {
  pruefe("H2 Kein Feld '" + wort + "' auf dem Bogen", !pdfRoh.includes(wort));
}

// Der Slot muss in BEIDEN Weisslisten stehen -- Client und Gateway.
const nachwuchsJs = readFileSync(REPO + "/nachwuchs.js", "utf8");
const gatewayJs = readFileSync("E:/ToolsUebersicht/admin-worker.js", "utf8");
pruefe("H3 Gateway kennt den Slot 'passbild'",
       /VV_NACHWEIS_SLOTS[\s\S]{0,220}"passbild"/.test(gatewayJs));
pruefe("H4 Client laedt unter genau diesem Slot hoch",
       /ladeNachweisHoch\("passbild"/.test(nachwuchsJs));

// Nur wo der Verband ein neues Bild braucht.
const arten = nachwuchsJs.match(/PASSBILD_ARTEN\s*=\s*\[([^\]]*)\]/);
pruefe("H5 Passbild nur bei Erstausstellung und Vereinswechsel",
       !!arten && /erstausstellung/.test(arten[1]) && /vereinswechsel/.test(arten[1]) &&
       !/rueckkehrer/.test(arten[1]) && !/namensaenderung/.test(arten[1]),
       arten ? arten[1].trim() : "nicht gefunden");

// Passbild-Format: 35x45 wie das amtliche Bild, nicht quadratisch.
const pbB = Number((nachwuchsJs.match(/PASSBILD_B\s*=\s*(\d+)/) || [])[1]);
const pbH = Number((nachwuchsJs.match(/PASSBILD_H\s*=\s*(\d+)/) || [])[1]);
pruefe("H6 Seitenverhaeltnis 35:45", Math.abs(pbB / pbH - 35 / 45) < 0.001,
       pbB + "x" + pbH);

// ⚠️ Die Hilfslinie darf NICHT ins gespeicherte Bild wandern.
pruefe("H7 Export zeichnet ohne Hilfslinie",
       /zeichnePassbild\(false\)[\s\S]{0,120}toDataURL/.test(nachwuchsJs));
pruefe("H8 Danach wird die Hilfslinie wieder gezeichnet",
       /toDataURL[\s\S]{0,120}zeichnePassbild\(true\)/.test(nachwuchsJs));

// Die Ablage des erzeugten Formulars.
pruefe("H9 Gateway kennt vv-antrag-pdf-put", /case "vv-antrag-pdf-put"/.test(gatewayJs));
pruefe("H10 Gateway kennt vv-antrag-pdf-get", /case "vv-antrag-pdf-get"/.test(gatewayJs));
pruefe("H11 Gateway kennt vv-antrag-pdf-status", /case "vv-antrag-pdf-status"/.test(gatewayJs));

// ⚠️ Die drei verlangen IMMER eine Sitzung -- anders als der
// Nachweis-Upload. Das Blatt entsteht in der Verwaltung.
// Das Fenster muss den ganzen Handler fassen -- die Magic-Byte-Pruefung
// steht hinter der Groessenpruefung, nicht gleich am Anfang.
const pdfPut = gatewayJs.match(/async function handleVvAntragPdfPut[\s\S]{0,2000}/);
pruefe("H12 Ablage prueft die Sitzung", !!pdfPut && /vvNachweisDarfSehen/.test(pdfPut[0]));
pruefe("H13 Ablage nimmt nur PDF (Magic Bytes)",
       !!pdfPut && /bytes\[0\] === 0x25[\s\S]{0,120}bytes\[3\] === 0x46/.test(pdfPut[0]));

// Die Antrags-Id ist eine UUID MIT Bindestrichen -- eigenes Muster, nicht
// das des Nachweis-Owners.
const idRe = gatewayJs.match(/VV_ANTRAG_ID_RE\s*=\s*\/(.+?)\//);
pruefe("H14 Eigenes Muster fuer die Antrags-Id", !!idRe && idRe[1].includes("-"),
       idRe ? idRe[1] : "nicht gefunden");
if (idRe) {
  const re = new RegExp(idRe[1]);
  pruefe("H15 Echte UUID passt", re.test("3f2504e0-4f89-41d3-9a0c-0305e82c3301"));
  pruefe("H16 Nachweis-Owner passt NICHT", !re.test(OWNER));
  pruefe("H17 Pfad-Ausbruch passt nicht", !re.test("../../etc/passwd"));
}

// ⚠️ Der Download darf nicht an einem Fehler der Ablage haengen.
const antraegeJs = readFileSync(REPO + "/antraege.js", "utf8");
pruefe("H18 Erst herunterladen, dann ablegen",
       /tfvAntragSpeichern\([\s\S]{0,400}legeTfvAntragAb\(/.test(antraegeJs));
pruefe("H19 Fehlgeschlagene Ablage wird gemeldet, nicht geschluckt",
       /Nicht abgelegt/.test(antraegeJs));

// base64 in Bloecken -- ein 300-KB-Array auf einmal wirft in Safari.
const dbJs = readFileSync(REPO + "/db.js", "utf8");
pruefe("H20 base64-Umwandlung laeuft blockweise",
       /const block = 0x8000/.test(dbJs) && /subarray\(i, i \+ block\)/.test(dbJs));

// --- Eigene Kameravorschau (Michel-Wunsch: Oval schon beim Auslösen) ---
const nwHtml = readFileSync(REPO + "/nachwuchs.html", "utf8");
const css = readFileSync(REPO + "/style.css", "utf8");

pruefe("H21 Der Knopf fuehrt in die eigene Vorschau",
       /"btn-passbild-kamera"\)\.addEventListener\("click", oeffneKamera\)/.test(nachwuchsJs));
pruefe("H22 Rueckfall auf die System-Kamera ohne getUserMedia",
       /if \(!kameraMoeglich\(\)\) \{ \$\("passbild-kamera"\)\.click\(\)/.test(nachwuchsJs));
pruefe("H23 Auch ein Fehler faellt auf die System-Kamera zurueck",
       /catch[\s\S]{0,180}schliesseKamera\(\);[\s\S]{0,80}passbild-kamera"\)\.click\(\)/.test(nachwuchsJs));

// ⚠️ playsinline ist auf iOS Pflicht -- ohne das reisst Safari das Video
// in den Vollbild-Player und die Hilfslinie ist weg.
pruefe("H24 video traegt playsinline", /<video[^>]*playsinline/.test(nwHtml));
pruefe("H25 video ist muted (sonst blockt autoplay)", /<video[^>]*muted/.test(nwHtml));

// ⚠️ facingMode als ideal, nicht exact: exact wirft auf Geraeten ohne die
// gewuenschte Kamera einen OverconstrainedError und liefert gar nichts.
pruefe("H26 facingMode ist 'ideal', nicht 'exact'",
       /facingMode: \{ ideal:/.test(nachwuchsJs) && !/facingMode: \{ exact:/.test(nachwuchsJs));
pruefe("H27 Aufloesung nur als Wunsch",
       /width: \{ ideal:/.test(nachwuchsJs) && /height: \{ ideal:/.test(nachwuchsJs));
pruefe("H28 Kein Ton angefordert", /audio: false/.test(nachwuchsJs));

// ⚠️ Der Strom MUSS enden -- sonst leuchtet die Kamera-Anzeige weiter.
pruefe("H29 Jede Spur wird einzeln gestoppt",
       /getTracks\(\)\.forEach\(\(s\) => s\.stop\(\)\)/.test(nachwuchsJs));
pruefe("H30 Auch beim Wegschalten der Seite",
       /visibilitychange[\s\S]{0,140}schliesseKamera\(\)/.test(nachwuchsJs));
pruefe("H31 Auch beim Verlassen der Seite",
       /pagehide", stoppeKameraStrom/.test(nachwuchsJs));

// ⚠️ Die Frontkamera wird in der Vorschau gespiegelt, der Schnappschuss
// aber ZURUECKgespiegelt -- ein spiegelverkehrtes Passbild ist falsch.
pruefe("H32 Vorschau spiegelt nur die Frontkamera",
       /\.gespiegelt video \{ transform: scaleX\(-1\)/.test(css));
pruefe("H33 Schnappschuss spiegelt zurueck",
       /kameraRichtung === "user"\)[\s\S]{0,120}ctx\.scale\(-1, 1\)/.test(nachwuchsJs));

// Das Oval liegt UEBER dem Video und darf nie mitfotografiert werden --
// gezeichnet wird aus dem <video>, nicht aus der Buehne.
pruefe("H34 Schnappschuss kommt aus dem video-Element",
       /ctx\.drawImage\(v, 0, 0/.test(nachwuchsJs));
pruefe("H35 Das Oval faengt keine Klicks ab", /\.kamera-oval[\s\S]{0,300}pointer-events: none/.test(css));

// Escape schliesst gestaffelt: erst die Kamera, dann der Zuschnitt.
pruefe("H36 Escape schliesst zuerst die Kamera",
       /kamera-overlay"\)\.hidden\) \{ schliesseKamera\(\); return; \}/.test(nachwuchsJs));

// ======================================================================

console.log("");
console.log("────────────────────────────────────────────────────────────");
if (fehler) {
  console.log(ok + " GRUEN, " + fehler + " ROT");
  for (const f of fehlerListe) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("ALLE " + ok + " PRUEFUNGEN GRUEN");
