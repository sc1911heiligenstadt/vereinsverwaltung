// Oeffentlicher Aufnahmeantrag nach § 4 der Satzung.
//
// Diese Datei laeuft auf der einzigen Seite der App ohne Anmeldung. Sie
// kennt die Verwaltungsaktionen nicht einmal dem Namen nach — der Weg
// nach draussen fuehrt ausschliesslich ueber die beiden Aktionen in
// db-antrag.js.
//
// Eigene Helfer statt app.js: die Seite laedt bewusst kein einziges
// Skript der Verwaltung mit.
//
// ⚠️ Die Helfer und der Formularkern stehen seit 06.08.2026 in
// antrag-felder.js und werden mit nachwuchs.html GETEILT -- $, esc, eur,
// datumDe, heuteIso, ibanPruefziffer, alterHeute, istLastschrift,
// sammleGemeinsameFelder, pruefeGemeinsameFelder, sammleSparten,
// baueMandatstext, baueBeitragsliste, baueSpartenAuswahl, sigFeldPflegen.
// Hier steht nur noch, was diese Seite allein betrifft. Wer eine der
// Funktionen zurueckkopiert, hat nach der ersten Aenderung zwei
// verschiedene Antraege.

let info = null;
let sigPad = null;
let sigPadGesetzl = null;
let sigPadGesetzl2 = null;
let laeuft = false;

// Sicht-Reiter. Nur belegt, wenn jemand angemeldet ist UND schreiben darf.
let eingangStatus = "neu";
let eingangZaehler = {};
let eingangAktuell = null;
let eingangStammdaten = null;
let eingangNurNachwuchs = false;

const EINGANG_STATUS_TEXT = {
  neu: "Neu",
  geprueft: "Vorgemerkt",
  angenommen: "Angenommen",
  abgelehnt: "Abgelehnt",
  zurueckgezogen: "Zurückgezogen"
};

// ---------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------

async function start() {
  // Reiter und Info stehen unabhaengig vom Formular. Sie muessen auch
  // dann bedienbar bleiben, wenn der Server das Formular nicht liefert --
  // sonst faehrt ein Serverfehler die ganze Seite an die Wand.
  verdrahteReiter();
  zeigeInfo();
  pruefeAnmeldung();

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
  $("a-sig-datum").value = datumDe(heuteIso());
  $("formular").hidden = false;

  // Erst jetzt: ein Canvas hinter hidden misst 0x0, und dann bleibt das
  // Zeichenfeld leer, egal was jemand hineinmalt.
  sigPad = createSignaturePad($("a-sig"));
  sigPad.resize();

  verdrahten();
}

// ---------------------------------------------------------------------
// Reiter, Anmeldung, Info
// ---------------------------------------------------------------------

function verdrahteReiter() {
  document.querySelectorAll("nav button").forEach((b) => {
    b.addEventListener("click", () => zeigeReiter(b.dataset.tab));
  });
  // ⚠️ Nicht in verdrahten(): das läuft erst, wenn das Formular geladen
  // ist. Ist der Antrag gerade zugedreht, gäbe es den Sicht-Reiter zwar,
  // aber sein Knopf täte nichts.
  $("btn-eingang-neu").addEventListener("click", () => ladeEingang());
}

function zeigeReiter(id) {
  document.querySelectorAll("nav button").forEach((b) => {
    b.classList.toggle("aktiv", b.dataset.tab === id);
  });
  document.querySelectorAll("main section.tab").forEach((s) => {
    s.classList.toggle("aktiv", s.id === id);
  });
  window.scrollTo(0, 0);
}

// Die Dashboard-Pille und der Sicht-Reiter haengen an der SITZUNG, nicht
// an der Seite. Wer ohne Konto herkommt, sieht beides nicht -- fuer ihn
// waere ein Knopf ins Anmeldefenster einer internen Verwaltung eine
// Sackgasse, und die Antragsliste geht ihn nichts an.
async function pruefeAnmeldung() {
  if (!antragToken()) return;
  $("dashboard-pille").hidden = false;

  let rechte;
  try {
    rechte = await ladeEigeneRechteAntrag();
  } catch {
    // Abgelaufene Sitzung, fehlende Rolle, Server weg: die Seite bleibt
    // das, was sie in erster Linie ist -- ein Antragsformular.
    return;
  }
  if (!rechte || !rechte.darfSchreiben) return;

  $("nav-eingang").hidden = false;
  ladeEingang();
  // Die Stammdaten braucht nur die Fusszeile des Ausdrucks. Ein
  // Fehlschlag (etwa fehlendes Bankdaten-Recht) darf den Reiter nicht
  // aufhalten.
  ladeStammdatenAntrag()
    .then((a) => {
      eingangStammdaten = {};
      (a.felder || []).forEach((f) => { eingangStammdaten[f.schluessel] = f.wert; });
    })
    .catch(() => { eingangStammdaten = null; });
}

