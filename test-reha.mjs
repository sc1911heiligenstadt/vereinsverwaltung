// Pruefstand fuer die Rehasportdaten aus der Verbandserhebung (2026-08-10).
//
// Faehrt den ECHTEN Client-Code aus reha.js und lsb.js sowie den ECHTEN
// Worker-Ausdruck alterSql() -- nichts davon ist nachgebaut.
//
//   node test-reha.mjs
//
// ⚠️ Das Raster ist ERFUNDEN und muss es bleiben. Die echte Erhebung
// nennt die Jahrgangsstaerken des Vereins; sie gehoert nicht in ein
// oeffentliches Repository. Der Aufbau der Vorlage ist dagegen
// originalgetreu nachgebildet -- einschliesslich der Falle, dass die
// Ueberschrift der Kontrollspalte selbst beide Sportarten nennt.
//
// Abschnitte:
//   A  Die Vorlage lesen: Bloecke, Summen, Stichtag
//   B  Die Kontrollspalte wird nicht mitgezaehlt (mit Gegenprobe)
//   C  Altersumrechnung ist bitgleich zu alterSql() im Worker
//   D  Meldezeilen: Raster, Optionen, Summen
//   E  Portal-Platzhalter: Anzahl, Format, Sportartennummer
//   F  Kaputte Dateien werden gemeldet, nicht verschluckt
//   G  lsbCsvText traegt die Rehazeilen, ohne die alte Datei zu aendern
//   H  Beide Seiten laden denselben Code, und nur den

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

// --- Den echten Code laden -------------------------------------------

const REHA_QUELLE = readFileSync(REPO + "/reha.js", "utf8");
const REHA_NAMEN = ["rehaRasterLesen", "rehaAlterZum", "rehaAltersgruppe", "rehaMeldeZeilen",
                    "rehaPortalZeilen", "rehaGesamt", "rehaBloeckeAuswahl", "rehaDatumDe",
                    "rehaZahl", "REHA_ALTERSGRUPPEN", "REHA_GEMELDET", "REHA_PLATZHALTER_TAG"];
function ladeReha(quelle) {
  return new Function(quelle + "\nreturn {" + REHA_NAMEN.join(",") + "};")();
}
const R = ladeReha(REHA_QUELLE);

// lsb.js haengt an window-Dingen, die es hier nicht gibt -- gezogen wird
// deshalb nur die reine Zeichenketten-Funktion samt ihrer Konstanten.
const LSB_QUELLE = readFileSync(REPO + "/lsb.js", "utf8");
const L = new Function(LSB_QUELLE.replace(/document\.addEventListener[\s\S]*$/, "") +
  "\nreturn {lsbCsvText, LSB_KOPF, LSB_SPALTEN_FUER_NUMMERN};")();

// --- Ein Raster im Aufbau der Verbandsvorlage -------------------------

function zeile(werte) {
  const max = Math.max(...Object.keys(werte).map(Number));
  const z = new Array(max + 1).fill(null);
  for (const [i, w] of Object.entries(werte)) z[Number(i)] = w;
  return z;
}

// ⚠️ Genau dieser Wortlaut ist die Falle: die Kontrollspalte nennt in
// ihrer eigenen Ueberschrift "Behinderten- und Rehabilitationssport".
const KONTROLL_TITEL = "Gesamtmitglieder\nim Verein\n(alle aktiven, passiven und sonstige " +
                       "Mitglieder im Behinderten- und Rehabilitationssport)";

// Erfundener Bestand. m/w je Block, daraus errechnet sich die
// Kontrollspalte.
const TESTJAHRGAENGE = [
  { jahr: 2018, reha: [2, 3], nicht: [0, 1], behind: [1, 0] },
  { jahr: 2005, reha: [0, 0], nicht: [0, 0], behind: [0, 0] },   // leer, faellt raus
  { jahr: 1960, reha: [10, 20], nicht: [1, 2], behind: [0, 0] },
  { jahr: 1950, reha: [5, 5], nicht: [0, 0], behind: [0, 0] }
];

