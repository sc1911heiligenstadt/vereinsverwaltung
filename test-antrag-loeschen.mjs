// Pruefstand fuer das Loeschen eines Aufnahmeantrags (2026-08-10).
//
// Faehrt den ECHTEN Worker-Code gegen das ECHTE Schema (node:sqlite mit
// duennem D1-Aufsatz, schema-kompakt.sql eingespielt). Anlass: Michel
// hatte drei zurueckgezogene Testantraege in der Live-D1 stehen und es
// gab keinen Weg, sie loszuwerden -- nur den Status zu aendern.
//
//   node test-antrag-loeschen.mjs
//
// Abschnitte:
//   A  Aufbau: vier Antraege in verschiedenen Zustaenden
//   B  Rechte: nur wer schreiben darf, und die Passstelle nie
//   C  Sperre: ein angenommener Antrag bleibt stehen
//   D  Die Probe zaehlt und schreibt nichts
//   E  Das Loeschen selbst
//   F  Der Nachweis-Schluessel kommt in der Antwort mit zurueck
//   G  Alles Fremde bleibt unangetastet

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
        all() { lauf.abfragen++; return { results: db.prepare(this._sql).all(...this._werte) }; },
        run() { lauf.abfragen++; db.prepare(this._sql).run(...this._werte); return { success: true }; }
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

const roh = readFileSync(REPO + "/vereinsverwaltung-worker.js", "utf8");
const schnitt = roh.indexOf("export default");
if (schnitt < 0) throw new Error("export default nicht gefunden");
const quelle = roh.slice(0, schnitt);

const namen = ["ladeRolle", "handleMigration", "handleAntragLoeschen", "handleAntraegeListe"];
const W = new Function(quelle + "\nreturn {" + namen.join(",") + "};")();

const db = new DatabaseSync(":memory:");
for (const anw of readFileSync(REPO + "/schema-kompakt.sql", "utf8")
                    .split(";").map((s) => s.trim()).filter(Boolean)) {
  db.exec(anw + ";");
}
const env = { VV_DB: d1(db) };
const cors = {};

const ADMIN  = { username: "admin", isAdmin: true, canEdit: true, canAdmin: true };
const GST    = { username: "gesch.stelle", isAdmin: false, canEdit: true, canAdmin: false };
const PASS   = { username: "pass.stelle", isAdmin: false, canEdit: true, canAdmin: false };
const OHNE   = { username: "ohne.rolle", isAdmin: false, canEdit: false, canAdmin: false };

function rolleGeben(username, rolle) {
  db.prepare("INSERT INTO benutzer_rolle (id, username, rolle, erstellt_am, erstellt_von) " +
             "VALUES (?,?,?,?,?)")
    .run("br-" + username, username, rolle, "2026-01-01", "test");
}
rolleGeben(GST.username, "geschaeftsstelle");
rolleGeben(PASS.username, "passstelle");

async function ruf(fn, ...args) {
  const antwort = await fn(...args);
  return { status: antwort.status, daten: await antwort.json() };
}
function zaehle(sql, ...werte) { return db.prepare(sql).get(...werte).n; }

// =====================================================================
// A  Aufbau
// =====================================================================

const migration = await ruf(W.handleMigration, env, ADMIN, cors);
pruefe("A1  Migration laeuft durch", migration.status === 200, "Status " + migration.status);

const OWNER = "07afc02ce70642cdabb34019b5c6e074";  // 32 Hex, wie im echten Betrieb

function legeAntragAn(id, vorname, nachname, status, extra) {
  const e = extra || {};
  db.prepare("INSERT INTO aufnahmeantrag (id, eingang_am, status, antrag_json, " +
             "unterschrift_datei, unterschrift_gesetzl_datei, nachweis_owner, quelle) " +
             "VALUES (?,?,?,?,?,?,?,?)")
    .run(id, e.eingang || "2026-08-06", status,
         JSON.stringify({ vorname, nachname, ort: "Heilbad Heiligenstadt" }),
         e.sig1 || null, e.sig2 || null, e.owner || null, e.quelle || "antrag");
}

legeAntragAn("a-tom",  "Tom",  "Mustermann", "zurueckgezogen",
             { sig1: "data:image/png;base64,AAA", sig2: "data:image/png;base64,BBB",
               owner: OWNER, quelle: "nachwuchs" });
legeAntragAn("a-lina", "Lina", "Mustermann", "zurueckgezogen",
             { sig1: "data:image/png;base64,AAA" });
legeAntragAn("a-neu",  "Nora", "Neuling",    "neu");
legeAntragAn("a-ja",   "Ada",  "Angenommen", "angenommen");

pruefe("A2  vier Antraege stehen da", zaehle("SELECT COUNT(*) AS n FROM aufnahmeantrag") === 4);

