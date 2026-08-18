// Reiter „Elternkodex" der Verwaltung.
//
// Zwei Fragen auf einem Blatt:
//   1. Welche minderjaehrigen Mitglieder haben die Kenntnisnahme noch nicht
//      abgegeben? (Liste „offen")
//   2. Welche Erklaerungen sind eingegangen, passen aber zu keinem Kind?
//      (Karte „Nicht zuzuordnen")
//
// ⚠️ Die zweite Frage ist die wichtigere. Eine Erklaerung mit abweichender
// Schreibweise ist abgegeben, die Familie haelt sie fuer erledigt -- ohne
// diese Karte stuende sie in keiner Uebersicht und niemand erfuehre davon.
// Deshalb hat sie eine eigene Karte mit Zaehler und nicht eine Zeile
// irgendwo unten.

const KO_ADRESSE = "https://sc1911heiligenstadt.github.io/vereinsverwaltung/kodex.html";

const KO_SICHT = {
  offen: "Noch offen",
  bestaetigt: "Bestätigt",
  alle: "Alle"
};

let koSicht = "offen";
let koDaten = null;      // die letzte Antwort von vv-kodex-liste
let koSparte = "";
let koSuche = "";
// Bei der Handzuordnung: die Erklaerung, fuer die gerade ein Kind gesucht
// wird. Ohne den Merker wuesste der Klick auf ein Kind nicht, wohin.
let koZuordnenId = null;

// ---------------------------------------------------------------------
// Laden
// ---------------------------------------------------------------------

async function ladeKodex() {
  const ziel = $("ko-liste");
  ziel.innerHTML = '<div class="leer">Wird geladen …</div>';
  koMeldung("");

  let antwort;
  try {
    antwort = await ladeKodexListe({ sparte_id: koSparte });
  } catch (e) {
    // Die Tabelle entsteht in der Migration. Antwortet der Server mit 409,
    // ist sie noch nicht da -- das ist keine Stoerung, sondern eine noch
    // nicht gelaufene Einrichtung, und der Text sagt es genau so.
    ziel.innerHTML = '<div class="hinweis ' +
      (e && e.message && /Einrichtung/.test(e.message) ? "warn" : "fehler") + '">' +
      esc(e.message) + "</div>";
    return;
  }

  koDaten = antwort;
  zeichneKodexSparten();
  zeichneKodexStand();
  zeichneKodexReiter();
  zeichneKodexListe();
  zeichneKodexOffene();
  zeichneKodexVerteilen();
}

// ---------------------------------------------------------------------
// Kopf: Stand und Verteilen
// ---------------------------------------------------------------------

function koMeldung(text, art) {
  const erfolg = $("ko-erfolg");
  const fehler = $("ko-fehler");
  erfolg.hidden = true;
  fehler.hidden = true;
  if (!text) return;
  const feld = art === "fehler" ? fehler : erfolg;
  feld.textContent = text;
  feld.hidden = false;
}

function zeichneKodexStand() {
  const kinder = koDaten.kinder || [];
  const fertig = kinder.filter((k) => k.bestaetigung_id).length;
  const offen = kinder.length - fertig;
  const anteil = kinder.length ? Math.round((fertig / kinder.length) * 100) : 0;

  $("ko-stand").innerHTML =
    '<div class="hinweis ' + (offen === 0 && kinder.length ? "erfolg" : "info") + '">' +
      "<strong>" + fertig + " von " + kinder.length + "</strong> minderjährigen " +
      "Mitgliedern liegt die Kenntnisnahme vor (" + anteil + " %)." +
      (offen ? " <strong>" + offen + "</strong> " +
               (offen === 1 ? "fehlt" : "fehlen") + " noch." : "") +
    "</div>" +
    '<p class="fussnote">Stichtag ' + esc(datumDe(koDaten.stichtag)) +
    ", Fassung des Kodex: " + esc(koDaten.kodex_version || "—") + ".</p>";
}

