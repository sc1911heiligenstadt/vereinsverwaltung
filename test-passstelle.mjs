// Pruefstand fuer die Rolle "passstelle" (2026-08-06).
//
// Faehrt den ECHTEN Worker-Code gegen das ECHTE Schema (node:sqlite mit
// duennem D1-Aufsatz, schema-kompakt.sql eingespielt). Gefragt wird
// genau das, was die Rolle ausmacht: Sie kommt an die Nachwuchs-
// Anmeldungen -- und an NICHTS sonst.
//
//   node test-passstelle.mjs
//
// Abschnitte:
//   A  Rechte-Ableitung je Rolle
//   B  Die Liste zeigt der Passstelle nur Nachwuchs-Anmeldungen
//   C  Das Detail haelt Bankdaten und Bestand zurueck
//   D  Schreibwege bleiben zu (Status, Annahme)
//   E  Fail-closed ohne die Spalte quelle
//   F  Rollenvergabe und Oberflaeche kennen die Rolle

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

const namen = ["ladeRolle", "handleMe", "handleAntraegeListe", "handleAntragDetail",
               "handleAntragStatus", "handleAntragAnnehmen", "handleAntragSenden",
               "handleRolleSetzen", "ROLLEN"];
const W = new Function(quelle + "\nreturn {" + namen.join(",") + "};")();

// --- Datenbank aufsetzen ----------------------------------------------

const db = new DatabaseSync(":memory:");
const schema = readFileSync(REPO + "/schema-kompakt.sql", "utf8");
for (const anw of schema.split(";").map((s) => s.trim()).filter(Boolean)) {
  db.exec(anw + ";");
}
const env = { VV_DB: d1(db) };

db.exec("CREATE TABLE IF NOT EXISTS einstellung (schluessel TEXT PRIMARY KEY, wert TEXT, " +
        "geaendert_am TEXT, geaendert_von TEXT)");
db.exec("INSERT OR REPLACE INTO einstellung (schluessel, wert) VALUES ('nachwuchs_offen','1')");
db.exec("INSERT OR REPLACE INTO einstellung (schluessel, wert) VALUES ('antrag_offen','1')");
db.exec("INSERT OR REPLACE INTO einstellung (schluessel, wert) VALUES ('verein_name','1. SC 1911 Heilbad Heiligenstadt')");
// ⚠️ Neutrales Standard-Testkonto, NICHT die Vereins-IBAN. Dieses Repo ist
// oeffentlich -- deshalb steht die echte Vereins-IBAN in der Datenbank
// (Tabelle einstellung) und nirgends im Code.
db.exec("INSERT OR REPLACE INTO einstellung (schluessel, wert) VALUES ('verein_iban','DE02100500000054540402')");
db.exec("INSERT OR REPLACE INTO einstellung (schluessel, wert) VALUES ('glaeubiger_id','DE98ZZZ09999999999')");
db.exec("INSERT INTO sparte (id, name, aktiv, erstellt_am, erstellt_von) " +
        "VALUES ('sp-1', 'Fussball', 1, '2026-01-01', 'test')");

const cors = {};
const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const HEUTE = new Date().toISOString().slice(0, 10);
const OWNER = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const IBAN = "DE02100500000054540402";

const request = {
  headers: { get: (h) => (h === "CF-Connecting-IP" ? "203.0.113.9" : "Pruefstand/1.0") }
};

// Konten. ⚠️ isAdmin/canAdmin bleiben false -- sonst schlaegt in ladeRolle
// der Admin-Kurzschluss zu und der ganze Pruefstand misst nichts.
const PASS = { username: "pass.stelle", isAdmin: false, canEdit: true, canAdmin: false };
const GST = { username: "gesch.stelle", isAdmin: false, canEdit: true, canAdmin: false };
const VOR = { username: "vor.stand", isAdmin: false, canEdit: false, canAdmin: false };
const OHNE = { username: "ohne.rolle", isAdmin: false, canEdit: false, canAdmin: false };
const ADMIN = { username: "admin", isAdmin: true, canEdit: true, canAdmin: true };

function rolleGeben(username, rolle, sparteId) {
  db.exec("INSERT INTO benutzer_rolle (id, username, rolle, sparte_id, erstellt_am, erstellt_von) " +
          "VALUES ('r-" + username + "-" + rolle + "', '" + username + "', '" + rolle + "', " +
          (sparteId ? "'" + sparteId + "'" : "NULL") + ", '2026-01-01', 'test')");
}
rolleGeben("pass.stelle", "passstelle");
rolleGeben("gesch.stelle", "geschaeftsstelle");
rolleGeben("vor.stand", "vorstand");

