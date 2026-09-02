// Rehasportdaten aus der Bestandserhebung des Verbandes
// =====================================================
//
// Der Rehasport des Vereins wird NICHT in dieser App gefuehrt -- er liegt
// woanders, und einmal im Jahr kommt von dort die ausgefuellte
// Bestandserhebung als Excel-Datei. Die Leute stehen trotzdem in der
// Meldung an den Landessportbund. Diese Datei liest jene Vorlage und
// rechnet sie in dasselbe Raster um, in dem die App den eigenen Bestand
// auszaehlt.
//
// ⚠️ Die Verbandsdatei enthaelt KEINE Personen, sondern ZAEHLWERTE je
// Jahrgang mal Geschlecht. Alles Weitere folgt daraus:
//   - Auf vorstand.html darf sie deshalb verarbeitet werden. Die
//     Rechtegrenze jener Seite ("laedt keinen Code, der Personendaten
//     anzeigen kann") bleibt unangetastet: hier gibt es keine Person.
//   - Fuer die Datei, die das Portal unser-sportverein.net in Schritt 3
//     einliest, muessen daraus PLATZHALTER-Zeilen werden. Das Portal
//     nimmt nur Einzelpersonen entgegen und rechnet die Jahrgangsmatrix
//     selbst -- eine fertige Matrix laesst sich dort nirgends hochladen.
//
// Die Datei wird von vorstand.html UND index.html geladen. Eine Kopie
// waere nach der ersten Aenderung eine zweite, andere Umrechnung, und es
// fiele erst auf, wenn die beiden Ausgaben verschiedene Summen zeigen.
// Sie bringt ihre Helfer deshalb selbst mit (rEsc), statt sich darauf zu
// verlassen, welche Seite sie geladen hat.

// Genau die Gruppen aus altersGruppeSql() im Worker, in genau dieser
// Schreibweise ("ueber 60" ohne Umlaut). Weicht eine ab, stehen die
// Rehazeilen in der Tabelle unter einer eigenen, zweiten Ueberschrift
// statt neben den Vereinszeilen.
const REHA_ALTERSGRUPPEN = ["bis 6", "7 bis 14", "15 bis 18", "19 bis 26",
                            "27 bis 40", "41 bis 60", "ueber 60", "unbekannt"];

// ⚠️ Der Platzhalter-Geburtstag ist der 1. JULI, und das ist keine
// Willkuer. Die Verbandsdatei kennt nur den Jahrgang; welches Alter
// daraus wird, haengt am Stichtag. Mit der Jahresmitte trifft die
// Umrechnung genau das, was alterSql() im Worker fuer dieselbe Zeile
// rechnen wuerde -- fuer jeden Stichtag im ersten Halbjahr, also auch
// fuer den ueblichen 1. Januar. Ein 1. Januar als Platzhalter liesse die
// Zahlen zwischen Anzeige und Portal um ein Jahr auseinanderlaufen.
const REHA_PLATZHALTER_TAG = "-07-01";

const REHA_SPEICHER = "vv-reha-bestand";

// Die vier Bloecke der Vorlage. Erkannt wird ueber die Ueberschriften,
// NICHT ueber feste Spaltennummern: der Verband setzt fuer jede
// Wettkampfsportart einen eigenen Dreierblock, und der verschiebt alles
// dahinter. Wer das auf Spaltenindizes umbaut, zerstoert den Import
// lautlos, sobald eine Sportart dazukommt.
//
// ⚠️ DIE REIHENFOLGE IST TRAGEND, die erste zutreffende Regel gewinnt.
// Die Ueberschrift der Kontrollspalte lautet im Original "Gesamtmitglieder
// im Verein (alle aktiven, passiven und sonstige Mitglieder im
// Behinderten- und Rehabilitationssport)" -- sie nennt also BEIDE
// Sportarten in ihrem eigenen Text. Stuende sie hinten, laese der Parser
// sie als Rehasport und jede Person waere doppelt in der Meldung: aus
// 951 wurden im ersten Lauf 1902. Genau deshalb steht sie zuerst.
const REHA_BLOECKE = [
  // Die erste Spaltengruppe der Vorlage ist eine KONTROLLSUMME ueber alle
  // uebrigen Bloecke, kein eigener Bestand. Sie wird zum Gegenrechnen
  // gelesen und nie mitgezaehlt.
  { schluessel: "kontrolle", titel: "Gesamtmitglieder im Verein",
    passt: (pfad) => /gesamtmitglieder/i.test(pfad) },
  { schluessel: "reha_nicht", titel: "Rehabilitationssport (Nichtmitglieder)",
    passt: (pfad) => /rehabilitationssport/i.test(pfad) && /nichtmitglied/i.test(pfad) },
  { schluessel: "reha", titel: "Rehabilitationssport",
    passt: (pfad) => /rehabilitationssport/i.test(pfad) },
  { schluessel: "behinderten", titel: "Behindertensport",
    passt: (pfad) => /behindertensport/i.test(pfad) }
];