// Gleiche Struktur wie der Changelog der Verwaltung (app.js), damit die
// vorhandenen Klassen greifen -- .changelog-block erwartet h3 und
// .changelog-datum. Nachgebaut sähe es hier anders aus als dort.
function zeigeInfo() {
  $("info-version").textContent = ANTRAG_VERSION;
  $("info-changelog").innerHTML = ANTRAG_CHANGELOG.map((block) =>
    block.groups.map((g) =>
      '<div class="changelog-block">' +
        "<h3>" + esc(g.title) + "</h3>" +
        "<ul>" + g.items.map((p) => "<li>" + esc(p) + "</li>").join("") + "</ul>" +
      "</div>"
    ).join("")
  ).join("");
}

// ---------------------------------------------------------------------
// Eingegangene Anträge — sichten und ausdrucken
// ---------------------------------------------------------------------

async function ladeEingang(status) {
  if (status) eingangStatus = status;
  const ziel = $("eingang-liste");
  ziel.innerHTML = '<p class="fussnote">Wird geladen …</p>';
  $("eingang-detail").hidden = true;

  let antwort;
  try {
    antwort = await ladeEingegangeneAntraege(eingangStatus);
  } catch (e) {
    ziel.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  eingangZaehler = antwort.nach || {};
  // Die Oberflaeche richtet sich nach dem, was der Server GELIEFERT hat,
  // nicht nach dem, was sie zu duerfen glaubt -- dieselbe Regel wie in
  // antraege.js. Der Reiter erscheint zwar nur mit darfSchreiben, aber
  // die Antwort ist die einzige Quelle, die auch dann noch stimmt, wenn
  // sich die Rechteableitung im Worker einmal aendert.
  eingangNurNachwuchs = !!antwort.nur_nachwuchs;
  zeichneEingangReiter();
  zeichneEingangListe(antwort.antraege || []);
}

function zeichneEingangReiter() {
  $("eingang-reiter").innerHTML = Object.keys(EINGANG_STATUS_TEXT).map((s) =>
    '<button class="btn klein ' + (s === eingangStatus ? "" : "grau") +
    '" type="button" data-eingang="' + s + '">' + EINGANG_STATUS_TEXT[s] +
    " (" + (eingangZaehler[s] || 0) + ")</button>").join(" ");

  $("eingang-reiter").querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => ladeEingang(b.dataset.eingang));
  });
}

function zeichneEingangListe(liste) {
  const ziel = $("eingang-liste");
  if (!liste.length) {
    ziel.innerHTML = '<p class="fussnote">Keine Anträge mit dem Status &bdquo;' +
      esc(EINGANG_STATUS_TEXT[eingangStatus]) + "&ldquo;.</p>";
    return;
  }

  const loeschbar = darfEingangLoeschen();

  // ⚠️ Der Löschknopf steht in DERSELBEN Zelle wie „Ansehen" und trägt ein
  // Kreuz statt des Wortes. Beides ist Platzrechnung, nicht Geschmack: mit
  // eigener Spalte und ausgeschriebenem „Löschen" braucht die Tabelle
  // 788 px statt 675 und scrollt in sich — ausgerechnet der neue Knopf
  // verschwindet dann hinter der rechten Kante (von Michel gemeldet).
  // Zusammen mit .umbruch an Name und Ort passt sie wieder ohne Laufleiste.
  ziel.innerHTML =
    '<div class="tabelle-scroll"><table class="schmal"><thead><tr>' +
    "<th>Eingang</th><th>Name</th><th>Geboren</th><th>Ort</th><th>Zahlung</th><th></th>" +
    "</tr></thead><tbody>" +
    liste.map((a) =>
      "<tr>" +
        "<td>" + esc(datumDe(a.eingang_am)) + "</td>" +
        '<td class="umbruch">' + esc(a.vorname + " " + a.nachname) +
          (a.minderjaehrig ? ' <span class="fussnote">(minderjährig)</span>' : "") + "</td>" +
        "<td>" + esc(datumDe(a.geburtsdatum)) + "</td>" +
        '<td class="umbruch">' + esc(a.ort) + "</td>" +
        "<td>" + esc(a.zahlungsart === "lastschrift" ? "Lastschrift" : "Überweisung") + "</td>" +
        '<td class="zeilen-knoepfe">' +
          '<button class="btn klein" type="button" data-antrag="' + esc(a.id) +
            '">Ansehen</button>' +
          (loeschbar
            ? '<button class="btn klein warn kreuz" type="button" data-eingangloeschen="' +
              esc(a.id) + '" title="Diesen Antrag endgültig löschen" ' +
              'aria-label="Antrag löschen">&times;</button>'
            : "") +
        "</td>" +
      "</tr>").join("") +
    "</tbody></table></div>";

  ziel.querySelectorAll("[data-antrag]").forEach((b) => {
    b.addEventListener("click", () => oeffneEingang(b.dataset.antrag));
  });
  ziel.querySelectorAll("[data-eingangloeschen]").forEach((b) => {
    b.addEventListener("click", () => loescheEingang(b.dataset.eingangloeschen));
  });
}