// ======================================================================
console.log("A  Rechte-Ableitung je Rolle");
// ======================================================================

const rPass = await W.ladeRolle(env, PASS);
pruefe("A1 Passstelle darf Nachwuchs", rPass.darfNachwuchs === true);
pruefe("A2 Passstelle darf NICHT schreiben", rPass.darfSchreiben === false);
pruefe("A3 Passstelle sieht KEINE Personen (Bestand)", rPass.darfPersonenSehen === false);
pruefe("A4 Passstelle sieht KEINE Bankdaten", rPass.darfBankSehen === false);
pruefe("A5 Passstelle darf NICHT buchen", rPass.darfBuchen === false);

const rGst = await W.ladeRolle(env, GST);
pruefe("A6 Geschaeftsstelle behaelt darfSchreiben", rGst.darfSchreiben === true);
pruefe("A7 Geschaeftsstelle darf Nachwuchs ebenfalls", rGst.darfNachwuchs === true);

const rVor = await W.ladeRolle(env, VOR);
pruefe("A8 Vorstand darf KEINEN Nachwuchs", rVor.darfNachwuchs === false);
const rOhne = await W.ladeRolle(env, OHNE);
pruefe("A9 Konto ohne Rolle darf nichts", rOhne.darfNachwuchs === false && rOhne.darfSchreiben === false);
const rAdmin = await W.ladeRolle(env, ADMIN);
pruefe("A10 Globaler Admin behaelt alles", rAdmin.darfNachwuchs === true && rAdmin.darfSchreiben === true);

// Die Rolle steht in der Weissliste -- ohne das faellt sie in ladeRolle
// stillschweigend heraus und die Person haette gar keine.
pruefe("A11 ROLLEN kennt passstelle", W.ROLLEN.has("passstelle"));
pruefe("A12 Passstelle taucht in rollen[] auf", rPass.rollen.includes("passstelle"));

// me liefert das neue Feld -- sonst kann der Client seinen Reiter nicht
// einblenden und die Rolle sieht nach einem Fehler aus.
const meAntwort = await (await W.handleMe(env, PASS, cors)).json();
pruefe("A13 me liefert darfNachwuchs", meAntwort.darfNachwuchs === true);
pruefe("A14 me liefert darfSchreiben false", meAntwort.darfSchreiben === false);

// ======================================================================
console.log("B  Die Liste zeigt der Passstelle nur Nachwuchs-Anmeldungen");
// ======================================================================

function antragBody(mehr) {
  return Object.assign({
    vorname: "Max", nachname: "Mustermann", geburtsdatum: "2015-03-14",
    strasse: "Musterweg 1", plz: "37308", ort: "Heilbad Heiligenstadt",
    email: "eltern@example.invalid", art: "ordentlich",
    zahlungsart: "lastschrift", iban: IBAN,
    kontoinhaber: "Erika Mustermann", bic: "HELADEF1EIC",
    bank_name: "Sparkasse Unstrut-Hainich", kontoinhaber_anschrift: "Musterweg 1, 37308",
    einwilligung_satzung: true, einwilligung_datenschutz: true,
    unterschrift: SIG, unterschrift_gesetzl: SIG, unterschrift_gesetzl2: SIG,
    gesetzl_name: "Erika Mustermann", gesetzl2_name: "Hans Mustermann",
    nationalitaet: "deutsch",
    spielerlaubnis: { art: "erstausstellung" },
    sparten: ["sp-1"]
  }, mehr);
}

const nwRes = await W.handleAntragSenden(
  antragBody({ nachweis_owner: OWNER }), env, request, cors, "nachwuchs");
pruefe("B0a Nachwuchs-Anmeldung angelegt", nwRes.status === 200, "status " + nwRes.status);
const nwId = (await nwRes.json()).id;

const allgRes = await W.handleAntragSenden(
  antragBody({ vorname: "Erika", geburtsdatum: "1985-05-05",
               unterschrift_gesetzl: undefined, unterschrift_gesetzl2: undefined,
               gesetzl_name: "", gesetzl2_name: "",
               nationalitaet: "", spielerlaubnis: undefined }),
  env, request, cors, "antrag");
