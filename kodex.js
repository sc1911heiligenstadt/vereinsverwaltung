// Nachreichen der Kenntnisnahme des Elternkodex.
//
// Die Nachwuchs-ANMELDUNG erhebt sie seit dem 18.08.2026 mit. Diese Seite
// ist fuer die Familien, deren Kind schon Mitglied ist und die Erklaerung
// nie abgegeben hat -- ein Link an alle Eltern, ohne Konto, ohne dass
// irgendeine Anmeldung wiederholt werden muss.
//
// Laeuft wie antrag.html und nachwuchs.html ohne Anmeldung. $, esc,
// datumDe und heuteIso kommen aus antrag-felder.js; der Formularkern
// darin wird hier NICHT gebraucht -- diese Seite fragt weder Anschrift
// noch Bankdaten ab, der Kodex verlangt beides nicht.

let kodexInfo = null;
let sigPad = null;
let laeuft = false;

// ---------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------

async function start() {
  verdrahte();
  zeigeInfo();
  pruefeAnmeldung();

  try {
    kodexInfo = await ladeKodexInfo();
  } catch (e) {
    // ⚠️ Ein 401 heisst hier NICHT "melde dich an" -- diese Seite verlangt
    // nie eine Anmeldung. Er heisst: der Worker kennt die Aktion nicht,
    // weil er noch nicht deployt ist. Genau dieses Fenster gibt es bei
    // jedem Rollout (Worker vor Pages), und "Nicht angemeldet" liesse
    // Eltern den Fehler bei sich suchen. Dasselbe fuer 400 mit
    // "Unbekannte Aktion", die Antwort eines aelteren Workers.
    const nichtDa = e.status === 401
      || /Nicht angemeldet|Unbekannte Aktion/i.test(e.message || "");
    $("lade-schirm").innerHTML = '<div class="hinweis ' +
      (nichtDa ? "warn" : "fehler") + '">' +
      (nichtDa
        ? "Diese Seite ist noch nicht freigeschaltet. Bitte in einigen Minuten " +
          "noch einmal versuchen. Hilft das nicht, freut sich die Geschäftsstelle " +
          "über einen Anruf: 03606 612206."
        : esc(e.message)) + "</div>";
    return;
  }

  $("lade-schirm").hidden = true;

  // Der Vereinsname kommt aus dem SERVER, nicht aus dem HTML. Dieselbe
  // Lehre wie bei den beiden Antragsformularen: der Wert stand einmal in
  // den Stammdaten und war dort mit einem Probewert ueberschrieben.
  if (kodexInfo.verein) {
    $("verein-name").textContent = kodexInfo.verein;
    document.querySelectorAll(".verein-name-text").forEach((s) => {
      s.textContent = kodexInfo.verein;
    });
  }

  // Ebenso die Fassung des Kodex. Sie steht in der unterschriebenen
  // Erklaerung -- ein alter Browser-Cache darf hier nicht eine andere
  // Zahl anzeigen als die, die der Server mitspeichert.
  if (kodexInfo.kodex_version) {
    $("k-version-text").textContent = "in der Fassung " + kodexInfo.kodex_version;
  }

  if (!kodexInfo.offen) {
    $("zu-schirm").hidden = false;
    return;
  }

  // ⚠️ Der Server sagt, ob er die Erklaerung auch ANNEHMEN kann. Fehlt die
  // Ablage noch (frisch ausgerollt, die Einrichtung laeuft beim ersten
  // Oeffnen der Verwaltung), dann gar kein Formular: sonst unterschreibt
  // eine Familie und erfaehrt erst beim Absenden davon.
  if (kodexInfo.bereit === false) {
    const schirm = $("zu-schirm");
    schirm.innerHTML =
      "<h2>Gleich verfügbar</h2>" +
      "<p>Diese Seite wird gerade eingerichtet und nimmt in wenigen Minuten " +
      "Erklärungen an. Bitte später noch einmal aufrufen.</p>" +
      '<p class="fussnote">Hilft das nicht, freut sich die Geschäftsstelle über ' +
      "einen Anruf: 03606 612206.</p>";
    schirm.hidden = false;
    return;
  }

  $("formular").hidden = false;
  $("k-datum").value = datumDe(heuteIso());

  // ⚠️ ERST jetzt. Hinter hidden ist das Canvas 0x0, und dann bleibt das
  // Bitmap leer -- gezeichnet wuerde, aber nichts erschiene. Flottenregel.
  sigPad = createSignaturePad($("k-sig"));
  sigPad.resize();
}

