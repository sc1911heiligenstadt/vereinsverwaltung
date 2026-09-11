// Pruefstand fuer die Vorschlaege in der Karte "Nicht zuzuordnen"
// (10.09.2026).
//
// Faehrt den ECHTEN Worker-Code gegen das ECHTE Schema (node:sqlite mit
// duennem D1-Aufsatz, schema-kompakt.sql eingespielt).
//
//   node test-kodex-vorschlag.mjs
//
// Abschnitte:
//   V  Die Vergleichsformen (kodexHart, kodexLev, kodexTeileListe)
//   W  Die Bewertung (kodexAehnlichkeit) samt Gegenproben
//   X  Der Lauf gegen die echte Datenbank
//   Y  Die Rechtegrenze: nur darfSchreiben bekommt Vorschlaege
//   Z  Die Oberflaeche zeigt sie auch
//   P  Der Vorfilter: Aequivalenz und Schranke (11.09.2026)
//
// ⚠️ ALLE Namen und Geburtsdaten hier sind ERFUNDEN und muessen es
// bleiben. Dieses Repo ist oeffentlich, und es geht um minderjaehrige
// Mitglieder. Beim Bauen am 10.09.2026 standen hier zuerst die echten
// Namen aus Michels Screenshot -- gefunden erst beim Abgleich gegen die
// Regeln, nach dem Push. Ein Testwert, der wie ein echter aussieht, ist
// meistens einer.

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

const NAMEN = ["kodexHart", "kodexLev", "kodexTeileListe", "kodexAehnlichkeit",
               "kodexVorschlaege", "kodexDatumGedreht", "kodexSchluessel",
               "kodexNamensteil", "KODEX_VORSCHLAG_PUNKTE", "KODEX_VORSCHLAG_ANZAHL",
               "handleKodexListe", "handleMigration", "ladeRolle",
               "namensIndex", "namensKandidaten", "namensSchluesselFuer",
               "kodexZaehler"];
const W = new Function(quelle + "\nreturn {" + NAMEN.join(",") + "};")();

// ======================================================================
console.log("V  Die Vergleichsformen");
// ======================================================================

const T = (v, n) => W.kodexTeileListe(v, n);

pruefe("V1 Namensteile kommen unsortiert, in Eingabereihenfolge",
       JSON.stringify(T("Anna Lena", "Mueller")) === '["anna","lena","mueller"]',
       JSON.stringify(T("Anna Lena", "Mueller")));

// ⚠️ Die Gegenprobe zum Schluessel: der SORTIERT zusaetzlich. Waeren
// beide gleich, haette das Herausloesen die Sortierung verschluckt.
pruefe("V2 kodexSchluessel sortiert weiterhin",
       W.kodexSchluessel("Zoe", "Aal", "2015-01-01") === "aal|zoe|2015-01-01",
       W.kodexSchluessel("Zoe", "Aal", "2015-01-01"));

pruefe("V3 Bindestrich, Komma und Schraegstrich trennen",
       JSON.stringify(T("Anna-Lena", "Mueller/Schmidt")) ===
       '["anna","lena","mueller","schmidt"]');

// Der eigentliche Zweck: die weggelassene Umlaut-Schreibweise.
pruefe("V4 Gruenbaum und Grunbaum sind hart gleich",
       W.kodexHart(W.kodexNamensteil("Grünbaum")) ===
       W.kodexHart(W.kodexNamensteil("Grunbaum")),
       W.kodexHart(W.kodexNamensteil("Grünbaum")) + " / " +
       W.kodexHart(W.kodexNamensteil("Grunbaum")));

// ⚠️ Gegenprobe: der STRENGE Schluessel darf sie weiterhin auseinander
// halten. Faende er sie gleich, waere die Toleranz nach oben gewandert
// und ein zweites Absenden ersetzte die Erklaerung eines fremden Kindes.
pruefe("V5 Der strenge Schluessel trennt sie weiterhin",
       W.kodexSchluessel("Mira", "Grünbaum", "2012-03-04") !==
       W.kodexSchluessel("Mira", "Grunbaum", "2012-03-04"));

pruefe("V6 Mueller, Müller und Muller fallen hart zusammen",
       W.kodexHart(W.kodexNamensteil("Müller")) === "muller" &&
       W.kodexHart(W.kodexNamensteil("Mueller")) === "muller" &&
       W.kodexHart(W.kodexNamensteil("Muller")) === "muller");

pruefe("V7 Doppel-s und scharfes s fallen hart zusammen",
       W.kodexHart(W.kodexNamensteil("Strauß")) ===
       W.kodexHart(W.kodexNamensteil("Strauss")));

pruefe("V8 Levenshtein: gleich ist 0", W.kodexLev("waldeck", "waldeck") === 0);
pruefe("V9 Levenshtein: ein Buchstabe ist 1", W.kodexLev("waldeck", "waldek") === 1);
pruefe("V10 Levenshtein: leer gegen Wort ist die Laenge",
       W.kodexLev("", "waldeck") === 7);
pruefe("V11 Levenshtein zaehlt auch das Einfuegen",
       W.kodexLev("bornholm", "bornholme") === 1);

pruefe("V12 Tag und Monat drehen", W.kodexDatumGedreht("2013-03-27") === "2013-27-03");
pruefe("V13 Ein unvollstaendiges Datum dreht nicht", W.kodexDatumGedreht("") === "");

// ======================================================================
console.log("W  Die Bewertung");
// ======================================================================

const A = (va, na, ga, vb, nb, gb) =>
  W.kodexAehnlichkeit(T(va, na), ga, T(vb, nb), gb);

// Der Regelfall der Karte: ein Zweitvorname zuviel.
const w1 = A("Jonas Tobias", "Feldbach", "2015-01-07",
             "Jonas", "Feldbach", "2015-01-07");
pruefe("W1 Zweitvorname zuviel: erkannt", w1.punkte >= W.KODEX_VORSCHLAG_PUNKTE,
       "" + w1.punkte);
pruefe("W2 Zweitvorname zuviel: Geburtstag wird genannt",
       w1.gruende.includes("Geburtstag gleich"), w1.gruende.join(" · "));

// Der Fall, um den es Michel geht: der weggelassene Umlaut.
const w2 = A("Mira", "Grunbaum", "2012-03-04", "Mira", "Grünbaum", "2012-03-04");
pruefe("W3 Weggelassener Umlaut: erkannt", w2.punkte >= W.KODEX_VORSCHLAG_PUNKTE,
       "" + w2.punkte);
pruefe("W4 Weggelassener Umlaut: als Schreibweise benannt",
       w2.gruende.some((g) => /anders geschrieben/.test(g)), w2.gruende.join(" · "));