function baueRaster(zusatz) {
  const o = zusatz || {};
  const kopf = { 0: "Jahr", 29: "Alter" };
  for (const s of [1, 5, 8, 11, 14, 17, 20, 23, 26]) {
    kopf[s] = "m"; kopf[s + 1] = "w"; kopf[s + 2] = "ges.";
  }
  const raster = [
    zeile({ 29: { __date: o.stichtag || "2025-12-31" } }),
    zeile({ 0: KONTROLL_TITEL, 5: "Behindertensport", 23: "Rehabilitationssport" }),
    zeile({ 5: "Wettkampfsport", 20: "Breitensport", 23: "Mitglieder", 26: "Nichtmitglieder" }),
    zeile({ 5: "Sportart", 8: "Sportart", 11: "Sportart", 14: "Sportart", 17: "Sportart" }),
    [], [],
    zeile(kopf)
  ];

  const summe = { k: [0, 0], r: [0, 0], n: [0, 0], b: [0, 0] };
  for (const j of TESTJAHRGAENGE) {
    const k = [j.reha[0] + j.nicht[0] + j.behind[0], j.reha[1] + j.nicht[1] + j.behind[1]];
    raster.push(zeile({
      0: j.jahr,
      1: k[0], 2: k[1], 3: k[0] + k[1],                            // Kontrollspalte
      20: j.behind[0], 21: j.behind[1], 22: j.behind[0] + j.behind[1],  // Breitensport
      23: j.reha[0], 24: j.reha[1], 25: j.reha[0] + j.reha[1],     // Reha, Mitglieder
      26: j.nicht[0], 27: j.nicht[1], 28: j.nicht[0] + j.nicht[1], // Reha, Nichtmitglieder
      29: 2025 - j.jahr
    }));
    summe.k[0] += k[0]; summe.k[1] += k[1];
    summe.r[0] += j.reha[0]; summe.r[1] += j.reha[1];
    summe.n[0] += j.nicht[0]; summe.n[1] += j.nicht[1];
    summe.b[0] += j.behind[0]; summe.b[1] += j.behind[1];
  }
  raster.push(zeile({
    0: "S", 1: summe.k[0], 2: summe.k[1], 20: summe.b[0], 21: summe.b[1],
    23: summe.r[0], 24: summe.r[1], 26: summe.n[0], 27: summe.n[1]
  }));
  return raster;
}

const RASTER = baueRaster();
// Von Hand nachgerechnet, damit ein Fehler in baueRaster() nicht
// zugleich die Erwartung verschiebt.
const SOLL = { reha: { m: 17, w: 28 }, reha_nicht: { m: 1, w: 3 },
               behinderten: { m: 1, w: 0 }, kontrolle: { m: 19, w: 31 } };
const SOLL_GESAMT = 50;

// =====================================================================
// A  Die Vorlage lesen
// =====================================================================

const d = R.rehaRasterLesen(RASTER);

pruefe("A1 Stichtag der Erhebung gelesen", d.stichtag === "2025-12-31", String(d.stichtag));
pruefe("A2 Erhebungsjahr abgeleitet", d.erhebungsjahr === 2025, String(d.erhebungsjahr));
pruefe("A3 Leere Jahrgaenge fallen raus", d.jahrgaenge.length === 3,
       d.jahrgaenge.length + " statt 3");
pruefe("A4 Kein Jahrgang 2005 (ueberall null)",
       !d.jahrgaenge.some((j) => j.jahrgang === "2005"));
for (const k of Object.keys(SOLL)) {
  pruefe("A5 Summe " + k, d.summen[k].m === SOLL[k].m && d.summen[k].w === SOLL[k].w,
         JSON.stringify(d.summen[k]) + " statt " + JSON.stringify(SOLL[k]));
}
pruefe("A6 Kontrollspalte gemerkt", d.kontrolle && d.kontrolle.m === 19);
pruefe("A7 Summenzeile der Vorlage gelesen", d.verbandsSumme && d.verbandsSumme.reha.m === 17);
pruefe("A8 Keine Warnung, die Datei geht auf", d.warnungen.length === 0,
       d.warnungen.join(" | "));