// =====================================================================
// B  Rechte
// =====================================================================

for (const [wer, konto] of [["die Passstelle", PASS], ["wer keine Rolle hat", OHNE]]) {
  const r = await ruf(W.handleAntragLoeschen, { id: "a-tom", pruefen: true }, env, konto, cors);
  pruefe("B  " + wer + " darf nicht loeschen", r.status === 403, "Status " + r.status);
  const r2 = await ruf(W.handleAntragLoeschen, { id: "a-tom" }, env, konto, cors);
  pruefe("B  " + wer + " auch nicht ohne Probe", r2.status === 403, "Status " + r2.status);
}

const unbekannt = await ruf(W.handleAntragLoeschen, { id: "gibt-es-nicht" }, env, GST, cors);
pruefe("B5  unbekannte Id -> 404", unbekannt.status === 404, "Status " + unbekannt.status);

// ⚠️ Gegenprobe: nach allen Abweisungen stehen alle vier noch da. Ohne
// diese Zeile waere B auch dann gruen, wenn die Rechtepruefung erst NACH
// dem DELETE kaeme.
pruefe("B6  nach allen Abweisungen sind alle vier unveraendert",
       zaehle("SELECT COUNT(*) AS n FROM aufnahmeantrag") === 4);

// =====================================================================
// C  Sperre: angenommen
// =====================================================================

const jaProbe = await ruf(W.handleAntragLoeschen, { id: "a-ja", pruefen: true }, env, GST, cors);
pruefe("C1  ein angenommener Antrag wird schon bei der Probe abgewiesen",
       jaProbe.status === 409, "Status " + jaProbe.status);
pruefe("C2  mit dem Code angenommen", jaProbe.daten.code === "angenommen",
       jaProbe.daten.code);
pruefe("C3  und der Text weist auf den Austritt",
       /Austritt/.test(jaProbe.daten.error || ""), jaProbe.daten.error);

const jaEcht = await ruf(W.handleAntragLoeschen, { id: "a-ja" }, env, GST, cors);
pruefe("C4  auch der echte Aufruf wird abgewiesen", jaEcht.status === 409);
pruefe("C5  und der Antrag steht unveraendert da",
       zaehle("SELECT COUNT(*) AS n FROM aufnahmeantrag WHERE id = 'a-ja'") === 1);

// =====================================================================
// D  Die Probe zaehlt und schreibt nichts
// =====================================================================

const probe = await ruf(W.handleAntragLoeschen, { id: "a-tom", pruefen: true }, env, GST, cors);
pruefe("D1  die Probe laeuft durch", probe.status === 200, "Status " + probe.status);
pruefe("D2  sie meldet sich als Probe", probe.daten.pruefung === true);
pruefe("D3  mit dem Namen aus dem Antrag", probe.daten.name === "Tom Mustermann",
       probe.daten.name);
pruefe("D4  mit dem Eingangsdatum", probe.daten.eingang_am === "2026-08-06",
       probe.daten.eingang_am);
pruefe("D5  mit dem Status", probe.daten.status === "zurueckgezogen", probe.daten.status);
pruefe("D6  sie nennt den Nachweis-Schluessel", probe.daten.nachweis_owner === OWNER,
       probe.daten.nachweis_owner);
pruefe("D7  und zaehlt die Unterschriften", probe.daten.unterschriften === 2,
       "unterschriften " + probe.daten.unterschriften);
pruefe("D8  ⚠️ die Probe schreibt NICHTS",
       zaehle("SELECT COUNT(*) AS n FROM aufnahmeantrag") === 4);

// Gegenprobe: ein Antrag ohne Nachweise meldet auch keinen Schluessel --
// ohne sie waere D6 auch dann gruen, wenn das Feld immer gefuellt waere.
const probeOhne = await ruf(W.handleAntragLoeschen, { id: "a-lina", pruefen: true }, env, GST, cors);
pruefe("D9  Gegenprobe: ohne Nachweise ist der Schluessel null",
       probeOhne.daten.nachweis_owner === null, String(probeOhne.daten.nachweis_owner));
pruefe("D10 Gegenprobe: und eine Unterschrift bleibt eine",
       probeOhne.daten.unterschriften === 1, String(probeOhne.daten.unterschriften));

// =====================================================================
// E  Das Loeschen selbst
// =====================================================================

const weg = await ruf(W.handleAntragLoeschen, { id: "a-tom" }, env, GST, cors);
pruefe("E1  der Antrag wird geloescht", weg.status === 200, "Status " + weg.status);
pruefe("E2  die Zeile ist wirklich weg",
       zaehle("SELECT COUNT(*) AS n FROM aufnahmeantrag WHERE id = 'a-tom'") === 0);