// ⚠️ Und derselbe Fall OHNE passendes Geburtsdatum muss ebenfalls reichen
// -- sonst haengt die ganze Umlaut-Toleranz still am Geburtstag, und
// genau der ist im Bestand oefter falsch erfasst.
const w3 = A("Mira", "Grunbaum", "", "Mira", "Grünbaum", "");
pruefe("W5 Umlaut allein reicht auch ohne Geburtsdatum",
       w3.punkte >= W.KODEX_VORSCHLAG_PUNKTE, "" + w3.punkte);

// Tippfehler von einem Buchstaben.
const w4 = A("Elias", "Bornholme", "2012-06-05", "Elias", "Bornholm", "2012-06-05");
pruefe("W6 Tippfehler im Nachnamen: erkannt",
       w4.punkte >= W.KODEX_VORSCHLAG_PUNKTE, "" + w4.punkte);

// Tag und Monat vertauscht.
const w5 = A("Fabian", "Ostermund", "2013-03-27", "Fabian", "Ostermund", "2013-27-03");
pruefe("W7 Gedrehtes Geburtsdatum wird benannt",
       w5.gruende.some((g) => /vertauscht/.test(g)), w5.gruende.join(" · "));

// ⚠️ DIE wichtigste Gegenprobe. Gleicher Geburtstag, voellig andere
// Namen: bei 540 Mitgliedern passiert das mehrfach und ist Zufall. Die
// Punktzahl allein reicht dafuer (100 > 50) -- der Aufrufer wirft es
// ueber `signale` heraus, und genau das wird hier festgehalten.
const w6 = A("Carla", "Nebelhorn", "2019-04-19", "Ferdinand", "Zaubermann", "2019-04-19");
pruefe("W8 Nur Geburtstag gleich: KEIN Namenssignal", w6.signale === 0,
       "signale " + w6.signale);
pruefe("W9 Nur Geburtstag gleich: Punktzahl allein wuerde reichen",
       w6.punkte >= W.KODEX_VORSCHLAG_PUNKTE, "" + w6.punkte);

// Zwei fremde Kinder duerfen sich nicht aehneln.
const w7 = A("Carla", "Nebelhorn", "2019-04-19", "Sebastian", "Winterberg", "2004-03-03");
pruefe("W10 Zwei fremde Kinder: kein Signal", w7.signale === 0 && w7.punkte === 0,
       w7.punkte + " / " + w7.signale);

// ⚠️ Kurze Namen duerfen NICHT ueber Levenshtein zusammenfallen: "Tim"
// und "Tom" sind zwei Kinder. Die Laengenschranke (>= 4) haelt sie
// auseinander.
const w8 = A("Tim", "Waldeck", "2018-10-09", "Tom", "Waldeck", "2018-10-09");
pruefe("W11 Tim und Tom sind nicht derselbe Vorname",
       !w8.gruende.some((g) => /2 Namensteile (gleich|fast gleich)/.test(g)),
       w8.gruende.join(" · "));

// ======================================================================
console.log("X  Der Lauf gegen die echte Datenbank");
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

function legeAn(id, vorname, nachname, geburt, nr, sparteId, status) {
  db.exec("INSERT INTO person (id, vorname, nachname, geburtsdatum, erstellt_am, " +
          "erstellt_von) VALUES ('" + id + "', '" + vorname + "', '" + nachname +
          "', '" + geburt + "', " + WER + ")");
  db.exec("INSERT INTO mitgliedschaft (id, person_id, mitgliedsnummer, art, eintritt, " +
          "status, erstellt_am, erstellt_von) VALUES ('m-" + id + "', '" + id + "', '" +
          nr + "', 'ordentlich', '2020-01-01', '" + (status || "aktiv") + "', " +
          WER + ")");
  if (sparteId) {
    db.exec("INSERT INTO mitgliedschaft_sparte (id, mitgliedschaft_id, sparte_id, " +
            "eintritt, erstellt_am, erstellt_von) VALUES ('ms-" + id + "', 'm-" + id +
            "', '" + sparteId + "', '2020-01-01', " + WER + ")");
  }
}

// Der Bestand: zwei Fussballkinder, ein Turnkind, ein Volljaehriger.
legeAn("p-lue", "Mira", "Grünbaum", "2012-03-04", "201", "sp-fu");
legeAn("p-bro", "Jonas", "Feldbach", "2015-01-07", "202", "sp-fu");
legeAn("p-tur", "Nele", "Steinweg", "2018-08-22", "203", "sp-tu");
legeAn("p-alt", "Barbara", "Sonnleitner", "1984-02-02", "204", "sp-fu");

// Ein offener Aufnahmeantrag -- die Familie wartet auf den Beschluss.
db.exec("INSERT INTO aufnahmeantrag (id, eingang_am, status, antrag_json, sparten_json) " +
        "VALUES ('a-neu', '2026-09-01', 'neu', " +
        "'{\"vorname\":\"Piet\",\"nachname\":\"Harkort\",\"geburtsdatum\":\"2019-02-11\"}', " +
        "'[]')");

const STEMPEL = "2026-09-07T10:00:00.000Z";
function erklaerung(id, vorname, nachname, geburt, mannschaft) {
  db.exec("INSERT INTO elternkodex_bestaetigung (id, eingang_am, kind_vorname, " +
          "kind_nachname, kind_geburtsdatum, mannschaft, erz_name, erz_email, ort, " +
          "kodex_version, abgleich_schluessel, unterschrift_datei) VALUES ('" + id + "', '" +
          STEMPEL + "', '" + vorname + "', '" + nachname + "', '" + geburt + "', '" +
          mannschaft + "', 'Ein Elternteil', 'eltern@example.invalid', 'Heiligenstadt', " +
          "'1.0', '" + W.kodexSchluessel(vorname, nachname, geburt) + "', 'x')");
}
// 1) Umlaut weggelassen -> Fussballkind, zuordenbar
erklaerung("e-lue", "Mira", "Grunbaum", "2012-03-04", "C1-Junioren");
// 2) Zweitvorname zuviel -> Fussballkind, zuordenbar
erklaerung("e-bro", "Jonas Tobias", "Feldbach", "2015-01-07", "D3");
// 3) Turnkind -> Vorschlag, aber nichts zu tun
erklaerung("e-tur", "Nele Marie", "Steinweg", "2018-08-22", "F1-Junioren");
// 4) offener Antrag -> Vorschlag aus dem Antrag
erklaerung("e-sag", "Piet", "Harkort", "2019-02-11", "F2-Junioren");
// 5) niemand im Verein -> ausdruecklich kein Treffer
erklaerung("e-nix", "Ferdinand", "Zaubermann", "2011-11-11", "B2");