pruefe("B0b Allgemeiner Aufnahmeantrag angelegt", allgRes.status === 200, "status " + allgRes.status);
const allgId = (await allgRes.json()).id;

const lPass = await (await W.handleAntraegeListe({ status: "neu" }, env, PASS, cors)).json();
pruefe("B1 Passstelle bekommt eine Liste", Array.isArray(lPass.antraege));
pruefe("B2 Genau die Nachwuchs-Anmeldung", lPass.antraege.length === 1,
       "Anzahl " + lPass.antraege.length);
pruefe("B3 Der allgemeine Antrag ist NICHT dabei",
       !lPass.antraege.some((a) => a.id === allgId));
pruefe("B4 Der Nachwuchsantrag ist dabei", lPass.antraege.some((a) => a.id === nwId));
pruefe("B5 Antwort kennzeichnet den Ausschnitt", lPass.nur_nachwuchs === true);
// ⚠️ Das Zaehlwerk der Statusreiter zaehlt mit -- sonst stuende ueber einer
// gefilterten Liste die Gesamtzahl des Vereins.
pruefe("B6 Zaehlwerk zaehlt nur Nachwuchs", lPass.nach.neu === 1, "neu=" + lPass.nach.neu);
pruefe("B7 Zahlungsart faellt aus der Liste",
       lPass.antraege[0] && lPass.antraege[0].zahlungsart === null);

const lGst = await (await W.handleAntraegeListe({ status: "neu" }, env, GST, cors)).json();
pruefe("B8 Geschaeftsstelle sieht beide", lGst.antraege.length === 2,
       "Anzahl " + lGst.antraege.length);
pruefe("B9 Geschaeftsstelle: Zaehlwerk ungefiltert", lGst.nach.neu === 2, "neu=" + lGst.nach.neu);
pruefe("B10 Geschaeftsstelle: kein Ausschnitt-Kennzeichen", lGst.nur_nachwuchs === false);
pruefe("B11 Geschaeftsstelle behaelt die Zahlungsart",
       lGst.antraege.every((a) => a.zahlungsart === "lastschrift"));

const lVor = await W.handleAntraegeListe({ status: "neu" }, env, VOR, cors);
pruefe("B12 Vorstand bekommt 403", lVor.status === 403, "status " + lVor.status);
const lOhne = await W.handleAntraegeListe({ status: "neu" }, env, OHNE, cors);
pruefe("B13 Konto ohne Rolle bekommt 403", lOhne.status === 403, "status " + lOhne.status);

// ======================================================================
console.log("C  Das Detail haelt Bankdaten und Bestand zurueck");
// ======================================================================

const dPassRes = await W.handleAntragDetail({ id: nwId }, env, PASS, cors);
pruefe("C1 Passstelle darf die Nachwuchs-Anmeldung oeffnen", dPassRes.status === 200,
       "status " + dPassRes.status);
const dPass = await dPassRes.json();

// ⚠️ Die entscheidende Zusage: die Bankfelder verlassen den Worker nicht.
for (const feld of ["iban", "bic", "kontoinhaber", "bank_name",
                    "kontoinhaber_anschrift", "zahlungsart"]) {
  pruefe("C2 Bankfeld fehlt: " + feld, dPass.antrag.inhalt[feld] === undefined,
         JSON.stringify(dPass.antrag.inhalt[feld]));
}
// Gegenprobe an der ROHEN Zeile: die Daten stehen sehr wohl da, sie
// werden nur nicht herausgegeben. Ohne diese Probe koennte der Test auch
// dann gruen sein, wenn das Formular nie eine IBAN geliefert hat.
const rohZeile = JSON.parse(
  db.prepare("SELECT antrag_json FROM aufnahmeantrag WHERE id = ?").get(nwId).antrag_json);
pruefe("C3 Gegenprobe: in der Datenbank steht die IBAN sehr wohl", rohZeile.iban === IBAN);

pruefe("C4 Name kommt weiterhin an", dPass.antrag.inhalt.nachname === "Mustermann");
pruefe("C5 Staatsangehoerigkeit kommt an", dPass.antrag.inhalt.nationalitaet === "deutsch");
pruefe("C6 Spielerlaubnis kommt an", !!dPass.antrag.inhalt.spielerlaubnis);
pruefe("C7 Unterschriften kommen an (der Bogen haengt daran)",
       !!dPass.antrag.unterschrift_gesetzl);
