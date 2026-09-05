// Geteilter Kern der beiden oeffentlichen Formulare: antrag.html
// (Aufnahmeantrag nach § 4) und nachwuchs.html (Anmeldung eines
// Jugendspielers mit Spielerlaubnis).
//
// ⚠️ Diese Datei ist die Antwort auf die naheliegende Alternative, den
// Formularkern zu kopieren. Person, Erziehungsberechtigte, SEPA-Mandat und
// die Unterschriftsflaechen sind auf beiden Seiten dieselben -- eine Kopie
// waere nach der ersten Aenderung ein zweiter, ANDERER Mitgliedsantrag,
// und niemand merkt es, bis ein Feld nur auf einer der beiden Seiten
// ankommt. antrag-druck.js macht dasselbe Muster im Repo bereits vor.
//
// Wie dort gilt: eigene Helfer, keine Annahme darueber, wer die Datei
// laedt, und kein globaler Zustand. Was die beiden Seiten UNTERSCHEIDLICH
// machen -- Schrittnummern, Ueberschriften, der Fussball-Teil --, steht
// nicht hier.
//
// Die Feld-Ids sind auf beiden Seiten gleich (a-vorname, a-iban, …).
// Das ist die Bedingung dafuer, dass diese Funktionen ueberhaupt geteilt
// werden koennen; wer eine Id auf einer Seite umbenennt, muss es auf
// beiden tun.

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

// ---------------------------------------------------------------------
// Mandatstext und Abteilungen
// ---------------------------------------------------------------------

