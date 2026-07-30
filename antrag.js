// Oeffentlicher Aufnahmeantrag nach § 4 der Satzung.
//
// Diese Datei laeuft auf der einzigen Seite der App ohne Anmeldung. Sie
// kennt die Verwaltungsaktionen nicht einmal dem Namen nach — der Weg
// nach draussen fuehrt ausschliesslich ueber die beiden Aktionen in
// db-antrag.js.
//
// Eigene Helfer statt app.js: die Seite laedt bewusst kein einziges
// Skript der Verwaltung mit.

function $(id) { return document.getElementById(id); }

function esc(wert) {
  return String(wert === null || wert === undefined ? "" : wert)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function eur(cent) {
  return (cent / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 }) + " Euro";
}

function datumDe(iso) {
  if (!iso) return "";
  const t = String(iso).slice(0, 10).split("-");
  return t.length === 3 ? t[2] + "." + t[1] + "." + t[0] : String(iso);
}

function heuteIso() {
  // Lokal bilden, nicht ueber toISOString: das liefert in deutscher
  // Sommerzeit vor 02:00 Uhr den Vortag. Flottenregel.
  const d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

// Gleiche Rechnung wie ibanGueltig() im Worker (ISO 13616, Modulo 97).
// Hier nur fuer die sofortige Rueckmeldung im Feld — massgeblich bleibt
// die Pruefung des Servers.
function ibanPruefziffer(roh) {
  const s = String(roh || "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const um = s.slice(4) + s.slice(0, 4);
  let rest = 0;
  for (const zeichen of um) {
    const wert = zeichen >= "0" && zeichen <= "9"
      ? zeichen
      : String(zeichen.charCodeAt(0) - 55);
    for (const ziffer of wert) rest = (rest * 10 + Number(ziffer)) % 97;
  }
  return rest === 1;
}

// Alter zum Stichtag — dieselbe Rechnung wie alterAm() im Worker.
function alterHeute(geburtsdatum) {
  const g = String(geburtsdatum || "").slice(0, 10).split("-").map(Number);
  if (g.length !== 3 || !g[0]) return null;
  const s = heuteIso().split("-").map(Number);
  let a = s[0] - g[0];
  if (s[1] < g[1] || (s[1] === g[1] && s[2] < g[2])) a--;
  return a;
}

let info = null;
let sigPad = null;
let sigPadGesetzl = null;
let laeuft = false;

// ---------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------

async function start() {
  try {
    info = await ladeAntragInfo();
  } catch (e) {
    $("lade-schirm").innerHTML =
      '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }

  $("lade-schirm").hidden = true;
  if (!info.offen) { $("zu-schirm").hidden = false; return; }

  $("verein-name").textContent = info.verein;
  document.querySelectorAll(".verein-name-text").forEach((el) => {
    el.textContent = info.verein;
  });

  zeigeBeitraege();
  zeigeSparten();
  zeigeMandatstext();

  $("a-eintritt").value = heuteIso();
  $("formular").hidden = false;

  // Erst jetzt: ein Canvas hinter hidden misst 0x0, und dann bleibt das
  // Zeichenfeld leer, egal was jemand hineinmalt.
  sigPad = createSignaturePad($("a-sig"));
  sigPad.resize();

  verdrahten();
}

function zeigeBeitraege() {
  if (!info.beitraege || !info.beitraege.length) { $("beitrags-info").innerHTML = ""; return; }
  $("beitrags-info").innerHTML =
    '<h3>Jahresbeitrag</h3><ul class="beitragsliste">' +
    info.beitraege.map((b) =>
      "<li>" + esc(b.name) + ": <strong>" + eur(b.betrag_cent) + "</strong></li>").join("") +
    "</ul><p class=\"fussnote\">Im Familienverbund jeweils die H&auml;lfte. " +
    "Der Beitrag wird einmal j&auml;hrlich eingezogen.</p>";
}

function zeigeSparten() {
  const ziel = $("a-sparten");
  if (!info.sparten || !info.sparten.length) {
    ziel.innerHTML = '<p class="fussnote">Es sind noch keine Abteilungen hinterlegt. ' +
      "Bitte tragen Sie Ihren Wunsch unten in die Anmerkung ein.</p>";
    return;
  }
  ziel.innerHTML = info.sparten.map((s) =>
    '<label class="ankreuz"><input type="checkbox" class="sparte-haken" value="' +
    esc(s.id) + '"><span>' + esc(s.name) + "</span></label>").join("");
}

function zeigeMandatstext() {
  $("a-mandatstext").innerHTML =
    "<strong>SEPA-Lastschriftmandat</strong>" +
    "<p>Ich erm&auml;chtige den " + esc(info.verein) + ", wiederkehrende Zahlungen von " +
    "meinem Konto mittels Lastschrift einzuziehen. Zugleich weise ich mein Kreditinstitut " +
    "an, die vom " + esc(info.verein) + " auf mein Konto gezogenen Lastschriften " +
    "einzul&ouml;sen.</p>" +
    "<p>Hinweis: Ich kann innerhalb von acht Wochen, beginnend mit dem Belastungsdatum, " +
    "die Erstattung des belasteten Betrages verlangen. Es gelten dabei die mit meinem " +
    "Kreditinstitut vereinbarten Bedingungen.</p>" +
    (info.glaeubiger_id
      ? '<p class="fussnote">Gl&auml;ubiger-Identifikationsnummer: ' +
        esc(info.glaeubiger_id) + "</p>"
      : "") +
    '<p class="fussnote">Die Mandatsreferenz erhalten Sie mit der Aufnahmebest&auml;tigung. ' +
    "Der Einzug wird mindestens f&uuml;nf Tage vorher angek&uuml;ndigt.</p>";
}

// ---------------------------------------------------------------------
// Zustand des Formulars
// ---------------------------------------------------------------------

function istLastschrift() {
  return $("a-zart-last").checked;
}

function zeigeZahlungsart() {
  const last = istLastschrift();
  $("a-bank-block").hidden = !last;
  $("a-ueberweisung-hinweis").hidden = last;
  aktualisiereSigTitel();
}

// Der Block erscheint und verschwindet mit dem Geburtsdatum. Bleiben die
// Schrittnummern dabei stehen, springt die Zaehlung von 4 auf 6 — das
// liest sich wie ein vergessener Abschnitt.
function zeigeMinderjaehrig() {
  const alter = alterHeute($("a-geburtsdatum").value);
  const minder = alter !== null && alter >= 0 && alter < 18;

  $("a-alter-hinweis").textContent = alter === null ? " "
    : (alter < 0 ? "Das Datum liegt in der Zukunft." : alter + " Jahre");

  $("a-karte-gesetzl").hidden = !minder;
  $("a-sig-gesetzl-block").hidden = !minder;
  $("nr-einwilligung").textContent = (minder ? "6" : "5") + " — Erklärungen";
  $("nr-unterschrift").textContent = (minder ? "7" : "6") + " — Unterschrift";

  if (minder && !sigPadGesetzl) {
    sigPadGesetzl = createSignaturePad($("a-sig-gesetzl"));
  }
  if (minder && sigPadGesetzl) sigPadGesetzl.resize();
  aktualisiereSigTitel();
}

function aktualisiereSigTitel() {
  const minder = !$("a-karte-gesetzl").hidden;
  $("a-sig-titel").textContent = minder
    ? "Unterschrift des Antragstellers (soweit möglich)"
    : (istLastschrift()
        ? "Unterschrift — Beitrittserklärung und SEPA-Mandat"
        : "Unterschrift — Beitrittserklärung");
}

function pruefeIbanFeld() {
  const roh = $("a-iban").value.trim();
  const kasten = $("a-iban-hinweis");
  if (!roh || !istLastschrift()) { kasten.hidden = true; return; }
  if (ibanPruefziffer(roh)) {
    kasten.hidden = true;
  } else {
    kasten.hidden = false;
    kasten.textContent = "Diese IBAN stimmt nicht. Bitte noch einmal vergleichen — " +
      "eine falsche IBAN lässt die ganze Abbuchung scheitern.";
  }
}

function meldung(text) {
  const k = $("a-meldung");
  if (!text) { k.hidden = true; return; }
  k.hidden = false;
  k.textContent = text;
  k.scrollIntoView({ block: "center" });
}

// ---------------------------------------------------------------------
// Absenden
// ---------------------------------------------------------------------

function sammle() {
  const sparten = Array.from(document.querySelectorAll(".sparte-haken"))
    .filter((h) => h.checked).map((h) => h.value);

  return {
    anrede: $("a-anrede").value,
    geschlecht: $("a-geschlecht").value,
    vorname: $("a-vorname").value,
    nachname: $("a-nachname").value,
    geburtsdatum: $("a-geburtsdatum").value,
    strasse: $("a-strasse").value,
    plz: $("a-plz").value,
    ort: $("a-ort").value,
    email: $("a-email").value,
    mobil: $("a-mobil").value,
    telefon: $("a-telefon").value,
    art: $("a-art").value,
    eintritt_wunsch: $("a-eintritt").value,
    beitragsart_wunsch: $("a-beitragsart").value,
    familie_hinweis: $("a-familie").value,
    sparten,
    zahlungsart: istLastschrift() ? "lastschrift" : "ueberweisung",
    kontoinhaber: $("a-kontoinhaber").value,
    iban: $("a-iban").value,
    bic: $("a-bic").value,
    gesetzl_name: $("a-gesetzl-name").value,
    gesetzl_verhaeltnis: $("a-gesetzl-verhaeltnis").value,
    einwilligung_satzung: $("a-ew-satzung").checked,
    einwilligung_datenschutz: $("a-ew-datenschutz").checked,
    einwilligung_fotos: $("a-ew-fotos").checked,
    bemerkung: $("a-bemerkung").value,
    unterschrift: sigPad ? sigPad.toDataURL() : "",
    unterschrift_gesetzl: sigPadGesetzl ? sigPadGesetzl.toDataURL() : ""
  };
}

async function absenden() {
  if (laeuft) return;
  meldung("");

  const daten = sammle();

  // Nur die Faelle, die sich hier ohne Rundlauf sagen lassen. Massgeblich
  // ist die Pruefung des Servers — der Client ist keine Zusage.
  if (!daten.unterschrift) {
    meldung("Bitte unterschreiben Sie im Feld unten.");
    return;
  }
  if (!$("a-karte-gesetzl").hidden && !daten.unterschrift_gesetzl) {
    meldung("Bei Minderjährigen wird auch die Unterschrift des gesetzlichen " +
            "Vertreters gebraucht.");
    return;
  }
  if (daten.zahlungsart === "lastschrift" && !ibanPruefziffer(daten.iban)) {
    meldung("Die IBAN stimmt nicht. Bitte prüfen Sie sie noch einmal.");
    return;
  }

  laeuft = true;
  const knopf = $("btn-antrag-senden");
  knopf.disabled = true;
  knopf.textContent = "Wird gesendet …";

  let antwort;
  try {
    antwort = await sendeAntrag(daten);
  } catch (e) {
    laeuft = false;
    knopf.disabled = false;
    knopf.textContent = "Antrag verbindlich absenden";
    meldung(e.message);
    return;
  }

  zeigeDanke(daten, antwort);
}

function zeigeDanke(daten, antwort) {
  $("formular").hidden = true;
  $("danke").hidden = false;

  $("danke-kopf").innerHTML =
    "Eingegangen am <strong>" + esc(datumDe(antwort.eingang_am)) + "</strong>, " +
    "Vorgangsnummer <strong>" + esc(String(antwort.id).slice(0, 8)) + "</strong>.";

  const spartenNamen = (info.sparten || [])
    .filter((s) => daten.sparten.includes(s.id)).map((s) => s.name);

  const zeile = (was, wert) => wert
    ? "<tr><th>" + esc(was) + "</th><td>" + esc(wert) + "</td></tr>" : "";

  $("danke-zusammenfassung").innerHTML =
    "<h2>Ihre Erklärung</h2>" +
    '<div class="tabelle-scroll"><table class="zusammenfassung"><tbody>' +
    zeile("Name", [daten.anrede, daten.vorname, daten.nachname].filter(Boolean).join(" ")) +
    zeile("Geburtsdatum", datumDe(daten.geburtsdatum)) +
    zeile("Anschrift", daten.strasse + ", " + daten.plz + " " + daten.ort) +
    zeile("E-Mail", daten.email) +
    zeile("Telefon", [daten.mobil, daten.telefon].filter(Boolean).join(" / ")) +
    zeile("Mitgliedschaft", daten.art === "ausserordentlich"
      ? "Außerordentliches Mitglied" : "Ordentliches Mitglied") +
    zeile("Eintritt gewünscht zum", datumDe(daten.eintritt_wunsch)) +
    zeile("Abteilungen", spartenNamen.join(", ")) +
    zeile("Familie im Verein", daten.familie_hinweis) +
    zeile("Zahlungsart", daten.zahlungsart === "lastschrift"
      ? "SEPA-Lastschrift" : "Überweisung") +
    zeile("Kontoinhaber", daten.zahlungsart === "lastschrift" ? daten.kontoinhaber : "") +
    zeile("IBAN", daten.zahlungsart === "lastschrift"
      ? daten.iban.replace(/\s+/g, "").toUpperCase() : "") +
    zeile("Gesetzlicher Vertreter", daten.gesetzl_name) +
    zeile("Fotoeinwilligung", daten.einwilligung_fotos ? "erteilt" : "nicht erteilt") +
    zeile("Anmerkung", daten.bemerkung) +
    "</tbody></table></div>" +
    (daten.zahlungsart === "lastschrift" ? $("a-mandatstext").innerHTML : "") +
    '<div class="unterschrift-beleg">' +
    '<div><div class="unterschrift-titel">Antragsteller</div>' +
    '<img alt="Unterschrift" src="' + esc(daten.unterschrift) + '"></div>' +
    (daten.unterschrift_gesetzl
      ? '<div><div class="unterschrift-titel">Gesetzlicher Vertreter</div>' +
        '<img alt="Unterschrift des gesetzlichen Vertreters" src="' +
        esc(daten.unterschrift_gesetzl) + '"></div>'
      : "") +
    "</div>";

  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------

function verdrahten() {
  $("a-geburtsdatum").addEventListener("change", zeigeMinderjaehrig);
  $("a-geburtsdatum").addEventListener("input", zeigeMinderjaehrig);
  $("a-zart-last").addEventListener("change", zeigeZahlungsart);
  $("a-zart-ueber").addEventListener("change", zeigeZahlungsart);
  $("a-iban").addEventListener("blur", pruefeIbanFeld);
  $("btn-sig-loeschen").addEventListener("click", () => { if (sigPad) sigPad.clear(); });
  $("btn-sig-gesetzl-loeschen").addEventListener("click", () => {
    if (sigPadGesetzl) sigPadGesetzl.clear();
  });
  $("btn-antrag-senden").addEventListener("click", absenden);
  $("btn-drucken").addEventListener("click", () => window.print());

  zeigeZahlungsart();
  zeigeMinderjaehrig();
}

document.addEventListener("DOMContentLoaded", start);
