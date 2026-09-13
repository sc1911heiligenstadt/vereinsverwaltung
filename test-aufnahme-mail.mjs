// Pruefstand fuer die Aufnahmebestaetigung per Mail (2026-09-13).
//
// Faehrt den ECHTEN Worker-Code gegen das ECHTE Schema (node:sqlite mit
// duennem D1-Aufsatz, schema-kompakt.sql eingespielt). Der Gateway wird
// durch einen Stub am Service Binding ersetzt, der jeden Aufruf mitschreibt.
//
//   node test-aufnahme-mail.mjs
//
// Abschnitte:
//   A  Der Brief geht nach der Annahme raus
//   B  Was drinsteht
//   C  Was NICHT mitgeht
//   D  Die Glaeubiger-Id
//   E  Ein Fehlschlag kippt die Aufnahme nicht
//   F  Die Reihenfolge (Schreiben vor Senden)
//
// ⚠️ Alle Namen, Adressen und Bankdaten sind ERFUNDEN und muessen es
// bleiben. Dieses Repo ist oeffentlich; es hat hier schon dreimal einen
// Datenschutz-Fall gegeben, zuletzt am 10.09.2026. Die IBAN unten ist das
// neutrale Standard-Testkonto, nicht die des Vereins.

import { DatabaseSync } from "node:sqlite";
import { readFileSync as readFileSyncRoh } from "node:fs";

// ⚠️ Zeilenenden auf LF normalisieren. Die Schnittmarke "export default"
// steht zwar in beiden Fassungen, aber `git` liefert mit core.autocrlf
// CRLF aus, und der Rest des Repos rechnet mit LF.
const readFileSync = (p, e) => {
  const r = readFileSyncRoh(p, e);
  return typeof r === "string" ? r.replace(/\r\n/g, "\n") : r;
};

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
if (schnitt < 0) throw new Error("ABBRUCH: export default nicht gefunden");
const quelle = roh.slice(0, schnitt);

const namen = ["ladeRolle", "handleMigration", "handleAntragSenden", "handleAntragAnnehmen",
               "ibanKurz", "MITGLIEDSART_TEXT", "sendeAufnahmeMail"];
const W = new Function(quelle + "\nreturn {" + namen.join(",") + "};")();

// --- Gateway-Stub -----------------------------------------------------
//
// ⚠️ Der Stub liest die Datenbank MIT. Nur so laesst sich beweisen, dass
// die Mitgliedschaft im Moment des Versands schon geschrieben ist -- eine
// Zusage auf die Reihenfolge im Quelltext waere eine Behauptung, keine
// Messung (Abschnitt F).

function baueEnv(db, verhalten) {
  const gerufen = [];
  return {
    gerufen,
    env: {
      VV_DB: d1(db),
      LANDINGPAGE: {
        async fetch(_url, init) {
          const koerper = JSON.parse(init.body);
          const stand = db.prepare(
            "SELECT COUNT(*) AS n FROM mitgliedschaft WHERE mitgliedsnummer = ?"
          ).get(String((koerper.daten || {}).mitgliedsnummer || ""));
          gerufen.push({
            koerper,
            auth: init.headers.Authorization,
            mitgliedschaftSchonDa: Number(stand.n) > 0
          });
          const v = verhalten || { ok: true, body: { ok: true, sent: true } };
          return {
            ok: v.ok,
            status: v.status || (v.ok ? 200 : 500),
            json: async () => v.body
          };
        }
      }
    }
  };
}

// --- Datenbank aufsetzen ----------------------------------------------

