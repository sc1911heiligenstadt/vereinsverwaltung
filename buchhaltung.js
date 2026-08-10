// Buchhaltung (Stufe 4) -- eigene Seite, dem Schatzmeister vorbehalten.
//
// Sie laedt bewusst weder app.js noch die Reiter der Mitgliederverwaltung.
// Eine Seite, die den Code zum Anzeigen von Personendaten gar nicht erst
// enthaelt, ist die klarste Rechtegrenze, die es gibt.
//
// Eigene Helfer statt eines gemeinsamen ui.js: die vier Zeilen unten sind
// billiger als eine Datei, die auf beiden Seiten mit derselben Versions-
// nummer stehen muss.

function $(id) { return document.getElementById(id); }

function esc(wert) {
  if (wert === null || wert === undefined) return "";
  return String(wert).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function eur(cent) {
  if (cent === null || cent === undefined) return "—";
  return (cent / 100).toLocaleString("de-DE",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function datumDe(iso) {
  const t = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return "—";
  return t.slice(8, 10) + "." + t.slice(5, 7) + "." + t.slice(0, 4);
}

function heute() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
         "-" + String(d.getDate()).padStart(2, "0");
}

// Betrag aus dem Eingabefeld in Cent.
//
// ⚠️ Hier steckte ein Fehler, der beim Messen aufgefallen ist: "alle
// Punkte sind Tausendertrennzeichen" machte aus 1234.56 die Summe
// 12.345,60 -- das Zehnfache, still gebucht. Bei Geld ist das kein
// Schoenheitsfehler.
//
// Die Regel jetzt: ein KOMMA ist immer das Dezimaltrennzeichen. Steht nur
// ein Punkt da, entscheidet die Zahl der Ziffern dahinter -- genau drei
// heisst Tausender (1.000), alles andere Dezimalpunkt (1234.56). Das ist
// die uebliche deutsche Lesart und deckt beide Tippgewohnheiten ab.
function centAus(text) {
  let roh = String(text === null || text === undefined ? "" : text).trim().replace(/\s/g, "");
  if (!roh) return null;
  if (!/^-?[0-9.,]+$/.test(roh)) return null;

  const negativ = roh.startsWith("-");
  if (negativ) roh = roh.slice(1);

  if (roh.indexOf(",") >= 0) {
    const letzte = roh.lastIndexOf(",");
    roh = roh.slice(0, letzte).replace(/[.,]/g, "") + "." + roh.slice(letzte + 1).replace(/[.,]/g, "");
  } else if (roh.indexOf(".") >= 0) {
    const letzte = roh.lastIndexOf(".");
    const dahinter = roh.length - letzte - 1;
    roh = dahinter === 3
      ? roh.replace(/\./g, "")
      : roh.slice(0, letzte).replace(/\./g, "") + "." + roh.slice(letzte + 1);
  }

  const n = Number(roh);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) * (negativ ? -1 : 1);
}

let stamm = null;
let jahrId = null;
let zeilenZaehler = 0;
let laeuft = false;
let offenesKonto = null;

// ---------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------

async function start() {
  let rechte;
  try {
    rechte = await ladeEigeneRechte();
  } catch (e) {
    if (e instanceof NotLoggedInError) { $("anmelde-schirm").hidden = false; return; }
    $("anmelde-schirm").hidden = false;
    $("anmelde-schirm").innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  $("anmelde-schirm").hidden = true;

  if (!rechte.darfBuchen) { $("kein-zugriff").hidden = false; return; }

  $("app-bereich").hidden = false;
  $("haupt-nav").hidden = false;

  await ladeStamm();
  verdrahten();
}

async function ladeStamm() {
  try {
    stamm = await vvRequest("vv-buch-stammdaten", {});
  } catch (e) {
    $("jahr-status").innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }

  $("einrichtung-karte").hidden = !!stamm.eingerichtet;
  $("jahr-karte").hidden = !stamm.eingerichtet;
  if (!stamm.eingerichtet) {
    $("haupt-nav").hidden = true;
    document.querySelectorAll(".tab").forEach((t) => { t.classList.remove("aktiv"); });
    return;
  }
  $("haupt-nav").hidden = false;

  const sel = $("f-jahr");
  sel.innerHTML = stamm.jahre.length
    ? stamm.jahre.map((j) => '<option value="' + esc(j.id) + '">' + j.jahr +
        (j.status === "offen" ? "" : " (abgeschlossen)") + "</option>").join("")
    : '<option value="">— noch keins angelegt —</option>';

  if (!jahrId || !stamm.jahre.some((j) => j.id === jahrId)) {
    const offen = stamm.jahre.find((j) => j.status === "offen");
    jahrId = offen ? offen.id : (stamm.jahre[0] ? stamm.jahre[0].id : null);
  }
  if (jahrId) sel.value = jahrId;
  zeigeJahrPille();

  fuelleVorlagen();
  if (!$("b-zeilen").children.length) { zeileHinzu(); zeileHinzu(); }
  $("b-datum").value = $("b-datum").value || heute();
  zeigeAbschlussJahre();
}

function aktuellesJahr() {
  return (stamm && stamm.jahre || []).find((j) => j.id === jahrId) || null;
}

function zeigeJahrPille() {
  const j = aktuellesJahr();
  const p = $("jahr-pille");
  p.hidden = !j;
  if (j) {
    p.textContent = j.jahr + (j.status === "offen" ? "" : " · abgeschlossen");
    p.className = "rollen-pille" + (j.status === "offen" ? "" : " warnfarbe");
  }
}

// ---------------------------------------------------------------------
// Buchen
// ---------------------------------------------------------------------

function fuelleVorlagen() {
  $("b-vorlage").innerHTML = '<option value="">— freie Eingabe —</option>' +
    stamm.vorlagen.map((v) => '<option value="' + esc(v.id) + '">' + esc(v.name) +
      "</option>").join("");
}

function kontoAuswahl(gewaehlt) {
  return stamm.konten.filter((k) => k.aktiv).map((k) =>
    '<option value="' + esc(k.id) + '"' + (k.id === gewaehlt ? " selected" : "") + ">" +
    esc(k.nummer + " " + k.name) + "</option>").join("");
}

function zeileHinzu(kontoId, seite) {
  const i = ++zeilenZaehler;
  const div = document.createElement("div");
  div.className = "buchungszeile";
  div.innerHTML =
    '<select class="bz-konto" aria-label="Konto"><option value="">— Konto wählen —</option>' +
      kontoAuswahl(kontoId) + "</select>" +
    '<input class="bz-soll" inputmode="decimal" placeholder="Soll" aria-label="Soll">' +
    '<input class="bz-haben" inputmode="decimal" placeholder="Haben" aria-label="Haben">' +
    '<button class="btn grau klein bz-weg" type="button" aria-label="Zeile entfernen">&times;</button>';
  $("b-zeilen").appendChild(div);

  div.querySelector(".bz-weg").addEventListener("click", () => {
    div.remove(); zeigeSumme();
  });
  div.querySelectorAll("input").forEach((f) => f.addEventListener("input", zeigeSumme));
  if (seite === "soll") div.querySelector(".bz-soll").value = "";
  return div;
}

function zeigeSumme() {
  let soll = 0, haben = 0;
  document.querySelectorAll(".buchungszeile").forEach((z) => {
    soll += centAus(z.querySelector(".bz-soll").value) || 0;
    haben += centAus(z.querySelector(".bz-haben").value) || 0;
  });
  const gleich = soll === haben && soll > 0;
  $("b-summe").innerHTML = "Soll " + eur(soll) + " · Haben " + eur(haben) +
    (soll || haben
      ? (gleich ? ' <span class="chip bezahlt">gleicht sich aus</span>'
                : ' <span class="chip offen">Differenz ' + eur(Math.abs(soll - haben)) + "</span>")
      : "");
}

// Eine Vorlage fuellt zwei Zeilen vor und schreibt ihre Begruendung
// sichtbar darueber. Der Text ist der eigentliche Zweck der Vorlage.
function vorlageGewaehlt() {
  const v = stamm.vorlagen.find((x) => x.id === $("b-vorlage").value);
  const kasten = $("b-erklaerung");
  if (!v) {
    kasten.innerHTML = '<p class="fussnote">Ohne Vorlage buchen Sie frei. Die Sphäre ergibt ' +
      "sich dann allein aus den gewählten Konten.</p>";
    return;
  }

  const sphaere = v.sphaere ? (stamm.sphaeren[v.sphaere] || v.sphaere) : null;
  kasten.innerHTML =
    '<div class="hinweis info"><strong>' + esc(v.name) + "</strong>" +
    (sphaere ? ' <span class="chip antrag">' + esc(sphaere) + "</span>" : "") +
    "<p>" + esc(v.erklaerung) + "</p>" +
    "<p class=\"fussnote\">Bucht " + esc(v.soll_nummer) + " an " + esc(v.haben_nummer) +
    ".</p></div>";

  const soll = stamm.konten.find((k) => k.nummer === v.soll_nummer);
  const haben = stamm.konten.find((k) => k.nummer === v.haben_nummer);
  $("b-zeilen").innerHTML = "";
  const z1 = zeileHinzu(soll ? soll.id : "");
  const z2 = zeileHinzu(haben ? haben.id : "");
  const betrag = $("b-betrag").value;
  if (betrag) {
    z1.querySelector(".bz-soll").value = betrag;
    z2.querySelector(".bz-haben").value = betrag;
  }
  zeigeSumme();
}

// Der Betrag oben ist die bequeme Eingabe: er fuellt die erste Soll- und
// die erste Habenzeile. Wer mehrere Zeilen braucht, tippt sie einzeln.
function betragVerteilen() {
  const zeilen = document.querySelectorAll(".buchungszeile");
  if (zeilen.length !== 2) return;
  const w = $("b-betrag").value;
  zeilen[0].querySelector(".bz-soll").value = w;
  zeilen[1].querySelector(".bz-haben").value = w;
  zeigeSumme();
}

function bMeldung(text) {
  const k = $("b-meldung");
  if (!text) { k.hidden = true; return; }
  k.hidden = false;
  k.textContent = text;
}

async function buchen() {
  if (laeuft) return;
  bMeldung("");
  if (!jahrId) { bMeldung("Es ist kein Geschäftsjahr angelegt."); return; }

  const zeilen = [];
  for (const z of document.querySelectorAll(".buchungszeile")) {
    const kontoId = z.querySelector(".bz-konto").value;
    const soll = centAus(z.querySelector(".bz-soll").value) || 0;
    const haben = centAus(z.querySelector(".bz-haben").value) || 0;
    if (!kontoId && !soll && !haben) continue;
    if (!kontoId) { bMeldung("In einer Zeile fehlt das Konto."); return; }
    zeilen.push({ konto_id: kontoId, soll_cent: soll, haben_cent: haben });
  }

  laeuft = true;
  $("btn-buchen").disabled = true;
  let antwort;
  try {
    antwort = await vvRequest("vv-buchen", {
      belegdatum: $("b-datum").value,
      text: $("b-text").value,
      vorlage_id: $("b-vorlage").value || null,
      zeilen
    });
  } catch (e) {
    bMeldung(e.message);
    laeuft = false; $("btn-buchen").disabled = false;
    return;
  }
  laeuft = false; $("btn-buchen").disabled = false;

  bMeldung("");
  const k = $("b-meldung");
  k.hidden = false;
  k.className = "hinweis erfolg";
  k.textContent = "Gebucht als Beleg " + antwort.belegnummer + " im Jahr " + antwort.jahr + ".";
  $("b-text").value = "";
  $("b-betrag").value = "";
  $("b-zeilen").innerHTML = "";
  zeileHinzu(); zeileHinzu();
  zeigeSumme();
  // Die Meldung soll rot bleiben, sobald wieder ein Fehler kommt.
  setTimeout(() => { k.className = "hinweis fehler"; k.hidden = true; }, 6000);
}

// ---------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------

async function ladeJournal() {
  const ziel = $("j-liste");
  if (!jahrId) { ziel.innerHTML = '<div class="leer">Kein Geschäftsjahr gewählt.</div>'; return; }
  ziel.innerHTML = '<div class="leer">Wird geladen …</div>';

  let antwort;
  try {
    antwort = await vvRequest("vv-journal", {
      geschaeftsjahr_id: jahrId, suche: $("j-suche").value
    });
  } catch (e) {
    ziel.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  if (!antwort.buchungen.length) {
    ziel.innerHTML = '<div class="leer">Keine Buchungen.</div>';
    return;
  }

  ziel.innerHTML = antwort.buchungen.map((b) =>
    '<div class="beleg' + (b.storniert_am ? " storniert" : "") + '">' +
      '<div class="beleg-kopf">' +
        "<strong>Beleg " + b.belegnummer + "</strong> · " + esc(datumDe(b.belegdatum)) +
        " · " + esc(b.text) +
        (b.art !== "normal" ? ' <span class="chip ruhend">' + esc(b.art) + "</span>" : "") +
        (b.storniert_am ? ' <span class="chip beendet">storniert</span>' : "") +
        (b.quelle_typ ? ' <span class="chip antrag">aus der Beitragsverwaltung</span>' : "") +
        '<span class="beleg-summe">' + eur(b.summe_cent) + "</span>" +
      "</div>" +
      '<table class="beleg-zeilen"><tbody>' +
      b.zeilen.map((z) =>
        "<tr><td>" + esc(z.nummer + " " + z.name) + "</td>" +
        '<td class="betrag">' + (z.soll_cent ? eur(z.soll_cent) : "") + "</td>" +
        '<td class="betrag">' + (z.haben_cent ? eur(z.haben_cent) : "") + "</td></tr>").join("") +
      "</tbody></table>" +
      (b.storniert_am || b.storno_von_id || b.art !== "normal" ? ""
        : '<div class="knopfreihe"><button class="btn warn klein" data-storno="' +
          esc(b.id) + '">Stornieren</button></div>') +
    "</div>").join("");

  ziel.querySelectorAll("[data-storno]").forEach((btn) => {
    btn.addEventListener("click", () => storniere(btn.dataset.storno));
  });
}

async function storniere(id) {
  const grund = prompt("Grund für den Storno (steht später im Journal):", "");
  if (grund === null) return;
  try {
    const r = await vvRequest("vv-buchung-stornieren", { id, grund });
    alert("Storniert mit Gegenbuchung Beleg " + r.belegnummer + ".");
  } catch (e) {
    alert(e.message);
    return;
  }
  ladeJournal();
}

// ---------------------------------------------------------------------
// Auswertung
// ---------------------------------------------------------------------

async function ladeAuswertung() {
  if (!jahrId) return;
  let a;
  try {
    a = await vvRequest("vv-saldenliste", { geschaeftsjahr_id: jahrId });
  } catch (e) {
    $("a-sphaeren").innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }

  $("a-sphaeren").innerHTML =
    '<div class="tabelle-scroll"><table class="schmal"><thead><tr><th>Sphäre</th>' +
    '<th class="betrag">Erträge</th><th class="betrag">Aufwendungen</th>' +
    '<th class="betrag">Ergebnis</th><th>steuerlich</th></tr></thead><tbody>' +
    Object.keys(a.sphaeren).map((s) => {
      const e = a.ergebnis[s] || { ertrag_cent: 0, aufwand_cent: 0, ergebnis_cent: 0 };
      return "<tr><td>" + esc(a.sphaeren[s]) + "</td>" +
        '<td class="betrag">' + eur(e.ertrag_cent) + "</td>" +
        '<td class="betrag">' + eur(e.aufwand_cent) + "</td>" +
        '<td class="betrag">' + eur(e.ergebnis_cent) + "</td>" +
        "<td>" + (s === "wirtschaft"
          ? '<span class="chip beendet">steuerpflichtig</span>'
          : '<span class="chip bezahlt">steuerfrei</span>') + "</td></tr>";
    }).join("") +
    '<tr class="summenzeile"><td>Gesamt</td><td></td><td></td>' +
    '<td class="betrag">' + eur(a.ergebnis_gesamt_cent) + "</td><td></td></tr>" +
    "</tbody></table></div>" +
    '<p class="fussnote">' + a.buchungen + " Belege" +
      (a.stornierte ? ", davon " + a.stornierte + " storniert" : "") +
      ". Aktiva " + eur(a.aktiva_cent) + ", Passiva " + eur(a.passiva_cent) + "." +
      (a.jahr.status === "offen"
        ? " Die Differenz von " + eur(a.differenz_cent) + " ist das noch nicht abgeschlossene " +
          "Ergebnis — sie steht bis zum Jahresabschluss auf den Erfolgskonten."
        : " Die Bilanz ist ausgeglichen.") + "</p>";

  const zeile = (k) =>
    "<tr><td>" + esc(k.nummer) + "</td><td>" + esc(k.name) + "</td>" +
    "<td>" + (k.sphaere ? esc(a.sphaeren[k.sphaere] || k.sphaere) : "") + "</td>" +
    '<td class="betrag">' + eur(k.soll_cent) + "</td>" +
    '<td class="betrag">' + eur(k.haben_cent) + "</td>" +
    '<td class="betrag"><strong>' + eur(k.saldo_cent) + "</strong></td></tr>";

  $("a-salden").innerHTML = a.konten.length
    ? '<div class="tabelle-scroll"><table><thead><tr><th>Konto</th><th>Bezeichnung</th>' +
      '<th>Sphäre</th><th class="betrag">Soll</th><th class="betrag">Haben</th>' +
      '<th class="betrag">Saldo</th></tr></thead><tbody>' +
      a.konten.map(zeile).join("") + "</tbody></table></div>"
    : '<div class="leer">In diesem Jahr wurde noch nichts gebucht.</div>';
}

// ---------------------------------------------------------------------
// Übernahme aus der Beitragsverwaltung
// ---------------------------------------------------------------------

async function ladeUebernahme() {
  const ziel = $("u-liste");
  ziel.innerHTML = '<div class="leer">Wird geladen …</div>';
  let u;
  try {
    u = await vvRequest("vv-uebernahme", {});
  } catch (e) {
    ziel.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  const alle = u.laeufe.concat(u.dateien);
  if (!alle.length) {
    ziel.innerHTML = '<div class="hinweis erfolg">Es steht nichts zur Übernahme an — ' +
      "alle festgeschriebenen Läufe und gebuchten Einzüge sind verbucht.</div>";
    return;
  }

  ziel.innerHTML =
    '<div class="tabelle-scroll"><table><thead><tr><th>Vorgang</th><th>Datum</th>' +
    '<th>Posten</th><th class="betrag">Betrag</th><th>Buchung</th><th></th>' +
    "</tr></thead><tbody>" +
    alle.map((v) =>
      "<tr><td>" + esc(v.bezeichnung) + "</td>" +
      "<td>" + esc(datumDe(v.datum)) + "</td>" +
      "<td>" + v.anzahl + "</td>" +
      '<td class="betrag">' + eur(v.summe_cent) + "</td>" +
      "<td>" + esc(v.soll) + " an " + esc(v.haben) + "</td>" +
      '<td><button class="btn klein" data-typ="' + esc(v.quelle_typ) + '" data-id="' +
        esc(v.quelle_id) + '">Buchen</button></td></tr>').join("") +
    "</tbody></table></div>";

  ziel.querySelectorAll("[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const r = await vvRequest("vv-uebernahme-buchen", {
          quelle_typ: btn.dataset.typ, quelle_id: btn.dataset.id
        });
        alert("Gebucht als Beleg " + r.belegnummer + " im Jahr " + r.jahr +
              " über " + eur(r.summe_cent) + ".");
      } catch (e) {
        alert(e.message);
        btn.disabled = false;
        return;
      }
      ladeUebernahme();
    });
  });
}