// Reihenfolge der Ausgabe -- die Kontrollspalte ist nie dabei.
const REHA_GEMELDET = ["reha", "reha_nicht", "behinderten"];

function rEsc(wert) {
  if (wert === null || wert === undefined) return "";
  return String(wert).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function rehaText(wert) {
  if (wert === null || wert === undefined) return "";
  if (typeof wert === "object") return "";
  return String(wert).replace(/\s+/g, " ").trim();
}

// Leere Zellen sind in dieser Vorlage die Regel, nicht die Ausnahme --
// der Verband laesst die Null weg. Sie zaehlen als 0, aber alles, was
// keine Zahl ist, wird gemeldet statt still verschluckt.
function rehaZahl(wert) {
  if (wert === null || wert === undefined || wert === "") return 0;
  if (typeof wert === "number") return Number.isFinite(wert) ? wert : null;
  const t = String(wert).replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

// Alter zum Stichtag -- BITGLEICH zu alterSql() im Worker, angewandt auf
// den Platzhalter-Geburtstag. Beide Seiten muessen dieselbe Zahl liefern,
// sonst zeigt die Auswertung etwas anderes an als das Portal spaeter
// ausrechnet.
function rehaAlterZum(jahrgang, stichtag) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(stichtag))) return null;
  const geburt = jahrgang + REHA_PLATZHALTER_TAG;
  return Number(stichtag.slice(0, 4)) - Number(geburt.slice(0, 4)) -
         (stichtag.slice(5) < geburt.slice(5) ? 1 : 0);
}

function rehaAltersgruppe(alter) {
  if (alter === null || alter === undefined) return "unbekannt";
  if (alter <= 6) return "bis 6";
  if (alter <= 14) return "7 bis 14";
  if (alter <= 18) return "15 bis 18";
  if (alter <= 26) return "19 bis 26";
  if (alter <= 40) return "27 bis 40";
  if (alter <= 60) return "41 bis 60";
  return "ueber 60";
}

// ---------------------------------------------------------------------
// Die Vorlage lesen
// ---------------------------------------------------------------------
//
// Aufbau der Verbandsdatei (gemessen an der Erhebung 2025):
//
//   Zeile 2   Bloecke:      Gesamtmitglieder | Behindertensport | Rehabilitationssport
//   Zeile 3   Unterbloecke: ... Wettkampfsport | Breitensport | Mitglieder | Nichtmitglieder
//   Zeile 4   je Wettkampfblock die Sportart
//   Zeile 7   Spaltenkopf:  Jahr | m | w | ges. | m | w | ges. | ... | Alter
//   ab Zeile 8  ein Jahrgang je Zeile
//   letzte Zeile  "S" = Summe des Verbandes, dient als Gegenprobe
//
// Die Blockueberschriften stehen wegen der verbundenen Zellen nur in der
// ERSTEN Spalte ihres Blocks; alles rechts davon ist leer, bis der
// naechste Block anfaengt. Der Pfad einer Spalte ist deshalb der jeweils
// letzte nicht-leere Wert links von ihr, ueber alle Kopfzeilen hinweg.
function rehaSpaltenPfad(raster, bisZeile, spalte) {
  const teile = [];
  for (let z = 0; z < bisZeile; z++) {
    const zeile = raster[z] || [];
    let letzter = "";
    for (let s = 0; s <= spalte; s++) {
      const t = rehaText(zeile[s]);
      if (t) letzter = t;
    }
    if (letzter) teile.push(letzter);
  }
  return teile.join(" / ");
}