const antwort = await (await W.handleKodexListe({}, env, ADMIN, cors)).json();
const V = antwort.vorschlaege || {};

pruefe("X1 Die Antwort fuehrt ein Feld vorschlaege", !!antwort.vorschlaege);
pruefe("X2 Fuenf Erklaerungen sind nicht zuzuordnen",
       (antwort.offene_eingaenge || []).length === 5,
       "" + (antwort.offene_eingaenge || []).length);

// --- Der Umlaut-Fall --------------------------------------------------
const vLue = V["e-lue"] || [];
pruefe("X3 Umlaut-Fall hat einen Vorschlag", vLue.length >= 1, "" + vLue.length);
pruefe("X4 Umlaut-Fall schlaegt Mira Grünbaum vor",
       vLue[0] && vLue[0].name === "Mira Grünbaum", vLue[0] && vLue[0].name);
pruefe("X5 Umlaut-Fall ist zuordenbar (steht in der Liste)",
       vLue[0] && vLue[0].in_liste === true);
pruefe("X6 Umlaut-Fall traegt eine Person-Id",
       vLue[0] && vLue[0].person_id === "p-lue", vLue[0] && vLue[0].person_id);
pruefe("X7 Umlaut-Fall nennt seinen Grund",
       vLue[0] && vLue[0].gruende.length >= 2, vLue[0] && vLue[0].gruende.join(" · "));

// --- Der Zweitvorname -------------------------------------------------
const vBro = V["e-bro"] || [];
pruefe("X8 Zweitvorname schlaegt Jonas Feldbach vor",
       vBro[0] && vBro[0].name === "Jonas Feldbach", vBro[0] && vBro[0].name);

// --- Das Turnkind -----------------------------------------------------
const vTur = V["e-tur"] || [];
pruefe("X9 Turnkind wird gefunden",
       vTur[0] && vTur[0].name === "Nele Steinweg", vTur[0] && vTur[0].name);
// ⚠️ Der Unterschied, auf den es ankommt: gefunden ja, zuordenbar nein.
pruefe("X10 Turnkind ist NICHT zuordenbar", vTur[0] && vTur[0].in_liste === false);
pruefe("X11 Turnkind nennt seine Abteilung",
       vTur[0] && /Turnen/.test(vTur[0].herkunft), vTur[0] && vTur[0].herkunft);

// --- Der offene Antrag ------------------------------------------------
const vSag = V["e-sag"] || [];
pruefe("X12 Offener Antrag wird gefunden",
       vSag[0] && vSag[0].name === "Piet Harkort", vSag[0] && vSag[0].name);
pruefe("X13 Offener Antrag ist als solcher gekennzeichnet",
       vSag[0] && vSag[0].antrag === true);
pruefe("X14 Offener Antrag traegt KEINE Person-Id",
       vSag[0] && vSag[0].person_id === null);
pruefe("X15 Offener Antrag nennt sein Eingangsdatum",
       vSag[0] && /2026-09-01/.test(vSag[0].herkunft), vSag[0] && vSag[0].herkunft);

// --- Kein Treffer -----------------------------------------------------
// ⚠️ Der haeufigste echte Fall (07.09.2026: 13 von 18). Ein leeres
// Ergebnis ist hier die richtige Antwort und darf nicht durch einen
// Zufallstreffer ueber das Geburtsdatum verdeckt werden.
pruefe("X16 Ohne Mitgliedschaft gibt es keinen Vorschlag",
       (V["e-nix"] || []).length === 0, JSON.stringify(V["e-nix"]));

// --- Gegenprobe: der Zufallstreffer ----------------------------------
// Ein Turnkind mit exakt demselben Geburtstag wie die herrenlose
// Erklaerung, aber voellig anderem Namen. Ohne die Signal-Schranke
// stuende es als Vorschlag da. ⚠️ Turnen, nicht Fussball -- sonst stuende
// es ohnehin in der Kinderliste und der Vorschlagsweg bliebe ungeprueft.
legeAn("p-zuf", "Gertrud", "Wetterstein", "2011-11-11", "205", "sp-tu");
const antwort2 = await (await W.handleKodexListe({}, env, ADMIN, cors)).json();
pruefe("X17 Gleicher Geburtstag allein erzeugt KEINEN Vorschlag",
       ((antwort2.vorschlaege || {})["e-nix"] || []).length === 0,
       JSON.stringify((antwort2.vorschlaege || {})["e-nix"]));

// --- Hoechstens drei --------------------------------------------------
for (const id of Object.keys(antwort2.vorschlaege || {})) {
  pruefe("X18 Hoechstens " + W.KODEX_VORSCHLAG_ANZAHL + " Vorschlaege je Erklaerung (" +
         id + ")", antwort2.vorschlaege[id].length <= W.KODEX_VORSCHLAG_ANZAHL,
         "" + antwort2.vorschlaege[id].length);
}

// --- Eine belegte Person ---------------------------------------------
// Wird die Erklaerung von Hand zugeordnet, verschwindet die Zeile aus
// "Nicht zuzuordnen" -- und mit ihr der Vorschlag.
db.exec("UPDATE elternkodex_bestaetigung SET person_id = 'p-lue', " +
        "zugeordnet_am = '" + STEMPEL + "', zugeordnet_von = 'pruefer' " +
        "WHERE id = 'e-lue'");
const antwort3 = await (await W.handleKodexListe({}, env, ADMIN, cors)).json();
pruefe("X19 Zugeordnete Erklaerung faellt aus der Karte",
       !(antwort3.offene_eingaenge || []).some((o) => o.id === "e-lue"));
pruefe("X20 Fuer sie gibt es auch keinen Vorschlag mehr",
       !(antwort3.vorschlaege || {})["e-lue"]);

// ⚠️ Und das Kind ist jetzt belegt: ein Vorschlag darauf darf keinen
// Zuordnen-Knopf mehr anbieten, sonst antwortet der Server 409.
erklaerung("e-lue2", "Mira", "Gruenbaum", "2012-03-04", "C1-Junioren");
const antwort4 = await (await W.handleKodexListe({}, env, ADMIN, cors)).json();
const vLue2 = ((antwort4.vorschlaege || {})["e-lue2"] || [])
  .find((v) => v.person_id === "p-lue");
pruefe("X21 Belegtes Kind wird weiter vorgeschlagen", !!vLue2);
pruefe("X22 Belegtes Kind ist als belegt gekennzeichnet", vLue2 && vLue2.belegt === true);