function baueMandatstext(info) {
  return "<strong>SEPA-Lastschriftmandat</strong>" +
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

function baueBeitragsliste(info) {
  if (!info.beitraege || !info.beitraege.length) return "";
  return '<h3>Jahresbeitrag</h3><ul class="beitragsliste">' +
    info.beitraege.map((b) =>
      "<li>" + esc(b.name) + ": <strong>" + eur(b.betrag_cent) + "</strong></li>").join("") +
    "</ul><p class=\"fussnote\">Im Familienverbund jeweils die H&auml;lfte. " +
    "Der Beitrag wird einmal j&auml;hrlich eingezogen.</p>";
}

function baueSpartenAuswahl(info) {
  if (!info.sparten || !info.sparten.length) {
    return '<p class="fussnote">Es sind noch keine Abteilungen hinterlegt. ' +
      "Bitte tragen Sie Ihren Wunsch unten in die Anmerkung ein.</p>";
  }
  return info.sparten.map((s) =>
    '<label class="ankreuz"><input type="checkbox" class="sparte-haken" value="' +
    esc(s.id) + '"><span>' + esc(s.name) + "</span></label>").join("");
}

// ---------------------------------------------------------------------
// Zustand des Formulars
// ---------------------------------------------------------------------

// Seit 14.08.2026 gibt es keine Wahl mehr -- der Verein zieht den Beitrag
// ausschliesslich per SEPA-Lastschrift ein, die Auswahlkaestchen
// a-zart-last/a-zart-ueber stehen in keiner der beiden Seiten mehr. Die
// Funktion bleibt als EINE Stelle stehen, an der die Regel steht: wer die
// Ueberweisung je wieder anbieten will, aendert sie hier und stellt die
// Kaestchen zurueck, statt acht Fallunterscheidungen neu zu erfinden.
function istLastschrift() {
  return true;
}

// Sammelt die Felder, die BEIDE Seiten fuehren. Was nur eine Seite hat
// (Sparten-Wunsch, Spielerlaubnis), haengt der Aufrufer an.
function sammleGemeinsameFelder(padGesetzl2) {
  const minder = !$("a-karte-gesetzl").hidden;
  const zweiter = minder && !$("a-allein-sorge").checked;

  return {
    anrede: $("a-anrede") ? $("a-anrede").value : "",
    geschlecht: $("a-geschlecht").value,
    vorname: $("a-vorname").value,
    nachname: $("a-nachname").value,
    geburtsdatum: $("a-geburtsdatum").value,
    geburtsort: $("a-geburtsort").value,
    strasse: $("a-strasse").value,
    plz: $("a-plz").value,
    ort: $("a-ort").value,
    email: $("a-email").value,
    mobil: $("a-mobil").value,
    telefon: $("a-telefon").value,
    zahlungsart: "lastschrift",
    kontoinhaber: $("a-kontoinhaber").value,
    kontoinhaber_anschrift: $("a-kontoinhaber-anschrift").value,
    iban: $("a-iban").value,
    bic: $("a-bic").value,
    bank_name: $("a-bank-name").value,
    unterschrift_ort: $("a-sig-ort").value,
    gesetzl_name: $("a-gesetzl-name").value,
    gesetzl_verhaeltnis: $("a-gesetzl-verhaeltnis").value,
    allein_sorgeberechtigt: minder && $("a-allein-sorge").checked,
    gesetzl2_name: zweiter ? $("a-gesetzl2-name").value : "",
    gesetzl2_verhaeltnis: zweiter ? $("a-gesetzl2-verhaeltnis").value : "",
    einwilligung_satzung: $("a-ew-satzung").checked,
    einwilligung_datenschutz: $("a-ew-datenschutz").checked,
    einwilligung_fotos: $("a-ew-fotos").checked,
    bemerkung: $("a-bemerkung").value
    // Die drei Unterschriften haengt der Aufrufer an: die Zeichenfelder
    // gehoeren ihm, nicht dieser Datei.
  };
}

// Gibt den ersten Fehlersatz zurueck oder null. Nur die Faelle, die sich
// ohne Rundlauf sagen lassen — massgeblich ist die Pruefung des Servers.
// Der Client ist keine Zusage.
function pruefeGemeinsameFelder(daten) {
  // ⚠️ Nur verlangt, solange es KEINE Erziehungsberechtigten-Karte gibt.
  // Ist sie da, unterschreibt der gesetzliche Vertreter (§ 4 der Satzung),
  // und die Unterschrift des Kindes ist freiwillig — das Feld heißt auf
  // der Nachwuchsseite „soweit es schon schreiben kann“. Dieselbe
  // Bedingung, nach der die Karte überhaupt erscheint.
  if (!daten.unterschrift && $("a-karte-gesetzl").hidden) {
    return "Bitte unterschreiben Sie im Feld unten.";
  }
  if (!$("a-karte-gesetzl").hidden && !daten.unterschrift_gesetzl) {
    return "Bei Minderjährigen wird auch die Unterschrift des gesetzlichen " +
           "Vertreters gebraucht.";
  }
  if (!$("a-gesetzl2-block").hidden && !daten.gesetzl2_name.trim()) {
    return "Bitte den zweiten Erziehungsberechtigten eintragen — oder ankreuzen, " +
           "dass Sie allein sorgeberechtigt sind.";
  }
  if (!$("a-sig-gesetzl2-block").hidden && !daten.unterschrift_gesetzl2) {
    return "Es fehlt die Unterschrift des zweiten Erziehungsberechtigten.";
  }
  if (daten.zahlungsart === "lastschrift" && !ibanPruefziffer(daten.iban)) {
    return "Die IBAN stimmt nicht. Bitte prüfen Sie sie noch einmal.";
  }
  return null;
}

// Die gewaehlten Abteilungen. Steht hier, weil beide Seiten dieselbe
// Kaestchenreihe benutzen — die Nachwuchsseite waehlt Fussball nur vor.
function sammleSparten() {
  return Array.from(document.querySelectorAll(".sparte-haken"))
    .filter((h) => h.checked).map((h) => h.value);
}

// ---------------------------------------------------------------------
// Zeichenfelder
// ---------------------------------------------------------------------
//
// ⚠️ Ein Canvas hinter hidden misst 0x0, und dann bleibt leer, was jemand
// hineinmalt. Deshalb wird ein Zeichenfeld erst erzeugt, wenn sein Block
// sichtbar ist, und danach bei jedem Sichtbarwerden neu vermessen.
// Der Aufrufer haelt die Instanzen; diese Funktion nimmt sie entgegen und
// gibt die (womoeglich neue) zurueck.
function sigFeldPflegen(vorhanden, canvasId, sichtbar) {
  if (!sichtbar) return vorhanden;
  const pad = vorhanden || createSignaturePad($(canvasId));
  pad.resize();
  return pad;
}