function rehaRasterLesen(raster) {
  const warnungen = [];
  if (!Array.isArray(raster) || !raster.length) {
    throw new Error("Die Datei enthält keine Tabelle.");
  }

  // 1. Kopfzeile finden: die Zeile, in der links "Jahr" steht.
  let kopf = -1;
  for (let z = 0; z < Math.min(raster.length, 30); z++) {
    if (/^jahr(gang)?$/i.test(rehaText((raster[z] || [])[0]))) { kopf = z; break; }
  }
  if (kopf < 0) {
    throw new Error("Keine Spalte „Jahr“ gefunden. Ist das die Bestandserhebung des " +
                    "Behinderten- und Rehabilitationssportverbandes?");
  }

  // 2. Jede m/w-Spalte ihrem Block zuordnen. Die "ges."-Spalten werden
  //    bewusst uebergangen: sie sind die Summe der beiden daneben, und
  //    eine mitgelesene Summe waere eine zweite Wahrheit ueber dieselben
  //    Personen.
  const spalten = [];
  const kopfZeile = raster[kopf] || [];
  let breite = kopfZeile.length;
  for (const z of raster) breite = Math.max(breite, (z || []).length);

  for (let s = 1; s < breite; s++) {
    const t = rehaText(kopfZeile[s]).toLowerCase();
    if (t !== "m" && t !== "w") continue;
    const pfad = rehaSpaltenPfad(raster, kopf, s);
    const block = REHA_BLOECKE.find((b) => b.passt(pfad));
    if (!block) {
      warnungen.push("Spalte " + (s + 1) + " („" + pfad + "“) gehört zu keinem bekannten " +
                     "Block und bleibt unberücksichtigt.");
      continue;
    }
    spalten.push({ index: s, geschlecht: t, block: block.schluessel, pfad });
  }
  if (!spalten.some((s) => s.block === "reha")) {
    throw new Error("In der Datei ist kein Block „Rehabilitationssport“ zu finden.");
  }

  // 3. Die Jahrgangszeilen. Alles, was in der ersten Spalte keine
  //    vierstellige Jahreszahl traegt, ist Kopf, Summe oder Fussnote.
  const jahrgaenge = [];
  const summen = {};
  for (const b of REHA_BLOECKE) summen[b.schluessel] = { m: 0, w: 0 };
  let verbandsSumme = null;

  for (let z = kopf + 1; z < raster.length; z++) {
    const zeile = raster[z] || [];
    const erste = rehaText(zeile[0]);

    // Die Summenzeile des Verbandes ("S") wird als Gegenprobe gelesen,
    // nicht als Jahrgang mitgezaehlt.
    if (/^s$/i.test(erste) || /^summe$/i.test(erste)) {
      verbandsSumme = {};
      for (const b of REHA_BLOECKE) verbandsSumme[b.schluessel] = { m: 0, w: 0 };
      for (const s of spalten) {
        const n = rehaZahl(zeile[s.index]);
        if (n !== null) verbandsSumme[s.block][s.geschlecht] += n;
      }
      continue;
    }
    if (!/^\d{4}$/.test(erste)) continue;

    const jahrgang = erste;
    const eintrag = { jahrgang };
    let hatWert = false;
    for (const b of REHA_BLOECKE) eintrag[b.schluessel] = { m: 0, w: 0 };

    for (const s of spalten) {
      const roh = zeile[s.index];
      const n = rehaZahl(roh);
      if (n === null) {
        warnungen.push("Jahrgang " + jahrgang + ", Spalte " + (s.index + 1) +
                       ": „" + rehaText(roh) + "“ ist keine Zahl und wurde als 0 gewertet.");
        continue;
      }
      if (n < 0) {
        warnungen.push("Jahrgang " + jahrgang + ": negative Zahl " + n + " übergangen.");
        continue;
      }
      eintrag[s.block][s.geschlecht] += n;
      if (n > 0) hatWert = true;
    }
    if (!hatWert) continue;

    for (const b of REHA_BLOECKE) {
      summen[b.schluessel].m += eintrag[b.schluessel].m;
      summen[b.schluessel].w += eintrag[b.schluessel].w;
    }
    jahrgaenge.push(eintrag);
  }

  if (!jahrgaenge.length) throw new Error("Die Datei enthält keine belegten Jahrgänge.");

  // 4. Stichtag und Erhebungsjahr. In der Vorlage steht das Datum als
  //    eigene Zelle ueber der Tabelle. Fehlt es, wird der juengste
  //    Jahrgang NICHT zum Jahr erklaert -- geraten wird hier nichts,
  //    sondern gefragt.
  let stichtag = null;
  for (let z = 0; z <= kopf; z++) {
    for (const zelle of (raster[z] || [])) {
      const iso = rehaDatumAus(zelle);
      if (iso) { stichtag = iso; break; }
    }
    if (stichtag) break;
  }
  if (!stichtag) {
    for (let z = raster.length - 1; z > kopf; z--) {
      for (const zelle of (raster[z] || [])) {
        const iso = rehaDatumAus(zelle);
        if (iso) { stichtag = iso; break; }
      }
      if (stichtag) break;
    }
  }
  const erhebungsjahr = stichtag ? Number(stichtag.slice(0, 4)) : null;
  if (!erhebungsjahr) {
    warnungen.push("In der Datei steht kein Erhebungsdatum. Prüfen Sie besonders sorgfältig, " +
                   "ob die Zahlen zum gewählten Stichtag passen.");
  }

  // 5. Gegenprobe gegen die Kontrollspalte der Vorlage. Sie ist die
  //    Summe aller uebrigen Bloecke -- geht sie nicht auf, ist entweder
  //    die Datei anders aufgebaut als erwartet oder von Hand nachgetragen
  //    worden, und beides muss auffallen.
  const gezaehlt = { m: 0, w: 0 };
  for (const b of REHA_BLOECKE) {
    if (b.schluessel === "kontrolle") continue;
    gezaehlt.m += summen[b.schluessel].m;
    gezaehlt.w += summen[b.schluessel].w;
  }
  const kontrolle = summen.kontrolle;
  const kontrolleBelegt = kontrolle.m + kontrolle.w > 0;
  if (kontrolleBelegt && (kontrolle.m !== gezaehlt.m || kontrolle.w !== gezaehlt.w)) {
    warnungen.push("Die Kontrollspalte der Vorlage („Gesamtmitglieder im Verein“) nennt " +
                   (kontrolle.m + kontrolle.w) + " Personen, aus den Sportblöcken ergeben sich " +
                   (gezaehlt.m + gezaehlt.w) + ". Die Datei geht nicht auf.");
  }
  if (verbandsSumme) {
    for (const b of REHA_BLOECKE) {
      const eig = summen[b.schluessel], ver = verbandsSumme[b.schluessel];
      if (eig.m !== ver.m || eig.w !== ver.w) {
        warnungen.push("Die Summenzeile der Vorlage nennt für „" + b.titel + "“ " +
                       (ver.m + ver.w) + " Personen, die Jahrgänge ergeben " +
                       (eig.m + eig.w) + ".");
      }
    }
  }

  return {
    version: 1, stichtag, erhebungsjahr, jahrgaenge, summen,
    kontrolle: kontrolleBelegt ? kontrolle : null,
    verbandsSumme, warnungen
  };
}