function verdrahte() {
  document.querySelectorAll("nav button[data-tab]").forEach((b) => {
    b.addEventListener("click", () => zeigeTab(b.dataset.tab));
  });
  $("btn-sig-loeschen").addEventListener("click", () => { if (sigPad) sigPad.clear(); });
  $("btn-kodex-senden").addEventListener("click", absenden);
  $("btn-drucken").addEventListener("click", () => window.print());
  $("btn-weiteres-kind").addEventListener("click", weiteresKind);
}

function zeigeTab(id) {
  document.querySelectorAll("nav button[data-tab]").forEach((b) => {
    b.classList.toggle("aktiv", b.dataset.tab === id);
  });
  document.querySelectorAll("main section.tab").forEach((s) => {
    s.classList.toggle("aktiv", s.id === id);
  });
  window.scrollTo(0, 0);
}

// Wie auf den beiden Antragsseiten: die Pille haengt an der Sitzung. Wer
// ohne Konto herkommt, sieht sie nicht -- fuer ihn waere ein Knopf ins
// Anmeldefenster einer internen Verwaltung eine Sackgasse.
function pruefeAnmeldung() {
  if (antragToken()) $("dashboard-pille").hidden = false;
}

function zeigeInfo() {
  $("info-version").textContent = ANTRAG_VERSION;
  $("info-changelog").innerHTML = KODEX_CHANGELOG.map((b) =>
    '<div class="changelog-block">' +
      "<h3>" + esc(b.version) + "</h3>" +
      '<div class="changelog-datum">' + esc(datumDe(b.datum)) + "</div>" +
      "<ul>" + b.punkte.map((p) => "<li>" + esc(p) + "</li>").join("") + "</ul>" +
    "</div>").join("");
}

// ---------------------------------------------------------------------
// Absenden
// ---------------------------------------------------------------------

function meldung(text) {
  const feld = $("k-meldung");
  if (!text) { feld.hidden = true; feld.textContent = ""; return; }
  feld.textContent = text;
  feld.hidden = false;
  feld.scrollIntoView({ block: "center" });
}

function sammle() {
  return {
    kind_vorname: $("k-kind-vorname").value.trim(),
    kind_nachname: $("k-kind-nachname").value.trim(),
    kind_geburtsdatum: $("k-kind-geburtsdatum").value,
    mannschaft: $("k-mannschaft").value.trim(),
    erz_name: $("k-erz-name").value.trim(),
    erz_email: $("k-erz-email").value.trim(),
    ort: $("k-ort").value.trim(),
    einwilligung_kodex: $("k-ew-kodex").checked,
    unterschrift: sigPad ? sigPad.toDataURL() : ""
  };
}

// Vorpruefung fuer die sofortige Rueckmeldung. Massgeblich bleibt der
// Server -- pruefeKodex() dort prueft dasselbe noch einmal, und nur das
// ist eine Zusage.
function pruefeVorOrt(daten) {
  if (!daten.kind_vorname || !daten.kind_nachname) {
    return "Bitte Vor- und Nachnamen des Kindes angeben.";
  }
  if (!daten.kind_geburtsdatum) {
    return "Bitte das Geburtsdatum des Kindes angeben.";
  }
  const alter = alterHeute(daten.kind_geburtsdatum);
  if (alter === null) return "Das Geburtsdatum ist nicht lesbar.";
  if (alter < 0) return "Das Geburtsdatum liegt in der Zukunft.";
  if (!daten.erz_name) {
    return "Bitte den Namen der unterschreibenden Person angeben.";
  }
  if (!daten.einwilligung_kodex) {
    return "Bitte bestaetigen Sie, dass Sie den Elternkodex gelesen haben und anerkennen.";
  }
  if (!daten.unterschrift) {
    return "Bitte im Feld unterschreiben.";
  }
  return null;
}