// Zwei Bedingungen, beide serverseitig ohnehin durchgesetzt — hier geht es
// nur darum, keinen Knopf zu zeigen, der sicher 403 oder 409 antwortet.
// Dieselbe Regel wie anDarfLoeschen() in antraege.js; sie steht hier ein
// zweites Mal, weil diese Seite bewusst kein Skript der Verwaltung laedt.
// ⚠️ Wer eine der beiden aendert, aendert beide.
//   * Die Passstelle loescht nicht. nur_nachwuchs heisst beim Server
//     !darfSchreiben, und genau daran haengt vv-antrag-loeschen.
//   * Ein angenommener Antrag bleibt stehen. An ihm haengen Mitgliedschaft
//     und SEPA-Mandat; die Mitgliedschaft endet ueber den Austritt.
function darfEingangLoeschen() {
  return !eingangNurNachwuchs && eingangStatus !== "angenommen";
}

// Zweistufig: erst zaehlen lassen, dann mit den Zahlen fragen. Wer einen
// Antrag wegwirft, soll vorher sehen, was daran haengt -- vor allem die
// Nachweise, die woanders liegen.
async function loescheEingang(id) {
  let p;
  try {
    p = await loescheAntragSatz(id, true);
  } catch (e) {
    alert("Der Antrag lässt sich nicht löschen: " + e.message);
    return;
  }

  const anhang = [];
  if (p.nachweis_owner) anhang.push("die hochgeladenen Nachweise");
  if (p.unterschriften) {
    anhang.push(p.unterschriften + " Unterschrift" + (p.unterschriften > 1 ? "en" : ""));
  }

  if (!confirm("Aufnahmeantrag von " + p.name + " (Eingang " + datumDe(p.eingang_am) +
               ") endgültig löschen?\n\n" +
               (anhang.length ? "Mitgelöscht werden: " + anhang.join(" und ") + ".\n\n" : "") +
               "Das lässt sich nicht rückgängig machen. Der Vorgang steht danach nur noch " +
               "im Protokoll.")) return;

  // ⚠️ Reihenfolge bindend: erst die Nachweise, dann die Zeile. Der
  // Schluessel zu den Dateien steht NUR im Antrag -- ist er weg, sind die
  // Ausweiskopien unauffindbar. Scheitert das Loeschen dort, wird auch der
  // Antrag nicht angefasst, statt eine halbe Loeschung zu hinterlassen.
  if (p.nachweis_owner) {
    try {
      await loescheNachweiseAntrag(p.nachweis_owner);
    } catch (e) {
      // ⚠️ Ein 403 ist keine Störung: der Gateway verlangt für das Löschen
      // der Nachweise das Administrieren-Recht auf der Kachel, während der
      // Löschknopf schon ab Bearbeiten erscheint. „Bitte noch einmal
      // versuchen“ wäre dort ein falscher Rat — der Versuch gelingt nie.
      alert(e.status === 403
        ? "Die Nachweise ließen sich nicht entfernen: dafür wird das Recht " +
          "„Administrieren“ auf der Kachel Vereinsverwaltung gebraucht; " +
          "Bearbeiten allein reicht nicht.\n\nDer Antrag bleibt deshalb stehen — " +
          "sonst lägen die Dateien unauffindbar in der Ablage. Bitte jemanden mit " +
          "diesem Recht darum bitten."
        : "Die Nachweise ließen sich nicht entfernen: " + e.message +
          "\n\nDer Antrag bleibt deshalb stehen — sonst lägen die Dateien unauffindbar " +
          "in der Ablage. Bitte noch einmal versuchen.");
      return;
    }
  }

  try {
    await loescheAntragSatz(id, false);
  } catch (e) {
    alert("Der Antrag ließ sich nicht löschen: " + e.message);
    return;
  }

  // ⚠️ Das Detail des geloeschten Antrags muss zu. Ohne das bliebe die
  // Karte darunter mit einem Vorgang stehen, den es nicht mehr gibt --
  // samt Druckknopf, der dann ins Leere greift. ladeEingang() versteckt
  // sie ohnehin als erste Anweisung; eingangAktuell wird hier
  // zurueckgesetzt, damit auch der Zustand dazu passt.
  eingangAktuell = null;
  await ladeEingang();
}