function rehaDatumAus(zelle) {
  if (!zelle) return null;
  if (zelle instanceof Date && !isNaN(zelle)) {
    return zelle.getFullYear() + "-" + String(zelle.getMonth() + 1).padStart(2, "0") +
           "-" + String(zelle.getDate()).padStart(2, "0");
  }
  // Der Pruefstand reicht Datumszellen als {__date} herein, weil JSON
  // keine Datumswerte kennt.
  if (typeof zelle === "object" && typeof zelle.__date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(zelle.__date)) return zelle.__date;
  const t = rehaText(zelle);
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (m) return m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  return null;
}

// ---------------------------------------------------------------------
// Umrechnen in das Raster der App
// ---------------------------------------------------------------------

// Welche Bloecke gemeldet werden. Der Rehasport der Vereinsmitglieder
// immer; die Nichtmitglieder und der Behindertensport auf Wunsch --
// getrennt, weil "Nichtmitglied" beim Verband etwas anderes heisst als
// beim Landessportbund und der Verein das selbst entscheiden muss.
function rehaBloeckeAuswahl(optionen) {
  const o = optionen || {};
  return REHA_GEMELDET.filter((b) =>
    b === "reha" ||
    (b === "reha_nicht" && o.nichtmitglieder !== false) ||
    (b === "behinderten" && o.behindertensport !== false));
}

function rehaBlockTitel(schluessel) {
  const b = REHA_BLOECKE.find((x) => x.schluessel === schluessel);
  return b ? b.titel : schluessel;
}