pruefe("C8 Nachweis-Schluessel kommt an", dPass.antrag.nachweis_owner === OWNER);

pruefe("C9 Keine Dublettensuche im Bestand", (dPass.dubletten || []).length === 0);
pruefe("C10 Keine Haushalte", (dPass.haushalte || []).length === 0);
pruefe("C11 Kein Vorschlag (keine naechste Mitgliedsnummer)", dPass.vorschlag === null);
pruefe("C12 Keine Beitragsklassen", (dPass.beitragsklassen || []).length === 0);
pruefe("C13 Ausschnitt-Kennzeichen gesetzt", dPass.nur_nachwuchs === true);

// Der Bogen braucht Vereinsname und Verbandsnummer -- und NUR die. Sie
// kommen mit dem Antrag mit, damit die Passstelle nicht vv-einstellungen
// aufrufen muss, wo Vereins-IBAN und Glaeubiger-Id daneben stehen.
pruefe("C14 Vereinsname kommt mit", dPass.verein.name.includes("SC 1911"));
pruefe("C15 Verbandsnummer kommt mit (hier leer)", dPass.verein.tfv_nr === "");
pruefe("C16 Vereins-IBAN kommt NICHT mit",
       JSON.stringify(dPass.verein).indexOf("DE62") < 0);
pruefe("C17 Glaeubiger-Id kommt NICHT mit",
       JSON.stringify(dPass).indexOf("DE98ZZZ") < 0);

// Eine geratene Id fuehrt nicht am Listenfilter vorbei.
const dFremd = await W.handleAntragDetail({ id: allgId }, env, PASS, cors);
pruefe("C18 Fremder Antrag wird abgewiesen", dFremd.status === 403, "status " + dFremd.status);

// Die Geschaeftsstelle sieht unveraendert alles.
const dGst = await (await W.handleAntragDetail({ id: nwId }, env, GST, cors)).json();
pruefe("C19 Geschaeftsstelle sieht die IBAN", dGst.antrag.inhalt.iban === IBAN);
pruefe("C20 Geschaeftsstelle bekommt einen Vorschlag", !!dGst.vorschlag);
pruefe("C21 Geschaeftsstelle: kein Ausschnitt-Kennzeichen", dGst.nur_nachwuchs === false);
pruefe("C22 Geschaeftsstelle darf den allgemeinen Antrag oeffnen",
       (await W.handleAntragDetail({ id: allgId }, env, GST, cors)).status === 200);

// ======================================================================
console.log("D  Schreibwege bleiben zu");
// ======================================================================

for (const status of ["geprueft", "abgelehnt", "zurueckgezogen"]) {
  const r = await W.handleAntragStatus({ id: nwId, status }, env, PASS, cors);
  pruefe("D1 Statuswechsel '" + status + "' abgewiesen", r.status === 403, "status " + r.status);
}
const dAnn = await W.handleAntragAnnehmen(
  { id: nwId, beschluss_am: HEUTE, eintritt: HEUTE, mitgliedsnummer: "9001" },
  env, PASS, cors);
pruefe("D2 Annahme nach § 4 abgewiesen", dAnn.status === 403, "status " + dAnn.status);

// Gegenprobe: die Zeile ist wirklich unangetastet geblieben.
const nachSchreibversuch = db.prepare("SELECT status, person_id FROM aufnahmeantrag WHERE id = ?")
  .get(nwId);
pruefe("D3 Der Antrag steht unveraendert auf 'neu'", nachSchreibversuch.status === "neu",
       nachSchreibversuch.status);
pruefe("D4 Es ist keine Person entstanden",
       db.prepare("SELECT COUNT(*) AS n FROM person").get().n === 0);

// Die Rollenvergabe bleibt beim globalen Administrator -- sonst macht sich
// die Passstelle selbst zur Geschaeftsstelle.
const dRolle = await W.handleRolleSetzen(
  { username: "pass.stelle", rolle: "geschaeftsstelle" }, env, PASS, cors);
pruefe("D5 Passstelle kann sich keine Rolle geben", dRolle.status === 403, "status " + dRolle.status);

// ======================================================================
console.log("E  Fail-closed ohne die Spalte quelle");
// ======================================================================

