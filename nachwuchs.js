// Anmeldung eines Jugendspielers: Aufnahmeantrag nach § 4 UND die Angaben
// fuer den Antrag auf Spielerlaubnis beim Thueringer Fussball-Verband, in
// einem Durchgang.
//
// Laeuft wie antrag.html ohne Anmeldung -- Eltern haben kein Vereinskonto.
// Der Formularkern (Person, Erziehungsberechtigte, SEPA, Unterschriften)
// steht in antrag-felder.js und wird mit antrag.js GETEILT, nicht kopiert.
// Hier steht nur, was diese Seite allein betrifft: der Fussball-Teil, die
// Nachweise und die eigene Schrittzaehlung.

let info = null;
let sigPad = null;
let sigPadGesetzl = null;
let sigPadGesetzl2 = null;
let laeuft = false;

// Schluessel des abgeschotteten Nachweis-Bereichs. Wird beim ERSTEN
// Upload vom Server vergeben; jeder weitere Nachweis schickt ihn mit,
// damit alle Anlagen desselben Antrags zusammen liegen.
let nachweisOwner = null;
const nachweisStand = {};   // slot -> "laeuft" | "fertig" | Fehlertext

// --- Passbild ---------------------------------------------------------
//
// ⚠️ Das Bild kommt NICHT auf den Verbandsbogen -- der hat gar kein
// Bildfeld (nachgemessen: das einzige Bild darauf ist das TFV-Logo). Es
// wird gesammelt, damit die Geschaeftsstelle es beim Eintragen in DFBnet
// Pass-Online hochladen kann, ohne die Familie noch einmal anzuschreiben.
//
// Format 35x45 mm wie beim amtlichen Passbild. Der Puffer ist GENAU so
// gross wie das Ergebnis: was im Dialog zu sehen ist, ist byte-genau das,
// was gespeichert wird -- es gibt keine zweite Umrechnung beim Export.
const PASSBILD_B = 350;
const PASSBILD_H = 450;

// Nur wo der Verband ein neues Bild braucht. Ein Rueckkehrer und eine
// Namensaenderung haengen an einem bestehenden Pass, dort liegt es schon.
const PASSBILD_ARTEN = ["erstausstellung", "vereinswechsel"];

let passbildDaten = null;      // fertiges Bild als Data-URL
let passbildStand = null;      // null | "laeuft" | "fertig" | Fehlertext
let pbBild = null;             // das geladene Original
let pbZoom = 1, pbX = 0, pbY = 0, pbDrehung = 0;
let pbZieht = false, pbVonX = 0, pbVonY = 0;

// Welche Anlage der Verband wann verlangt. Die Slots sind dieselben wie
// in der Weissliste des Gateways -- ein hier erfundener Wert wuerde dort
// abgewiesen.
const NACHWEIS_ARTEN = [
  { slot: "geburtsurkunde",
    titel: "Geburtsurkunde oder Ausweis des Kindes",
    hinweis: "Personalausweis, Reisepass oder Geburtsurkunde. Der Verband verlangt " +
             "den Nachweis bei jeder Erstausstellung.",
    arten: ["erstausstellung"] },
  { slot: "spielerpass",
    titel: "Bisheriger Spielerpass",
    hinweis: "Falls der Pass nicht mehr auffindbar ist, genügt eine Verlusterklärung " +
             "des bisherigen Vereins.",
    arten: ["vereinswechsel"] },
  { slot: "abmeldung",
    titel: "Nachweis der Abmeldung",
    hinweis: "Kopie der Kündigung mit dem Einschreibebeleg. Nur nötig, wenn die " +
             "Abmeldung bereits erfolgt ist.",
    arten: ["vereinswechsel"] },
  { slot: "namensaenderung",
    titel: "Amtliches Dokument der Namensänderung",
    hinweis: "Zum Beispiel die Heirats- oder Namensänderungsurkunde.",
    arten: ["namensaenderung"] }
];

// ---------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------