// Zeilen im Format von handleBestandsmeldung: eine je Block mal
// Altersgruppe, damit sie sich unveraendert unter die Vereinszeilen
// haengen lassen.
function rehaMeldeZeilen(daten, stichtag, optionen) {
  if (!daten || !daten.jahrgaenge) return [];
  const bloecke = rehaBloeckeAuswahl(optionen);
  const nachBlock = new Map();

  for (const j of daten.jahrgaenge) {
    const gruppe = rehaAltersgruppe(rehaAlterZum(j.jahrgang, stichtag));
    for (const b of bloecke) {
      const wert = j[b] || { m: 0, w: 0 };
      if (!wert.m && !wert.w) continue;
      if (!nachBlock.has(b)) nachBlock.set(b, {});
      const g = nachBlock.get(b);
      if (!g[gruppe]) g[gruppe] = { w: 0, m: 0, d: 0, ohne: 0, gesamt: 0 };
      g[gruppe].m += wert.m;
      g[gruppe].w += wert.w;
      g[gruppe].gesamt += wert.m + wert.w;
    }
  }

  const zeilen = [];
  for (const b of bloecke) {
    const gruppen = nachBlock.get(b);
    if (!gruppen) continue;
    for (const g of REHA_ALTERSGRUPPEN) {
      if (!gruppen[g]) continue;
      zeilen.push(Object.assign({ sparte: rehaBlockTitel(b), altersgruppe: g, reha: true },
                                gruppen[g]));
    }
  }
  return zeilen;
}

// Platzhalter-Zeilen fuer die Datei, die das Portal einliest.
//
// ⚠️ Die Namen sind ERFUNDEN, und das muss auf den ersten Blick zu sehen
// sein -- deshalb "Rehasport" als Nachname und eine laufende Nummer als
// Vorname, nicht irgendetwas Menschenaehnliches. Das Portal rechnet aus
// diesen Zeilen die Jahrgangs- und Fachverbandsmeldung; gebraucht werden
// davon nur Jahrgang, Geschlecht und Sportartennummer.
function rehaPortalZeilen(daten, optionen) {
  if (!daten || !daten.jahrgaenge) return [];
  const o = optionen || {};
  const bloecke = rehaBloeckeAuswahl(o);
  const nummer = String(o.sportartNr || "").trim();
  const zeilen = [];
  let lfd = 0;

  for (const b of bloecke) {
    for (const j of daten.jahrgaenge) {
      const wert = j[b] || { m: 0, w: 0 };
      for (const g of ["m", "w"]) {
        for (let i = 0; i < wert[g]; i++) {
          lfd++;
          zeilen.push({
            nachname: b === "behinderten" ? "Behindertensport" : "Rehasport",
            vorname: "Nr. " + String(lfd).padStart(4, "0"),
            geschlecht: g,
            geburtsdatum: rehaDatumDe(j.jahrgang + REHA_PLATZHALTER_TAG),
            sparten: [rehaBlockTitel(b)],
            nummern: nummer ? [nummer] : [],
            reha: true
          });
        }
      }
    }
  }
  return zeilen;
}

function rehaDatumDe(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? m[3] + "." + m[2] + "." + m[1] : String(iso || "");
}

function rehaGesamt(daten, optionen) {
  if (!daten) return 0;
  return rehaBloeckeAuswahl(optionen).reduce(
    (s, b) => s + (daten.summen[b] ? daten.summen[b].m + daten.summen[b].w : 0), 0);
}

// ---------------------------------------------------------------------
// Der geladene Stand
// ---------------------------------------------------------------------
//
// Gehalten wird er im Browser, nicht in der Datenbank: es sind
// Zaehlwerte aus einer fremden Quelle, die einmal im Jahr fuer eine
// einzige Meldung gebraucht werden. In D1 waeren sie ein zweiter,
// alternder Bestand neben dem echten -- und die Frage, wer ihn
// ueberschreiben darf, waere jedes Jahr neu zu beantworten.
//
// ⚠️ Der Preis dafuer: er gilt nur in diesem Browser. Deshalb steht in
// der Karte immer, WELCHE Datei geladen ist und aus WELCHEM Jahr -- und
// passt das Erhebungsjahr nicht zum Stichtag, sagt die Karte das, statt
// die alten Zahlen still mitzumelden.
function rehaSpeichern(stand) {
  try { localStorage.setItem(REHA_SPEICHER, JSON.stringify(stand)); return true; }
  catch (e) { return false; }
}