// Der Link und der Schalter. Nur mit Schreibrecht -- den Eingangsweg des
// ganzen Vereins zuzudrehen ist kein Leserecht, und der Server weist die
// Aktion einer Nur-Lese-Rolle ohnehin ab.
async function zeichneKodexVerteilen() {
  if (!koDaten.darf_schreiben) {
    $("ko-verteilen-karte").hidden = true;
    return;
  }
  $("ko-verteilen-karte").hidden = false;
  $("ko-link").value = KO_ADRESSE;

  const ziel = $("ko-schalter");
  let antwort;
  try {
    antwort = await vvRequest("vv-einstellungen", {});
  } catch (e) {
    ziel.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  const feld = (antwort.felder || []).find((f) => f.schluessel === "kodex_offen");
  // Fehlt der Schluessel, gilt die Vorgabe des Servers (1 = offen). Ein
  // fehlender Wert darf nicht als „geschlossen" erscheinen -- dann suchte
  // jemand einen Schalter, der gar nicht umgelegt ist.
  const offen = !feld || feld.wert === null || feld.wert === undefined || feld.wert === ""
    || feld.wert === "1";

  ziel.innerHTML =
    '<div class="hinweis ' + (offen ? "erfolg" : "warn") + '" style="margin-top:12px">' +
      "Die Seite ist zurzeit <strong>" + (offen ? "geöffnet" : "geschlossen") + "</strong>." +
      (offen ? "" : " Wer den Link aufruft, bekommt einen Hinweis auf die Geschäftsstelle.") +
    "</div>" +
    '<div class="knopfreihe"><button class="btn ' + (offen ? "warn" : "") +
      '" id="btn-ko-umschalten">' +
      (offen ? "Seite schließen" : "Seite öffnen") + "</button></div>";

  $("btn-ko-umschalten").addEventListener("click", () => schalteKodex(offen ? "0" : "1"));
}

async function schalteKodex(wert) {
  try {
    await vvRequest("vv-einstellung-setzen", { schluessel: "kodex_offen", wert });
  } catch (e) {
    koMeldung(e.message, "fehler");
    return;
  }
  koMeldung(wert === "1" ? "Die Seite ist jetzt geöffnet."
                         : "Die Seite ist jetzt geschlossen.");
  zeichneKodexVerteilen();
}

// ---------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------

function zeichneKodexSparten() {
  const ziel = $("ko-sparte");
  // Nur neu aufbauen, wenn nötig -- sonst verliert das Feld bei jedem
  // Laden seine Auswahl.
  if (ziel.dataset.gefuellt === "1") { ziel.value = koSparte; return; }
  ziel.innerHTML = '<option value="">Alle Abteilungen</option>' +
    (koDaten.sparten || []).map((s) =>
      '<option value="' + esc(s.id) + '">' + esc(s.name) + "</option>").join("");
  ziel.dataset.gefuellt = "1";
  ziel.value = koSparte;
}

function zeichneKodexReiter() {
  const kinder = koDaten.kinder || [];
  const zahl = {
    offen: kinder.filter((k) => !k.bestaetigung_id).length,
    bestaetigt: kinder.filter((k) => k.bestaetigung_id).length,
    alle: kinder.length
  };
  $("ko-reiter").innerHTML = Object.keys(KO_SICHT).map((s) =>
    '<button class="btn klein ' + (s === koSicht ? "" : "grau") + '" data-kosicht="' +
    s + '">' + KO_SICHT[s] + " (" + zahl[s] + ")</button>").join(" ");

  $("ko-reiter").querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      koSicht = b.dataset.kosicht;
      zeichneKodexReiter();
      zeichneKodexListe();
    });
  });
}

// ---------------------------------------------------------------------
// Die Kinderliste
// ---------------------------------------------------------------------

function koPasst(k) {
  if (koSicht === "offen" && k.bestaetigung_id) return false;
  if (koSicht === "bestaetigt" && !k.bestaetigung_id) return false;
  if (!koSuche) return true;
  return (k.vorname + " " + k.nachname).toLowerCase().includes(koSuche);
}