pruefe("A9 Jahrgang ist Text, nicht Zahl", typeof d.jahrgaenge[0].jahrgang === "string");

// Die "ges."-Spalten sind Summen und werden bewusst uebergangen -- sonst
// stuende jede Person doppelt in der Meldung.
pruefe("A10 Die ges.-Spalten sind nicht mitgezaehlt",
       d.summen.reha.m + d.summen.reha.w === 45, String(d.summen.reha.m + d.summen.reha.w));

// ⚠️ A10 allein reicht nicht. Beim Gegenlauf fiel auf: liest der Parser
// die "ges."-Spalte MIT, bleiben m und w trotzdem richtig -- die Werte
// landen unter dem Schluessel "ges." und werden nie wieder angefasst.
// Das ist Zufall, kein Schutz: ein Schluessel, den niemand liest, sieht
// von aussen aus wie eine korrekte Ausblendung. Deshalb wird hier
// ausdruecklich geprueft, dass gar nichts anderes entsteht.
for (const b of Object.keys(d.summen)) {
  pruefe("A11 Block " + b + " traegt nur m und w",
         JSON.stringify(Object.keys(d.summen[b]).sort()) === '["m","w"]',
         JSON.stringify(Object.keys(d.summen[b])));
}
pruefe("A12 Auch die Jahrgangszeilen tragen nur m und w",
       d.jahrgaenge.every((j) => R.REHA_GEMELDET.concat("kontrolle").every((b) =>
         JSON.stringify(Object.keys(j[b]).sort()) === '["m","w"]')));

// =====================================================================
// B  Die Kontrollspalte, und die Gegenprobe dazu
// =====================================================================
//
// Beim ersten Lauf gegen die echte Datei stand die Kontrollspalte hinten
// in REHA_BLOECKE. Weil ihre Ueberschrift "Rehabilitationssport" enthaelt,
// wurde sie als Rehasport gelesen und JEDE Person war doppelt in der
// Meldung. Ohne die folgende Mutation waere dieser Abschnitt auch dann
// gruen, wenn die Reihenfolge wieder kippt.

pruefe("B1 Gesamtzahl stimmt", R.rehaGesamt(d, {}) === SOLL_GESAMT,
       R.rehaGesamt(d, {}) + " statt " + SOLL_GESAMT);
pruefe("B2 Kontrollspalte ist kein gemeldeter Block",
       !R.rehaBloeckeAuswahl({}).includes("kontrolle"));
pruefe("B3 Kontrolle = Summe der uebrigen Bloecke",
       SOLL.kontrolle.m === SOLL.reha.m + SOLL.reha_nicht.m + SOLL.behinderten.m &&
       SOLL.kontrolle.w === SOLL.reha.w + SOLL.reha_nicht.w + SOLL.behinderten.w);

{
  // Mutation: die Kontrollspalte faellt durch ihre eigene Regel und
  // landet damit bei der naechsten, die passt -- dem Rehasport.
  const mutiert = REHA_QUELLE.replace("passt: (pfad) => /gesamtmitglieder/i.test(pfad) },",
                                      "passt: (pfad) => false },");
  pruefe("B4 Mutation greift", mutiert !== REHA_QUELLE);
  const M = ladeReha(mutiert);
  const dm = M.rehaRasterLesen(RASTER);
  pruefe("B5 Mutation verdoppelt den Bestand", M.rehaGesamt(dm, {}) === SOLL_GESAMT * 2,
         M.rehaGesamt(dm, {}) + " statt " + SOLL_GESAMT * 2);
  pruefe("B6 Der echte Code tut das nicht", R.rehaGesamt(d, {}) === SOLL_GESAMT);
}