function rehaLaden() {
  try {
    const roh = localStorage.getItem(REHA_SPEICHER);
    if (!roh) return null;
    const stand = JSON.parse(roh);
    if (!stand || stand.version !== 1 || !stand.daten || !stand.daten.jahrgaenge) return null;
    return stand;
  } catch (e) { return null; }
}

function rehaEntfernen() {
  try { localStorage.removeItem(REHA_SPEICHER); } catch (e) { /* nichts zu tun */ }
}

async function rehaDateiLesen(datei) {
  await ladeTabellenBibliothek();
  const puffer = await datei.arrayBuffer();
  const buch = XLSX.read(puffer, { type: "array", cellDates: true });
  const blatt = buch.Sheets[buch.SheetNames[0]];
  if (!blatt) throw new Error("Die Datei enthält kein Tabellenblatt.");
  const raster = XLSX.utils.sheet_to_json(blatt, { header: 1, raw: true, defval: null });
  return rehaRasterLesen(raster);
}

// ---------------------------------------------------------------------
// Die Karte -- gleicher Baustein auf beiden Seiten
// ---------------------------------------------------------------------

function rehaKarteHtml(id) {
  return '<div class="reha-block" id="' + id + '">' +
    '<div class="knopfreihe">' +
      '<label class="btn grau" for="' + id + '-datei">Rehasportdaten einlesen</label>' +
      '<input type="file" id="' + id + '-datei" accept=".xlsx,.xls" hidden>' +
      '<button class="btn grau" id="' + id + '-weg" hidden>Entfernen</button>' +
    "</div>" +
    '<div id="' + id + '-stand"></div>' +
    '<div id="' + id + '-optionen" hidden>' +
      // class="ankreuz" ist die Flottenklasse: ohne sie zieht die
      // 100-%-Regel fuer Formularfelder das Kaestchen zu einem Balken
      // ueber die ganze Zeile.
      '<label class="ankreuz"><input type="checkbox" id="' + id + '-nicht" checked>' +
        "Nichtmitglieder des Rehasports mitmelden" +
        '<span class="fussnote">Rehasportler ohne Vereinsmitgliedschaft. Der Verband führt ' +
        "sie getrennt; ob sie in die Meldung des Vereins gehören, entscheidet der Verein.</span>" +
      "</label>" +
      '<label class="ankreuz"><input type="checkbox" id="' + id + '-behind" checked>' +
        "Behindertensport mitmelden" +
      "</label>" +
      '<div class="feld reha-nummer"><label for="' + id + '-nr">Sportartennummer für den ' +
        "Rehasport</label>" +
        // 16 px bleiben stehen (Flottenregel gegen das Hineinzoomen auf
        // iOS); schmal wird das Feld ueber die Breite, nicht die Schrift.
        '<input type="text" id="' + id + '-nr" inputmode="numeric" maxlength="6" ' +
          'placeholder="z. B. 300">' +
      "</div>" +
      '<p class="fussnote">Die Nummer steht in der Sportartenliste des LSB. Ohne sie laufen ' +
      "diese Personen beim Verband unter „ohne Landesfachverband“ — 2026 kostet das 5 € je Kind " +
      "und 10 € je Erwachsenem, ab 2027 ist es gar nicht mehr möglich.</p>" +
    "</div></div>";
}