// ---------------------------------------------------------------------
// Jahresabschluss
// ---------------------------------------------------------------------

function zeigeAbschlussJahre() {
  if (!stamm || !stamm.jahre.length) {
    $("ab-jahre").innerHTML = '<div class="leer">Es ist noch kein Geschäftsjahr angelegt.</div>';
    return;
  }
  $("ab-jahre").innerHTML =
    '<div class="tabelle-scroll"><table class="schmal"><thead><tr><th>Jahr</th><th>Status</th>' +
    "<th>Abgeschlossen</th><th class=\"betrag\">Ergebnis</th><th></th></tr></thead><tbody>" +
    stamm.jahre.map((j) => {
      let erg = null;
      try { erg = j.ergebnis_json ? JSON.parse(j.ergebnis_json) : null; } catch { erg = null; }
      return "<tr><td><strong>" + j.jahr + "</strong></td>" +
        '<td><span class="chip ' + (j.status === "offen" ? "aktiv" : "beendet") + '">' +
          (j.status === "offen" ? "offen" : "abgeschlossen") + "</span></td>" +
        "<td>" + (j.abgeschlossen_am ? esc(datumDe(j.abgeschlossen_am) + " · " +
          (j.abgeschlossen_von || "")) : "—") + "</td>" +
        '<td class="betrag">' + (erg ? eur(erg.ergebnis_cent) : "—") + "</td>" +
        "<td>" + (j.status === "offen"
          ? '<button class="btn warn klein" data-abschluss="' + esc(j.id) + '">Abschließen</button> ' +
            '<button class="btn grau klein" data-eroeffnung="' + esc(j.id) + '">Eröffnungsbilanz übernehmen</button>'
          : "") + "</td></tr>";
    }).join("") + "</tbody></table></div>";

  $("ab-jahre").querySelectorAll("[data-abschluss]").forEach((b) => {
    b.addEventListener("click", () => abschluss(b.dataset.abschluss));
  });
  $("ab-jahre").querySelectorAll("[data-eroeffnung]").forEach((b) => {
    b.addEventListener("click", () => eroeffnung(b.dataset.eroeffnung));
  });
}