function zeichneKodexListe() {
  const ziel = $("ko-liste");
  const zeilen = (koDaten.kinder || []).filter(koPasst);

  if (!zeilen.length) {
    ziel.innerHTML = '<div class="leer">' +
      (koSuche ? "Kein Kind gefunden."
        : koSicht === "offen"
          ? "Von allen minderjährigen Mitgliedern liegt die Kenntnisnahme vor."
          : "Keine Einträge.") + "</div>";
    return;
  }

  // Beim Zuordnen ist die Liste die AUSWAHL: ein Klick auf ein Kind
  // verbindet die vorgemerkte Erklaerung damit. Der Hinweis muss über der
  // Liste stehen, sonst klickt jemand und wundert sich.
  const zuordnen = !!koZuordnenId;

  ziel.innerHTML =
    (zuordnen
      ? '<div class="hinweis warn">Bitte das Kind anklicken, zu dem die vorgemerkte ' +
        "Erklärung gehört. " +
        '<button class="btn grau klein" id="btn-ko-zuordnen-ab">Abbrechen</button></div>'
      : "") +
    '<div class="tabelle-scroll"><table><thead><tr>' +
    "<th>Name</th><th>Geboren</th><th>Nr.</th><th>Kenntnisnahme</th>" +
    "<th>Unterschrieben von</th><th></th>" +
    "</tr></thead><tbody>" +
    zeilen.map((k) =>
      '<tr class="ko-kind" data-person="' + esc(k.person_id) + '">' +
        '<td class="name">' + esc(k.vorname + " " + k.nachname) + "</td>" +
        "<td>" + esc(datumDe(k.geburtsdatum)) + "</td>" +
        "<td>" + esc(k.mitgliedsnummer || "") + "</td>" +
        "<td>" + (k.bestaetigung_id
          ? '<span class="chip aktiv">' + esc(datumDe(k.bestaetigt_am)) + "</span>" +
            (k.von_hand ? ' <span class="chip ruhend">von Hand</span>' : "")
          : '<span class="chip gekuendigt">offen</span>') + "</td>" +
        "<td>" + esc(k.erz_name || "") + "</td>" +
        "<td>" + (k.bestaetigung_id && !zuordnen
          ? '<button class="btn grau klein" data-ko-detail="' + esc(k.bestaetigung_id) +
            '">Ansehen</button>'
          : "") + "</td>" +
      "</tr>").join("") +
    "</tbody></table></div>";

  ziel.querySelectorAll("[data-ko-detail]").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      zeigeKodexDetail(b.dataset.koDetail);
    });
  });

  if (zuordnen) {
    ziel.querySelectorAll("tr.ko-kind").forEach((tr) => {
      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => fuehreZuordnungAus(tr.dataset.person));
    });
    $("btn-ko-zuordnen-ab").addEventListener("click", () => {
      koZuordnenId = null;
      koMeldung("");
      zeichneKodexListe();
    });
  }
}

// ---------------------------------------------------------------------
// Nicht zuzuordnende Erklaerungen
// ---------------------------------------------------------------------

function zeichneKodexOffene() {
  const liste = koDaten.offene_eingaenge || [];
  const karte = $("ko-offen-karte");

  if (!liste.length) { karte.hidden = true; return; }
  karte.hidden = false;
  $("ko-offen-zahl").textContent = liste.length;

  $("ko-offen-liste").innerHTML =
    '<div class="tabelle-scroll"><table><thead><tr>' +
    "<th>Eingang</th><th>Kind (Angabe der Eltern)</th><th>Geboren</th>" +
    "<th>Mannschaft</th><th>Unterschrieben von</th><th>E-Mail</th><th></th>" +
    "</tr></thead><tbody>" +
    liste.map((b) =>
      "<tr>" +
        "<td>" + esc(datumDe(b.eingang_am)) + "</td>" +
        '<td class="name">' + esc(b.kind_vorname + " " + b.kind_nachname) +
          // Eine Handzuordnung, die auf ein Kind zeigt, das nicht mehr in
          // der Liste steht (ausgetreten, volljaehrig, andere Abteilung).
          // Kein Fehler -- aber ohne den Hinweis sähe es nach einem aus.
          (b.zugeordnet
            ? ' <span class="chip ruhend">zugeordnet, nicht im Bestand</span>' : "") +
          "</td>" +
        "<td>" + esc(datumDe(b.kind_geburtsdatum)) + "</td>" +
        "<td>" + esc(b.mannschaft || "") + "</td>" +
        "<td>" + esc(b.erz_name || "") + "</td>" +
        "<td>" + (b.erz_email
          ? '<a href="mailto:' + esc(b.erz_email) + '">' + esc(b.erz_email) + "</a>" : "") +
          "</td>" +
        '<td><button class="btn grau klein" data-ko-detail2="' + esc(b.id) +
          '">Ansehen</button></td>' +
      "</tr>").join("") +
    "</tbody></table></div>";

  $("ko-offen-liste").querySelectorAll("[data-ko-detail2]").forEach((b) => {
    b.addEventListener("click", () => zeigeKodexDetail(b.dataset.koDetail2));
  });
}