async function start() {
  // Wie in antrag.js: Reiter und Info stehen unabhaengig vom Formular und
  // muessen auch dann bedienbar bleiben, wenn der Server es nicht liefert.
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
  // ⚠️ Der EIGENE Schalter, nicht info.offen. Sonst dreht man mit der
  // Nachwuchs-Anmeldung den allgemeinen Aufnahmeantrag mit zu -- und
  // umgekehrt. Ein alter Worker kennt das Feld noch nicht; dann faellt es
  // auf den allgemeinen Schalter zurueck, statt die Seite auszusperren.
  const offen = info.nachwuchs_offen !== undefined ? info.nachwuchs_offen : info.offen;
  if (!offen) { $("zu-schirm").hidden = false; return; }

  $("verein-name").textContent = info.verein;
  document.querySelectorAll(".verein-name-text").forEach((el) => {
    el.textContent = info.verein;
  });

  $("beitrags-info").innerHTML = baueBeitragsliste(info);
  $("a-sparten").innerHTML = baueSpartenAuswahl(info);
  $("a-mandatstext").innerHTML = baueMandatstext(info);
  waehleFussballVor();
  zeichneNachweise();

  $("a-sig-datum").value = datumDe(heuteIso());
  $("formular").hidden = false;

  // Erst jetzt: ein Canvas hinter hidden misst 0x0, und dann bleibt das
  // Zeichenfeld leer, egal was jemand hineinmalt.
  sigPad = createSignaturePad($("a-sig"));
  sigPad.resize();

  verdrahten();
}

// Fussball ist der Grund, aus dem jemand dieses Formular ausfuellt -- also
// vorwaehlen statt danach zu fragen. ⚠️ Nur VORwaehlen: die Abteilung
// laesst sich abwaehlen und weitere dazunehmen. Eine feste Zuordnung waere
// eine zweite Wahrheit neben der Spartenliste des Servers.
function waehleFussballVor() {
  const treffer = (info.sparten || []).find((s) => /fussball|fußball/i.test(s.name));
  if (!treffer) return;
  const haken = document.querySelector('.sparte-haken[value="' + CSS.escape(treffer.id) + '"]');
  if (haken) haken.checked = true;
}

// ---------------------------------------------------------------------
// Reiter, Anmeldung, Info
// ---------------------------------------------------------------------