async function abschluss(id) {
  const j = stamm.jahre.find((x) => x.id === id);
  if (!confirm("Das Geschäftsjahr " + (j ? j.jahr : "") + " wirklich abschließen? " +
               "Danach lässt sich darin nicht mehr buchen, und der Abschluss kann nicht " +
               "wiederholt werden.")) return;
  let r;
  try {
    r = await vvRequest("vv-jahresabschluss", { geschaeftsjahr_id: id });
  } catch (e) {
    $("ab-ergebnis").innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }

  $("ab-ergebnis").innerHTML =
    '<div class="hinweis erfolg"><strong>' + r.jahr + " abgeschlossen.</strong> " +
    "Jahresergebnis " + eur(r.ergebnis_cent) + "." +
    (r.abschluss_beleg ? " Abschlussbuchung als Beleg " + r.abschluss_beleg + "." : "") +
    (r.eroeffnung_beleg
      ? " Eröffnungsbilanz " + r.folgejahr + " als Beleg " + r.eroeffnung_beleg + "."
      : "") +
    (r.hinweis ? " " + esc(r.hinweis) : "") + "</div>" +
    '<div class="tabelle-scroll"><table class="schmal"><thead><tr><th>Sphäre</th>' +
    '<th class="betrag">Ergebnis</th></tr></thead><tbody>' +
    Object.keys(r.je_sphaere).map((s) =>
      "<tr><td>" + esc(stamm.sphaeren[s] || s) + "</td>" +
      '<td class="betrag">' + eur(r.je_sphaere[s].ergebnis_cent) + "</td></tr>").join("") +
    "</tbody></table></div>";

  await ladeStamm();
}