function neueDb() {
  const db = new DatabaseSync(":memory:");
  const schema = readFileSync(REPO + "/schema-kompakt.sql", "utf8");
  for (const anw of schema.split(";").map((s) => s.trim()).filter(Boolean)) db.exec(anw + ";");

  db.exec("CREATE TABLE IF NOT EXISTS einstellung (schluessel TEXT PRIMARY KEY, wert TEXT, " +
          "geaendert_am TEXT, geaendert_von TEXT)");
  db.exec("INSERT OR REPLACE INTO einstellung (schluessel, wert) VALUES ('antrag_offen','1')");
  db.exec("INSERT OR REPLACE INTO einstellung (schluessel, wert) VALUES ('nachwuchs_offen','1')");
  db.exec("INSERT OR REPLACE INTO einstellung (schluessel, wert) VALUES " +
          "('verein_iban','DE02100500000054540402')");
  db.exec("INSERT OR REPLACE INTO einstellung (schluessel, wert) VALUES " +
          "('glaeubiger_id','DE98ZZZ09999999999')");

  db.exec("INSERT INTO sparte (id, name, aktiv, sortierung, erstellt_am, erstellt_von) " +
          "VALUES ('sp-1','Fussball',1,10,'2026-01-01','test')");
  db.exec("INSERT INTO sparte (id, name, aktiv, sortierung, erstellt_am, erstellt_von) " +
          "VALUES ('sp-2','Turnen',1,20,'2026-01-01','test')");

  db.exec("INSERT INTO beitragsklasse (id, name, aktiv, erstellt_am, erstellt_von) " +
          "VALUES ('bk-1','Kinder/Jugendliche (Familie)',1,'2026-01-01','test')");
  // ⚠️ ZWEI Saetze. Der zweite gilt erst ab 2027 -- ein Eintritt im
  // Oktober 2026 muss den ERSTEN bekommen. Ohne den zweiten Satz waere
  // die Zusage B4 auch dann gruen, wenn der Code einfach den neuesten
  // nimmt.
  db.exec("INSERT INTO beitragssatz (id, beitragsklasse_id, gueltig_ab, gueltig_bis, " +
          "betrag_cent, erstellt_am, erstellt_von) " +
          "VALUES ('bs-alt','bk-1','2026-01-01','2026-12-31',3600,'2026-01-01','test')");
  db.exec("INSERT INTO beitragssatz (id, beitragsklasse_id, gueltig_ab, gueltig_bis, " +
          "betrag_cent, erstellt_am, erstellt_von) " +
          "VALUES ('bs-neu','bk-1','2027-01-01',NULL,4800,'2026-01-01','test')");

  db.exec("INSERT INTO benutzer_rolle (id, username, rolle, erstellt_am, erstellt_von) " +
          "VALUES ('r-1','gesch.stelle','geschaeftsstelle','2026-01-01','test')");
  return db;
}

const cors = {};
const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const IBAN = "DE02100500000054540402";
const AUTH = "Bearer pruefstand-token";
const GST = { username: "gesch.stelle", isAdmin: false, canEdit: true, canAdmin: false };
// ⚠️ Die Spalten, an denen die Annahme haengt (beitragsklasse_id, quelle,
// nationalitaet, …), entstehen in handleMigration -- nicht in schema-kompakt.sql.
// Ohne diesen Lauf stirbt der Pruefstand an einem nackten SQL-Fehler, und das
// sieht wie ein Fehler am geprueften Code aus.
const ADMIN = { username: "admin", isAdmin: true, canEdit: true, canAdmin: true };
const request = {
  headers: { get: (h) => (h === "CF-Connecting-IP" ? "203.0.113.9" : "Pruefstand/1.0") }
};

function antragBody(mehr) {
  return Object.assign({
    vorname: "Lina", nachname: "Beispiel", geburtsdatum: "2015-03-14",
    strasse: "Beispielweg 1", plz: "37308", ort: "Heilbad Heiligenstadt",
    email: "eltern@example.invalid", art: "ordentlich",
    zahlungsart: "lastschrift", iban: IBAN,
    kontoinhaber: "Rena Beispiel", bic: "HELADEF1EIC",
    bank_name: "Beispielbank", kontoinhaber_anschrift: "Beispielweg 1, 37308",
    einwilligung_satzung: true, einwilligung_datenschutz: true,
    unterschrift: SIG, unterschrift_gesetzl: SIG, unterschrift_gesetzl2: SIG,
    gesetzl_name: "Rena Beispiel", gesetzl2_name: "Toni Beispiel",
    nationalitaet: "deutsch",
    einwilligung_elternkodex: true,
    elternkodex_version: "1.0 (Stand 23.03.2026)",
    unterschrift_elternkodex: SIG,
    spielerlaubnis: { art: "erstausstellung" },
    sparten: ["sp-1", "sp-2"]
  }, mehr);
}