function verdrahteReiter() {
  document.querySelectorAll("nav button").forEach((b) => {
    b.addEventListener("click", () => zeigeReiter(b.dataset.tab));
  });
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

// Die Dashboard-Pille haengt an der SITZUNG. Wer ohne Konto herkommt,
// sieht sie nicht -- fuer ihn waere ein Knopf ins Anmeldefenster einer
// internen Verwaltung eine Sackgasse. Einen Sicht-Reiter gibt es hier
// nicht: die eingegangenen Antraege stehen gesammelt in antrag.html und
// in der Verwaltung, ein dritter Ort waere einer zu viel.
function pruefeAnmeldung() {
  if (antragToken()) $("dashboard-pille").hidden = false;
}

function zeigeInfo() {
  $("info-version").textContent = ANTRAG_VERSION;
  $("info-changelog").innerHTML = NACHWUCHS_CHANGELOG.map((b) =>
    '<div class="changelog-block">' +
      "<h3>" + esc(b.version) + "</h3>" +
      '<div class="changelog-datum">' + esc(datumDe(b.datum)) + "</div>" +
      "<ul>" + b.punkte.map((p) => "<li>" + esc(p) + "</li>").join("") + "</ul>" +
    "</div>").join("");
}

// ---------------------------------------------------------------------
// Zustand des Formulars
// ---------------------------------------------------------------------

function zeigeZahlungsart() {
  const last = istLastschrift();
  $("a-bank-block").hidden = !last;
  $("a-ueberweisung-hinweis").hidden = last;
  aktualisiereSigTitel();
}

// Der Block der Erziehungsberechtigten erscheint aus dem Geburtsdatum --
// ein volljaehriger A-Jugend-Spieler unterschreibt selbst. Bleiben die
// Schrittnummern dabei stehen, springt die Zaehlung und liest sich wie ein
// vergessener Abschnitt.
function zeigeMinderjaehrig() {
  const alter = alterHeute($("a-geburtsdatum").value);
  const minder = alter !== null && alter >= 0 && alter < 18;

  $("a-alter-hinweis").textContent = alter === null ? " "
    : (alter < 0 ? "Das Datum liegt in der Zukunft." : alter + " Jahre");

  $("a-karte-gesetzl").hidden = !minder;
  $("a-sig-gesetzl-block").hidden = !minder;

  const n = minder ? 0 : -1;
  $("nr-fussball").textContent = (3 + n) + " — Spielerlaubnis";
  $("nr-beitrag").textContent = (4 + n) + " — Beitragszahlung";
  $("nr-einwilligung").textContent = (5 + n) + " — Erklärungen";
  $("nr-unterschrift").textContent = (6 + n) + " — Unterschriften";
  zeigePassbildKarte();   // vergibt 7/8 je nachdem, ob ein Bild verlangt ist

  sigPadGesetzl = sigFeldPflegen(sigPadGesetzl, "a-sig-gesetzl", minder);
  zeigeZweitenVertreter();
  aktualisiereSigTitel();
  pruefeFreigabe();
}

function zeigeZweitenVertreter() {
  const minder = !$("a-karte-gesetzl").hidden;
  const zweiter = minder && !$("a-allein-sorge").checked;

  $("a-gesetzl2-block").hidden = !zweiter;
  $("a-sig-gesetzl2-block").hidden = !zweiter;

  sigPadGesetzl2 = sigFeldPflegen(sigPadGesetzl2, "a-sig-gesetzl2", zweiter);
}

function aktualisiereSigTitel() {
  const minder = !$("a-karte-gesetzl").hidden;
  // Bei Minderjaehrigen traegt das Mandat die Unterschrift des
  // Erziehungsberechtigten, nicht die des Kindes -- ein Minderjaehriger
  // kann keines erteilen. Das muss ueber dem Feld stehen, nicht nur im
  // Servercode.
  $("a-sig-gesetzl-titel").textContent = istLastschrift()
    ? "Unterschrift des Erziehungsberechtigten — Beitritt, Spielerlaubnis und SEPA-Mandat"
    : "Unterschrift des Erziehungsberechtigten — Beitritt und Spielerlaubnis";

  if (!minder) {
    $("a-sig-titel").textContent = istLastschrift()
      ? "Unterschrift — Beitritt, Spielerlaubnis und SEPA-Mandat"
      : "Unterschrift — Beitritt und Spielerlaubnis";
  } else {
    $("a-sig-titel").innerHTML = "Unterschrift des Kindes " +
      '<span class="fussnote">(soweit es schon schreiben kann)</span>';
  }
}

// Der Bogen weist darauf hin: bei Auslaendern ab dem 10. Lebensjahr ist
// zusaetzlich ein Antrag auf internationale Freigabe beizufuegen. Das
// Formular rechnet es aus und SAGT es -- das Zusatzformular selbst ist
// nicht Teil dieser Routine, aber wer davon nichts weiss, wartet sonst
// wochenlang auf eine Spielerlaubnis, die nie kommt.
function pruefeFreigabe() {
  const alter = alterHeute($("a-geburtsdatum").value);
  const nat = $("a-nationalitaet").value.trim().toLowerCase();
  const auslaendisch = nat && !/^(deutsch|de|deutschland|german)$/.test(nat);
  const kasten = $("a-freigabe-hinweis");

  if (auslaendisch && alter !== null && alter >= 10) {
    kasten.hidden = false;
    kasten.innerHTML = "<strong>Zusätzlicher Antrag nötig.</strong> Bei einer anderen " +
      "als der deutschen Staatsangehörigkeit verlangt der Verband ab dem 10. Lebensjahr " +
      "zusätzlich einen <em>Antrag auf internationale Freigabe</em>. Die Geschäftsstelle " +
      "meldet sich dazu — die Anmeldung können Sie normal abschließen.";
  } else {
    kasten.hidden = true;
  }
}

function spielerlaubnisArt() {
  const gewaehlt = document.querySelector('input[name="sp-art"]:checked');
  return gewaehlt ? gewaehlt.value : "erstausstellung";
}

function zeigeSpielerlaubnisArt() {
  $("sp-wechsel-block").hidden = spielerlaubnisArt() !== "vereinswechsel";
  zeigePassbildKarte();
  zeichneNachweise();
}

// Die Passbild-Karte haengt an der Art der Passausstellung. Faellt sie
// weg, rutschen die Nummern der Karten darunter -- eine springende
// Zaehlung liest sich wie ein vergessener Abschnitt.
function zeigePassbildKarte() {
  const noetig = PASSBILD_ARTEN.includes(spielerlaubnisArt());
  $("sp-passbild-karte").hidden = !noetig;
  const minder = !$("a-karte-gesetzl").hidden;
  const n = minder ? 0 : -1;
  $("nr-passbild").textContent = (7 + n) + " — Passbild";
  $("nr-nachweise").textContent = (7 + n + (noetig ? 1 : 0)) + " — Nachweise";
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
// Nachweise
// ---------------------------------------------------------------------

// Welche Anlagen zur gewaehlten Art gehoeren. Bei einer Erstausstellung
// nach dem Spielerpass zu fragen waere eine Aufforderung, die niemand
// erfuellen kann.
function noetigeNachweise() {
  const art = spielerlaubnisArt();
  return NACHWEIS_ARTEN.filter((n) => n.arten.includes(art));
}

function zeichneNachweise() {
  const ziel = $("sp-nachweis-liste");
  const noetig = noetigeNachweise();

  if (!noetig.length) {
    ziel.innerHTML = '<p class="fussnote">Für diese Art der Passausstellung verlangt ' +
      "der Verband keine Anlage. Die Geschäftsstelle meldet sich, falls doch etwas " +
      "gebraucht wird.</p>";
    return;
  }

  ziel.innerHTML = noetig.map((n) => {
    const stand = nachweisStand[n.slot];
    let zustand = '<span class="fussnote">noch nicht hochgeladen</span>';
    if (stand === "laeuft") zustand = '<span class="fussnote">wird hochgeladen …</span>';
    else if (stand === "fertig") zustand = '<span class="hinweis erfolg">✓ liegt vor</span>';
    else if (stand) zustand = '<span class="hinweis fehler">' + esc(stand) + "</span>";

    return '<div class="nachweis-zeile">' +
      "<h3>" + esc(n.titel) + "</h3>" +
      '<p class="fussnote">' + esc(n.hinweis) + "</p>" +
      '<input type="file" accept="image/*,application/pdf" data-slot="' + esc(n.slot) + '">' +
      '<div class="nachweis-stand">' + zustand + "</div>" +
      "</div>";
  }).join("");

  ziel.querySelectorAll("input[type=file]").forEach((f) => {
    f.addEventListener("change", () => nachweisGewaehlt(f));
  });
}

async function nachweisGewaehlt(feld) {
  const slot = feld.dataset.slot;
  const datei = feld.files && feld.files[0];
  if (!datei) return;

  // 10 MB ist die Grenze des Gateways. Vorher abfangen statt den Upload
  // laufen und scheitern zu lassen -- am Handy dauert der Weg lange genug,
  // um wie ein Fehler auszusehen.
  if (datei.size > 10 * 1024 * 1024) {
    nachweisStand[slot] = "Die Datei ist größer als 10 MB. Bitte ein kleineres Foto wählen.";
    zeichneNachweise();
    return;
  }

  nachweisStand[slot] = "laeuft";
  zeichneNachweise();

  try {
    const antwort = await ladeNachweisHoch(slot, datei, nachweisOwner);
    // Beim ersten Upload vergibt der Server den Schluessel. Ab dann
    // MUSS er mitgehen, sonst legt jeder weitere Nachweis einen eigenen
    // Ordner an und die Geschaeftsstelle findet nur einen davon.
    if (antwort && antwort.owner) nachweisOwner = antwort.owner;
    nachweisStand[slot] = "fertig";
  } catch (e) {
    nachweisStand[slot] = e.message;
  }
  zeichneNachweise();
}

// ---------------------------------------------------------------------
// Passbild: aufnehmen, zuschneiden, hochladen
// ---------------------------------------------------------------------

// ⚠️ Am Handy oeffnet capture="user" die SYSTEM-Kamera. Darin laesst sich
// nichts ueberlagern -- eine Hilfslinie waehrend der Aufnahme ist technisch
// nicht moeglich, ohne die Kamera selbst nachzubauen (getUserMedia mit
// eigener Vorschau). Das waere eine zusaetzliche Berechtigung und auf den
// aelteren iOS-Geraeten der Flotte unzuverlaessig. Deshalb: erst aufnehmen,
// DANN zuschneiden -- die ovale Hilfslinie steht im Zuschnitt-Dialog, wo
// sie sich beliebig oft korrigieren laesst.
function passbildGewaehlt(feld) {
  const datei = feld.files && feld.files[0];
  feld.value = "";   // damit dieselbe Datei erneut gewaehlt werden kann
  if (!datei) return;

  const leser = new FileReader();
  leser.onload = () => {
    const bild = new Image();
    bild.onload = () => oeffnePassbildDialog(bild);
    bild.onerror = () => {
      passbildStand = "Das Bild konnte nicht gelesen werden.";
      zeichnePassbildStand();
    };
    bild.src = String(leser.result || "");
  };
  leser.onerror = () => {
    passbildStand = "Die Datei konnte nicht gelesen werden.";
    zeichnePassbildStand();
  };
  leser.readAsDataURL(datei);
}

function oeffnePassbildDialog(bild) {
  pbBild = bild;
  pbDrehung = 0;
  $("passbild-zoom").value = 100;

  // ⚠️ Erst sichtbar machen, dann messen: ein Canvas hinter hidden ist
  // 300x150, und der ganze Zuschnitt saesse daneben.
  $("passbild-overlay").hidden = false;

  const c = $("passbild-canvas");
  c.width = PASSBILD_B;
  c.height = PASSBILD_H;

  passbildEinpassen();
  zeichnePassbild();
}

// Startzustand: das Bild fuellt den Rahmen und sitzt mittig. Von dort aus
// ist jede Korrektur eine kleine Bewegung -- von einer Ecke aus waere sie
// eine Suche.
function passbildEinpassen() {
  const [b, h] = pbMasse();
  pbZoom = Math.max(PASSBILD_B / b, PASSBILD_H / h);
  pbX = (PASSBILD_B - b * pbZoom) / 2;
  pbY = (PASSBILD_H - h * pbZoom) / 2;
}

// Breite und Hoehe NACH der Drehung -- bei 90 und 270 Grad vertauscht.
function pbMasse() {
  return (pbDrehung % 180 === 0)
    ? [pbBild.width, pbBild.height]
    : [pbBild.height, pbBild.width];
}

function zeichnePassbild(mitHilfe = true) {
  const c = $("passbild-canvas");
  const ctx = c.getContext("2d");
  const regler = Number($("passbild-zoom").value) / 100;

  ctx.clearRect(0, 0, PASSBILD_B, PASSBILD_H);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PASSBILD_B, PASSBILD_H);

  const [b, h] = pbMasse();
  const z = pbZoom * regler;
  const bb = b * z, hh = h * z;
  // Der Regler vergroessert um die MITTE des Rahmens, nicht um die linke
  // obere Ecke -- sonst wandert das Gesicht beim Zoomen aus dem Bild.
  const x = pbX - (bb - b * pbZoom) / 2;
  const y = pbY - (hh - h * pbZoom) / 2;

  ctx.save();
  ctx.translate(x + bb / 2, y + hh / 2);
  ctx.rotate(pbDrehung * Math.PI / 180);
  ctx.drawImage(pbBild, -pbBild.width * z / 2, -pbBild.height * z / 2,
                pbBild.width * z, pbBild.height * z);
  ctx.restore();

  if (!mitHilfe) return;

  // Die ovale Hilfslinie: Kopfhoehe belegt beim amtlichen Passbild rund
  // zwei Drittel der Bildhoehe, mit etwas Luft ueber dem Scheitel. Sie ist
  // eine HILFE, keine Maske -- gespeichert wird das volle Rechteck, weil
  // DFBnet ein rechteckiges Bild erwartet.
  ctx.save();
  ctx.strokeStyle = "rgba(26, 86, 160, .85)";
  ctx.setLineDash([9, 7]);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(PASSBILD_B / 2, PASSBILD_H * 0.46,
              PASSBILD_B * 0.30, PASSBILD_H * 0.34, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function pbZeigerPos(e) {
  const c = $("passbild-canvas");
  const r = c.getBoundingClientRect();
  // ⚠️ In Puffer-Pixel umrechnen: die Anzeige ist am Handy schmaler als
  // die 350 des Puffers, und ohne das wandert das Bild spuerbar langsamer
  // als der Finger.
  return { x: (e.clientX - r.left) * (PASSBILD_B / r.width),
           y: (e.clientY - r.top) * (PASSBILD_H / r.height) };
}

function verdrahtePassbild() {
  const c = $("passbild-canvas");

  c.addEventListener("pointerdown", (e) => {
    if (!pbBild) return;
    pbZieht = true;
    c.setPointerCapture(e.pointerId);
    const p = pbZeigerPos(e);
    pbVonX = p.x - pbX;
    pbVonY = p.y - pbY;
  });
  c.addEventListener("pointermove", (e) => {
    if (!pbZieht) return;
    const p = pbZeigerPos(e);
    pbX = p.x - pbVonX;
    pbY = p.y - pbVonY;
    zeichnePassbild();
  });
  const los = (e) => {
    if (!pbZieht) return;
    pbZieht = false;
    try { c.releasePointerCapture(e.pointerId); } catch {}
  };
  c.addEventListener("pointerup", los);
  c.addEventListener("pointercancel", los);

  $("passbild-zoom").addEventListener("input", () => zeichnePassbild());

  // Handyfotos tragen ihre Ausrichtung im EXIF, und die aelteren
  // iOS-Geraete der Flotte wenden sie beim Zeichnen nicht an -- ein
  // Hochkant-Selfie landet dann quer. Statt EXIF im Code zu raten, sieht
  // man die Schieflage und dreht sie mit einem Tipp gerade.
  $("btn-passbild-drehen").addEventListener("click", () => {
    if (!pbBild) return;
    pbDrehung = (pbDrehung + 90) % 360;
    $("passbild-zoom").value = 100;
    passbildEinpassen();     // Versatz zurueck: er zeigte in die alte Richtung
    zeichnePassbild();
  });

  $("btn-passbild-abbrechen").addEventListener("click", schliessePassbildDialog);
  $("btn-passbild-uebernehmen").addEventListener("click", uebernehmePassbild);

  $("btn-passbild-kamera").addEventListener("click", () => $("passbild-kamera").click());
  $("btn-passbild-datei").addEventListener("click", () => $("passbild-datei").click());
  $("passbild-kamera").addEventListener("change", () => passbildGewaehlt($("passbild-kamera")));
  $("passbild-datei").addEventListener("change", () => passbildGewaehlt($("passbild-datei")));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("passbild-overlay").hidden) schliessePassbildDialog();
  });
}