// ======================================================================
console.log("Y  Die Rechtegrenze");
// ======================================================================

const rPass = await W.ladeRolle(env, PASS);
pruefe("Y1 Passstelle darf lesen", rPass.darfNachwuchs === true);
pruefe("Y2 Passstelle darf NICHT schreiben", rPass.darfSchreiben === false);

const antwortPass = await (await W.handleKodexListe({}, env, PASS, cors)).json();
// ⚠️ Der Vorschlag greift in den GESAMTEN Bestand -- Erwachsene, andere
// Abteilungen, offene Antraege. Dieselbe Antwort verweigert der
// Passstelle an anderer Stelle sogar die Mitgliedsnummer.
pruefe("Y3 Passstelle bekommt die Liste", Array.isArray(antwortPass.kinder));
pruefe("Y4 Passstelle bekommt KEINE Vorschlaege",
       Object.keys(antwortPass.vorschlaege || {}).length === 0,
       JSON.stringify(antwortPass.vorschlaege));
// Gegenprobe: es gaebe welche zu holen -- ohne sie waere Y4 auch dann
// gruen, wenn gar keine Erklaerung offen waere.
pruefe("Y5 Gegenprobe: fuer die Geschaeftsstelle gibt es welche",
       Object.keys(antwort4.vorschlaege || {}).length > 0);
// Und die Namen duerfen auch sonst nirgends in ihrer Antwort stehen.
pruefe("Y6 Der Volljaehrige taucht in ihrer Antwort nirgends auf",
       !JSON.stringify(antwortPass).includes("Wetterstein"));

// ======================================================================
console.log("Z  Die Oberflaeche");
// ======================================================================

// ⚠️ Eine gruene Zusage auf ein Feld der Antwort belegt nicht, dass es
// jemand zu sehen bekommt -- genau dieser Fehler ist am 18.08.2026 mit
// dem Chip in "Nicht zuzuordnen" passiert.
const kv = readFileSync(REPO + "/kodex-verwaltung.js", "utf8");
const idx = readFileSync(REPO + "/index.html", "utf8");
const cfg = readFileSync(REPO + "/config.js", "utf8");
const css = readFileSync(REPO + "/style.css", "utf8");