// Doppelklick-Sperre, gleiche Begruendung wie bei erzeugeSepa in lauf.js:
// zwei zugleich laufende Eroeffnungen zoegen zwei Belegnummern fuer
// denselben Vortrag, und die Bilanz staende doppelt in den Buechern.
async function eroeffnung(id) {
  if (eroeffnung.laeuft) return;
  eroeffnung.laeuft = true;
  try {
    return await eroeffnungAusfuehren(id);
  } finally {
    eroeffnung.laeuft = false;
  }
}

async function eroeffnungAusfuehren(id) {
  let r;
  try {
    r = await vvRequest("vv-eroeffnung", { geschaeftsjahr_id: id });
  } catch (e) {
    $("ab-ergebnis").innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  $("ab-ergebnis").innerHTML = '<div class="hinweis erfolg">' +
    (r.belegnummer
      ? "Eröffnungsbilanz " + r.jahr + " aus " + r.aus + " übernommen, Beleg " + r.belegnummer + "."
      : esc(r.hinweis || "Nichts zu übernehmen.")) + "</div>";
  await ladeStamm();
}

// ---------------------------------------------------------------------
// Konten
// ---------------------------------------------------------------------

function zeigeKonten() {
  if (!stamm || !stamm.konten.length) {
    $("k-liste").innerHTML = '<div class="leer">Kein Kontenrahmen angelegt.</div>';
    return;
  }
  $("k-liste").innerHTML =
    '<div class="tabelle-scroll"><table><thead><tr><th>Nummer</th><th>Bezeichnung</th>' +
    "<th>Art</th><th>Sphäre</th><th>Gruppe</th><th></th></tr></thead><tbody>" +
    stamm.konten.map((k) =>
      "<tr" + (k.aktiv ? "" : ' class="erledigt"') + "><td>" + esc(k.nummer) + "</td>" +
      "<td>" + esc(k.name) + "</td><td>" + esc(k.art) + "</td>" +
      "<td>" + (k.sphaere ? esc(stamm.sphaeren[k.sphaere] || k.sphaere) : "—") + "</td>" +
      "<td>" + esc(k.gruppe || "") + "</td>" +
      '<td><button class="btn grau klein" data-konto="' + esc(k.id) + '">Ändern</button></td></tr>'
    ).join("") + "</tbody></table></div>";

  $("k-liste").querySelectorAll("[data-konto]").forEach((b) => {
    b.addEventListener("click", () => oeffneKonto(b.dataset.konto));
  });
}

function oeffneKonto(id) {
  offenesKonto = id ? stamm.konten.find((k) => k.id === id) : null;
  $("konto-titel").textContent = offenesKonto ? "Konto ändern" : "Neues Konto";
  $("ko-nummer").value = offenesKonto ? offenesKonto.nummer : "";
  $("ko-name").value = offenesKonto ? offenesKonto.name : "";
  $("ko-art").value = offenesKonto ? offenesKonto.art : "aufwand";
  $("ko-gruppe").value = offenesKonto ? (offenesKonto.gruppe || "") : "";
  $("ko-aktiv").checked = offenesKonto ? !!offenesKonto.aktiv : true;
  $("ko-sphaere").innerHTML = '<option value="">— keine —</option>' +
    Object.keys(stamm.sphaeren).map((s) => '<option value="' + s + '">' +
      esc(stamm.sphaeren[s]) + "</option>").join("");
  $("ko-sphaere").value = offenesKonto ? (offenesKonto.sphaere || "") : "";
  $("ko-meldung").hidden = true;
  kontoArtGewaehlt();
  $("konto-overlay").hidden = false;
}

function kontoArtGewaehlt() {
  const art = $("ko-art").value;
  const braucht = art === "ertrag" || art === "aufwand";
  $("ko-sphaere").disabled = !braucht;
  if (!braucht) $("ko-sphaere").value = "";
  $("ko-hinweis").textContent = braucht
    ? "Ertrags- und Aufwandskonten brauchen eine Sphäre — an ihr hängt, ob der Posten steuerpflichtig ist."
    : "Bestandskonten haben keine Sphäre. Ein Geldeingang ist für sich genommen weder ideell noch wirtschaftlich.";
}

async function speichereKonto() {
  const k = $("ko-meldung");
  k.hidden = true;
  let r;
  try {
    r = await vvRequest("vv-konto-speichern", {
      id: offenesKonto ? offenesKonto.id : null,
      nummer: $("ko-nummer").value,
      name: $("ko-name").value,
      art: $("ko-art").value,
      sphaere: $("ko-sphaere").value,
      gruppe: $("ko-gruppe").value,
      aktiv: $("ko-aktiv").checked
    });
  } catch (e) {
    k.hidden = false; k.textContent = e.message;
    return;
  }
  $("konto-overlay").hidden = true;
  await ladeStamm();
  zeigeKonten();
}

// ---------------------------------------------------------------------

function waehleTab(id) {
  document.querySelectorAll("#haupt-nav button").forEach((b) => {
    b.classList.toggle("aktiv", b.dataset.tab === id);
  });
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("aktiv", t.id === id);
  });
  if (id === "tab-journal") ladeJournal();
  if (id === "tab-auswertung") ladeAuswertung();
  if (id === "tab-uebernahme") ladeUebernahme();
  if (id === "tab-abschluss") zeigeAbschlussJahre();
  if (id === "tab-konten") zeigeKonten();
}