// Ein vollstaendiger Durchgang: Antrag stellen, annehmen, Mailaufruf
// zurueckgeben.
async function durchgang(opt) {
  const o = opt || {};
  const db = o.db || neueDb();
  const { env, gerufen } = baueEnv(db, o.verhalten);
  await W.handleMigration(env, ADMIN, cors);
  const res = await W.handleAntragSenden(
    antragBody(o.antrag), env, request, cors, o.quelle || "nachwuchs");
  if (res.status !== 200) throw new Error("Antrag nicht angelegt: " + res.status);
  const id = (await res.json()).id;

  const annahme = await W.handleAntragAnnehmen({
    id,
    beschluss_am: "2026-09-05",
    eintritt: "2026-10-01",
    art: "ordentlich",
    beitragsklasse_id: "bk-1",
    sparte_ids: ["sp-1", "sp-2"]
  }, env, GST, AUTH, cors);
  return { db, gerufen, annahme, antwort: await annahme.json(), id };
}

// ======================================================================
console.log("A  Der Brief geht nach der Annahme raus");
// ======================================================================

const A = await durchgang();
pruefe("A1 Annahme antwortet 200", A.annahme.status === 200, "status " + A.annahme.status);
pruefe("A2 Genau EIN Gateway-Aufruf", A.gerufen.length === 1, "Anzahl " + A.gerufen.length);
pruefe("A3 Aktion ist vv-aufnahme-mail",
       A.gerufen[0] && A.gerufen[0].koerper.action === "vv-aufnahme-mail",
       A.gerufen[0] && A.gerufen[0].koerper.action);
pruefe("A4 Empfaenger ist die Adresse aus dem Antrag",
       A.gerufen[0].koerper.an === "eltern@example.invalid", A.gerufen[0].koerper.an);
// ⚠️ Ohne den durchgereichten Token antwortet der Gateway 401, und der
// Brief kaeme nie an -- die Sitzung der Geschaeftsstelle ist der Ausweis.
pruefe("A5 Der Token der Geschaeftsstelle wird durchgereicht",
       A.gerufen[0].auth === AUTH, String(A.gerufen[0].auth));
pruefe("A6 Antwort meldet den Versand", A.antwort.mail_gesendet === true);
pruefe("A7 Antwort nennt die Adresse", A.antwort.mail_an === "eltern@example.invalid");
pruefe("A8 Antwort nennt keinen Grund", A.antwort.mail_grund === null);

const protA = A.db.prepare(
  "SELECT detail_json FROM protokoll WHERE aktion = 'aufnahme-mail'").all();
pruefe("A9 Der Versand steht im Protokoll", protA.length === 1, "Zeilen " + protA.length);
pruefe("A10 Protokoll merkt sich das Ergebnis",
       protA.length === 1 && JSON.parse(protA[0].detail_json).gesendet === true);

// ======================================================================
console.log("B  Was drinsteht");
// ======================================================================

const d = A.gerufen[0].koerper.daten;
pruefe("B1 Mitgliedsnummer wie in der Antwort",
       d.mitgliedsnummer === A.antwort.mitgliedsnummer, String(d.mitgliedsnummer));
pruefe("B2 Name vollstaendig", d.name === "Lina Beispiel", String(d.name));
pruefe("B3 Geburtsdatum", d.geburtsdatum === "2015-03-14", String(d.geburtsdatum));
pruefe("B4 Eintritt", d.eintritt === "2026-10-01", String(d.eintritt));
pruefe("B5 Beschlussdatum", d.beschluss_am === "2026-09-05", String(d.beschluss_am));

// ⚠️ NAMEN, keine Ids. Eine Id im Willkommensbrief waere fuer die Familie
// wertlos -- und der Fehler faellt nur auf, wenn jemand hinsieht.
pruefe("B6 Abteilungen als Namen", d.abteilungen === "Fussball, Turnen", String(d.abteilungen));
pruefe("B6b Keine Sparten-Id im Brief", !String(d.abteilungen).includes("sp-"));
pruefe("B7 Beitragsklasse als Name", d.beitragsklasse === "Kinder/Jugendliche (Familie)",
       String(d.beitragsklasse));