pruefe("Z1 Die Oberflaeche zeichnet eine Vorschlagszeile",
       /function koVorschlagZeile\(/.test(kv));
pruefe("Z2 Sie liest koDaten.vorschlaege",
       /koDaten\.vorschlaege/.test(kv));
pruefe("Z3 Sie haengt an der Karte 'Nicht zuzuordnen'",
       /koVorschlagZeile\(b, KO_OFFEN_SPALTEN\)/.test(kv));
pruefe("Z4 Der Zuordnen-Knopf ist verdrahtet",
       /data-ko-uebernehmen/.test(kv) && /uebernimmVorschlag\(/.test(kv));
pruefe("Z5 Der Knopf fragt vor dem Zuordnen zurueck",
       /async function uebernimmVorschlag[\s\S]{0,400}confirm\(/.test(kv));
pruefe("Z6 Ohne Schreibrecht wird nichts gezeichnet",
       /if \(!koDaten\.darf_schreiben\) return "";/.test(kv));
pruefe("Z7 Der leere Fall wird ausdruecklich benannt",
       /Wahrscheinlich ist das Kind gar nicht angemeldet/.test(kv));
pruefe("Z8 Der Knopf erscheint nur fuer ein Kind der Liste",
       /v\.in_liste && !v\.belegt && v\.person_id/.test(kv));

// Die Spaltenzahl der Vorschlagszeile muss zur Kopfzeile passen -- sonst
// steht die Zeile schmaler als die Tabelle.
//
// ⚠️ Gezaehlt wird der Kopf-String selbst, nicht "alles bis zum naechsten
// </tr>": diese aeltere Fassung lief ueber die Konstante hinaus und zaehlte
// das `<th` aus `<thead>` und aus der Zaehl-Regex mit -- 9 statt 7.
// Und `<th[\s>]` statt `<th`, sonst faengt `<thead>` wieder mit.
const kopf = (kv.match(/const KO_OFFEN_KOPF =([\s\S]*?);/) || ["", ""])[1];
pruefe("Z9 Die Kopfzeile hat sieben Spalten",
       (kopf.match(/<th[\s>]/g) || []).length === 7,
       "" + (kopf.match(/<th[\s>]/g) || []).length);
// ⚠️ Nicht "steht auf 7" pruefen. Genau das stand hier bis zum 10.09.2026,
// und die Zahl war von Hand eingetragen -- eine neue Spalte in der Kopfzeile
// haette die Vorschlagszeile darunter aufbrechen lassen, ohne dass eine
// einzige Zusage rot geworden waere. Geprueft wird jetzt der Rechenweg, und
// die Probe zaehlt selbst nach.
pruefe("Z10 KO_OFFEN_SPALTEN wird aus der Kopfzeile gezaehlt",
       /KO_OFFEN_SPALTEN = \(KO_OFFEN_KOPF\.match\(/.test(kv));
// Und der Kopf-String wird auch wirklich eingesetzt, statt daneben zu liegen.
pruefe("Z10b Die Tabelle benutzt genau diesen Kopf",
       /<thead><tr>' \+\s*\n?\s*KO_OFFEN_KOPF \+/.test(kv));

pruefe("Z11 Die Karte erklaert die Vorschlaege", /Vorschläge aus der/.test(idx));
pruefe("Z12 Der Info-Reiter nennt sie", /Vorschläge aus dem Mitgliederbestand/.test(cfg));
pruefe("Z13 Der Changelog nennt sie", /schlägt jetzt Kinder vor/.test(cfg));
pruefe("Z14 Die Vorschlagszeile hat eine eigene Regel",
       /tr\.ko-vorschlag > td/.test(css));
// ⚠️ `th, td` tragen flottenweit `white-space: nowrap`. Ohne die Aufhebung
// bestimmt der laengste Satz die Breite der ganzen Tabelle -- im Browser
// gemessen 1216 px statt 736, und der Zuordnen-Knopf lag hinter der
// Laufleiste.
pruefe("Z14b Der Fliesstext darf umbrechen",
       /tr\.ko-vorschlag > td \{[\s\S]*?white-space: normal;[\s\S]*?\}/.test(css));
// Am Handy ist die Tabelle breiter als das Bild. Gemessen bei 375 px:
// Huelle 318 px, Inhalt 303 px, zwei Pixel Luft.
pruefe("Z14c Der Inhalt klebt am linken Rand und bleibt im Bild",
       /\.ko-vorschlag-inhalt \{[\s\S]*?position: sticky;[\s\S]*?left: 0;[\s\S]*?max-width:[\s\S]*?\}/
         .test(css));

// ⚠️ Cache-Bust: ohne ihn zieht der Browser das alte Skript und die
// Vorschlaege kommen an, ohne dass jemand sie sieht.
// kodex-verwaltung.js steht nur in einer einzigen Seite -- ein Quervergleich
// wie unten geht hier nicht. Statisch pruefbar ist nur, DASS eine Fassung
// dranhaengt; ob sie zur letzten Aenderung passt, sieht keine Regex.
pruefe("Z15 kodex-verwaltung.js traegt eine Fassung",
       /kodex-verwaltung\.js\?v=[0-9]+\.[0-9]+/.test(idx));
// style.css haengt in sechs Seiten -- da zaehlt wieder die Uebereinstimmung.
{
  const seiten = ["index.html", "antrag.html", "buchhaltung.html",
                  "kodex.html", "nachwuchs.html", "vorstand.html"];
  const staende = new Map();
  for (const datei of seiten) {
    const m = readFileSync(REPO + "/" + datei, "utf8").match(/style\.css\?v=([0-9.]+)/);
    if (m) staende.set(datei, m[1]);
  }
  const zeige = [...staende].map(([d, v]) => d + "=" + v).join(" ");
  pruefe("Z16 Jede Seite nennt eine style.css-Fassung",
         staende.size === seiten.length, zeige);
  pruefe("Z16b Alle Seiten ziehen dieselbe style.css",
         new Set(staende.values()).size === 1, zeige);
}
// ⚠️ Hier stand eine feste Zahl (2.7). Beim naechsten Bump wurde die Zusage
// rot, obwohl der Cache-Bust stimmte -- und ein Pruefstand, der immer rot
// ist, wird beim naechsten Mal ueberlesen. Geprueft wird deshalb, worauf es
// wirklich ankommt: dass ALLE Seiten dieselbe Fassung ziehen. Zieht eine
// Seite eine alte, sieht genau deren Besucher die Aenderung nicht.
{
  const seiten = ["index.html", "buchhaltung.html", "vorstand.html"];
  const staende = new Map();
  for (const datei of seiten) {
    const t = readFileSync(REPO + "/" + datei, "utf8");
    const m = t.match(/config\.js\?v=([0-9.]+)/);
    if (m) staende.set(datei, m[1]);
  }
  pruefe("Z17 Jede Seite mit config.js nennt eine Fassung",
         staende.size === seiten.length,
         [...staende].map(([d, v]) => d + "=" + v).join(" "));
  pruefe("Z17b Alle Seiten ziehen dieselbe config.js",
         new Set(staende.values()).size === 1,
         [...staende].map(([d, v]) => d + "=" + v).join(" "));
}
// (Der Quervergleich ueber alle sechs Seiten steht oben bei Z16b -- die
// frueheren Z18-Zusagen gegen die feste 1.3 sind darin aufgegangen.)

// ----------------------------------------------------------------------
// Und jetzt die Zeile wirklich zeichnen.
//
// ⚠️ Ein Grep auf den Dateitext belegt nur, dass Code DASTEHT. Ob dabei
// ein Knopf herauskommt, sagt er nicht -- deshalb wird koVorschlagZeile
// hier mit den ECHTEN Helfern aus app.js aufgerufen und das Ergebnis
// gelesen. (Die Datei enthaelt nur Deklarationen, kein Aufruf beim Laden.)
const appQuelle = readFileSync(REPO + "/app.js", "utf8");
const escQuelle = (appQuelle.match(/function esc\(wert\)[\s\S]*?\n\}/) || [""])[0];
const datQuelle = (appQuelle.match(/function datumDe\(iso\)[\s\S]*?\n\}/) || [""])[0];
pruefe("Z19 Die echten Helfer sind aus app.js geholt",
       !!escQuelle && !!datQuelle);

const R = new Function(
  escQuelle + "\n" + datQuelle + "\n" + kv +
  ";\nreturn { koVorschlagZeile, setze: (d) => { koDaten = d; } };")();

function zeichne(darfSchreiben, eintrag, treffer) {
  R.setze({ darf_schreiben: darfSchreiben, vorschlaege: { [eintrag.id]: treffer } });
  return R.koVorschlagZeile(eintrag, 7);
}
const EIN = { id: "e-1", zugeordnet: false, andere_abteilung: false };
const KAND = {
  person_id: "p-lue", name: "Mira Grünbaum", geburtsdatum: "2012-03-04",
  herkunft: "Fußball, steht in der Liste", in_liste: true, belegt: false,
  antrag: false, punkte: 156,
  gruende: ["Geburtstag gleich", "1 Namensteil nur anders geschrieben"]
};

const h1 = zeichne(true, EIN, [KAND]);
pruefe("Z20 Die gezeichnete Zeile spannt sieben Spalten",
       /colspan="7"/.test(h1), h1.slice(0, 80));
pruefe("Z20b Der Inhalt steckt in der klebenden Huelle",
       /<td colspan="7"><div class="ko-vorschlag-inhalt">/.test(h1), h1.slice(0, 120));
pruefe("Z21 Der Name steht drin", /Mira Grünbaum/.test(h1));
pruefe("Z22 Das Geburtsdatum steht deutsch drin", /04\.03\.2012/.test(h1), h1);
pruefe("Z23 Der Grund steht drin", /Geburtstag gleich · 1 Namensteil/.test(h1));
pruefe("Z24 Es gibt einen Zuordnen-Knopf",
       /data-ko-person="p-lue"[\s\S]*?zuordnen<\/button>/.test(h1), h1);

// ⚠️ Die drei Faelle, in denen KEIN Knopf erscheinen darf.
const h2 = zeichne(true, EIN, [{ ...KAND, belegt: true }]);
pruefe("Z25 Belegtes Kind: kein Knopf, sondern ein Hinweis",
       !/data-ko-person/.test(h2) && /hat schon eine eigene Erklärung/.test(h2), h2);

const h3 = zeichne(true, EIN, [{ ...KAND, in_liste: false, herkunft: "Turnen" }]);
pruefe("Z26 Anderes Kind: kein Knopf",
       !/data-ko-person/.test(h3) && /andere Abteilung/.test(h3), h3);

const h4 = zeichne(true, EIN, [{ ...KAND, in_liste: false, person_id: null,
                                 antrag: true, herkunft: "Aufnahmeantrag vom 2026-09-01" }]);
pruefe("Z27 Offener Antrag: kein Knopf, Verweis auf den Beschluss",
       !/data-ko-person/.test(h4) && /Vorstandsbeschluss/.test(h4), h4);

pruefe("Z28 Ohne Treffer kommt der Satz zur fehlenden Anmeldung",
       /nicht angemeldet/.test(zeichne(true, EIN, [])));
pruefe("Z29 Beim Vermerk 'andere Abteilung' bleibt die Zeile leer",
       zeichne(true, { ...EIN, andere_abteilung: true }, []) === "");
pruefe("Z30 Eine zugeordnete Erklaerung bekommt keine Zeile",
       zeichne(true, { ...EIN, zugeordnet: true }, [KAND]) === "");
pruefe("Z31 Ohne Schreibrecht bleibt die Zeile leer",
       zeichne(false, EIN, [KAND]) === "");

// ⚠️ Gegenprobe zum Escaping: ein Name mit spitzer Klammer darf als TEXT
// dastehen, nicht als Markup. Der Vorschlag zeigt Namen aus der
// Datenbank, und dort steht, was der Import geliefert hat.
const h5 = zeichne(true, EIN, [{ ...KAND, name: '<img src=x onerror=1>' }]);
pruefe("Z32 Der Name wird escaped", /&lt;img/.test(h5) && !/<img/.test(h5), h5);

// ======================================================================
console.log("P  Der Vorfilter: Aequivalenz und Schranke");
// ======================================================================

// ⚠️ WARUM DIESER ABSCHNITT EXISTIERT (11.09.2026). kodexVorschlaege hat
// jede offene Erklaerung gegen den GESAMTEN Mitgliederpool bewertet, mit
// einer Levenshtein-Rechnung darin. Genau diese Bauart hat beim
// DFBnet-Abgleich den Worker umgebracht: 146 x 540 = 78.840 Bewertungen,
// 223 ms reine Rechenzeit, harter Abbruch, keine CORS-Kopfzeilen -- im
// Browser stand nur "Server nicht erreichbar".
//
// Beim Elternkodex sind es heute ein bis zwei Dutzend Erklaerungen. Es
// laeuft. Es ist trotzdem dieselbe Landmine, sobald der Link an mehr
// Eltern geht. Seit heute laeuft die Bewertung auch hier ueber
// namensIndex / namensKandidaten.
//
// ⚠️ Bewiesen wird das als AEQUIVALENZ, nicht als Vermutung: derselbe
// Bestand einmal vollstaendig durchgerechnet, einmal ueber den Index --
// Punkte und Begruendungen zeichengleich. Und dazu eine SCHRANKE auf die
// Zahl der bewerteten Paare. Ohne die bliebe die Aequivalenz auch dann
// gruen, wenn jemand den Index gegen "nimm einfach alle" tauscht.
//
// ⚠️ ALLE Namen und Geburtsdaten hier sind ERFUNDEN, aus Silben gebaut.

const pSilben = ["berg", "feld", "horn", "stein", "bach", "wald", "moor", "tal",
                 "kamp", "rode", "sund", "heide", "furt", "au", "lohe", "brink"];
const pVor = ["Anouk", "Bendix", "Cosima", "Dorian", "Elvira", "Falk", "Greta",
              "Hinnerk", "Ilvy", "Joris", "Karlotta", "Lennart", "Maja", "Nusret",
              "Odile", "Pepijn"];

function pName(i) {
  const vorname = pVor[i % pVor.length] + (i % 7 === 0 ? "a" : "");
  const nachname = pSilben[i % pSilben.length] +
                   pSilben[(i * 5 + 2) % pSilben.length] + "z" + i;
  return [vorname, nachname];
}
function pGeb(i) {
  return (2008 + (i % 10)) + "-0" + (1 + (i % 9)) + "-1" + (i % 9);
}

// 540 erfundene Mitglieder. Der Nachname traegt die laufende Zahl, damit
// KEIN Gleichstand aus gleichem Namen UND gleicher Punktzahl entsteht --
// sonst haengt die Reihenfolge an der Poolreihenfolge und die beiden
// Wege waeren nur zufaellig vergleichbar.
sparte("sp-p", "Turnen-Pruefstand");
for (let i = 0; i < 540; i++) {
  const [v, n] = pName(i);
  legeAn("q" + i, v, n, pGeb(i), "9" + (1000 + i), "sp-p");
}

// Die ersten 60 stehen zusaetzlich in der Fussball-Kinderliste -- wie im
// echten Lauf, wo `kinder` getrennt hereingereicht wird.
const pKinder = [];
for (let i = 0; i < 60; i++) {
  const [v, n] = pName(i);
  pKinder.push({ person_id: "q" + i, vorname: v, nachname: n,
                 geburtsdatum: pGeb(i), bestaetigung_id: i % 4 === 0 ? "b" + i : null });
}

// 120 offene Erklaerungen: gleich viele ueber jede der drei Stufen, dazu
// ein Fuenftel, das zu niemandem passt.
const pOffene = [];
for (let i = 0; i < 120; i++) {
  const [v, n] = pName((i * 4) % 540);
  const g = pGeb((i * 4) % 540);
  let vorname = v, nachname = n, geb = g;
  if (i % 5 === 0) {
    vorname = v.replace(/a/, "ä");              // nur anders geschrieben
  } else if (i % 5 === 1) {
    nachname = n.slice(0, -1) + "7";            // Tippfehler
  } else if (i % 5 === 2) {
    const t = g.split("-");
    geb = t[0] + "-" + t[2] + "-" + t[1];       // Tag und Monat vertauscht
  } else if (i % 5 === 3) {
    vorname = v + " Marie";                     // Zweitvorname zuviel
  } else {
    vorname = "Xanthippa" + i;                  // gar kein Treffer
    nachname = "Unverwechselbar" + i;
    geb = "1948-03-0" + (1 + (i % 9));
  }
  pOffene.push({ id: "po" + i, kind_vorname: vorname, kind_nachname: nachname,
                 kind_geburtsdatum: geb, zugeordnet: false });
}

// --- Einzelfaelle, die je GENAU EINEN Schluesseltyp brauchen ----------
//
// ⚠️ Ohne diese drei war die Aequivalenz-Zusage zahnlos. Gemessen: die
// 120 gebauten Faelle oben finden ihren Treffer ueber MEHRERE Schluessel
// gleichzeitig -- die Mutationsproben "Datumsschluessel raus" und
// "harter Namensschluessel raus" blieben deshalb beide gruen. Die
// Aequivalenz stimmte, aber sie hat nichts bewacht.
//
// ⚠️ Und die Enden-Schluessel schlucken den harten Schluessel mit, weil
// namensSchluesselFuer erst kodexHart rechnet und DANN die drei Zeichen
// abschneidet. Der harte Schluessel traegt also nur bei Namen, die nach
// kodexHart KUERZER ALS VIER Zeichen sind -- genau so ist Fall A gebaut.
const pEinzeln = [
  // A) Nur "h:". Zwei kurze Namensteile, Umlaut weggelassen, Geburtsdatum
  //    verschieden -- kein Datumsschluessel, und fuer v:/n: sind die
  //    harten Formen "ida"/"boh" zu kurz. 30 + 26 = 56 Punkte.
  { id: "pe-h", person: ["Ida", "Böh", "2014-06-07"],
    erklaerung: ["Ida", "Boh", "2011-02-03"] },
  // B) Nur "d:". Beide Namensteile mit Levenshtein-Abstand 2, veraendert
  //    am ERSTEN und am LETZTEN Zeichen -- damit greift weder h: noch
  //    v:/n:. 100 + 12 + 12 = 124 Punkte.
  { id: "pe-d", person: ["Roswitha", "Kornblum", "2013-05-12"],
    erklaerung: ["Zoswithz", "Zornbluz", "2013-05-12"] },
  // C) Nur "d:" mit vertauschtem Tag und Monat. Dieselben Namen, das
  //    Datum gedreht. 60 + 12 + 12 = 84 Punkte.
  { id: "pe-dg", person: ["Wilhelmine", "Talbrink", "2013-05-12"],
    erklaerung: ["Zilhelminz", "Zalbrinz", "2013-12-05"] }
];
pEinzeln.forEach((f, i) => {
  legeAn("qe" + i, f.person[0], f.person[1], f.person[2], "95" + i, "sp-p");
  pOffene.push({ id: f.id, kind_vorname: f.erklaerung[0],
                 kind_nachname: f.erklaerung[1],
                 kind_geburtsdatum: f.erklaerung[2], zugeordnet: false });
});

// --- Der echte Lauf, ueber den Index ---------------------------------
W.kodexZaehler.paare = 0;
const pEcht = await W.kodexVorschlaege(env, pOffene, pKinder);
const pPaareIndex = W.kodexZaehler.paare;

// --- Das eigene Orakel: derselbe Pool, vollstaendig durchgerechnet ----
//
// ⚠️ Der Pool wird hier NICHT aus der Fixture nachgebaut, sondern aus der
// Datenbank gelesen -- mit eigenem SQL. Nachgebaut aus dem, was ich
// eingefuegt zu haben glaube, waere er kein Orakel, sondern eine zweite
// Abschrift derselben Annahme.
const pPool = [];
const pGesehen = new Set();
for (const k of pKinder) {
  pGesehen.add(k.person_id);
  pPool.push({ person_id: k.person_id,
               name: (k.vorname + " " + k.nachname).trim(),
               geburtsdatum: k.geburtsdatum,
               teile: W.kodexTeileListe(k.vorname, k.nachname) });
}
for (const m of db.prepare(
  "SELECT p.id, p.vorname, p.nachname, p.geburtsdatum FROM mitgliedschaft m " +
  "JOIN person p ON p.id = m.person_id GROUP BY m.id").all()) {
  if (pGesehen.has(m.id)) continue;
  pGesehen.add(m.id);
  pPool.push({ person_id: m.id,
               name: ((m.vorname || "") + " " + (m.nachname || "")).trim(),
               geburtsdatum: m.geburtsdatum,
               teile: W.kodexTeileListe(m.vorname, m.nachname) });
}
for (const a of db.prepare(
  "SELECT antrag_json FROM aufnahmeantrag WHERE person_id IS NULL " +
  "AND status IN ('neu','geprueft')").all()) {
  let inhalt = {};
  try { inhalt = JSON.parse(a.antrag_json || "{}"); } catch { inhalt = {}; }
  const teile = W.kodexTeileListe(inhalt.vorname, inhalt.nachname);
  if (!teile.length) continue;
  pPool.push({ person_id: null,
               name: ((inhalt.vorname || "") + " " + (inhalt.nachname || "")).trim(),
               geburtsdatum: String(inhalt.geburtsdatum || "").slice(0, 10),
               teile });
}

function pSchluessel(v) {
  return String(v.person_id) + "|" + v.name + "|" + v.punkte + "|" + v.gruende.join(",");
}

// Der vollstaendige Lauf: jede Erklaerung gegen JEDEN Pooleintrag.
W.kodexZaehler.paare = 0;
const pVoll = {};
let pTreffer = 0;
for (const o of pOffene) {
  const teile = W.kodexTeileListe(o.kind_vorname, o.kind_nachname);
  if (!teile.length) continue;
  const bewertet = [];
  pPool.forEach((p, rang) => {
    if (!p.teile.length) return;
    const a = W.kodexAehnlichkeit(teile, o.kind_geburtsdatum, p.teile, p.geburtsdatum);
    if (a.signale < 1 || a.punkte < W.KODEX_VORSCHLAG_PUNKTE) return;
    bewertet.push({ person_id: p.person_id, name: p.name,
                    punkte: a.punkte, gruende: a.gruende, rang });
  });
  bewertet.sort((x, y) => y.punkte - x.punkte ||
    (x.name < y.name ? -1 : x.name > y.name ? 1 : 0) || x.rang - y.rang);
  pTreffer += bewertet.length;
  pVoll[o.id] = bewertet.slice(0, W.KODEX_VORSCHLAG_ANZAHL).map(pSchluessel);
}
const pPaareVoll = W.kodexZaehler.paare;

// ⚠️ GEGENPROBE ZUERST. Ohne sie waere P2 auch dann gruen, wenn beide
// Wege nichts finden -- und der Vorfilter waere ungeprueft.
// Gebaut sind 120 Erklaerungen, vier Fuenftel davon mit einem Treffer:
// 96. Gezaehlt wird gegen 80, damit die Zusage nicht an der Fixture
// klebt -- aber hoch genug, dass ein stummer Lauf sie rot faerbt.
pruefe("P1 Gegenprobe: der vollstaendige Lauf findet ueberhaupt Vorschlaege",
       pTreffer > 80, pTreffer + " Treffer");

let pAbweichungen = 0, pBeispiel = "";
for (const o of pOffene) {
  const voll = (pVoll[o.id] || []).join(";");
  const idx = (pEcht[o.id] || []).map(pSchluessel).join(";");
  if (voll !== idx) {
    pAbweichungen++;
    if (!pBeispiel) pBeispiel = o.id + ": voll [" + voll + "] / index [" + idx + "]";
  }
}
// ⚠️ Gegenprobe zu den Einzelfaellen: sie muessen ueberhaupt einen
// Vorschlag ergeben. Faenden sie keinen, waeren sie in P2 zwei leere
// Listen -- gleich, aber ohne Aussage, und die Mutationsproben blieben
// wieder gruen.
pEinzeln.forEach((f, i) => {
  const v = (pEcht[f.id] || []).find((x) => x.person_id === "qe" + i);
  pruefe("P1" + String.fromCharCode(97 + i) + " Einzelfall " + f.id +
         " findet seinen Partner", !!v,
         JSON.stringify(pEcht[f.id]));
});

pruefe("P2 Bei " + pOffene.length + " Erklaerungen liefert der Index zeichengleich " +
       "dasselbe wie der volle Lauf",
       pAbweichungen === 0, pAbweichungen + " Abweichungen, z. B. " + pBeispiel);

// ⚠️ DIE SCHRANKE. Ohne sie koennte jemand namensKandidaten gegen "nimm
// einfach alle" tauschen: P2 bliebe gruen, der Worker stuerbe wieder.
// Gemessen an dieser Fixture: 3.933 bewertete Paare statt 67.527.
//
// MUTATIONSPROBEN, alle am 11.09.2026 wirklich gefahren:
//   Index gegen "nimm einfach alle"        -> P3 und P6 rot
//   Index je Erklaerung statt einmal       -> P5 rot
//   beide Datumsschluessel raus            -> P1b, P1c, P2 rot
//   harter Namensschluessel raus           -> P1a, P2 rot
//   Enden-Schluessel (v:/n:) raus          -> GRUEN, und das ist richtig
//
// ⚠️ Der letzte Punkt ist kein Loch, sondern die ehrliche Lage: ein
// reiner Tippfehler wiegt 12 Punkte, die Schwelle liegt bei 50. Ein
// Vorschlag entsteht ohnehin nur mit passendem Datum oder einem exakt
// gleichen Namensteil -- beides exakte Schluessel. Die Enden sind eine
// Reserve fuer den Tag, an dem jemand die Gewichte aendert. Genauso
// steht es im Worker und in der CLAUDE.md.
//
// ⚠️ Grosszuegig angesetzt: dieser Bestand ist aus sechzehn Silben
// gebaut und teilt deshalb viel mehr Namensanfaenge als ein echter.
pruefe("P3 Der echte Lauf bewertet einen Bruchteil der Paare",
       pPaareIndex < pPaareVoll / 10,
       pPaareIndex + " statt " + pPaareVoll);
// Und die Gegenrechnung von Hand, damit die Zahl nicht nur relativ ist.
pruefe("P4 Gegenprobe zur Schranke: der volle Lauf ist wirklich das Produkt",
       pPaareVoll === pOffene.length * pPool.length,
       pPaareVoll + " gegen " + (pOffene.length * pPool.length));

// ⚠️ Der Index wird EINMAL gebaut, nicht je Erklaerung. Im Schleifenkoerper
// waere er derselbe quadratische Lauf in gruen -- und P3 bliebe trotzdem
// gruen, weil die gezaehlten PAARE dieselben blieben.
const pQuelle = readFileSync(REPO + "/vereinsverwaltung-worker.js", "utf8");
const pRumpf = pQuelle.slice(pQuelle.indexOf("async function kodexVorschlaege"));
const pKopf = pRumpf.slice(0, pRumpf.indexOf("\n  const ergebnis = {};"));
pruefe("P5 Der Index entsteht VOR der Schleife ueber die Erklaerungen",
       /namensIndex\(pool\)/.test(pKopf), "nicht vor 'const ergebnis' gefunden");
pruefe("P6 In der Schleife wird nicht mehr ueber den ganzen Pool gelaufen",
       !/for \(const p of pool\)/.test(pRumpf.slice(0, pRumpf.indexOf("\n}\n"))));

// --- Die drei Stufen einzeln, durch die ECHTE Funktion ---------------
async function pEine(vorname, nachname, geb) {
  const r = await W.kodexVorschlaege(
    env, [{ id: "px", kind_vorname: vorname, kind_nachname: nachname,
            kind_geburtsdatum: geb, zugeordnet: false }], pKinder);
  return r["px"] || [];
}
const [pV0, pN0] = pName(300);
const pG0 = pGeb(300);
pruefe("P7 Umlaut-Variante ueberlebt den Vorfilter",
       (await pEine(pV0.replace(/a/, "ä"), pN0, pG0)).length > 0);
pruefe("P8 Zweitvorname zuviel ueberlebt den Vorfilter",
       (await pEine(pV0 + " Marie", pN0, pG0)).length > 0);
pruefe("P9 Tippfehler am Wortende ueberlebt den Vorfilter",
       (await pEine(pV0, pN0.slice(0, -1) + "7", pG0)).length > 0);
pruefe("P10 Tippfehler am Wortanfang ueberlebt den Vorfilter",
       (await pEine(pV0, "z" + pN0.slice(1), pG0)).length > 0);
const pT0 = pG0.split("-");
pruefe("P11 Vertauschter Tag und Monat ueberlebt den Vorfilter",
       (await pEine(pV0, pN0, pT0[0] + "-" + pT0[2] + "-" + pT0[1])).length > 0);
// ⚠️ Der Sortierschluessel _rang ist nur fuer die Reihenfolge da und
// darf die Antwort nicht verlassen -- sonst stuende eine Poolposition in
// der JSON, die niemanden etwas angeht und die der Client nicht kennt.
const pFelder = Object.keys((pEcht["po0"] || [{}])[0] || {});
pruefe("P11b Die Antwort traegt keinen Sortierschluessel",
       pFelder.length > 0 && !pFelder.includes("_rang"), pFelder.join(", "));

pruefe("P12 Wer zu niemandem passt, bekommt weiterhin nichts",
       (await pEine("Xaverina", "Unverwechselbar", "1901-01-01")).length === 0);

// ⚠️ Und der Zufallstreffer bleibt draussen: gleicher Geburtstag, voellig
// anderer Name. Der Index laesst ihn durch (Datumsschluessel), die
// Signal-Schranke in kodexVorschlaege wirft ihn heraus -- das ist die
// Arbeitsteilung, und sie muss so bleiben.
pruefe("P13 Gleicher Geburtstag allein erzeugt auch hier KEINEN Vorschlag",
       (await pEine("Xaverina", "Unverwechselbar", pG0)).length === 0,
       JSON.stringify(await pEine("Xaverina", "Unverwechselbar", pG0)));

// ======================================================================
console.log("");
console.log("Zusagen: " + ok + " gruen, " + fehler + " rot");
if (fehler) {
  console.log("");
  for (const f of fehlerListe) console.log("  ROT  " + f);
  process.exit(1);
}