// ---------------------------------------------------------------------
// Eine Erklaerung ansehen
// ---------------------------------------------------------------------

async function zeigeKodexDetail(id) {
  const inhalt = $("ko-inhalt");
  inhalt.innerHTML = '<div class="leer">Wird geladen …</div>';
  $("kodex-overlay").hidden = false;

  let d;
  try {
    d = await ladeKodexDetail(id);
  } catch (e) {
    inhalt.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }

  const zeile = (titel, wert) => wert
    ? "<tr><th>" + esc(titel) + "</th><td>" + wert + "</td></tr>" : "";

  inhalt.innerHTML =
    '<div class="tabelle-scroll"><table class="zusammenfassung"><tbody>' +
      zeile("Eingegangen", esc(datumDe(d.eingang_am))) +
      zeile("Kind (Angabe der Eltern)", esc(d.kind_vorname + " " + d.kind_nachname)) +
      zeile("Geburtsdatum", esc(datumDe(d.kind_geburtsdatum))) +
      zeile("Mannschaft", esc(d.mannschaft)) +
      zeile("Unterschrieben von", esc(d.erz_name)) +
      zeile("E-Mail", d.erz_email
        ? '<a href="mailto:' + esc(d.erz_email) + '">' + esc(d.erz_email) + "</a>" : "") +
      zeile("Ort", esc(d.ort)) +
      // Die Fassung gehoert zum Beleg: ohne sie ist nicht sagbar, WAS
      // anerkannt wurde. Der Kodex wird fortgeschrieben.
      zeile("Fassung des Kodex", esc(d.kodex_version)) +
      zeile("Zugeordnet zu", d.person_name
        ? esc(d.person_name) + ' <span class="chip ruhend">von Hand, ' +
          esc(datumDe(d.zugeordnet_am)) + " durch " + esc(d.zugeordnet_von || "") + "</span>"
        : "") +
    "</tbody></table></div>" +
    '<p class="fussnote">Erklärt wurde: Der Elternkodex des Vereins wurde ' +
      "heruntergeladen, gelesen und wird anerkannt.</p>" +
    '<div class="unterschrift-block">' +
      '<div class="unterschrift-titel">Unterschrift der Erziehungsberechtigten</div>' +
      (d.unterschrift
        ? '<img alt="Unterschrift der Erziehungsberechtigten" ' +
          'style="max-width:100%;background:#fff" src="' + esc(d.unterschrift) + '">'
        : '<div class="leer">Keine Unterschrift gespeichert.</div>') +
    "</div>" +
    (d.darf_schreiben
      ? '<div class="knopfreihe" style="margin-top:14px">' +
          '<button class="btn" id="btn-ko-zuordnen" data-id="' + esc(d.id) + '">' +
            (d.person_id ? "Anderem Kind zuordnen" : "Von Hand zuordnen") + "</button>" +
          (d.person_id
            ? '<button class="btn grau" id="btn-ko-loesen" data-id="' + esc(d.id) +
              '">Zuordnung aufheben</button>' : "") +
          '<button class="btn warn" id="btn-ko-loeschen" data-id="' + esc(d.id) +
            '">Erklärung löschen</button>' +
        "</div>" +
        '<p class="fussnote">Löschen ist für zurückgezogene Erklärungen und Testeinträge ' +
        "gedacht. Die Unterschrift wird mitgelöscht.</p>"
      : "");

  if (d.darf_schreiben) {
    $("btn-ko-zuordnen").addEventListener("click", () => starteZuordnung(d.id));
    if ($("btn-ko-loesen")) {
      $("btn-ko-loesen").addEventListener("click", () => loeseZuordnung(d.id));
    }
    $("btn-ko-loeschen").addEventListener("click", () => loescheErklaerung(d.id, d));
  }
}