function schliessePassbildDialog() {
  $("passbild-overlay").hidden = true;
  pbBild = null;
  pbZieht = false;
}

async function uebernehmePassbild() {
  // ⚠️ Ohne Hilfslinie neu zeichnen, sonst wandert das gestrichelte Oval
  // ins gespeicherte Bild. Danach wieder mit -- der Dialog koennte noch
  // einen Lidschlag sichtbar sein.
  zeichnePassbild(false);
  passbildDaten = $("passbild-canvas").toDataURL("image/jpeg", 0.9);
  zeichnePassbild(true);
  schliessePassbildDialog();

  passbildStand = "laeuft";
  zeichnePassbildStand();

  try {
    const blob = await passbildAlsBlob(passbildDaten);
    const antwort = await ladeNachweisHoch("passbild", blob, nachweisOwner);
    if (antwort && antwort.owner) nachweisOwner = antwort.owner;
    passbildStand = "fertig";
  } catch (e) {
    passbildStand = e.message;
  }
  zeichnePassbildStand();
}

// ladeNachweisHoch erwartet etwas, das FileReader lesen kann. Ein Blob aus
// der Data-URL zu bauen ist der kuerzere Weg, als dort einen zweiten
// Eingang fuer Data-URLs zu oeffnen.
function passbildAlsBlob(dataUrl) {
  return fetch(dataUrl).then((r) => r.blob());
}