async function oeffneEingang(id) {
  const ziel = $("eingang-detail");
  ziel.hidden = false;
  ziel.innerHTML = '<p class="fussnote">Wird geladen …</p>';

  try {
    eingangAktuell = await ladeAntragDetail(id);
  } catch (e) {
    ziel.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }

  const a = eingangAktuell.antrag;
  const i = a.inhalt || {};
  const spartenNamen = (eingangAktuell.alle_sparten || [])
    .filter((s) => (a.sparten || []).includes(s.id)).map((s) => s.name);

  const zeile = (was, wert) => wert
    ? "<tr><th>" + esc(was) + "</th><td>" + esc(wert) + "</td></tr>" : "";

  const dubletten = eingangAktuell.dubletten || [];

  ziel.innerHTML =
    "<h3>" + esc((i.vorname || "") + " " + (i.nachname || "")) + "</h3>" +
    (dubletten.length
      ? '<div class="hinweis fehler"><strong>Diese Person könnte bereits im Bestand stehen.</strong> ' +
        "Bitte vor dem Beschluss in der Vereinsverwaltung klären — ein zweiter Datensatz " +
        "bedeutet einen zweiten Beitrag.</div>"
      : "") +
    '<div class="hinweis info">Eingegangen am <strong>' + esc(datumDe(a.eingang_am)) +
      "</strong>, Status <strong>" + esc(EINGANG_STATUS_TEXT[a.status] || a.status) +
      "</strong>.</div>" +
    '<div class="tabelle-scroll"><table class="zusammenfassung"><tbody>' +
    zeile("Name", [i.anrede, i.vorname, i.nachname].filter(Boolean).join(" ")) +
    zeile("Geburtsdatum", datumDe(i.geburtsdatum)) +
    zeile("Geburtsort", i.geburtsort) +
    zeile("Anschrift", [i.strasse, [i.plz, i.ort].filter(Boolean).join(" ")]
      .filter(Boolean).join(", ")) +
    zeile("E-Mail", i.email) +
    zeile("Telefon", [i.mobil, i.telefon].filter(Boolean).join(" / ")) +
    zeile("Eintritt gewünscht", datumDe(i.eintritt_wunsch)) +
    zeile("Abteilungen", spartenNamen.join(", ")) +
    zeile("Beitragswunsch", i.beitragsart_wunsch) +
    zeile("Familie im Verein", i.familie_hinweis) +
    zeile("Zahlungsart", i.zahlungsart === "lastschrift" ? "SEPA-Lastschrift" : "Überweisung") +
    zeile("Kontoinhaber", i.kontoinhaber) +
    zeile("Anschrift Kontoinhaber", i.kontoinhaber_anschrift) +
    zeile("IBAN", i.iban) +
    zeile("Kreditinstitut", i.bank_name) +
    zeile("Gesetzlicher Vertreter", i.gesetzl_name) +
    zeile("Zweiter Erziehungsberechtigter", i.gesetzl2_name
      || (i.minderjaehrig && i.allein_sorgeberechtigt ? "alleiniges Sorgerecht erklärt" : "")) +
    zeile("Fotoeinwilligung", i.einwilligung_fotos ? "erteilt" : "nicht erteilt") +
    zeile("Anmerkung", i.bemerkung) +
    "</tbody></table></div>" +
    '<div class="unterschrift-beleg">' +
      (a.unterschrift
        ? '<div><div class="unterschrift-titel">Antragsteller</div>' +
          '<img alt="Unterschrift" src="' + esc(a.unterschrift) + '"></div>' : "") +
      (a.unterschrift_gesetzl
        ? '<div><div class="unterschrift-titel">Gesetzlicher Vertreter</div>' +
          '<img alt="Unterschrift des gesetzlichen Vertreters" src="' +
          esc(a.unterschrift_gesetzl) + '"></div>' : "") +
      (a.unterschrift_gesetzl2
        ? '<div><div class="unterschrift-titel">Zweiter Erziehungsberechtigter</div>' +
          '<img alt="Unterschrift des zweiten Erziehungsberechtigten" src="' +
          esc(a.unterschrift_gesetzl2) + '"></div>' : "") +
    "</div>" +
    '<div class="knopfreihe">' +
      '<button class="btn" id="btn-eingang-drucken" type="button">Als Papierantrag drucken</button>' +
      '<button class="btn grau" id="btn-eingang-zu" type="button">Schließen</button>' +
    "</div>";

  $("btn-eingang-drucken").addEventListener("click", druckeEingang);
  $("btn-eingang-zu").addEventListener("click", () => { ziel.hidden = true; });
  ziel.scrollIntoView({ block: "start" });
}