pruefe("E3  ein zweiter Aufruf antwortet 404",
       (await ruf(W.handleAntragLoeschen, { id: "a-tom" }, env, GST, cors)).status === 404);

// ⚠️ Was geloescht wurde, steht danach NUR noch im Protokoll -- deshalb
// mit Name, Status und Eingang, nicht bloss mit der Id.
const prot = db.prepare("SELECT * FROM protokoll WHERE aktion = 'antrag-geloescht'").get();
pruefe("E4  das Loeschen steht im Protokoll", !!prot);
const protDaten = prot ? JSON.parse(prot.detail_json || "{}") : {};
pruefe("E5  mit dem Namen", protDaten.name === "Tom Mustermann", JSON.stringify(protDaten));
pruefe("E6  mit dem Status von damals", protDaten.status === "zurueckgezogen");
pruefe("E7  und mit dem Vermerk, dass Nachweise dranhingen",
       protDaten.hatte_nachweise === true, String(protDaten.hatte_nachweise));
// ⚠️ Die Spalte heisst `username`, nicht `benutzer` -- daran ist meine
// erste Erwartung gescheitert, nicht der Code. Gleiche Falle wie
// `detail_json` gegen `details_json` in test-sammel-zurueck.
pruefe("E8  der Urheber steht dabei", prot && prot.username === GST.username,
       prot && prot.username);

// Auch ein Antrag im Status "neu" darf weg -- nur "angenommen" sperrt.
const wegNeu = await ruf(W.handleAntragLoeschen, { id: "a-neu" }, env, GST, cors);
pruefe("E9  auch ein neuer Antrag laesst sich loeschen", wegNeu.status === 200,
       "Status " + wegNeu.status);

// Der Administrator kommt ueber ladeRolle ebenfalls durch.
const wegAdmin = await ruf(W.handleAntragLoeschen, { id: "a-lina" }, env, ADMIN, cors);
pruefe("E10 der Administrator darf es auch", wegAdmin.status === 200, "Status " + wegAdmin.status);

// =====================================================================
// F  Der Schluessel kommt zurueck
// =====================================================================
//
// ⚠️ Das ist kein Schmuck: die Dateien liegen im Gateway, nicht in D1.
// Nach dem DELETE kennt den Schluessel niemand mehr -- steht er nicht in
// der Antwort, bleiben die Ausweiskopien unauffindbar liegen.

pruefe("F1  die Antwort traegt den Nachweis-Schluessel", weg.daten.nachweis_owner === OWNER,
       weg.daten.nachweis_owner);
pruefe("F2  und den Namen fuer die Rueckmeldung", weg.daten.name === "Tom Mustermann");
pruefe("F3  Gegenprobe: ohne Nachweise steht dort null",
       wegAdmin.daten.nachweis_owner === null, String(wegAdmin.daten.nachweis_owner));

// =====================================================================
// G  Alles Fremde bleibt stehen
// =====================================================================

pruefe("G1  der angenommene Antrag steht unveraendert da",
       zaehle("SELECT COUNT(*) AS n FROM aufnahmeantrag WHERE id = 'a-ja'") === 1);
// ⚠️ Ohne das `|| {}` stirbt der Pruefstand hier mit einem TypeError,
// sobald die Sperre aus C wegfaellt -- und verschluckt dabei seine
// eigene Fehlerliste. Ein Pruefstand, der abstuerzt, meldet nichts.
pruefe("G2  und ist immer noch angenommen",
       (db.prepare("SELECT status FROM aufnahmeantrag WHERE id = 'a-ja'").get() || {})
         .status === "angenommen");
pruefe("G3  genau ein Antrag ist uebrig", zaehle("SELECT COUNT(*) AS n FROM aufnahmeantrag") === 1);
pruefe("G4  drei Loeschungen stehen im Protokoll",
       zaehle("SELECT COUNT(*) AS n FROM protokoll WHERE aktion = 'antrag-geloescht'") === 3);

// Die Liste faellt danach nicht auseinander.
const liste = await ruf(W.handleAntraegeListe, { status: "angenommen" }, env, GST, cors);
pruefe("G5  die Antragsliste laeuft weiter", liste.status === 200, "Status " + liste.status);
pruefe("G6  und zeigt den einen verbliebenen",
       (liste.daten.antraege || []).length === 1,
       "anzahl " + (liste.daten.antraege || []).length);

// =====================================================================

console.log("");
console.log("Pruefstand Antrag loeschen");
console.log("  bestanden: " + ok);
console.log("  gescheitert: " + fehler);
if (fehler) {
  console.log("");
  for (const f of fehlerListe) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("");
console.log("  alles gruen.");