{
  // Geht die Kontrollspalte nicht auf, muss es auffallen: eine von Hand
  // nachgetragene Zahl ist der wahrscheinlichste Fall.
  const schief = baueRaster();
  const kopf = schief.findIndex((z) => String((z || [])[0]).trim() === "Jahr");
  schief[kopf + 1][1] = 99;
  const ds = R.rehaRasterLesen(schief);
  pruefe("B7 Schiefe Kontrollspalte wird gemeldet",
         ds.warnungen.some((w) => /geht nicht auf/i.test(w)), ds.warnungen.join(" | "));
  pruefe("B8 Trotz Warnung bleibt der Bestand richtig",
         R.rehaGesamt(ds, {}) === SOLL_GESAMT, String(R.rehaGesamt(ds, {})));
}

{
  // Dasselbe fuer die Summenzeile der Vorlage.
  const schief = baueRaster();
  const sz = schief.findIndex((z) => String((z || [])[0]).trim() === "S");
  schief[sz][23] = 999;
  const ds = R.rehaRasterLesen(schief);
  pruefe("B9 Schiefe Summenzeile wird gemeldet",
         ds.warnungen.some((w) => /Summenzeile/i.test(w)), ds.warnungen.join(" | "));
}

// =====================================================================
// C  Alter: bitgleich zum Worker
// =====================================================================
//
// Die Anzeige rechnet im Browser, das Portal rechnet aus dem
// Geburtsdatum der Platzhalterzeile. Laufen die beiden auseinander,
// steht in der Meldung eine andere Altersgruppe als in der Vorschau --
// und niemand kann sagen, welche stimmt. Gemessen wird deshalb gegen den
// ECHTEN SQL-Ausdruck des Workers, in SQLite ausgefuehrt.

const workerRoh = readFileSync(REPO + "/vereinsverwaltung-worker.js", "utf8");
const W = new Function(workerRoh.slice(0, workerRoh.indexOf("export default")) +
  "\nreturn {alterSql, altersGruppeSql, ALTERSGRUPPEN, istIsoDatum};")();

pruefe("C1 Altersgruppen stimmen mit dem Worker ueberein",
       JSON.stringify(R.REHA_ALTERSGRUPPEN) === JSON.stringify(W.ALTERSGRUPPEN),
       JSON.stringify(R.REHA_ALTERSGRUPPEN));

{
  const db = new DatabaseSync(":memory:");
  let gleich = 0, ungleich = [];
  for (const stichtag of ["2026-01-01", "2025-12-31", "2026-02-15", "2026-06-30"]) {
    for (let jg = 1930; jg <= 2020; jg++) {
      const geburt = jg + R.REHA_PLATZHALTER_TAG;
      const sql = "SELECT " + W.alterSql(stichtag) + " AS a, " +
                  W.altersGruppeSql(W.alterSql(stichtag)) + " AS g " +
                  "FROM (SELECT '" + geburt + "' AS geburtsdatum) p";
      const r = db.prepare(sql).get();
      const eigen = R.rehaAlterZum(String(jg), stichtag);
      const eigenG = R.rehaAltersgruppe(eigen);
      if (r.a === eigen && r.g === eigenG) gleich++;
      else if (ungleich.length < 3) {
        ungleich.push(stichtag + "/" + jg + ": Worker " + r.a + "/" + r.g +
                      ", Client " + eigen + "/" + eigenG);
      }
    }
  }
  db.close();
  pruefe("C2 364 Jahrgang-Stichtag-Paare bitgleich", ungleich.length === 0 && gleich === 364,
         gleich + " gleich, " + ungleich.join(" | "));
}

// Der Platzhaltertag ist die Jahresmitte, und daran haengt C2: mit dem
// 1. Januar liefe die Rechnung fuer jeden Stichtag ab dem 2. Januar um
// ein Jahr auseinander.
pruefe("C3 Platzhaltertag ist der 1. Juli", R.REHA_PLATZHALTER_TAG === "-07-01",
       R.REHA_PLATZHALTER_TAG);
pruefe("C4 Alter zum 1. Januar folgt dem Vorjahr",
       R.rehaAlterZum("1960", "2026-01-01") === 65, String(R.rehaAlterZum("1960", "2026-01-01")));
pruefe("C5 Alter zum 31. Dezember folgt dem laufenden Jahr",
       R.rehaAlterZum("1960", "2025-12-31") === 65, String(R.rehaAlterZum("1960", "2025-12-31")));