// Derselbe Aufbau wie in der Verwaltung — die vier Blätter stehen in
// antrag-druck.js. Die Mitgliedsnummer bleibt hier leer: sie wird erst
// beim Beschluss vergeben, und dieser Reiter beschließt nicht.
function druckeEingang() {
  papierAntragOeffnen({
    antrag: eingangAktuell.antrag,
    sparten: eingangAktuell.alle_sparten,
    einstellungen: eingangStammdaten,
    mitgliedsnummer: ""
  });
}

function zeigeBeitraege() {
  $("beitrags-info").innerHTML = baueBeitragsliste(info);
}

function zeigeSparten() {
  $("a-sparten").innerHTML = baueSpartenAuswahl(info);
}

function zeigeMandatstext() {
  $("a-mandatstext").innerHTML = baueMandatstext(info);
}

// ---------------------------------------------------------------------
// Zustand des Formulars
// ---------------------------------------------------------------------

// zeigeZahlungsart() gab es hier bis zum 14.08.2026: sie blendete den
// Bankblock je nach angekreuzter Zahlungsart ein und aus. Mit dem Wegfall
// der Ueberweisung ist der Bankblock immer sichtbar, und damit hatte sie
// nichts mehr zu tun. Den Unterschriftentitel frischt zeigeMinderjaehrig()
// ohnehin selbst auf.

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

  sigPadGesetzl = sigFeldPflegen(sigPadGesetzl, "a-sig-gesetzl", minder);
  zeigeZweitenVertreter();
  aktualisiereSigTitel();
}

// Der zweite Erziehungsberechtigte haengt an zwei Bedingungen: es muss ein
// Minderjaehriger sein, und es darf kein alleiniges Sorgerecht erklaert
// sein. Beides wird hier an EINER Stelle entschieden, damit Feldblock und
// Zeichenfeld nie auseinanderlaufen.
function zeigeZweitenVertreter() {
  const minder = !$("a-karte-gesetzl").hidden;
  const zweiter = minder && !$("a-allein-sorge").checked;

  $("a-gesetzl2-block").hidden = !zweiter;
  $("a-sig-gesetzl2-block").hidden = !zweiter;

  sigPadGesetzl2 = sigFeldPflegen(sigPadGesetzl2, "a-sig-gesetzl2", zweiter);
}