// Verdrahtet die Karte und ruft beiAenderung(), sobald sich am geladenen
// Stand oder an den Haken etwas tut. Der Aufrufer entscheidet, was er
// damit macht -- die Auswertung rechnet neu, die Meldedatei nicht.
function rehaKarteVerdrahten(id, beiAenderung) {
  const el = (s) => document.getElementById(id + "-" + s);
  const melden = () => { if (beiAenderung) beiAenderung(); };
  // Das Stichtagsfeld steht ausserhalb dieser Karte und heisst je nach
  // Seite anders.
  const stichtagFeld = () => document.getElementById("f-stichtag") ||
                              document.getElementById("lsb-stichtag");

  const zeichne = () => {
    const stand = rehaLaden();
    el("weg").hidden = !stand;
    el("optionen").hidden = !stand;
    if (!stand) {
      el("stand").innerHTML = '<p class="fussnote">Noch keine Rehasportdaten geladen — die ' +
        "Meldung enthält nur den Bestand der Vereinsverwaltung. Die Datei ist die ausgefüllte " +
        "Bestandserhebung des Behinderten- und Rehabilitationssportverbandes.</p>";
      return;
    }
    const d = stand.daten;
    el("nicht").checked = stand.optionen.nichtmitglieder !== false;
    el("behind").checked = stand.optionen.behindertensport !== false;
    el("nr").value = stand.optionen.sportartNr || "";

    const teile = [];
    for (const b of REHA_GEMELDET) {
      const s = d.summen[b];
      if (!s || !(s.m + s.w)) continue;
      teile.push(rEsc(rehaBlockTitel(b)) + ": <strong>" + (s.m + s.w) + "</strong> (" +
                 s.m + " m, " + s.w + " w)");
    }
    el("stand").innerHTML =
      '<div class="hinweis erfolg"><strong>' + rEsc(stand.dateiname) + "</strong>" +
      (d.stichtag ? ", Erhebung zum " + rEsc(rehaDatumDe(d.stichtag)) : "") + ". " +
      teile.join(" · ") + ".</div>" +
      (d.warnungen && d.warnungen.length
        ? '<div class="hinweis warn">' + d.warnungen.map(rEsc).join("<br>") + "</div>" : "");
    pruefeJahr(stand);
  };

  // ⚠️ Die Datei kommt einmal im Jahr, der geladene Stand bleibt aber
  // liegen. Ohne diesen Hinweis meldet jemand im Januar 2028 die Zahlen
  // von 2025 mit -- und es faellt niemandem auf, weil die Summe
  // plausibel aussieht.
  const pruefeJahr = (stand) => {
    const feld = stichtagFeld();
    const jahr = feld && /^\d{4}/.test(feld.value) ? Number(feld.value.slice(0, 4)) : null;
    const eh = stand.daten.erhebungsjahr;
    if (!jahr || !eh) return;
    // Die Erhebung zum 31.12. eines Jahres ist der Bestand, der zum
    // 1. Januar des Folgejahres gemeldet wird. Beides ist richtig.
    if (jahr === eh || jahr === eh + 1) return;
    el("stand").innerHTML += '<div class="hinweis warn">Die geladenen Rehasportdaten sind ' +
      "von <strong>" + eh + "</strong>, gemeldet wird zum Stichtag <strong>" +
      rEsc(feld.value) + "</strong>. Bitte die aktuelle Datei des Verbandes einlesen.</div>";
  };

  el("datei").addEventListener("change", async (ev) => {
    const datei = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!datei) return;
    el("stand").innerHTML = '<p class="fussnote">Wird gelesen …</p>';
    let daten;
    try {
      daten = await rehaDateiLesen(datei);
    } catch (e) {
      el("stand").innerHTML = '<div class="hinweis fehler">' + rEsc(e.message) + "</div>";
      return;
    }
    const alt = rehaLaden();
    const ok = rehaSpeichern({
      version: 1, dateiname: datei.name, daten,
      optionen: (alt && alt.optionen) || { nichtmitglieder: true, behindertensport: true,
                                           sportartNr: "" }
    });
    zeichne();
    if (!ok) {
      el("stand").innerHTML += '<div class="hinweis warn">Der Browser konnte die Zahlen nicht ' +
        "merken. Die Meldung stimmt, aber nach dem Neuladen der Seite ist die Datei wieder " +
        "einzulesen.</div>";
    }
    melden();
  });

  el("weg").addEventListener("click", () => { rehaEntfernen(); zeichne(); melden(); });

  const merkeOption = (feld, name, wert) => {
    const stand = rehaLaden();
    if (!stand) return;
    stand.optionen[name] = wert;
    rehaSpeichern(stand);
    melden();
  };
  el("nicht").addEventListener("change", (e) =>
    merkeOption(null, "nichtmitglieder", e.target.checked));
  el("behind").addEventListener("change", (e) =>
    merkeOption(null, "behindertensport", e.target.checked));
  el("nr").addEventListener("change", (e) =>
    merkeOption(null, "sportartNr", e.target.value.trim()));

  // ⚠️ Der Stichtag entscheidet darueber, ob die geladenen Zahlen noch
  // passen -- er steht aber ausserhalb dieser Karte. Ohne diesen
  // Listener bliebe die Jahreswarnung stumm, sobald jemand den Stichtag
  // NACH dem Einlesen aendert. Genau das ist der gemeldete Fall: im
  // Januar 2028 die Datei von 2025 mitzumelden. Im Browser gemessen --
  // ohne ihn schlug die Warnung nicht an.
  const feld = stichtagFeld();
  if (feld) feld.addEventListener("change", zeichne);

  zeichne();
  return { zeichne };
}