// ⚠️ Eigener Worker-Kontext und eigene Datenbank: hatNachwuchsSpalten ist
// Modul-Zustand und merkt sich nur das Ja. Ohne frischen Kontext truege
// der Lauf oben das Ja herueber und dieser Abschnitt pruefte nichts.
const db2 = new DatabaseSync(":memory:");
for (const anw of schema.split(";").map((s) => s.trim()).filter(Boolean)) db2.exec(anw + ";");
db2.exec("ALTER TABLE aufnahmeantrag DROP COLUMN quelle");
db2.exec("INSERT INTO benutzer_rolle (id, username, rolle, sparte_id, erstellt_am, erstellt_von) " +
         "VALUES ('r1','pass.stelle','passstelle',NULL,'2026-01-01','test')");
db2.exec("INSERT INTO benutzer_rolle (id, username, rolle, sparte_id, erstellt_am, erstellt_von) " +
         "VALUES ('r2','gesch.stelle','geschaeftsstelle',NULL,'2026-01-01','test')");
const env2 = { VV_DB: d1(db2) };
const W2 = new Function(quelle + "\nreturn {handleAntraegeListe};")();

const eAlt = await W2.handleAntraegeListe({ status: "neu" }, env2, PASS, cors);
pruefe("E1 Ohne die Spalte quelle liefert die Passstelle NICHTS", eAlt.status === 503,
       "status " + eAlt.status);
const eGst = await W2.handleAntraegeListe({ status: "neu" }, env2, GST, cors);
pruefe("E2 Die Geschaeftsstelle ist davon unberuehrt", eGst.status === 200,
       "status " + eGst.status);

// ======================================================================
console.log("F  Rollenvergabe und Oberflaeche kennen die Rolle");
// ======================================================================

const fSetzen = await W.handleRolleSetzen(
  { username: "neuer.pass", rolle: "passstelle" }, env, ADMIN, cors);
pruefe("F1 Admin kann die Rolle vergeben", fSetzen.status === 200, "status " + fSetzen.status);
const fZeile = db.prepare("SELECT rolle, sparte_id FROM benutzer_rolle WHERE username = 'neuer.pass'")
  .get();
pruefe("F2 Die Rolle steht in der Datenbank", fZeile && fZeile.rolle === "passstelle");
pruefe("F3 Ohne Sparte gespeichert", fZeile && fZeile.sparte_id === null);

// Eine Rolle, die der Server kennt und die Oberflaeche nicht, erscheint in
// der Liste als roher Schluessel und ist im Panel nicht vergebbar.
const rollenJs = readFileSync(REPO + "/rollen.js", "utf8");
const indexHtml = readFileSync(REPO + "/index.html", "utf8");
const appJs = readFileSync(REPO + "/app.js", "utf8");
const antraegeJs = readFileSync(REPO + "/antraege.js", "utf8");

pruefe("F4 rollen.js hat einen Anzeigenamen", /passstelle:\s*"Passstelle"/.test(rollenJs));
pruefe("F5 rollen.js erklaert die Rolle", /passstelle:\s*"Sieht ausschließlich/.test(rollenJs));
pruefe("F6 app.js kennt den Anzeigenamen", /passstelle:\s*"Passstelle"/.test(appJs));
pruefe("F7 index.html bietet die Rolle zur Vergabe an",
       /<option value="passstelle">/.test(indexHtml));
pruefe("F8 app.js blendet den Antrags-Reiter fuer die Rolle ein",
       /darfNachwuchs[\s\S]{0,400}nav-antraege/.test(appJs));
pruefe("F9 app.js versteckt die Formular-Karte", /an-formular-karte/.test(appJs));
pruefe("F10 index.html hat die Karte mit Id", /id="an-formular-karte"/.test(indexHtml));
pruefe("F11 antraege.js richtet sich nach der Server-Antwort",
       /anAktuell\.nur_nachwuchs/.test(antraegeJs) && /antwort\.nur_nachwuchs/.test(antraegeJs));
pruefe("F12 antraege.js nimmt die Vereinsdaten aus dem Antrag",
       /anAktuell\.verein/.test(antraegeJs));

// ======================================================================
console.log("");
console.log(fehler === 0
  ? "ALLES GRUEN — " + ok + " Zusagen"
  : ok + " gruen, " + fehler + " ROT:\n  " + fehlerListe.join("\n  "));
process.exit(fehler === 0 ? 0 : 1);