pruefe("C6 Ungueltiger Stichtag liefert null statt einer Zahl",
       R.rehaAlterZum("1960", "Unfug") === null);
pruefe("C7 Ohne Alter faellt es in die Gruppe unbekannt",
       R.rehaAltersgruppe(null) === "unbekannt");

// =====================================================================
// D  Meldezeilen
// =====================================================================

const STICHTAG = "2026-01-01";
const zeilenAlle = R.rehaMeldeZeilen(d, STICHTAG, {});

pruefe("D1 Fuenf Zeilen (drei Bloecke mal belegte Gruppen)", zeilenAlle.length === 5,
       String(zeilenAlle.length));
pruefe("D2 Summe der Zeilen = Summe der Bloecke",
       zeilenAlle.reduce((s, z) => s + z.gesamt, 0) === SOLL_GESAMT,
       String(zeilenAlle.reduce((s, z) => s + z.gesamt, 0)));
pruefe("D3 Jede Zeile ist als Reha gekennzeichnet", zeilenAlle.every((z) => z.reha === true));
pruefe("D4 Das Raster passt zur Serverantwort",
       zeilenAlle.every((z) => ["sparte", "altersgruppe", "w", "m", "d", "ohne", "gesamt"]
         .every((f) => f in z)));
pruefe("D5 Kein Geschlecht divers, keins ohne Angabe",
       zeilenAlle.every((z) => z.d === 0 && z.ohne === 0));
pruefe("D6 Der Rehasport steht vor den Nichtmitgliedern",
       zeilenAlle[0].sparte === "Rehabilitationssport");
pruefe("D7 Jahrgang 2018 landet in 7 bis 14",
       zeilenAlle.some((z) => z.altersgruppe === "7 bis 14" && z.gesamt === 5));
pruefe("D8 1950 und 1960 landen zusammen in ueber 60",
       zeilenAlle.some((z) => z.sparte === "Rehabilitationssport" &&
                              z.altersgruppe === "ueber 60" && z.m === 15 && z.w === 25));

pruefe("D9 Ohne Nichtmitglieder fehlen genau vier Personen",
       R.rehaMeldeZeilen(d, STICHTAG, { nichtmitglieder: false })
        .reduce((s, z) => s + z.gesamt, 0) === SOLL_GESAMT - 4);
pruefe("D10 Ohne Behindertensport fehlt genau eine",
       R.rehaMeldeZeilen(d, STICHTAG, { behindertensport: false })
        .reduce((s, z) => s + z.gesamt, 0) === SOLL_GESAMT - 1);
pruefe("D11 Der Rehasport selbst laesst sich nicht abwaehlen",
       R.rehaMeldeZeilen(d, STICHTAG, { nichtmitglieder: false, behindertensport: false })
        .reduce((s, z) => s + z.gesamt, 0) === 45);
pruefe("D12 Ohne geladene Daten keine Zeilen",
       R.rehaMeldeZeilen(null, STICHTAG, {}).length === 0);
pruefe("D13 Die Gruppen stehen in der Reihenfolge des Rasters",
       (() => {
         const g = zeilenAlle.filter((z) => z.sparte === "Rehabilitationssport")
                             .map((z) => R.REHA_ALTERSGRUPPEN.indexOf(z.altersgruppe));
         return g.every((v, i) => i === 0 || g[i - 1] < v);
       })());

// =====================================================================
// E  Portal-Platzhalter
// =====================================================================

const portal = R.rehaPortalZeilen(d, { sportartNr: "300" });

pruefe("E1 Eine Zeile je gemeldeter Person", portal.length === SOLL_GESAMT,
       String(portal.length));
pruefe("E2 Namen sind als Platzhalter erkennbar",
       portal.every((z) => z.nachname === "Rehasport" || z.nachname === "Behindertensport"));
pruefe("E3 Laufende Nummer ist eindeutig",
       new Set(portal.map((z) => z.vorname)).size === portal.length);