// ⚠️ Die Kern-Zusage dieses Abschnitts: der Satz zum EINTRITTSTAG, nicht
// der neueste. Beide stehen in der Datenbank (36,00 € ab 2026, 48,00 €
// ab 2027); der Eintritt ist der 01.10.2026.
pruefe("B8 Jahresbeitrag ist der Satz zum Eintritt", d.jahresbeitrag_cent === 3600,
       String(d.jahresbeitrag_cent));
pruefe("B8b Gegenprobe: der spaetere Satz steht sehr wohl in der Datenbank",
       A.db.prepare("SELECT betrag_cent FROM beitragssatz WHERE id='bs-neu'")
            .get().betrag_cent === 4800);

pruefe("B9 Mitgliedsart im Klartext", d.art_text === "ordentliches Mitglied", String(d.art_text));
pruefe("B9b Gegenprobe: der rohe Schluessel steht NICHT im Brief", d.art_text !== "ordentlich");

// ⚠️ Bei einem Kind geht der Brief an den gesetzlichen Vertreter -- die
// Anrede muss dessen Namen tragen, nicht den des Kindes.
pruefe("B10 Anrede nennt den gesetzlichen Vertreter", d.anrede_name === "Rena Beispiel",
       String(d.anrede_name));

// Gegenprobe an einem Volljaehrigen: ohne sie waere B10 auch dann gruen,
// wenn der Code IMMER den Elternnamen naehme.
const B2 = await durchgang({
  quelle: "antrag",
  antrag: {
    vorname: "Rena", nachname: "Beispiel", geburtsdatum: "1985-05-05",
    unterschrift_gesetzl: undefined, unterschrift_gesetzl2: undefined,
    gesetzl_name: "", gesetzl2_name: "",
    nationalitaet: "", spielerlaubnis: undefined,
    einwilligung_elternkodex: undefined, unterschrift_elternkodex: undefined,
    elternkodex_version: undefined
  }
});
pruefe("B11 Volljaehriger: Anrede ist der eigene Name",
       B2.gerufen[0].koerper.daten.anrede_name === "Rena Beispiel",
       String(B2.gerufen[0].koerper.daten.anrede_name));
pruefe("B11b Volljaehriger: kein Elternname im Brief",
       B2.gerufen[0].koerper.daten.name === "Rena Beispiel");

// ======================================================================
console.log("C  Was NICHT mitgeht");
// ======================================================================

const alsText = JSON.stringify(A.gerufen[0].koerper);

// ⚠️ Die Kern-Zusage: die vollstaendige IBAN verlaesst diesen Worker nicht.
pruefe("C1 Die volle IBAN steht in KEINEM Feld des Aufrufs", !alsText.includes(IBAN));
// Gegenprobe. Ohne sie waere C1 auch dann gruen, wenn das Formular nie
// eine IBAN geliefert haette.
const rohZeile = JSON.parse(
  A.db.prepare("SELECT antrag_json FROM aufnahmeantrag WHERE id = ?").get(A.id).antrag_json);
pruefe("C1b Gegenprobe: in der Datenbank steht die IBAN sehr wohl", rohZeile.iban === IBAN);
pruefe("C1c Gegenprobe: auch das Mandat traegt sie",
       A.db.prepare("SELECT iban FROM sepa_mandat LIMIT 1").get().iban === IBAN);

pruefe("C2 Im Brief steht nur die verkuerzte IBAN",
       d.mandat && d.mandat.iban_kurz === "DE02…0402", String(d.mandat && d.mandat.iban_kurz));

// ⚠️ Der Brief wird im GATEWAY gebaut. Schickte dieser Worker Betreff oder
// Text mit, waere die dortige Aktion ein offenes Mailrelais unter der
// Vereinsadresse -- jeder mit dem Bearbeiten-Haken koennte beliebige Post
// im Namen des Vereins verschicken.
for (const feld of ["betreff", "subject", "text", "html", "textContent", "htmlContent"]) {
  pruefe("C3 Kein fertiger Text im Koerper: " + feld,
         A.gerufen[0].koerper[feld] === undefined);
}