function aktualisiereSigTitel() {
  const minder = !$("a-karte-gesetzl").hidden;
  $("a-sig-titel").textContent = minder
    ? "Unterschrift des Antragstellers (soweit möglich)"
    : (istLastschrift()
        ? "Unterschrift — Beitrittserklärung und SEPA-Mandat"
        : "Unterschrift — Beitrittserklärung");

  // Bei Minderjaehrigen traegt das Mandat die Unterschrift des
  // gesetzlichen Vertreters, nicht die des Kindes -- ein Minderjaehriger
  // kann keines erteilen. Das muss ueber dem Feld stehen, nicht nur im
  // Servercode.
  $("a-sig-gesetzl-titel").textContent = istLastschrift()
    ? "Unterschrift des gesetzlichen Vertreters — Beitritt und SEPA-Mandat"
    : "Unterschrift des gesetzlichen Vertreters";
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
  const minder = !$("a-karte-gesetzl").hidden;
  const zweiter = minder && !$("a-allein-sorge").checked;

  return Object.assign(sammleGemeinsameFelder(), {
    // Nur auf dieser Seite: die Art der Mitgliedschaft, der Eintrittswunsch
    // und die Beitragseinschaetzung. Die Nachwuchsseite leitet beides aus
    // dem Alter ab.
    art: $("a-art").value,
    eintritt_wunsch: $("a-eintritt").value,
    beitragsart_wunsch: $("a-beitragsart").value,
    familie_hinweis: $("a-familie").value,
    sparten: sammleSparten(),
    unterschrift: sigPad ? sigPad.toDataURL() : "",
    unterschrift_gesetzl: sigPadGesetzl ? sigPadGesetzl.toDataURL() : "",
    // Nur mitschicken, wenn ein zweiter Vertreter ueberhaupt verlangt ist:
    // sonst kaeme die Unterschrift eines Feldes mit, das der Antragsteller
    // vor dem Ankreuzen von "allein sorgeberechtigt" ausgefuellt hatte.
    unterschrift_gesetzl2: zweiter && sigPadGesetzl2 ? sigPadGesetzl2.toDataURL() : ""
  });
}

async function absenden() {
  if (laeuft) return;
  meldung("");

  const daten = sammle();

  const fehler = pruefeGemeinsameFelder(daten);
  if (fehler) { meldung(fehler); return; }

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
    zeile("Geburtsort", daten.geburtsort) +
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
    zeile("Anschrift Kontoinhaber", daten.zahlungsart === "lastschrift"
      ? daten.kontoinhaber_anschrift : "") +
    zeile("IBAN", daten.zahlungsart === "lastschrift"
      ? daten.iban.replace(/\s+/g, "").toUpperCase() : "") +
    zeile("Kreditinstitut", daten.zahlungsart === "lastschrift" ? daten.bank_name : "") +
    zeile("Gesetzlicher Vertreter", daten.gesetzl_name) +
    zeile("Zweiter Erziehungsberechtigter", daten.gesetzl2_name) +
    zeile("Sorgerecht", daten.allein_sorgeberechtigt ? "alleiniges Sorgerecht erklärt" : "") +
    zeile("Fotoeinwilligung", daten.einwilligung_fotos ? "erteilt" : "nicht erteilt") +
    zeile("Anmerkung", daten.bemerkung) +
    zeile("Ort und Datum", [daten.unterschrift_ort || daten.ort, datumDe(heuteIso())]
      .filter(Boolean).join(", ")) +
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
    (daten.unterschrift_gesetzl2
      ? '<div><div class="unterschrift-titel">Zweiter Erziehungsberechtigter</div>' +
        '<img alt="Unterschrift des zweiten Erziehungsberechtigten" src="' +
        esc(daten.unterschrift_gesetzl2) + '"></div>'
      : "") +
    "</div>";

  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------

function verdrahten() {
  $("a-geburtsdatum").addEventListener("change", zeigeMinderjaehrig);
  $("a-geburtsdatum").addEventListener("input", zeigeMinderjaehrig);
  $("a-allein-sorge").addEventListener("change", zeigeZweitenVertreter);
  $("a-iban").addEventListener("blur", pruefeIbanFeld);
  // Der Ort der Unterschrift ist fast immer der Wohnort. Vorbelegen, aber
  // nur solange niemand selbst etwas eingetragen hat -- sonst ueber-
  // schreibt eine spaetere Korrektur der Anschrift die Eingabe.
  $("a-ort").addEventListener("blur", () => {
    if (!$("a-sig-ort").value.trim()) $("a-sig-ort").value = $("a-ort").value;
  });
  $("btn-sig-loeschen").addEventListener("click", () => { if (sigPad) sigPad.clear(); });
  $("btn-sig-gesetzl-loeschen").addEventListener("click", () => {
    if (sigPadGesetzl) sigPadGesetzl.clear();
  });
  $("btn-sig-gesetzl2-loeschen").addEventListener("click", () => {
    if (sigPadGesetzl2) sigPadGesetzl2.clear();
  });
  $("btn-antrag-senden").addEventListener("click", absenden);
  $("btn-drucken").addEventListener("click", () => window.print());

  zeigeMinderjaehrig();
}

document.addEventListener("DOMContentLoaded", start);