function zeichnePassbildStand() {
  const ziel = $("passbild-stand");
  if (!passbildDaten) { ziel.innerHTML = ""; return; }

  let hinweis = "";
  if (passbildStand === "laeuft") hinweis = '<span class="fussnote">wird übertragen …</span>';
  else if (passbildStand === "fertig") hinweis = '<span class="hinweis erfolg">✓ übertragen</span>';
  else if (passbildStand) hinweis = '<span class="hinweis fehler">' + esc(passbildStand) + "</span>";

  ziel.innerHTML =
    '<div class="passbild-vorschau">' +
      '<img alt="Aufgenommenes Passbild" src="' + esc(passbildDaten) + '">' +
      "<div>" + hinweis +
        '<div class="fussnote">Nicht zufrieden? Einfach noch einmal aufnehmen.</div>' +
      "</div>" +
    "</div>";
}

// ---------------------------------------------------------------------
// Absenden
// ---------------------------------------------------------------------

function sammle() {
  const minder = !$("a-karte-gesetzl").hidden;
  const zweiter = minder && !$("a-allein-sorge").checked;
  const art = spielerlaubnisArt();
  const abmeldung = document.querySelector('input[name="sp-abmeldung"]:checked');

  return Object.assign(sammleGemeinsameFelder(), {
    // Der Nachwuchs meldet sich als ordentliches Mitglied an, und der
    // Eintritt ist der Tag der Anmeldung -- beides steht auf dieser Seite
    // bewusst nicht zur Wahl. Die Beitragsklasse leitet die
    // Geschaeftsstelle beim Beschluss aus dem Alter ab.
    art: "ordentlich",
    eintritt_wunsch: heuteIso(),
    beitragsart_wunsch: "jugend",
    familie_hinweis: "",
    sparten: sammleSparten(),
    nationalitaet: $("a-nationalitaet").value,
    nachweis_owner: nachweisOwner || "",
    spielerlaubnis: {
      art,
      pass_nr: art === "vereinswechsel" ? $("sp-pass-nr").value : "",
      letzter_verein: art === "vereinswechsel" ? $("sp-letzter-verein").value : "",
      landesverband: art === "vereinswechsel" ? $("sp-landesverband").value : "",
      abmeldeweg: art === "vereinswechsel" && abmeldung ? abmeldung.value : "",
      einwilligung_dfb_marketing: $("sp-ew-dfb").checked
    },
    // ⚠️ Die Unterschrift des KINDES darf leer bleiben -- ein
    // Siebenjaehriger unterschreibt nicht. Der Server verlangt sie bei
    // Minderjaehrigen ohnehin nicht; er verlangt die der
    // Erziehungsberechtigten.
    unterschrift: sigPad ? sigPad.toDataURL() : "",
    unterschrift_gesetzl: sigPadGesetzl ? sigPadGesetzl.toDataURL() : "",
    unterschrift_gesetzl2: zweiter && sigPadGesetzl2 ? sigPadGesetzl2.toDataURL() : ""
  });
}