pruefe("E4 Geburtsdatum ist deutsch und liegt auf dem Platzhaltertag",
       portal.every((z) => /^01\.07\.\d{4}$/.test(z.geburtsdatum)), portal[0].geburtsdatum);
pruefe("E5 Nur m und w", portal.every((z) => z.geschlecht === "m" || z.geschlecht === "w"));
pruefe("E6 Die Sportartennummer steht an jeder Zeile",
       portal.every((z) => z.nummern[0] === "300"));
pruefe("E7 Maenner und Frauen in der richtigen Zahl",
       portal.filter((z) => z.geschlecht === "m").length === 19 &&
       portal.filter((z) => z.geschlecht === "w").length === 31,
       portal.filter((z) => z.geschlecht === "m").length + " m");
pruefe("E8 Jahrgang 1950 kommt fuenfmal als Mann vor",
       portal.filter((z) => z.geburtsdatum === "01.07.1950" && z.geschlecht === "m").length === 5);

const ohneNr = R.rehaPortalZeilen(d, {});
pruefe("E9 Ohne Nummer bleibt das Feld leer statt zu raten",
       ohneNr.every((z) => z.nummern.length === 0));
pruefe("E10 Ohne Nummer entstehen trotzdem alle Zeilen", ohneNr.length === SOLL_GESAMT);
pruefe("E11 Abgewaehlte Bloecke fehlen auch im Portal",
       R.rehaPortalZeilen(d, { nichtmitglieder: false, behindertensport: false }).length === 45);
pruefe("E12 Der Behindertensport traegt einen eigenen Namen",
       portal.some((z) => z.nachname === "Behindertensport"));
pruefe("E13 Ohne geladene Daten keine Zeilen", R.rehaPortalZeilen(null, {}).length === 0);

// Anzeige und Datei muessen dieselbe Zahl nennen.
pruefe("E14 Portalzeilen und Meldezeilen zaehlen gleich",
       portal.length === zeilenAlle.reduce((s, z) => s + z.gesamt, 0));

// =====================================================================
// F  Kaputte Dateien
// =====================================================================

function wirft(name, raster, muster) {
  try { R.rehaRasterLesen(raster); pruefe(name, false, "keine Meldung"); }
  catch (e) { pruefe(name, muster.test(e.message), e.message); }
}

wirft("F1 Leere Datei", [], /keine Tabelle/i);
wirft("F2 Ohne Spalte Jahr", [zeile({ 0: "Name", 1: "m" })], /Jahr/i);
{
  const ohneReha = baueRaster();
  ohneReha[1][23] = null;
  ohneReha[2][23] = null; ohneReha[2][26] = null;
  wirft("F3 Ohne Rehasport-Block", ohneReha, /Rehabilitationssport/i);
}
{
  const leer = baueRaster();
  const kopf = leer.findIndex((z) => String((z || [])[0]).trim() === "Jahr");
  for (let i = kopf + 1; i < leer.length; i++) {
    if (/^\d{4}$/.test(String(leer[i][0]))) for (let s = 1; s < leer[i].length; s++) leer[i][s] = 0;
  }
  wirft("F4 Datei ohne belegte Jahrgaenge", leer, /keine belegten Jahrg/i);
}
{
  // Text statt Zahl: gemeldet, als 0 gewertet, nicht als NaN weitergereicht.
  const text = baueRaster();
  const kopf = text.findIndex((z) => String((z || [])[0]).trim() === "Jahr");
  text[kopf + 1][23] = "k. A.";
  const dt = R.rehaRasterLesen(text);
  pruefe("F5 Nicht-Zahl wird gemeldet",
         dt.warnungen.some((w) => /keine Zahl/i.test(w)), dt.warnungen.join(" | "));
  pruefe("F6 Nicht-Zahl wird als 0 gewertet, nicht als NaN",
         Number.isInteger(R.rehaGesamt(dt, {})) && R.rehaGesamt(dt, {}) === SOLL_GESAMT - 2,
         String(R.rehaGesamt(dt, {})));
}
{
  const ohneDatum = baueRaster();
  ohneDatum[0] = [];
  const dd = R.rehaRasterLesen(ohneDatum);
  pruefe("F7 Ohne Erhebungsdatum wird gewarnt, nicht geraten",
         dd.erhebungsjahr === null && dd.warnungen.some((w) => /Erhebungsdatum/i.test(w)),
         String(dd.erhebungsjahr));
  pruefe("F8 Die Zahlen sind trotzdem da", R.rehaGesamt(dd, {}) === SOLL_GESAMT);
}
pruefe("F9 Leerzelle ist 0", R.rehaZahl(null) === 0 && R.rehaZahl("") === 0);
pruefe("F10 Komma-Zahl wird gelesen", R.rehaZahl("12,0") === 12);
pruefe("F11 Text ist keine Zahl", R.rehaZahl("k. A.") === null);
{
  // Ein zusaetzlicher Wettkampfblock verschiebt alles dahinter. Genau
  // dagegen wird ueber die Ueberschriften gelesen und nicht ueber feste
  // Spaltennummern.
  const breiter = RASTER.map((z) => {
    const k = z.slice();
    if (k.length > 20) k.splice(20, 0, null, null, null);
    return k;
  });
  breiter[3][20] = "Sportart";
  const db2 = R.rehaRasterLesen(breiter);
  pruefe("F12 Eine zusaetzliche Sportart verschiebt nichts",
         R.rehaGesamt(db2, {}) === SOLL_GESAMT, String(R.rehaGesamt(db2, {})));
}