// Weder BIC noch Anschrift des Kontoinhabers braucht der Brief.
pruefe("C4 Kein BIC im Aufruf", !alsText.includes("HELADEF1EIC"));
pruefe("C5 Keine Unterschrift im Aufruf", !alsText.includes("iVBORw0KGgo"));

// ======================================================================
console.log("D  Die Glaeubiger-Id");
// ======================================================================

pruefe("D1 Gueltige Glaeubiger-Id kommt mit",
       d.mandat && d.mandat.glaeubiger_id === "DE98ZZZ09999999999",
       String(d.mandat && d.mandat.glaeubiger_id));
pruefe("D2 Mandatsreferenz kommt mit",
       d.mandat && d.mandat.referenz === "M-" + A.antwort.mitgliedsnummer,
       String(d.mandat && d.mandat.referenz));

// ⚠️ Eigene Datenbank. Eine unbrauchbare Nummer darf NICHT in den Brief --
// dieselbe Regel wie im Mandatstext des Formulars: lieber keine Nummer als
// eine falsche. Der Live-Bestand hatte genau diesen Zustand ("asdasd").
const dbUnsinn = neueDb();
dbUnsinn.exec("UPDATE einstellung SET wert = 'asdasd' WHERE schluessel = 'glaeubiger_id'");
const D3 = await durchgang({ db: dbUnsinn });
pruefe("D3 Unbrauchbare Glaeubiger-Id faellt aus dem Brief",
       D3.gerufen[0].koerper.daten.mandat.glaeubiger_id === "",
       String(D3.gerufen[0].koerper.daten.mandat.glaeubiger_id));
pruefe("D3b Gegenprobe: der Unsinn steht sehr wohl in der Datenbank",
       dbUnsinn.prepare("SELECT wert FROM einstellung WHERE schluessel='glaeubiger_id'")
               .get().wert === "asdasd");
// Der Rest des Briefs bleibt trotzdem vollstaendig -- eine fehlende Nummer
// ist kein Grund, die Bankangaben ganz wegzulassen.
pruefe("D3c Der Mandatsblock steht trotzdem",
       !!D3.gerufen[0].koerper.daten.mandat.referenz);

// ======================================================================
console.log("E  Ein Fehlschlag kippt die Aufnahme nicht");
// ======================================================================

const E = await durchgang({ verhalten: { ok: false, status: 502, body: null } });
pruefe("E1 Die Annahme antwortet trotzdem 200", E.annahme.status === 200,
       "status " + E.annahme.status);
pruefe("E2 Die Mitgliedsnummer steht in der Antwort", !!E.antwort.mitgliedsnummer);
// ⚠️ Die eigentliche Zusage: das Mitglied ist angelegt. Ein Brief, der
// nicht rausging, darf keine Mitgliedschaft kosten.
pruefe("E3 Die Mitgliedschaft steht in der Datenbank",
       E.db.prepare("SELECT COUNT(*) AS n FROM mitgliedschaft").get().n === 1);
pruefe("E4 Antwort meldet den Fehlschlag", E.antwort.mail_gesendet === false);
pruefe("E5 Antwort nennt einen Grund", typeof E.antwort.mail_grund === "string" &&
       E.antwort.mail_grund.length > 0, String(E.antwort.mail_grund));
pruefe("E6 Antwort nennt keine Adresse als erreicht", E.antwort.mail_an === null);
const protE = E.db.prepare(
  "SELECT detail_json FROM protokoll WHERE aktion = 'aufnahme-mail'").all();
pruefe("E7 Auch der Fehlschlag steht im Protokoll",
       protE.length === 1 && JSON.parse(protE[0].detail_json).gesendet === false);

// Der Gateway kann auch fachlich ablehnen (keine Adresse hinterlegt). Auch
// das ist kein Fehler des Vorgangs, sondern eine Auskunft.
const E2 = await durchgang({
  verhalten: { ok: true, body: { ok: true, sent: false, grund: "keine-adresse" } }
});
pruefe("E8 Fachliche Absage wird durchgereicht",
       E2.antwort.mail_gesendet === false && E2.antwort.mail_grund === "keine-adresse",
       String(E2.antwort.mail_grund));