// Nur die Faelle, die sich ohne Rundlauf sagen lassen. Massgeblich bleibt
// die Pruefung des Servers.
function pruefeEigeneFelder(daten) {
  if (!daten.nationalitaet.trim()) {
    return "Der Verband verlangt die Staatsangehörigkeit des Kindes.";
  }
  if (daten.geschlecht !== "m" && daten.geschlecht !== "w") {
    // Der Verbandsbogen kennt nur diese beiden Kaestchen. Bei „divers"
    // oder ohne Angabe bliebe das Feld leer und der Antrag laege beim
    // Verband liegen, ohne dass jemand hier davon erfaehrt.
    return "Der Verband verlangt auf dem Antrag die Angabe männlich oder weiblich. " +
           "Bei einer anderen Angabe wenden Sie sich bitte an die Geschäftsstelle.";
  }
  if (daten.spielerlaubnis.art === "vereinswechsel") {
    if (!daten.spielerlaubnis.letzter_verein.trim()) {
      return "Beim Vereinswechsel wird der bisherige Verein gebraucht.";
    }
    if (!daten.spielerlaubnis.abmeldeweg) {
      return "Bitte angeben, ob die Abmeldung beim bisherigen Verein bereits erfolgt " +
             "ist oder der Verein sie übernehmen soll.";
    }
  }
  return null;
}