// =====================================================================
// G  Die Datei fuer das Portal
// =====================================================================

const lauf = { stichtag: STICHTAG, zeilen: [
  { nachname: "Mustermann", vorname: "Muster", geschlecht: "m",
    geburtsdatum: "01.05.2000", sparten: ["Fussball"], nummern: ["81"] }
] };

const csvOhne = L.lsbCsvText(lauf);
const csvMit = L.lsbCsvText(lauf, portal);
const zMit = csvMit.split("\r\n");

pruefe("G1 Ohne Rehazeilen ist die Datei unveraendert",
       csvOhne === L.lsbCsvText(lauf, []) && csvOhne === L.lsbCsvText(lauf, undefined));
pruefe("G2 Ohne Rehazeilen: Kopf plus ein Mitglied", csvOhne.split("\r\n").length === 2);
pruefe("G3 Mit Rehazeilen kommen genau 50 dazu",
       zMit.length === csvOhne.split("\r\n").length + SOLL_GESAMT, String(zMit.length));
pruefe("G4 Die Kopfzeile bleibt die der LSB-Vorlage",
       zMit[0] === "﻿" + L.LSB_KOPF.join(";"), zMit[0]);
pruefe("G5 Das echte Mitglied steht vor den Platzhaltern",
       zMit[1].startsWith("Mustermann;"), zMit[1]);
pruefe("G6 Die Platzhalter stehen als Block am Ende",
       zMit.slice(2).every((z) => /^(Rehasport|Behindertensport);/.test(z)));
pruefe("G7 Eine Rehazeile hat dasselbe Spaltenbild",
       zMit[2].split(";").length === L.LSB_KOPF.length, zMit[2]);
pruefe("G8 Sportartennummer landet in der ersten Nummernspalte",
       zMit[2].split(";")[4] === "300", zMit[2]);
pruefe("G9 Die beiden Reservespalten bleiben leer",
       zMit[2].split(";")[5] === "" && zMit[2].split(";")[6] === "");
pruefe("G10 Kein Semikolon im Platzhalternamen sprengt die Zeile",
       zMit.slice(2).every((z) => z.split(";").length === L.LSB_KOPF.length));

{
  // Die Nummernspalten sind begrenzt -- eine Rehazeile darf sie nicht
  // ueberlaufen lassen.
  const viele = portal.map((z) => Object.assign({}, z, { nummern: ["1", "2", "3", "4"] }));
  const z4 = L.lsbCsvText(lauf, viele).split("\r\n")[2].split(";");
  pruefe("G11 Mehr Nummern als Spalten werden abgeschnitten, nicht angehaengt",
         z4.length === L.LSB_KOPF.length && z4[4] === "1" && z4[6] === "3");
}