// Und ein geplatztes Service Binding darf die Annahme ebenfalls nicht
// mitreissen -- der Worker faellt hier bewusst NICHT geschlossen aus.
const dbWeg = neueDb();
const wegEnv = baueEnv(dbWeg);
await W.handleMigration(wegEnv.env, ADMIN, cors);
wegEnv.env.LANDINGPAGE = { async fetch() { throw new Error("kein Binding"); } };
const resWeg = await W.handleAntragSenden(antragBody(), wegEnv.env, request, cors, "nachwuchs");
const idWeg = (await resWeg.json()).id;
const annWeg = await W.handleAntragAnnehmen({
  id: idWeg, beschluss_am: "2026-09-05", eintritt: "2026-10-01",
  art: "ordentlich", beitragsklasse_id: "bk-1", sparte_ids: ["sp-1"]
}, wegEnv.env, GST, AUTH, cors);
const antWeg = await annWeg.json();
pruefe("E9 Ohne Service Binding: Annahme trotzdem 200", annWeg.status === 200,
       "status " + annWeg.status);
pruefe("E10 Ohne Service Binding: Mitgliedschaft angelegt",
       dbWeg.prepare("SELECT COUNT(*) AS n FROM mitgliedschaft").get().n === 1);
pruefe("E11 Ohne Service Binding: Grund genannt",
       antWeg.mail_gesendet === false && /nicht erreichbar/i.test(antWeg.mail_grund || ""),
       String(antWeg.mail_grund));

// ======================================================================
console.log("F  Die Reihenfolge (Schreiben vor Senden)");
// ======================================================================

// ⚠️ GEMESSEN, nicht aus dem Quelltext gelesen: der Stub fragt im Moment
// des Versands die Datenbank. Stuende der Mailaufruf vor dem batch, waere
// hier noch keine Mitgliedschaft da -- und der Verein haette einen Brief
// fuer eine Mitgliedschaft verschickt, die es nicht gibt.
pruefe("F1 Beim Versand steht die Mitgliedschaft schon in der Datenbank",
       A.gerufen[0].mitgliedschaftSchonDa === true);

// Gegenprobe zur Messung selbst: vor dem Durchgang war sie es nicht.
const dbF = neueDb();
pruefe("F1b Gegenprobe: vorher ist die Tabelle leer",
       dbF.prepare("SELECT COUNT(*) AS n FROM mitgliedschaft").get().n === 0);

// ⚠️ Der Helfer selbst wirft nie -- darauf verlaesst sich handleAntragAnnehmen.
const kaputt = await W.sendeAufnahmeMail(
  { LANDINGPAGE: { async fetch() { throw new Error("peng"); } } }, AUTH, "a@example.invalid", {});
pruefe("F2 sendeAufnahmeMail wirft nicht", kaputt && kaputt.gesendet === false);

// Kuerzung und Textliste stehen fuer sich -- sie werden von zwei Stellen
// gebraucht und sind die haeufigste Quelle stiller Abweichungen.
pruefe("F3 ibanKurz maskiert die Mitte", W.ibanKurz(IBAN) === "DE02…0402", W.ibanKurz(IBAN));
pruefe("F4 ibanKurz haelt Leerzeichen aus",
       W.ibanKurz("DE02 1005 0000 0054 5404 02") === "DE02…0402");
pruefe("F5 ibanKurz liefert bei Unsinn nichts", W.ibanKurz("DE02") === "");
pruefe("F6 MITGLIEDSART_TEXT kennt alle drei Arten",
       Object.keys(W.MITGLIEDSART_TEXT).length === 3 &&
       !!W.MITGLIEDSART_TEXT.ordentlich && !!W.MITGLIEDSART_TEXT.ausserordentlich &&
       !!W.MITGLIEDSART_TEXT.ehrenmitglied);

// ======================================================================
console.log("");
console.log("Zusagen gruen: " + ok + "   rot: " + fehler);
for (const f of fehlerListe) console.log("  ✗ " + f);
console.log("FERTIG");
process.exit(fehler ? 1 : 0);