// ---------------------------------------------------------------------
// Handzuordnung
// ---------------------------------------------------------------------

// Zweistufig: erst vormerken, dann in der Kinderliste anklicken. Ein
// Auswahlfeld mit dreihundert Namen wäre am Handy unbedienbar, und die
// Liste steht ohnehin schon da -- samt Suchfeld.
function starteZuordnung(id) {
  koZuordnenId = id;
  $("kodex-overlay").hidden = true;
  koMeldung("Erklärung vorgemerkt. Bitte unten das Kind anklicken, zu dem sie gehört.");
  koSicht = "alle";
  zeichneKodexReiter();
  zeichneKodexListe();
  $("ko-liste").scrollIntoView({ block: "start" });
}

async function fuehreZuordnungAus(personId) {
  if (!koZuordnenId) return;
  const id = koZuordnenId;
  koZuordnenId = null;

  try {
    const antwort = await ordneKodexZu(id, personId);
    koMeldung("Die Erklärung ist " + (antwort.person_name || "dem Kind") + " zugeordnet.");
  } catch (e) {
    koMeldung(e.message, "fehler");
  }
  ladeKodex();
}

async function loeseZuordnung(id) {
  if (!confirm("Die Zuordnung dieser Erklärung aufheben?\n\n" +
               "Die Erklärung selbst bleibt gespeichert. Sie wird danach wieder " +
               "über den Namen abgeglichen.")) return;
  try {
    await ordneKodexZu(id, "");
    koMeldung("Die Zuordnung ist aufgehoben.");
  } catch (e) {
    koMeldung(e.message, "fehler");
  }
  $("kodex-overlay").hidden = true;
  ladeKodex();
}

async function loescheErklaerung(id, d) {
  if (!confirm("Die Erklärung für " + d.kind_vorname + " " + d.kind_nachname +
               " endgültig löschen?\n\nDie Unterschrift wird mitgelöscht. " +
               "Das Kind erscheint danach wieder als offen.")) return;
  try {
    await loescheKodex(id);
    koMeldung("Die Erklärung ist gelöscht.");
  } catch (e) {
    koMeldung(e.message, "fehler");
  }
  $("kodex-overlay").hidden = true;
  ladeKodex();
}

// ---------------------------------------------------------------------
// Verdrahtung
// ---------------------------------------------------------------------

function verdrahteKodex() {
  $("btn-ko-zu").addEventListener("click", () => { $("kodex-overlay").hidden = true; });
  $("btn-ko-schliessen").addEventListener("click", () => { $("kodex-overlay").hidden = true; });
  $("kodex-overlay").addEventListener("click", (e) => {
    if (e.target === $("kodex-overlay")) $("kodex-overlay").hidden = true;
  });

  $("ko-sparte").addEventListener("change", () => {
    koSparte = $("ko-sparte").value;
    ladeKodex();
  });

  // Rein im Browser gefiltert: die Liste liegt schon vollstaendig da, ein
  // Server-Aufruf je Tastendruck waere Verschwendung.
  $("ko-suche").addEventListener("input", () => {
    koSuche = $("ko-suche").value.trim().toLowerCase();
    if (koDaten) zeichneKodexListe();
  });

  $("btn-ko-kopieren").addEventListener("click", async () => {
    const feld = $("ko-link");
    try {
      await navigator.clipboard.writeText(feld.value);
      koMeldung("Der Link ist kopiert.");
    } catch {
      // Ohne Berechtigung fuer die Zwischenablage (aeltere Geraete, kein
      // https): markieren, damit der Link von Hand kopierbar ist, statt
      // nur zu melden, dass es nicht ging.
      feld.focus();
      feld.select();
      koMeldung("Bitte den markierten Link von Hand kopieren.");
    }
  });
}