// =====================================================================
// H  Verdrahtung
// =====================================================================

const vorstandHtml = readFileSync(REPO + "/vorstand.html", "utf8");
const indexHtml = readFileSync(REPO + "/index.html", "utf8");
const auswertungJs = readFileSync(REPO + "/auswertung.js", "utf8");

pruefe("H1 vorstand.html laedt reha.js", /src="reha\.js\?v=/.test(vorstandHtml));
pruefe("H2 index.html laedt reha.js", /src="reha\.js\?v=/.test(indexHtml));
pruefe("H3 reha.js steht vor lsb.js",
       indexHtml.indexOf('src="reha.js') < indexHtml.indexOf('src="lsb.js'));
pruefe("H4 reha.js steht vor auswertung.js",
       vorstandHtml.indexOf('src="reha.js') < vorstandHtml.indexOf('src="auswertung.js'));
pruefe("H5 Beide Seiten haben den Platz fuer die Karte",
       /id="reha-karte"/.test(vorstandHtml) && /id="lsb-reha"/.test(indexHtml));

// ⚠️ Die Rechtegrenze von vorstand.html: sie darf keinen Code laden, der
// Personendaten anzeigt. Die Rehazeilen sind Zaehlwerte und deshalb
// erlaubt -- die Datei mit den echten Namen entsteht weiterhin nur dort,
// wo darfSchreiben gilt.
pruefe("H6 vorstand.html laedt lsb.js NICHT", !/src="lsb\.js/.test(vorstandHtml));
pruefe("H7 auswertung.js erzeugt keine Portal-Platzhalter",
       !/rehaPortalZeilen/.test(auswertungJs));
pruefe("H8 auswertung.js kennt weiterhin nur zwei Server-Aktionen",
       (auswertungJs.match(/vvRequest\("/g) || []).length === 2,
       String((auswertungJs.match(/vvRequest\("/g) || []).length));
pruefe("H9 reha.js ruft den Server ueberhaupt nicht",
       !/vvRequest/.test(REHA_QUELLE));

// Der geteilte Kern darf nicht nachgebaut sein.
pruefe("H10 auswertung.js baut die Umrechnung nicht nach",
       !/REHA_ALTERSGRUPPEN\s*=/.test(auswertungJs) &&
       /rehaMeldeZeilen\(/.test(auswertungJs));
pruefe("H11 lsb.js baut die Platzhalter nicht nach",
       !/Rehasport"/.test(LSB_QUELLE.replace(/\/\/[^\n]*/g, "")) &&
       /rehaPortalZeilen\(/.test(LSB_QUELLE));
pruefe("H12 Die CSV der Auswertung nennt die Quelle je Zeile",
       /Rehasport-Erhebung/.test(auswertungJs) && /Vereinsverwaltung"/.test(auswertungJs));
pruefe("H13 Das Ankreuzfeld traegt die Flottenklasse",
       /class="ankreuz"/.test(REHA_QUELLE) && !/class="haken"/.test(REHA_QUELLE));

// 16 px sind Flottenregel: kleiner laesst iOS beim Antippen hineinzoomen.
const css = readFileSync(REPO + "/style.css", "utf8");
pruefe("H14 Das Nummernfeld schrumpft ueber die Breite, nicht die Schrift",
       /\.reha-nummer input \{[^}]*max-width/.test(css) &&
       !/\.reha-nummer[^}]*font-size/.test(css));
pruefe("H15 Die Rehazeilen setzen sich in der Tabelle ab",
       /tr\.reha-zeile td/.test(css) && /class="reha-zeile"/.test(auswertungJs));

// =====================================================================

console.log("\n" + ok + " Prüfungen grün" + (fehler ? ", " + fehler + " ROT" : "") + ".");
if (fehler) { console.log("\n" + fehlerListe.map((f) => "  ✗ " + f).join("\n") + "\n"); }
process.exit(fehler ? 1 : 0);