function verdrahten() {
  document.querySelectorAll("#haupt-nav button").forEach((b) => {
    b.addEventListener("click", () => waehleTab(b.dataset.tab));
  });

  $("btn-einrichten").addEventListener("click", async () => {
    $("einrichtung-status").innerHTML = '<p class="fussnote">Wird angelegt …</p>';
    try {
      const r = await vvRequest("vv-buch-init", {});
      $("einrichtung-status").innerHTML = '<div class="hinweis erfolg">' +
        r.konten_angelegt + " Konten und " + r.vorlagen_angelegt +
        " Geschäftsvorfälle angelegt.</div>";
    } catch (e) {
      $("einrichtung-status").innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
      return;
    }
    await ladeStamm();
  });

  $("f-jahr").addEventListener("change", () => {
    jahrId = $("f-jahr").value;
    zeigeJahrPille();
    const aktiv = document.querySelector(".tab.aktiv");
    if (aktiv) waehleTab(aktiv.id);
  });

  $("btn-jahr-anlegen").addEventListener("click", async () => {
    try {
      await vvRequest("vv-jahr-anlegen", { jahr: $("nj-jahr").value });
    } catch (e) {
      $("jahr-status").innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
      return;
    }
    $("nj-jahr").value = "";
    $("jahr-status").innerHTML = "";
    await ladeStamm();
  });

  $("b-vorlage").addEventListener("change", vorlageGewaehlt);
  $("b-betrag").addEventListener("input", betragVerteilen);
  $("btn-zeile-mehr").addEventListener("click", () => { zeileHinzu(); zeigeSumme(); });
  $("btn-buchen").addEventListener("click", buchen);
  $("btn-journal").addEventListener("click", ladeJournal);
  $("j-suche").addEventListener("keydown", (e) => { if (e.key === "Enter") ladeJournal(); });
  $("btn-uebernahme-neu").addEventListener("click", ladeUebernahme);
  $("btn-konto-neu").addEventListener("click", () => oeffneKonto(null));
  $("ko-art").addEventListener("change", kontoArtGewaehlt);
  $("btn-konto-speichern").addEventListener("click", speichereKonto);
  $("btn-konto-zu").addEventListener("click", () => { $("konto-overlay").hidden = true; });
  $("btn-konto-abbrechen").addEventListener("click", () => { $("konto-overlay").hidden = true; });
  $("konto-overlay").addEventListener("click", (e) => {
    if (e.target === $("konto-overlay")) $("konto-overlay").hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("konto-overlay").hidden) $("konto-overlay").hidden = true;
  });

  vorlageGewaehlt();
  zeigeSumme();
}

document.addEventListener("DOMContentLoaded", start);