async function absenden() {
  if (laeuft) return;
  meldung("");

  const daten = sammle();

  // Bei Minderjaehrigen ist die Unterschrift des Kindes freiwillig --
  // pruefeGemeinsameFelder verlangt sie aber. Deshalb hier ein
  // Ersatzwert, bevor die geteilte Pruefung laeuft: der Server nimmt bei
  // Minderjaehrigen ohnehin die des Vertreters als massgeblich.
  const minder = !$("a-karte-gesetzl").hidden;
  if (minder && !daten.unterschrift) {
    daten.unterschrift = daten.unterschrift_gesetzl;
  }

  const fehler = pruefeGemeinsameFelder(daten) || pruefeEigeneFelder(daten);
  if (fehler) { meldung(fehler); return; }

  laeuft = true;
  const knopf = $("btn-antrag-senden");
  knopf.disabled = true;
  knopf.textContent = "Wird gesendet …";

  let antwort;
  try {
    antwort = await sendeNachwuchsAntrag(daten);
  } catch (e) {
    laeuft = false;
    knopf.disabled = false;
    knopf.textContent = "Anmeldung verbindlich absenden";
    meldung(e.message);
    return;
  }

  zeigeDanke(daten, antwort);
}

const SP_ART_TEXT = {
  erstausstellung: "Erstausstellung",
  vereinswechsel: "Vereinswechsel",
  rueckkehrer: "Rückkehrer",
  namensaenderung: "Namensänderung / Korrektur"
};

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

  const s = daten.spielerlaubnis;
  const hochgeladen = Object.keys(nachweisStand)
    .filter((k) => nachweisStand[k] === "fertig")
    .map((k) => (NACHWEIS_ARTEN.find((n) => n.slot === k) || {}).titel)
    .filter(Boolean);

  $("danke-zusammenfassung").innerHTML =
    "<h2>Ihre Erklärung</h2>" +
    '<div class="tabelle-scroll"><table class="zusammenfassung"><tbody>' +
    zeile("Kind", [daten.vorname, daten.nachname].filter(Boolean).join(" ")) +
    zeile("Geburtsdatum", datumDe(daten.geburtsdatum)) +
    zeile("Geburtsort", daten.geburtsort) +
    zeile("Staatsangehörigkeit", daten.nationalitaet) +
    zeile("Anschrift", daten.strasse + ", " + daten.plz + " " + daten.ort) +
    zeile("E-Mail", daten.email) +
    zeile("Telefon", [daten.mobil, daten.telefon].filter(Boolean).join(" / ")) +
    zeile("Abteilungen", spartenNamen.join(", ")) +
    zeile("Art der Passausstellung", SP_ART_TEXT[s.art] || s.art) +
    zeile("Bisheriger Verein", s.letzter_verein) +
    zeile("Landesverband", s.landesverband) +
    zeile("Pass-Nummer", s.pass_nr) +
    zeile("Abmeldung", s.abmeldeweg === "1"
      ? "bereits erfolgt, Nachweis liegt vor"
      : (s.abmeldeweg === "2" ? "wird vom Verein übernommen" : "")) +
    zeile("Zahlungsart", daten.zahlungsart === "lastschrift"
      ? "SEPA-Lastschrift" : "Überweisung") +
    zeile("Kontoinhaber", daten.zahlungsart === "lastschrift" ? daten.kontoinhaber : "") +
    zeile("Anschrift Kontoinhaber", daten.zahlungsart === "lastschrift"
      ? daten.kontoinhaber_anschrift : "") +
    zeile("IBAN", daten.zahlungsart === "lastschrift"
      ? daten.iban.replace(/\s+/g, "").toUpperCase() : "") +
    zeile("Kreditinstitut", daten.zahlungsart === "lastschrift" ? daten.bank_name : "") +
    zeile("Erziehungsberechtigter", daten.gesetzl_name) +
    zeile("Zweiter Erziehungsberechtigter", daten.gesetzl2_name) +
    zeile("Sorgerecht", daten.allein_sorgeberechtigt ? "alleiniges Sorgerecht erklärt" : "") +
    zeile("Fotoeinwilligung", daten.einwilligung_fotos ? "erteilt" : "nicht erteilt") +
    zeile("DFB-Werbeeinwilligung", s.einwilligung_dfb_marketing ? "erteilt" : "nicht erteilt") +
    zeile("Passbild", passbildStand === "fertig" ? "übertragen"
      : (PASSBILD_ARTEN.includes(s.art) ? "fehlt noch" : "")) +
    zeile("Nachweise", hochgeladen.length ? hochgeladen.join(", ") : "keine hochgeladen") +
    zeile("Anmerkung", daten.bemerkung) +
    zeile("Ort und Datum", [daten.unterschrift_ort || daten.ort, datumDe(heuteIso())]
      .filter(Boolean).join(", ")) +
    "</tbody></table></div>" +
    (daten.zahlungsart === "lastschrift" ? $("a-mandatstext").innerHTML : "") +
    '<div class="unterschrift-beleg">' +
    (daten.unterschrift && daten.unterschrift !== daten.unterschrift_gesetzl
      ? '<div><div class="unterschrift-titel">Kind</div>' +
        '<img alt="Unterschrift des Kindes" src="' + esc(daten.unterschrift) + '"></div>'
      : "") +
    (daten.unterschrift_gesetzl
      ? '<div><div class="unterschrift-titel">Erziehungsberechtigter</div>' +
        '<img alt="Unterschrift des Erziehungsberechtigten" src="' +
        esc(daten.unterschrift_gesetzl) + '"></div>'
      : "") +
    (daten.unterschrift_gesetzl2
      ? '<div><div class="unterschrift-titel">Zweiter Erziehungsberechtigter</div>' +
        '<img alt="Unterschrift des zweiten Erziehungsberechtigten" src="' +
        esc(daten.unterschrift_gesetzl2) + '"></div>'
      : "") +
    "</div>" +
    (hochgeladen.length < noetigeNachweise().length
      ? '<div class="hinweis warn">Es fehlen noch Nachweise. Die Geschäftsstelle ' +
        "meldet sich dazu — die Anmeldung selbst ist eingegangen.</div>"
      : "");

  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------

function verdrahten() {
  $("a-geburtsdatum").addEventListener("change", zeigeMinderjaehrig);
  $("a-geburtsdatum").addEventListener("input", zeigeMinderjaehrig);
  $("a-nationalitaet").addEventListener("input", pruefeFreigabe);
  $("a-zart-last").addEventListener("change", zeigeZahlungsart);
  $("a-zart-ueber").addEventListener("change", zeigeZahlungsart);
  $("a-allein-sorge").addEventListener("change", zeigeZweitenVertreter);
  $("a-iban").addEventListener("blur", pruefeIbanFeld);

  document.querySelectorAll('input[name="sp-art"]').forEach((r) => {
    r.addEventListener("change", zeigeSpielerlaubnisArt);
  });

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
  verdrahtePassbild();

  zeigeZahlungsart();
  zeigeMinderjaehrig();
  zeigeSpielerlaubnisArt();
}

document.addEventListener("DOMContentLoaded", start);
