// Pruefstand: der Vereinsname ist eine Konstante, die Glaeubiger-ID wird
// geprueft (2026-08-16).
//
// Anlass war ein echter Live-Zustand, kein gedachter Fall: in der D1 stand
// verein_name = "asd" und glaeubiger_id = "asdasd". Auf beiden oeffentlichen
// Formularen las sich das als "Willkommen beim asd", und der Mandatstext
// lautete "Ich ermaechtige den asd" mit "Glaeubiger-Identifikationsnummer
// asdasd" -- ein Lastschriftmandat, das den Glaeubiger nicht benennt.
//
// Faehrt den ECHTEN Worker-Code gegen das ECHTE Schema (node:sqlite mit
// duennem D1-Aufsatz) UND die ECHTEN Client-Funktionen aus antrag-felder.js
// und antrag-druck.js -- beide aus der Datei gezogen, nicht nachgebaut.
// Muster wie test-papierfelder.mjs und test-antrag-loeschen.mjs.
//
//   node test-vereinsname.mjs

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

const namen = ["glaeubigerIdGueltig", "ibanGueltig", "VEREIN_NAME", "EINSTELLUNGEN",
               "handleAntragInfo", "handleEinstellungen", "handleEinstellungSetzen",
               "handleMigration", "sepaText"];
const W = new Function(quelle + "\nreturn {" + namen.join(",") + "};")();