async function absenden() {
  if (laeuft) return;
  meldung("");

  const daten = sammle();
  const fehler = pruefeVorOrt(daten);
  if (fehler) { meldung(fehler); return; }

  laeuft = true;
  const knopf = $("btn-kodex-senden");
  knopf.disabled = true;
  knopf.textContent = "Wird gesendet …";

  try {
    const antwort = await sendeKodex(daten);
    zeigeDanke(daten, antwort);
  } catch (e) {
    meldung(e.message);
  } finally {
    laeuft = false;
    knopf.disabled = false;
    knopf.textContent = "Bestätigung absenden";
  }
}

// Die eigene Kopie der Erklaerung. Sie enthaelt bewusst dasselbe, was
// gespeichert wurde -- samt Unterschrift und Fassung: eine Bestaetigung
// ohne die Fassung des Textes belegt nicht, WAS anerkannt wurde.
function zeigeDanke(daten, antwort) {
  $("formular").hidden = true;
  $("danke").hidden = false;

  const fassung = (antwort && antwort.kodex_version) || (kodexInfo && kodexInfo.kodex_version) || "";
  $("danke-kopf").textContent =
    "Eingegangen am " + datumDe((antwort && antwort.eingang_am) || heuteIso()) +
    " für " + daten.kind_vorname + " " + daten.kind_nachname + ".";

  const zeile = (titel, wert) => wert
    ? "<p><strong>" + esc(titel) + ":</strong> " + esc(wert) + "</p>" : "";

  $("danke-zusammenfassung").innerHTML =
    "<h3>Ihre Erklärung</h3>" +
    zeile("Kind", daten.kind_vorname + " " + daten.kind_nachname) +
    zeile("Geburtsdatum", datumDe(daten.kind_geburtsdatum)) +
    zeile("Mannschaft", daten.mannschaft) +
    zeile("Erziehungsberechtigte", daten.erz_name) +
    zeile("E-Mail", daten.erz_email) +
    zeile("Ort", daten.ort) +
    zeile("Datum", datumDe(heuteIso())) +
    zeile("Fassung des Elternkodex", fassung) +
    "<p><strong>Erklärung:</strong> Der Elternkodex des Vereins wurde " +
    "heruntergeladen, gelesen und wird anerkannt.</p>" +
    '<div class="unterschrift-block">' +
      '<div class="unterschrift-titel">Unterschrift der Erziehungsberechtigten</div>' +
      '<img alt="Unterschrift der Erziehungsberechtigten" ' +
        'style="max-width:100%;background:#fff" src="' + esc(daten.unterschrift) + '">' +
    "</div>";

  window.scrollTo(0, 0);
}

// Der haeufigste naechste Schritt ist das zweite Kind derselben Familie.
//
// ⚠️ Die UNTERSCHRIFT wird geleert, obwohl dieselbe Person unterschreibt.
// Eine Erklaerung fuer ein anderes Kind ist eine eigene Erklaerung; eine
// uebernommene Unterschrift waere keine geleistete. Name, E-Mail und Ort
// bleiben stehen -- die aendern sich nicht und noch einmal zu tippen
// waere Schikane.
function weiteresKind() {
  $("danke").hidden = true;
  $("formular").hidden = false;

  $("k-kind-vorname").value = "";
  $("k-kind-nachname").value = "";
  $("k-kind-geburtsdatum").value = "";
  $("k-mannschaft").value = "";

  if (sigPad) {
    sigPad.clear();
    // Das Canvas war hinter hidden und ist dort auf 0x0 gefallen.
    sigPad.resize();
  }

  meldung("");
  window.scrollTo(0, 0);
  $("k-kind-vorname").focus();
}

document.addEventListener("DOMContentLoaded", start);