// ⚠️ Wer prueft, ob eine Lesestelle VERSCHWUNDEN ist, muss die Kommentare
// wegwerfen. Beim ersten Lauf waren B5 und H3 rot -- getroffen hatten sie
// die Kommentarbloecke, in denen der alte Ausdruck erklaert WIRD
// ("cfg.verein_name || FALLBACK greift nur beim leeren Feld"). Der Code
// selbst war laengst richtig. Gleiche Falle wie G18 in test-papierfelder:
// eine Zeichenfolge im Text ist kein ausgefuehrter Code.
function ohneKommentare(src) {
  return src.split("\n").filter((z) => !/^\s*\/\//.test(z)).join("\n");
}

// Client-Funktionen aus der echten Datei ziehen.
function zieheFunktion(src, name) {
  const m = src.match(
    new RegExp("(async )?function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  if (!m) throw new Error("Funktion " + name + " nicht gefunden");
  return m[0];
}

const felderQuelle = readFileSync(REPO + "/antrag-felder.js", "utf8");
const druckQuelle  = readFileSync(REPO + "/antrag-druck.js", "utf8");
const antragQuelle = readFileSync(REPO + "/antrag.js", "utf8");
const nachwuchsQuelle = readFileSync(REPO + "/nachwuchs.js", "utf8");
const antraegeQuelle  = readFileSync(REPO + "/antraege.js", "utf8");

// baueMandatstext braucht nur esc() -- das kommt aus derselben Datei mit.
const mandatstext = new Function(
  zieheFunktion(felderQuelle, "esc") + "\n" +
  zieheFunktion(felderQuelle, "baueMandatstext") +
  "\nreturn baueMandatstext;")();

const fusszeile = new Function(
  zieheFunktion(druckQuelle, "pEsc") + "\n" +
  druckQuelle.match(/const VEREIN_NAME_PAPIER = "[^"]*";/)[0] + "\n" +
  zieheFunktion(druckQuelle, "pFusszeile") +
  "\nreturn pFusszeile;")();

const cors = {};
const alsJson = async (antwort) => JSON.parse(await antwort.text());

// ======================================================================
console.log("A  Pruefziffer der Glaeubiger-ID");

// ⚠️ Die drei offiziellen Beispiele aus den EPC-Unterlagen. Sie sind der
// eigentliche Beleg: der Aufbau ist NICHT der einer IBAN (die Stellen 5-7,
// der Creditor Business Code, fallen bei der Rechnung weg). Wer sie
// mitrechnet, weist jede echte Nummer ab -- diese drei Zeilen fangen das.
pruefe("A1  DE98ZZZ09999999999 (EPC-Beispiel DE) ist gueltig",
       W.glaeubigerIdGueltig("DE98ZZZ09999999999") === true);
pruefe("A2  FR72ZZZ123456 (EPC-Beispiel FR) ist gueltig",
       W.glaeubigerIdGueltig("FR72ZZZ123456") === true);
pruefe("A3  NL42ZZZ123456780001 (EPC-Beispiel NL) ist gueltig",
       W.glaeubigerIdGueltig("NL42ZZZ123456780001") === true);

// Der Wert, der wirklich in der Live-Datenbank stand.
pruefe("A4  \"asdasd\" wird abgewiesen",
       W.glaeubigerIdGueltig("asdasd") === false);
pruefe("A5  leer wird abgewiesen", W.glaeubigerIdGueltig("") === false);
pruefe("A6  null wird abgewiesen", W.glaeubigerIdGueltig(null) === false);

// Ein Zahlendreher ist der Fall, der ohne Pruefziffer erst der Bank
// auffaellt -- und dann die ganze Einreichung kippt, nicht eine Zeile.
pruefe("A7  letzte Stelle verdreht faellt durch",
       W.glaeubigerIdGueltig("DE98ZZZ09999999998") === false);
pruefe("A8  falsche Pruefziffer faellt durch",
       W.glaeubigerIdGueltig("DE99ZZZ09999999999") === false);
pruefe("A9  eine Stelle zu kurz faellt durch",
       W.glaeubigerIdGueltig("DE98ZZZ0999999999") === false);

// Toleranz, die der Nutzer braucht: er tippt die Nummer vom Brief ab.
pruefe("A10 klein geschrieben ist gueltig",
       W.glaeubigerIdGueltig("de98zzz09999999999") === true);
pruefe("A11 mit Leerzeichen ist gueltig",
       W.glaeubigerIdGueltig("DE98 ZZZ 0999 9999 999") === true);

// ⚠️ Gegenprobe gegen die naheliegende Verwechslung: eine gueltige IBAN
// ist KEINE gueltige Glaeubiger-ID und umgekehrt. Ohne diese beiden
// Zeilen waere der Test auch dann gruen, wenn glaeubigerIdGueltig
// versehentlich auf ibanGueltig zeigte.
pruefe("A12 eine gueltige IBAN ist keine gueltige Glaeubiger-ID",
       W.ibanGueltig("DE02100500000054540402") === true &&
       W.glaeubigerIdGueltig("DE02100500000054540402") === false);
pruefe("A13 eine gueltige Glaeubiger-ID ist keine gueltige IBAN",
       W.ibanGueltig("DE98ZZZ09999999999") === false);

// ======================================================================
console.log("B  Der Name ist eine Konstante, keine Einstellung");

pruefe("B1  VEREIN_NAME nennt den Verein",
       typeof W.VEREIN_NAME === "string" && /SC 1911/.test(W.VEREIN_NAME),
       W.VEREIN_NAME);
pruefe("B2  verein_name ist KEINE Einstellung mehr",
       W.EINSTELLUNGEN.verein_name === undefined);
pruefe("B3  glaeubiger_id traegt die Pruefregel",
       W.EINSTELLUNGEN.glaeubiger_id && W.EINSTELLUNGEN.glaeubiger_id.glaeubiger === true);
pruefe("B4  verein_iban ist weiter Pflicht mit IBAN-Pruefung",
       W.EINSTELLUNGEN.verein_iban.pflicht === true &&
       W.EINSTELLUNGEN.verein_iban.iban === true);

// ⚠️ Gegenprobe: der Name darf im Worker NICHT mehr aus cfg gelesen werden.
// Ohne diese Zeile bliebe der Test gruen, wenn eine der sechs frueheren
// Lesestellen stehen geblieben waere.
const quelleCode = ohneKommentare(quelle);
pruefe("B5  keine Stelle im Worker liest cfg.verein_name",
       !/cfg\.verein_name|einstellungen\.verein_name/.test(quelleCode),
       (quelleCode.match(/.*cfg\.verein_name.*/) || [""])[0].trim());
// Gegenprobe zur Gegenprobe: der Filter darf nicht einfach alles wegwerfen.
pruefe("B6  ohneKommentare laesst den echten Code stehen",
       /function glaeubigerIdGueltig/.test(quelleCode) &&
       quelleCode.length > quelle.length * 0.4);

// ======================================================================
console.log("C  Der Live-Zustand: \"asd\" steht in der Datenbank");

const db = new DatabaseSync(":memory:");
const schema = readFileSync(REPO + "/schema-kompakt.sql", "utf8");
for (const anw of schema.split(";").map((s) => s.trim()).filter(Boolean)) db.exec(anw + ";");
const env = { VV_DB: d1(db) };

// Genau der gemeldete Zustand, am Live-Endpunkt am 16.08.2026 abgelesen.
db.exec("INSERT OR REPLACE INTO einstellung (schluessel, wert) VALUES ('verein_name','asd')");
db.exec("INSERT OR REPLACE INTO einstellung (schluessel, wert) VALUES ('glaeubiger_id','asdasd')");
db.exec("INSERT OR REPLACE INTO einstellung (schluessel, wert) VALUES ('antrag_offen','1')");
db.exec("INSERT OR REPLACE INTO einstellung (schluessel, wert) VALUES ('nachwuchs_offen','1')");

// Gegenprobe: der Muell steht wirklich in der Datenbank. Ohne diese Zeile
// waere C2 auch dann gruen, wenn die Tabelle leer geblieben waere -- dann
// haette der alte Fallback gegriffen und nichts wuerde bewiesen.
const drin = db.prepare("SELECT wert FROM einstellung WHERE schluessel='verein_name'").get();
pruefe("C1  Gegenprobe: \"asd\" steht in der Einstellung", drin && drin.wert === "asd");

const info = await alsJson(await W.handleAntragInfo(env, cors));
pruefe("C2  vv-antrag-info liefert NICHT \"asd\"", info.verein !== "asd", info.verein);
pruefe("C3  vv-antrag-info liefert den Vereinsnamen", info.verein === W.VEREIN_NAME, info.verein);
pruefe("C4  die unbrauchbare Glaeubiger-ID wird weggelassen",
       info.glaeubiger_id === null, String(info.glaeubiger_id));
pruefe("C5  das Formular bleibt trotzdem offen", info.offen === true);
pruefe("C6  die Nachwuchsseite bleibt trotzdem offen", info.nachwuchs_offen === true);

// Eine GUELTIGE Glaeubiger-ID muss dagegen ankommen -- sonst waere C4 auch
// gruen, wenn das Feld grundsaetzlich null lieferte.
db.exec("UPDATE einstellung SET wert='DE98ZZZ09999999999' WHERE schluessel='glaeubiger_id'");
const info2 = await alsJson(await W.handleAntragInfo(env, cors));
pruefe("C7  eine gueltige Glaeubiger-ID kommt mit",
       info2.glaeubiger_id === "DE98ZZZ09999999999", String(info2.glaeubiger_id));

// ======================================================================
console.log("D  Der Mandatstext (echter Client-Code)");

// Das ist der Text, den der Antragsteller unterschreibt.
const textMuell = mandatstext({ verein: info.verein, glaeubiger_id: info.glaeubiger_id });
pruefe("D1  der Mandatstext nennt nie \"asd\"", !/\basd\b/i.test(textMuell));
pruefe("D2  der Mandatstext nennt den Verein", textMuell.includes(W.VEREIN_NAME));
pruefe("D3  ohne gueltige Nummer steht keine Glaeubiger-ID im Text",
       !/Gl&auml;ubiger-Identifikationsnummer/.test(textMuell));

const textGut = mandatstext({ verein: info2.verein, glaeubiger_id: info2.glaeubiger_id });
pruefe("D4  mit gueltiger Nummer steht sie im Text",
       /Gl&auml;ubiger-Identifikationsnummer: DE98ZZZ09999999999/.test(textGut));
pruefe("D5  der Text ermaechtigt den richtigen Verein",
       textGut.includes("Ich erm&auml;chtige den " + W.VEREIN_NAME));

// ======================================================================
console.log("E  Der Papierantrag (echter Client-Code)");

// Der Papierausdruck bekommt "cfg" aus vv-einstellungen. Selbst wenn dort
// jemand wieder ein verein_name unterschiebt, darf es nicht durchschlagen.
const fussMuell = fusszeile({ verein_name: "asd", verein_iban: "DE02100500000054540402" });
pruefe("E1  die Fusszeile nennt nie \"asd\"", !/\basd\b/i.test(fussMuell));
pruefe("E2  die Fusszeile nennt den Verein", /SC 1911/.test(fussMuell));
pruefe("E3  die Bankdaten kommen weiter aus der Einstellung",
       fussMuell.includes("DE02100500000054540402"));

const fussLeer = fusszeile({});
pruefe("E4  ohne Bankdaten steht der Name trotzdem da", /SC 1911/.test(fussLeer));
pruefe("E5  ohne Bankdaten steht keine leere IBAN-Zeile", !/IBAN:/.test(fussLeer));

// ⚠️ Die beiden Namensstrings (Worker und Papier) muessen zeichengleich
// bleiben: der Papierantrag traegt das SEPA-Mandat, und darin muss derselbe
// Glaeubiger stehen wie in der Lastschriftdatei. Sie liegen bewusst an zwei
// Orten -- dieselbe Doppelung wie ANTRAG_WORKER_URL -- und genau deshalb
// braucht es diese Zeile.
const papierName = druckQuelle.match(/const VEREIN_NAME_PAPIER = "([^"]*)";/)[1];
pruefe("E6  Worker und Papierausdruck nennen zeichengleich denselben Namen",
       papierName === W.VEREIN_NAME, papierName + " vs. " + W.VEREIN_NAME);

// ======================================================================
console.log("F  Die Einstellungsmaske");

const me = { username: "pruefer", isAdmin: true, canEdit: true, canAdmin: true };

const setzMuell = await W.handleEinstellungSetzen(
  { schluessel: "glaeubiger_id", wert: "asdasd" }, env, me, cors);
pruefe("F1  \"asdasd\" wird beim Speichern abgewiesen", setzMuell.status === 400);
const fMuell = await alsJson(setzMuell);
pruefe("F2  die Meldung nennt den Aufbau", /DE98ZZZ09999999999/.test(fMuell.error), fMuell.error);

const setzGut = await W.handleEinstellungSetzen(
  { schluessel: "glaeubiger_id", wert: "DE98ZZZ09999999999" }, env, me, cors);
pruefe("F3  eine gueltige Nummer wird gespeichert", setzGut.status === 200);

// ⚠️ Gegenprobe: verein_name laesst sich gar nicht mehr setzen. Ohne diese
// Zeile koennte das Feld weiter beschrieben werden und irgendwann wieder
// jemand darauf bauen.
const setzName = await W.handleEinstellungSetzen(
  { schluessel: "verein_name", wert: "asd" }, env, me, cors);
pruefe("F4  verein_name laesst sich nicht mehr setzen", setzName.status === 400);

// Ein Pflichtfeld mit unbrauchbarem Inhalt muss sich melden -- ein leeres
// tat das schon, ein gefuelltes nicht.
db.exec("UPDATE einstellung SET wert='asdasd' WHERE schluessel='glaeubiger_id'");
db.exec("INSERT OR REPLACE INTO einstellung (schluessel, wert) VALUES ('verein_iban','DE02100500000054540402')");
const st = await alsJson(await W.handleEinstellungen(env, me, cors));
pruefe("F5  Stammdaten gelten als unvollstaendig", st.vollstaendig === false);
pruefe("F6  die Glaeubiger-ID wird benannt",
       st.fehlend.some((f) => /Glaeubiger/.test(f)), JSON.stringify(st.fehlend));
pruefe("F7  die Meldung sagt, dass etwas DRIN steht",
       st.fehlend.some((f) => /ungueltig/.test(f)), JSON.stringify(st.fehlend));
pruefe("F8  verein_name steht nicht mehr in der Maske",
       !st.felder.some((f) => f.schluessel === "verein_name"));

// Gegenprobe: mit gueltigen Werten ist die Meldung weg.
db.exec("UPDATE einstellung SET wert='DE98ZZZ09999999999' WHERE schluessel='glaeubiger_id'");
const st2 = await alsJson(await W.handleEinstellungen(env, me, cors));
pruefe("F9  mit gueltigen Werten sind die Stammdaten vollstaendig",
       st2.vollstaendig === true, JSON.stringify(st2.fehlend));

// ======================================================================
console.log("G  Die SEPA-Datei");

// Nicht die ganze Datei erzeugen (das braucht einen fertigen Beitragslauf,
// dafuer gibt es test-rhythmus.mjs) -- geprueft wird, was in die beiden
// Namensfelder des XML geht und dass die Sperre greift.
pruefe("G1  das XML nennt VEREIN_NAME, nicht die Einstellung",
       /<Cdtr><Nm>" \+ xmlEsc\(sepaText\(VEREIN_NAME, 70\)\)/.test(quelle));
pruefe("G2  auch die einleitende Partei nennt VEREIN_NAME",
       /<InitgPty><Nm>" \+ xmlEsc\(sepaText\(VEREIN_NAME, 70\)\)/.test(quelle));
pruefe("G3  handleSepaErzeugen prueft die Glaeubiger-ID",
       /if \(!glaeubigerIdGueltig\(cfg\.glaeubiger_id\)\)/.test(quelle));
pruefe("G4  die Sperre kommt mit code \"stammdaten\"",
       /Glaeubiger-Identifikationsnummer ist ungueltig[\s\S]{0,300}code: "stammdaten"/.test(quelle));
pruefe("G5  der Name uebersteht die SEPA-Transliteration",
       W.sepaText(W.VEREIN_NAME, 70).includes("SC 1911"), W.sepaText(W.VEREIN_NAME, 70));

// ======================================================================
console.log("H  Kein Client baut den Namen selbst nach");

// ⚠️ Beide oeffentlichen Seiten schreiben den Namen aus der Server-Antwort
// in ihre .verein-name-text-Elemente. Das ist jetzt richtig, WEIL der
// Server die Konstante liefert -- die Zeilen bleiben deshalb stehen.
pruefe("H1  antrag.js nimmt den Namen aus der Antwort",
       /verein-name-text[\s\S]{0,120}info\.verein/.test(antragQuelle));
pruefe("H2  nachwuchs.js nimmt den Namen aus der Antwort",
       /verein-name-text[\s\S]{0,120}info\.verein/.test(nachwuchsQuelle));

// ⚠️ Der Verbandsbogen AO21 wird BEDRUCKT -- der Fehler waere dort erst
// auf dem fertigen Blatt beim Verband aufgefallen.
pruefe("H3  antraege.js hat den Rueckfall auf verein_name verloren",
       !/anEinstellungen\.verein_name/.test(ohneKommentare(antraegeQuelle)));
pruefe("H4  antraege.js nimmt den Namen aus der Antwort",
       /vereinsname: verein\.name/.test(antraegeQuelle));
pruefe("H5  antrag-druck.js liest kein verein_name mehr",
       !/cfg\.verein_name/.test(ohneKommentare(druckQuelle)));
// ⚠️ Die Verbandsnummer behaelt ihren Rueckfall -- nur der Name hat ihn
// verloren. Ohne diese Zeile wuerde H3 auch dann gruen, wenn beim
// Aufraeumen versehentlich beide Zweige weggefallen waeren.
pruefe("H7  die Verbandsnummer behaelt ihren Rueckfall",
       /anEinstellungen\.tfv_vereinsnummer/.test(antraegeQuelle));

// Und die HTML-Dateien tragen den Namen weiter statisch -- das ist der
// Zustand, den ein Browser sieht, BEVOR die Antwort da ist.
for (const seite of ["antrag.html", "nachwuchs.html"]) {
  const html = readFileSync(REPO + "/" + seite, "utf8");
  pruefe("H6  " + seite + " nennt den Verein schon statisch",
         /verein-name-text">1\. SC 1911/.test(html));
}

// ======================================================================
console.log("─".repeat(60));
if (fehler) {
  console.log(ok + " gruen, " + fehler + " ROT");
  for (const f of fehlerListe) console.log("   ✗ " + f);
  process.exit(1);
}
console.log("ALLE " + ok + " PRUEFUNGEN GRUEN");
