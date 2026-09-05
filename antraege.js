// Aufnahmeanträge prüfen und beschließen — Satzung § 4.
//
// Der eine Satz, um den sich dieser Reiter dreht: ein Antrag ist keine
// Mitgliedschaft. Aus ihm wird erst eine, wenn hier ein Beschlussdatum
// eingetragen wird — und das Feld ist Pflicht, gerade weil die App es
// nicht erraten kann.

let anStatus = "neu";
let anListe = [];
let anZaehler = {};
let anAktuell = null;
let anLaeuft = false;
// Sicht der Passstelle: nur Nachwuchs-Anmeldungen, keine Bankdaten, kein
// Beschluss. ⚠️ Der Wert kommt aus der SERVER-Antwort und wird nie aus
// meineRechte abgeleitet — die Oberfläche soll genau das zeigen, was der
// Worker geliefert hat, und nicht das, was sie zu dürfen glaubt.
let anNurNachwuchs = false;
// Vereinsstammdaten fuer den Papierausdruck. Sie stehen in der Datenbank
// und nicht im Code -- eine Vereins-IBAN gehoert nicht in ein
// oeffentliches Repository.
let anEinstellungen = null;

const AN_ADRESSE = "https://sc1911heiligenstadt.github.io/vereinsverwaltung/antrag.html";

const AN_STATUS_TEXT = {
  neu: "Neu",
  geprueft: "Vorgemerkt",
  angenommen: "Angenommen",
  abgelehnt: "Abgelehnt",
  zurueckgezogen: "Zurückgezogen"
};

const AN_CHIP = {
  neu: "antrag", geprueft: "ruhend", angenommen: "aktiv",
  abgelehnt: "beendet", zurueckgezogen: "beendet"
};

function anAlter(geburt) {
  const a = alterJahre(geburt);
  return a === null ? "" : " (" + a + ")";
}

// ---------------------------------------------------------------------
// Das öffentliche Formular auf- und zudrehen
// ---------------------------------------------------------------------

async function ladeAntragSchalter() {
  const ziel = $("an-schalter");
  let antwort;
  try {
    antwort = await vvRequest("vv-einstellungen", {});
  } catch (e) {
    ziel.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  const feld = (antwort.felder || []).find((f) => f.schluessel === "antrag_offen");
  const offen = !feld || feld.wert === "1";

  anEinstellungen = {};
  (antwort.felder || []).forEach((f) => { anEinstellungen[f.schluessel] = f.wert; });

  ziel.innerHTML =
    '<div class="hinweis ' + (offen ? "erfolg" : "warn") + '">' +
      "Das Online-Formular ist zurzeit <strong>" +
      (offen ? "geöffnet" : "geschlossen") + "</strong>." +
      (offen ? "" : " Wer die Adresse aufruft, bekommt einen Hinweis auf die Geschäftsstelle.") +
    "</div>" +
    '<p class="fussnote">Adresse zum Verlinken: <a href="' + AN_ADRESSE +
      '" target="_blank" rel="noopener">' + AN_ADRESSE + "</a></p>" +
    '<div class="knopfreihe"><button class="btn ' + (offen ? "warn" : "") +
      '" id="btn-an-schalter">' +
      (offen ? "Formular schließen" : "Formular öffnen") + "</button></div>";

  $("btn-an-schalter").addEventListener("click", () => schalteFormular(offen ? "0" : "1"));
  ladeAntragSparten();
}

// Welche Abteilungen der Antragsteller überhaupt zu sehen bekommt.
//
// Anlass: im Bestand stehen die neun Sammelposten des Vereinsmeisters
// neben den zwölf echten Abteilungen — auf dem öffentlichen Formular
// standen dadurch „Dart" und „Darts" untereinander. Eine stillgelegte
// Abteilung verschwindet aus dem Formular und aus den Auswahllisten,
// ihre Zeile und alle Zuordnungen bleiben aber bestehen.
async function ladeAntragSparten() {
  const ziel = $("an-sparten");
  let antwort;
  try {
    antwort = await vvRequest("vv-sparten", {});
  } catch (e) {
    ziel.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  const sparten = antwort.sparten || [];
  const aktive = sparten.filter((s) => s.aktiv).length;

  const ohneNr = sparten.filter((s) => s.aktiv && !s.dosb_sportart_nr).length;

  ziel.innerHTML =
    "<h3>Abteilungen im Formular</h3>" +
    '<p class="fussnote">Angehakt heißt: steht im Aufnahmeantrag zur Auswahl. Zurzeit ' +
      "sind es <strong>" + aktive + " von " + sparten.length + "</strong>. Eine stillgelegte " +
      "Abteilung behält ihre Mitglieder und ihre Geschichte — sie wird nur nicht mehr " +
      "angeboten. Das × daneben löscht die Abteilung ganz; das geht nur, solange ihr " +
      "niemand mehr zugeordnet ist.</p>" +
    '<p class="fussnote">Das Zahlenfeld ist die <strong>Sportartennummer des LSB</strong> ' +
      "(Sportartenliste des Landessportbundes). Sie entscheidet, an welchen Fachverband die " +
      "Mitglieder dieser Abteilung gemeldet werden — ohne sie laufen sie unter „ohne " +
      "Landesfachverband“ und kosten den Anstatt-Beitrag." +
      (ohneNr ? " <strong>" + ohneNr + (ohneNr === 1 ? " aktive Abteilung hat" : " aktive Abteilungen haben") +
        " noch keine Nummer.</strong>" : "") + "</p>" +
    '<div class="ankreuz-raster">' + sparten.map((s) =>
      '<div class="sparte-zeile">' +
      '<label class="ankreuz"><input type="checkbox" class="an-sp-aktiv" data-id="' + esc(s.id) +
      '" data-name="' + esc(s.name) + '" data-anzahl="' + (s.mitglieder || 0) + '"' +
      (s.aktiv ? " checked" : "") + "><span>" + esc(s.name) +
      ' <span class="fussnote">(' + (s.mitglieder || 0) + ")</span></span></label>" +
      '<input type="number" class="sparte-nr an-sp-nr" min="1" max="9999" step="1" ' +
      'inputmode="numeric" placeholder="Nr." title="Sportartennummer des LSB" ' +
      'data-id="' + esc(s.id) + '" data-name="' + esc(s.name) + '" ' +
      'data-wert="' + (s.dosb_sportart_nr || "") + '" ' +
      'value="' + (s.dosb_sportart_nr || "") + '">' +
      '<button type="button" class="sparte-weg an-sp-weg" data-id="' + esc(s.id) +
      '" data-name="' + esc(s.name) + '" title="Abteilung löschen">×</button>' +
      "</div>").join("") +
    "</div>";

  ziel.querySelectorAll(".an-sp-aktiv").forEach((h) => {
    h.addEventListener("change", () => schalteSparte(h));
  });
  ziel.querySelectorAll(".an-sp-weg").forEach((b) => {
    b.addEventListener("click", () => loescheSparte(b));
  });
  // "change" statt "input": gespeichert wird, wenn das Feld verlassen
  // wird -- sonst schriebe jede einzelne getippte Ziffer eine eigene
  // Nummer in die Datenbank (aus "291" wuerden 2, 29 und 291).
  ziel.querySelectorAll(".an-sp-nr").forEach((f) => {
    f.addEventListener("change", () => setzeSportart(f));
  });
}

// Die Nummer wird einzeln gespeichert, ohne Sammelknopf: es ist ein Feld
// je Zeile, und ein "Speichern" darueber liesse offen, ob die gerade
// getippte Zahl schon drin ist.
async function setzeSportart(feld) {
  const alt = feld.dataset.wert || "";
  try {
    await vvRequest("vv-sparte-sportart",
                    { sparte_id: feld.dataset.id, nummer: feld.value.trim() });
  } catch (e) {
    feld.value = alt;
    alert("Nicht gespeichert: " + e.message);
    return;
  }
  feld.dataset.wert = feld.value.trim();
  feld.classList.add("gespeichert");
  setTimeout(() => feld.classList.remove("gespeichert"), 1200);
}

// Der Server liefert Codes, die Saetze entstehen hier -- dort gehoeren
// Umlaute und deutsches Datum hin. "rolle" und "buchung" sind Sperren,
// an denen kein Knopf vorbeifuehrt.
function sperrText(sp) {
  if (sp.was === "rolle") {
    return sp.anzahl === 1
      ? "eine Abteilungsleitung ist auf sie eingetragen"
      : sp.anzahl + " Abteilungsleitungen sind auf sie eingetragen";
  }
  if (sp.was === "buchung") {
    return sp.anzahl === 1
      ? "eine Buchungszeile verweist auf sie"
      : sp.anzahl + " Buchungszeilen verweisen auf sie";
  }
  return sp.anzahl === 1
    ? "ein offener Aufnahmeantrag nennt sie"
    : sp.anzahl + " offene Aufnahmeanträge nennen sie";
}

// Loeschen statt stilllegen: die Zeile verschwindet aus der Datenbank.
//
// Der Client zaehlt bewusst NICHT selbst nach, ob die Abteilung leer ist.
// Die angezeigte Mitgliederzahl kennt nur laufende Zuordnungen (kein
// Austritt, Status aktiv oder ruhend) -- eine "(0)" waere also eine
// truegerische Grundlage fuer ein DELETE. Der Server zaehlt alles und
// antwortet 409, wenn noch etwas daran haengt.
async function loescheSparte(knopf) {
  const name = knopf.dataset.name;
  if (!confirm("Abteilung „" + name + "“ endgültig löschen?\n\n" +
               "Stilllegen — das Häkchen wegnehmen — behält sie samt ihrer Geschichte. " +
               "Löschen entfernt die Zeile, und das lässt sich nicht rückgängig machen.")) {
    return;
  }

  let antwort;
  try {
    antwort = await vvRequest("vv-sparte-loeschen", { sparte_id: knopf.dataset.id });
  } catch (e) {
    const d = e.daten || {};

    if (d.code === "gesperrt") {
      alert("„" + name + "“ lässt sich nicht löschen:\n\n" +
            (d.sperren || []).map((s) => "• " + sperrText(s)).join("\n") +
            "\n\nStilllegen geht jederzeit — dann verschwindet sie aus dem Antragsformular, " +
            "bleibt aber der Verwaltung erhalten.");
      return;
    }

    if (d.code === "zuordnungen") {
      const namen = (d.mitglieder || []).map(
        (m) => "• " + m.vorname + " " + m.nachname + " (Nr. " + m.mitgliedsnummer + ")");
      const rest = (d.zuordnungen || 0) - namen.length;
      if (!confirm("„" + name + "“ hat noch " + d.zuordnungen +
                   (d.zuordnungen === 1 ? " Zuordnung" : " Zuordnungen") + ":\n\n" +
                   namen.join("\n") + (rest > 0 ? "\n… und " + rest + " weitere" : "") +
                   "\n\nTrotzdem löschen? Die Personen bleiben Mitglied mit unverändertem " +
                   "Beitrag — sie sind danach nur dieser Abteilung nicht mehr zugeordnet.")) {
        return;
      }
      try {
        antwort = await vvRequest("vv-sparte-loeschen",
                                  { sparte_id: knopf.dataset.id, mit_zuordnungen: true });
      } catch (e2) {
        alert("Nicht gelöscht: " + e2.message);
        return;
      }
    } else {
      alert("Nicht gelöscht: " + e.message);
      return;
    }
  }

  if (antwort && antwort.zuordnungen > 0) {
    alert("„" + antwort.name + "“ gelöscht, dabei " + antwort.zuordnungen +
          (antwort.zuordnungen === 1 ? " Zuordnung" : " Zuordnungen") + " entfernt.");
  }
  // Die Auswahllisten im Mitglieder-Reiter zeigen sonst weiter eine
  // Abteilung, die es nicht mehr gibt.
  if (typeof ladeSpartenAuswahl === "function") ladeSpartenAuswahl();
  ladeAntragSparten();
}

async function schalteSparte(haken) {
  const anzahl = Number(haken.dataset.anzahl || 0);
  if (!haken.checked && anzahl > 0 &&
      !confirm(haken.dataset.name + " hat noch " + anzahl +
               (anzahl === 1 ? " Mitglied" : " Mitglieder") +
               ". Die bleiben zugeordnet, die Abteilung wird nur nicht mehr angeboten. Fortfahren?")) {
    haken.checked = true;
    return;
  }
  try {
    await vvRequest("vv-sparte-aktiv", { sparte_id: haken.dataset.id, aktiv: haken.checked });
  } catch (e) {
    haken.checked = !haken.checked;
    $("an-schalter").insertAdjacentHTML("beforeend",
      '<div class="hinweis fehler">' + esc(e.message) + "</div>");
    return;
  }
  // Die Auswahlliste im Mitglieder-Reiter zeigt sonst weiter die
  // stillgelegte Abteilung.
  if (typeof ladeSpartenAuswahl === "function") ladeSpartenAuswahl();
  ladeAntragSparten();
}

async function schalteFormular(wert) {
  try {
    await vvRequest("vv-einstellung-setzen", { schluessel: "antrag_offen", wert });
  } catch (e) {
    $("an-schalter").innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  ladeAntragSchalter();
}

// ---------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------

async function ladeAntraege(status) {
  if (status) anStatus = status;
  const ziel = $("an-liste");
  ziel.innerHTML = '<div class="leer">Wird geladen …</div>';

  let antwort;
  try {
    antwort = await vvRequest("vv-antraege", { status: anStatus });
  } catch (e) {
    ziel.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  anListe = antwort.antraege || [];
  anZaehler = antwort.nach || {};
  anNurNachwuchs = !!antwort.nur_nachwuchs;
  zeichneAntragsReiter();
  zeichneAntragsListe();
}

function zeichneAntragsReiter() {
  $("an-reiter").innerHTML = Object.keys(AN_STATUS_TEXT).map((s) =>
    '<button class="btn klein ' + (s === anStatus ? "" : "grau") + '" data-anstatus="' +
    s + '">' + AN_STATUS_TEXT[s] + " (" + (anZaehler[s] || 0) + ")</button>").join(" ");

  $("an-reiter").querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => ladeAntraege(b.dataset.anstatus));
  });
}

function zeichneAntragsListe() {
  const ziel = $("an-liste");
  if (!anListe.length) {
    ziel.innerHTML = '<div class="leer">Keine ' +
      (anNurNachwuchs ? "Nachwuchs-Anmeldungen" : "Anträge") + " mit dem Status &bdquo;" +
      esc(AN_STATUS_TEXT[anStatus]) + "&ldquo;.</div>";
    return;
  }

  // Die Zahlungsart gehört zur Beitragsseite. Der Server liefert sie der
  // Passstelle gar nicht erst — die Spalte fällt hier mit weg, statt
  // „Überweisung" für „nicht mitgeteilt" zu behaupten.
  ziel.innerHTML =
    (anNurNachwuchs
      ? '<p class="fussnote">Diese Liste zeigt ausschließlich die Nachwuchs-Anmeldungen. ' +
        "Über die Aufnahme in den Verein entscheidet die Geschäftsstelle.</p>"
      : "") +
    '<div class="tabelle-scroll"><table><thead><tr>' +
    "<th>Eingang</th><th>Name</th><th>Geboren</th><th>Ort</th>" +
    "<th>Art</th><th>Abt.</th>" + (anNurNachwuchs ? "" : "<th>Zahlung</th>") + "<th></th>" +
    (anDarfLoeschen() ? "<th></th>" : "") +
    "</tr></thead><tbody>" +
    anListe.map((a) =>
      '<tr class="an-zeile" data-id="' + esc(a.id) + '">' +
        "<td>" + esc(datumDe(a.eingang_am)) + "</td>" +
        '<td class="name">' + esc(a.vorname + " " + a.nachname) +
          (a.minderjaehrig ? ' <span class="chip ruhend">minderjährig</span>' : "") + "</td>" +
        "<td>" + esc(datumDe(a.geburtsdatum) + anAlter(a.geburtsdatum)) + "</td>" +
        "<td>" + esc(a.ort) + "</td>" +
        "<td>" + esc(a.art === "ausserordentlich" ? "außerordentl." : "ordentlich") + "</td>" +
        "<td>" + a.anzahl_sparten + "</td>" +
        (anNurNachwuchs ? ""
          : "<td>" + esc(a.zahlungsart === "lastschrift" ? "Lastschrift" : "Überweisung") + "</td>") +
        '<td><button class="btn klein" type="button">Öffnen</button></td>' +
        (anDarfLoeschen()
          ? '<td><button class="btn klein warn" type="button" data-anloeschen="' + esc(a.id) +
            '" title="Diesen Antrag endgültig löschen">Löschen</button></td>'
          : "") +
      "</tr>").join("") +
    "</tbody></table></div>";

  ziel.querySelectorAll(".an-zeile").forEach((tr) => {
    tr.addEventListener("click", () => oeffneAntrag(tr.dataset.id));
  });
  // ⚠️ Der Knopf sitzt IN der klickbaren Zeile. Ohne stopPropagation
  // liefe der Zeilen-Handler mit und öffnete beim Abbrechen der
  // Rückfrage trotzdem den Antrag — dieselbe Falle wie beim Löschknopf
  // der Beitragsläufe.
  ziel.querySelectorAll("[data-anloeschen]").forEach((b) => {
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      loescheAntrag(b.dataset.anloeschen);
    });
  });
}

// ⚠️ Zwei Bedingungen, beide serverseitig ohnehin durchgesetzt — hier
// geht es nur darum, keinen Knopf zu zeigen, der sicher 403 oder 409
// antwortet:
//   * Die Passstelle löscht nicht. `nur_nachwuchs` heißt beim Server
//     `!darfSchreiben`, und genau daran hängt vv-antrag-loeschen.
//   * Ein angenommener Antrag bleibt stehen. An ihm hängen Mitgliedschaft
//     und SEPA-Mandat; die Mitgliedschaft endet über den Austritt.
function anDarfLoeschen() {
  return !anNurNachwuchs && anStatus !== "angenommen";
}

// Zweistufig: erst zählen lassen, dann mit den Zahlen fragen. Wer einen
// Antrag wegwirft, soll vorher sehen, was daran hängt — vor allem die
// Nachweise, die woanders liegen.
async function loescheAntrag(id) {
  let p;
  try {
    p = await vvRequest("vv-antrag-loeschen", { id, pruefen: true });
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
  // Schlüssel zu den Dateien steht NUR im Antrag — ist er weg, sind die
  // Ausweiskopien unauffindbar. Scheitert das Löschen dort, wird auch
  // der Antrag nicht angefasst, statt eine halbe Löschung zu hinterlassen.
  if (p.nachweis_owner) {
    try {
      await loescheNachweise(p.nachweis_owner);
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
    await vvRequest("vv-antrag-loeschen", { id });
  } catch (e) {
    alert("Der Antrag ließ sich nicht löschen: " + e.message);
    return;
  }
  // Die Rückmeldung ist die Liste selbst: die Zeile ist weg und der
  // Zähler im Statusreiter zählt herunter. Eine zusätzliche Erfolgs-
  // meldung bräuchte eine Fläche, die es in diesem Reiter nicht gibt.
  await ladeAntraege(anStatus);
}

// ---------------------------------------------------------------------
// Einzelner Antrag
// ---------------------------------------------------------------------

async function oeffneAntrag(id) {
  $("antrag-overlay").hidden = false;
  $("an-titel").textContent = "Aufnahmeantrag";
  $("an-inhalt").innerHTML = '<div class="leer">Wird geladen …</div>';

  try {
    anAktuell = await vvRequest("vv-antrag", { id });
  } catch (e) {
    $("an-inhalt").innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  zeichneAntrag();
}

function anZeile(was, wert) {
  return wert ? "<tr><th>" + esc(was) + "</th><td>" + esc(wert) + "</td></tr>" : "";
}

function zeichneAntrag() {
  const a = anAktuell.antrag;
  const i = a.inhalt || {};
  const entschieden = a.status === "angenommen";
  const nurNachwuchs = !!anAktuell.nur_nachwuchs;

  $("an-titel").textContent = (i.vorname || "") + " " + (i.nachname || "");

  const spartenNamen = (anAktuell.alle_sparten || [])
    .filter((s) => (a.sparten || []).includes(s.id)).map((s) => s.name);

  // Dubletten zuerst und laut: einen Menschen doppelt anzulegen merkt
  // hinterher niemand, und der Beitrag geht dann zweimal ab.
  const dubletten = anAktuell.dubletten || [];
  const warnung = dubletten.length
    ? '<div class="hinweis fehler"><strong>Diese Person könnte bereits im Bestand stehen.</strong>' +
      "<ul>" + dubletten.map((d) =>
        "<li>" + esc(d.vorname + " " + d.nachname) + ", geboren " + esc(datumDe(d.geburtsdatum)) +
        (d.mitgliedsnummer ? " — Mitgliedsnummer " + esc(d.mitgliedsnummer) : " — ohne Mitgliedschaft") +
        (d.mgs_status ? " (" + esc(STATUS_LABELS[d.mgs_status] || d.mgs_status) + ")" : "") +
        "</li>").join("") + "</ul>" +
      "Bitte vor dem Beschluss klären. Ein zweiter Datensatz bedeutet einen zweiten Beitrag." +
      "</div>"
    : "";

  $("an-inhalt").innerHTML =
    warnung +
    '<div class="hinweis info">Eingegangen am <strong>' + esc(datumDe(a.eingang_am)) +
      "</strong>, Status <strong>" + esc(AN_STATUS_TEXT[a.status] || a.status) + "</strong>." +
      (a.geprueft_von ? " Zuletzt bearbeitet von " + esc(a.geprueft_von) + "." : "") +
    "</div>" +

    "<h3>Angaben aus dem Antrag</h3>" +
    '<div class="tabelle-scroll"><table class="zusammenfassung"><tbody>' +
    anZeile("Name", [i.anrede, i.vorname, i.nachname].filter(Boolean).join(" ")) +
    anZeile("Geboren", datumDe(i.geburtsdatum) + anAlter(i.geburtsdatum)) +
    anZeile("Geburtsort", i.geburtsort) +
    anZeile("Anschrift", (i.strasse || "") + ", " + (i.plz || "") + " " + (i.ort || "")) +
    anZeile("E-Mail", i.email) +
    anZeile("Telefon", [i.mobil, i.telefon].filter(Boolean).join(" / ")) +
    anZeile("Mitgliedschaft", MITGLIEDSARTEN[i.art] || i.art) +
    anZeile("Eintritt gewünscht", datumDe(i.eintritt_wunsch)) +
    anZeile("Abteilungen", spartenNamen.join(", ")) +
    // Beitrag und Bankverbindung stehen der Passstelle nicht zu. Der
    // Server schickt die Felder gar nicht mit; die Zeilen entfallen hier
    // ausdrücklich, statt sich auf leere Werte zu verlassen — bei
    // „Zahlungsart" stünde sonst „Überweisung" für „nicht mitgeteilt".
    (nurNachwuchs ? "" :
      anZeile("Beitragswunsch", i.beitragsart_wunsch) +
      anZeile("Familie im Verein", i.familie_hinweis) +
      anZeile("Zahlungsart", i.zahlungsart === "lastschrift" ? "SEPA-Lastschrift" : "Überweisung") +
      anZeile("Kontoinhaber", i.kontoinhaber) +
      anZeile("Anschrift Kontoinhaber", i.kontoinhaber_anschrift) +
      anZeile("IBAN", i.iban) +
      anZeile("BIC", i.bic) +
      anZeile("Kreditinstitut", i.bank_name)) +
    anZeile("Gesetzlicher Vertreter", i.gesetzl_name
      ? i.gesetzl_name + (i.gesetzl_verhaeltnis ? " (" + i.gesetzl_verhaeltnis + ")" : "") : "") +
    anZeile("Zweiter Erziehungsberechtigter", i.gesetzl2_name
      ? i.gesetzl2_name + (i.gesetzl2_verhaeltnis ? " (" + i.gesetzl2_verhaeltnis + ")" : "")
      : (i.minderjaehrig && i.allein_sorgeberechtigt ? "alleiniges Sorgerecht erklärt" : "")) +
    anZeile("Fotoeinwilligung", i.einwilligung_fotos ? "erteilt" : "nicht erteilt") +
    // Nur bei der Nachwuchs-Anmeldung gefuehrt -- beim allgemeinen Antrag
    // bleibt die Zeile weg statt "nicht anerkannt" zu behaupten.
    (i.einwilligung_elternkodex
      ? anZeile("Elternkodex", "gelesen und anerkannt" +
                (i.elternkodex_version ? " (Fassung " + i.elternkodex_version + ")" : ""))
      : "") +
    anZeile("Anmerkung", i.bemerkung) +
    anZeile("Ort der Unterschrift", i.unterschrift_ort) +
    "</tbody></table></div>" +

    anSpielerlaubnisBlock(a, i) +

    "<h3>Unterschrift</h3>" +
    '<div class="unterschrift-beleg">' +
      (a.unterschrift
        ? '<div><div class="unterschrift-titel">Antragsteller</div><img alt="Unterschrift" src="' +
          esc(a.unterschrift) + '"></div>' : "") +
      (a.unterschrift_gesetzl
        ? '<div><div class="unterschrift-titel">Gesetzlicher Vertreter</div>' +
          '<img alt="Unterschrift des gesetzlichen Vertreters" src="' +
          esc(a.unterschrift_gesetzl) + '"></div>' : "") +
      (a.unterschrift_gesetzl2
        ? '<div><div class="unterschrift-titel">Zweiter Erziehungsberechtigter</div>' +
          '<img alt="Unterschrift des zweiten Erziehungsberechtigten" src="' +
          esc(a.unterschrift_gesetzl2) + '"></div>' : "") +
      (a.unterschrift_elternkodex
        ? '<div><div class="unterschrift-titel">Elternkodex</div>' +
          '<img alt="Unterschrift unter dem Elternkodex" src="' +
          esc(a.unterschrift_elternkodex) + '"></div>' : "") +
    "</div>" +
    '<p class="fussnote">Unterschrieben am ' + esc(datumDe(a.signatur_zeit)) +
      ", Internetadresse " + esc(a.signatur_ip || "—") + ". Gerät: " +
      esc((a.signatur_agent || "—").slice(0, 90)) + "</p>" +
    '<div class="knopfreihe nicht-drucken">' +
      // Der Papierantrag trägt das SEPA-Mandat mit Kontodaten — er ist das
      // Vereinsdokument und bleibt bei der Geschäftsstelle. Die Passstelle
      // bekäme ohnehin nur ein Blatt mit leerem Mandat.
      (nurNachwuchs ? ""
        : '<button class="btn grau" id="btn-an-papier" type="button">Als Papierantrag drucken</button>') +
      // Nur bei einer Nachwuchs-Anmeldung: ohne die Angaben aus dem
      // Spielerlaubnis-Block bliebe der halbe Bogen leer, und ein
      // unbrauchbares Blatt anzubieten ist schlimmer als kein Knopf.
      (i.spielerlaubnis
        ? '<button class="btn" id="btn-an-tfv" type="button">TFV-Antrag erzeugen</button>'
        : "") +
    "</div>" +
    '<div id="an-tfv-hinweise"></div>' +

    // Über die Aufnahme entscheidet nach § 4 der Gesamtvorstand, eingetragen
    // von der Geschäftsstelle. Die Passstelle sieht deshalb weder den
    // Beschlussblock noch die Angaben der angenommenen Mitgliedschaft.
    (nurNachwuchs
      ? '<div class="hinweis info">Über die Aufnahme in den Verein entscheidet die ' +
        "Geschäftsstelle (§ 4 der Satzung). Ihre Aufgabe hier ist der Antrag auf " +
        "Spielerlaubnis: Angaben prüfen, Nachweise ansehen, Verbandsformular erzeugen.</div>"
      : (entschieden ? anAngenommenBlock(a) : anEntscheidungsBlock(a, i)));

  if ($("btn-an-papier")) $("btn-an-papier").addEventListener("click", druckePapierantrag);
  if ($("btn-an-tfv")) $("btn-an-tfv").addEventListener("click", erzeugeTfvAntrag);
  anZeigeNachweise(a);
  anZeigeTfvStand(a);

  if (!nurNachwuchs && !entschieden) anVerdrahteEntscheidung();
}

// ---------------------------------------------------------------------
// Spielerlaubnis: Angaben, Nachweise, Verbandsformular
// ---------------------------------------------------------------------

const AN_SP_ART = {
  erstausstellung: "Erstausstellung",
  vereinswechsel: "Vereinswechsel",
  rueckkehrer: "Rückkehrer",
  namensaenderung: "Namensänderung / Korrektur"
};

const AN_NACHWEIS_TITEL = {
  geburtsurkunde: "Geburtsurkunde oder Ausweis",
  spielerpass: "Bisheriger Spielerpass",
  abmeldung: "Nachweis der Abmeldung",
  namensaenderung: "Dokument der Namensänderung",
  // ⚠️ Fehlte bis 06.08.2026 — der Knopf hieß dadurch roh „passbild". Das
  // Bild ist kein Nachweis im Sinne des Bogens, wird aber im selben Zug
  // hochgeladen und liegt deshalb im selben Ordner.
  passbild: "Passbild"
};

function anSpielerlaubnisBlock(a, i) {
  const s = i.spielerlaubnis;
  if (!s) return "";

  return "<h3>Antrag auf Spielerlaubnis</h3>" +
    '<div class="tabelle-scroll"><table class="zusammenfassung"><tbody>' +
    anZeile("Art der Passausstellung", AN_SP_ART[s.art] || s.art) +
    anZeile("Staatsangehörigkeit", i.nationalitaet) +
    anZeile("Bisheriger Verein", s.letzter_verein) +
    anZeile("Landesverband", s.landesverband) +
    anZeile("Pass-Nummer", s.pass_nr) +
    anZeile("Abmeldung", s.abmeldeweg === "1"
      ? "bereits erfolgt, Nachweis liegt vor"
      : (s.abmeldeweg === "2" ? "wird vom Verein übernommen" : "")) +
    anZeile("DFB-Werbeeinwilligung", s.einwilligung_dfb_marketing
      ? "erteilt" : "nicht erteilt") +
    "</tbody></table></div>" +
    // Der Bogen verlangt bei Auslaendern ab 10 zusaetzlich einen Antrag
    // auf internationale Freigabe. Die Familie hat den Hinweis beim
    // Ausfuellen gesehen -- hier steht er, weil ihn die Geschaeftsstelle
    // beim Einreichen braucht.
    (anBrauchtFreigabe(i)
      ? '<div class="hinweis warn"><strong>Internationale Freigabe nötig.</strong> ' +
        "Bei einer anderen als der deutschen Staatsangehörigkeit verlangt der Verband " +
        "ab dem 10. Lebensjahr zusätzlich einen Antrag auf internationale Freigabe. " +
        "Er ist dem Spielerlaubnisantrag beizufügen.</div>"
      : "") +
    '<div id="an-nachweise"></div>';
}

function anBrauchtFreigabe(i) {
  const nat = String(i.nationalitaet || "").trim().toLowerCase();
  if (!nat || /^(deutsch|de|deutschland|german)$/.test(nat)) return false;
  // alterJahre() aus app.js -- dieselbe Rechnung wie ueberall in dieser
  // App, nicht eine zweite daneben.
  const alter = alterJahre(i.geburtsdatum);
  return alter !== null && alter >= 10;
}

// Die Nachweise liegen beim Gateway, nicht in dieser Datenbank -- sie
// werden deshalb erst NACH dem Zeichnen der Karte nachgeladen. Ein
// Fehlschlag darf die Antragsansicht nicht aufhalten.
async function anZeigeNachweise(a) {
  const ziel = $("an-nachweise");
  if (!ziel) return;

  if (!a.nachweis_owner) {
    ziel.innerHTML = '<div class="hinweis warn"><strong>Keine Nachweise hochgeladen.</strong> ' +
      "Der Verband verlangt sie als Anlage zum Antrag — bitte bei der Familie nachfragen.</div>";
    return;
  }

  ziel.innerHTML = '<p class="fussnote">Nachweise werden geladen …</p>';
  let antwort;
  try {
    antwort = await ladeNachweisListe(a.nachweis_owner);
  } catch (e) {
    ziel.innerHTML = '<div class="hinweis fehler">Die Nachweise sind gerade nicht ' +
      "erreichbar: " + esc(e.message) + "</div>";
    return;
  }

  const liste = (antwort && antwort.nachweise) || [];
  if (!liste.length) {
    ziel.innerHTML = '<div class="hinweis warn">Zu diesem Antrag liegt keine Datei vor.</div>';
    return;
  }

  ziel.innerHTML = "<h4>Nachweise</h4>" +
    '<div class="knopfreihe nicht-drucken">' +
    liste.map((n) =>
      '<button class="btn grau klein" type="button" data-nachweis="' + esc(n.slot) + '">' +
      esc(AN_NACHWEIS_TITEL[n.slot] || n.slot) +
      ' <span class="fussnote">(' + Math.round((n.groesse || 0) / 1024) + " KB)</span></button>"
    ).join(" ") + "</div>";

  ziel.querySelectorAll("[data-nachweis]").forEach((b) => {
    b.addEventListener("click", () => oeffneNachweis(a.nachweis_owner, b.dataset.nachweis));
  });
}

// ---------------------------------------------------------------------
// Dateien ansehen statt herunterladen
// ---------------------------------------------------------------------
//
// Michel-Vorgabe vom 06.08.2026: eine Anlage soll sich ANSEHEN lassen, und
// im Anzeigefeld steht dann ein Knopf zum Herunterladen.
//
// ⚠️ Der frühere Weg (window.open auf eine Blob-URL) war kein Ansehen: was
// der Browser damit macht, hängt vom Dateityp ab — bei allem außer Bild und
// PDF ist es ein Download, und am Handy verliert man dabei den Antrag, aus
// dem man kam. Nebenbei fällt damit die iOS-Falle weg, dass window.open
// nach einem await lautlos blockiert wird: es wird kein Fenster mehr
// geöffnet.

let dateiUrl = null;

function dateiEndung(mime) {
  const t = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
              "image/heic": "heic", "application/pdf": "pdf" };
  return t[mime] || "dat";
}

function zeigeDatei(titel, blob, dateiname) {
  // Eine noch offene Datei zuerst wegräumen — sonst bleibt ihre Blob-URL
  // liegen, solange die Seite offen ist.
  schliesseDatei();

  const typ = blob.type || "";
  dateiUrl = URL.createObjectURL(blob);

  $("datei-titel").textContent = titel;
  const buehne = $("datei-buehne");
  buehne.innerHTML = "";

  if (typ.indexOf("image/") === 0) {
    const bild = document.createElement("img");
    bild.src = dateiUrl;
    bild.alt = titel;
    buehne.appendChild(bild);
  } else if (typ === "application/pdf") {
    const rahmen = document.createElement("iframe");
    rahmen.src = dateiUrl;
    rahmen.title = titel;
    buehne.appendChild(rahmen);
  } else {
    // Weder Bild noch PDF: ehrlich sagen, dass hier nichts zu sehen ist,
    // statt ein leeres Feld zu zeigen. Der Knopf im Fuß führt weiter.
    const hinweis = document.createElement("div");
    hinweis.className = "datei-leer";
    hinweis.textContent = "Diese Datei lässt sich hier nicht anzeigen (" +
      (typ || "unbekannter Dateityp") + "). Bitte herunterladen.";
    buehne.appendChild(hinweis);
  }

  const knopf = $("btn-datei-laden");
  knopf.href = dateiUrl;
  knopf.setAttribute("download", dateiname);

  // ⚠️ Auf iOS zeigt ein iframe ein PDF nur als erste Seite oder gar nicht.
  // Der Satz nennt deshalb den Ausweg, statt den Nutzer raten zu lassen.
  $("datei-hinweis").textContent = typ === "application/pdf"
    ? "Zeigt das Blatt nicht vollständig? Dann herunterladen."
    : Math.max(1, Math.round(blob.size / 1024)) + " KB";

  $("datei-overlay").hidden = false;
}

function schliesseDatei() {
  $("datei-overlay").hidden = true;
  $("datei-buehne").innerHTML = "";
  if (dateiUrl) { URL.revokeObjectURL(dateiUrl); dateiUrl = null; }
}

async function oeffneNachweis(owner, slot) {
  const titel = AN_NACHWEIS_TITEL[slot] || slot;
  try {
    const blob = await ladeNachweisDatei(owner, slot);
    const name = ["nachweis", slot, (anAktuell && anAktuell.antrag &&
      (anAktuell.antrag.inhalt || {}).nachname) || ""]
      .filter(Boolean).join("_").replace(/[^A-Za-z0-9_-]/g, "") +
      "." + dateiEndung(blob.type);
    zeigeDatei(titel, blob, name);
  } catch (e) {
    alert("Der Nachweis konnte nicht geladen werden: " + e.message);
  }
}

async function erzeugeTfvAntrag() {
  const knopf = $("btn-an-tfv");
  const hinweisZiel = $("an-tfv-hinweise");
  knopf.disabled = true;
  knopf.textContent = "Wird erzeugt …";
  hinweisZiel.innerHTML = "";

  try {
    // Vereinsname und Verbandsnummer kommen seit der Passstellen-Rolle mit
    // dem Antrag mit. ⚠️ `anEinstellungen` bleibt für die VERBANDSNUMMER als
    // Rückfall stehen: es stammt aus `vv-einstellungen`, das neben ihr die
    // Vereins-IBAN führt und deshalb nur der Geschäftsstelle antwortet.
    //
    // ⚠️ Für den NAMEN gibt es diesen Rückfall seit dem 16.08.2026 nicht
    // mehr: er steht als Konstante im Worker und kommt immer gefüllt an.
    // `anEinstellungen.verein_name` gibt es nicht mehr -- der Schlüssel war
    // frei eingebbar, und in der Live-Datenbank stand "asd" darin.
    const verein = anAktuell.verein || {};
    const { bytes, hinweise } = await tfvAntragErzeugen({
      antrag: anAktuell.antrag,
      vereinsname: verein.name || "",
      vereinsNr: verein.tfv_nr || (anEinstellungen && anEinstellungen.tfv_vereinsnummer) || "",
      unterschriftOrt: anAktuell.antrag.inhalt.unterschrift_ort,
      datum: anAktuell.antrag.signatur_zeit || anAktuell.antrag.eingang_am
    });

    // Erst herunterladen, dann ablegen. Die Reihenfolge ist Absicht: der
    // Download ist die Handlung, die die Geschaeftsstelle gerade will --
    // ein Fehler bei der Ablage darf ihn nicht verschlucken.
    tfvAntragSpeichern(bytes, anAktuell.antrag);

    let ablage = "";
    try {
      await legeTfvAntragAb(anAktuell.antrag.id, bytes);
      ablage = " Es liegt zugleich beim Antrag in der Vereins-Nextcloud — " +
               "der Verband verlangt die Aufbewahrung für mindestens zwei Jahre.";
      tfvVorhanden = true;
    } catch (e) {
      // Sichtbar melden statt still schlucken: sonst verlaesst sich
      // jemand auf eine Aufbewahrung, die es nie gab.
      ablage = ' <strong>Nicht abgelegt:</strong> ' + esc(e.message) +
               " Das heruntergeladene Blatt ist davon unberührt.";
    }

    // Ueberlaengen werden GEMELDET, nicht still abgeschnitten: das Raster
    // fasst 29 Zeichen, und was darueber hinausgeht, faellt sonst erst
    // beim Verband auf.
    hinweisZiel.innerHTML = hinweise.length
      ? '<div class="hinweis warn"><strong>Bitte vor dem Einreichen prüfen:</strong><ul>' +
        hinweise.map((h) => "<li>" + esc(h) + "</li>").join("") +
        "</ul>Die betroffenen Felder sind im PDF gekürzt. Korrigieren lässt sich das " +
        "nur, indem die Angabe in der Mitgliederverwaltung geändert und der Antrag " +
        "neu erzeugt wird." + ablage + "</div>"
      : '<div class="hinweis erfolg">Der Verbandsantrag ist erzeugt. ' +
        "Bitte ausdrucken, mit Vereinsstempel und Unterschrift versehen und über " +
        "DFBnet Pass-Online einreichen." + ablage + "</div>";
  } catch (e) {
    hinweisZiel.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
  }

  knopf.disabled = false;
  knopf.textContent = tfvVorhanden ? "TFV-Antrag neu erzeugen" : "TFV-Antrag erzeugen";
}

let tfvVorhanden = false;

// Liegt schon ein Blatt zu diesem Antrag? Beschriftet den Knopf und bietet
// den Abruf an. Laeuft NACH dem Zeichnen der Karte; ein Fehlschlag darf
// die Antragsansicht nicht aufhalten.
async function anZeigeTfvStand(a) {
  tfvVorhanden = false;
  if (!$("btn-an-tfv")) return;

  let stand;
  try {
    stand = await ladeTfvAntragStatus(a.id);
  } catch {
    return;   // aelteres Gateway oder Netz weg: der Knopf funktioniert trotzdem
  }
  if (!stand || !stand.vorhanden) return;

  tfvVorhanden = true;
  $("btn-an-tfv").textContent = "TFV-Antrag neu erzeugen";
  $("an-tfv-hinweise").innerHTML =
    '<div class="hinweis info">Zu diesem Antrag liegt bereits ein erzeugtes ' +
    "Verbandsformular (" + Math.round((stand.groesse || 0) / 1024) + " KB" +
    (stand.erzeugt_am ? ", " + esc(new Date(stand.erzeugt_am).toLocaleString("de-DE")) : "") +
    "). " +
    '<button class="btn grau klein" id="btn-an-tfv-holen" type="button">Abgelegtes ' +
    "Blatt öffnen</button></div>";

  $("btn-an-tfv-holen").addEventListener("click", () => oeffneAbgelegtenTfvAntrag(a.id));
}

// Dasselbe Anzeigefeld wie bei den Nachweisen — auch hier war der
// Blob-Tab je nach Browser ein Download statt einer Ansicht.
async function oeffneAbgelegtenTfvAntrag(id) {
  try {
    const blob = await ladeTfvAntragDatei(id);
    const i = (anAktuell && anAktuell.antrag && anAktuell.antrag.inhalt) || {};
    const name = ["Spielerlaubnis", i.nachname, i.vorname].filter(Boolean)
      .join("_").replace(/[^A-Za-z0-9_-]/g, "") + ".pdf";
    zeigeDatei("Abgelegtes Verbandsformular", blob, name);
  } catch (e) {
    alert("Das abgelegte Formular konnte nicht geladen werden: " + e.message);
  }
}

function anAngenommenBlock(a) {
  return '<div class="hinweis erfolg"><strong>Angenommen.</strong> ' +
    "Vorstandsbeschluss vom " + esc(datumDe(a.beschluss_am)) +
    ", eingetragen von " + esc(a.geprueft_von || "—") + ". " +
    "Die Mitgliedschaft steht in der Mitgliederliste.</div>";
}

function anEntscheidungsBlock(a, i) {
  const v = anAktuell.vorschlag || {};
  const klassen = anAktuell.beitragsklassen || [];
  const haushalte = anAktuell.haushalte || [];

  const klassenWahl = klassen.map((k) =>
    '<option value="' + esc(k.id) + '"' + (k.id === v.beitragsklasse_id ? " selected" : "") +
    ">" + esc(k.name) + (k.betrag_cent !== null ? " — " + lEur(k.betrag_cent) : "") +
    "</option>").join("");

  // Wird ein bestehender Haushalt gewählt, hängt die neue Person am
  // Familienbeitrag und am vorhandenen Mandat. Wer das übersieht, legt
  // ein zweites Mandat für dieselbe Familie an.
  const haushaltWahl = haushalte.length
    ? '<div class="feld breit"><label for="an-haushalt">Haushalt</label>' +
      '<select id="an-haushalt"><option value="">Neuen Haushalt anlegen</option>' +
      haushalte.map((h) =>
        '<option value="' + esc(h.haushalt_id) + '">' +
        esc((h.bezeichnung || ("Haushalt " + h.nachname)) + " — " + h.strasse + ", " +
            h.plz + " " + h.ort + " (" + h.im_haushalt + " Personen)") +
        "</option>").join("") +
      "</select></div>"
    : '<input type="hidden" id="an-haushalt" value="">';

  const spartenHaken = (anAktuell.alle_sparten || []).map((s) =>
    '<label class="ankreuz"><input type="checkbox" class="an-sparte" value="' + esc(s.id) + '"' +
    ((a.sparten || []).includes(s.id) ? " checked" : "") + "><span>" + esc(s.name) +
    "</span></label>").join("");

  return "<h3>Beschluss nach § 4</h3>" +
    '<div class="hinweis warn">Die Aufnahme ist ein Beschluss des Gesamtvorstands. ' +
    "Ohne dessen Datum legt die App keine Mitgliedschaft an — sie kann es nicht erraten, " +
    "und ohne Beschluss ist die Mitgliedschaft nicht wirksam.</div>" +
    (haushalte.length
      ? '<div class="hinweis info">Unter derselben Anschrift steht bereits ' +
        (haushalte.length === 1 ? "eine Person" : haushalte.length + " Personen") +
        " mit diesem Nachnamen. Beim Zuordnen zu deren Haushalt gilt der Familienbeitrag, " +
        "und ein vorhandenes Mandat wird weiterverwendet.</div>"
      : "") +
    '<div class="formraster">' +
      '<div class="feld"><label for="an-beschluss">Datum des Vorstandsbeschlusses *</label>' +
        '<input type="date" id="an-beschluss" max="' + lHeute() + '"></div>' +
      '<div class="feld"><label for="an-eintritt">Eintritt zum</label>' +
        '<input type="date" id="an-eintritt" value="' + esc(v.eintritt || lHeute()) + '"></div>' +
      '<div class="feld"><label for="an-nummer">Mitgliedsnummer</label>' +
        '<input id="an-nummer" value="' + esc(v.mitgliedsnummer || "") + '"></div>' +
      '<div class="feld"><label for="an-art">Art</label><select id="an-art">' +
        '<option value="ordentlich"' + (i.art !== "ausserordentlich" ? " selected" : "") +
          ">Ordentliches Mitglied</option>" +
        '<option value="ausserordentlich"' + (i.art === "ausserordentlich" ? " selected" : "") +
          ">Außerordentliches Mitglied</option>" +
        "</select></div>" +
      '<div class="feld breit"><label for="an-klasse">Beitragsklasse</label>' +
        '<select id="an-klasse"><option value="">— noch offen —</option>' + klassenWahl +
        "</select></div>" +
      haushaltWahl +
    "</div>" +
    '<p class="fussnote">Vorgeschlagen ist die Klasse ' +
      (v.beitragsklasse_grund === "wunsch"
        ? "nach der Angabe im Antrag"
        : "nach dem Alter — im Antrag stand keine") +
      ". Der Familienbeitrag steckt in der Klasse selbst, es gibt kein zweites Kästchen.</p>" +

    "<h3>Abteilungen</h3>" +
    '<div class="ankreuz-raster">' + (spartenHaken || '<p class="fussnote">Keine Abteilungen hinterlegt.</p>') + "</div>" +

    '<div class="feld breit" style="margin-top:14px"><label for="an-vermerk">' +
      "Interner Vermerk (bei Ablehnung)</label><input id=\"an-vermerk\"></div>" +
    '<p class="fussnote">§ 4 Abs. 2: Eine Ablehnung muss nicht begründet werden. ' +
      "Der Vermerk bleibt intern.</p>" +

    '<div id="an-meldung" class="hinweis fehler" hidden></div>' +
    '<div class="knopfreihe">' +
      '<button class="btn" id="btn-an-annehmen">Aufnehmen</button>' +
      (a.status === "neu"
        ? '<button class="btn grau" id="btn-an-vormerken">Für den Vorstand vormerken</button>' : "") +
      '<button class="btn warn" id="btn-an-ablehnen">Ablehnen</button>' +
      '<button class="btn grau" id="btn-an-zurueck">Zurückgezogen</button>' +
    "</div>";
}

function anVerdrahteEntscheidung() {
  $("btn-an-annehmen").addEventListener("click", antragAnnehmen);
  const vor = $("btn-an-vormerken");
  if (vor) vor.addEventListener("click", () => antragStatus("geprueft"));
  $("btn-an-ablehnen").addEventListener("click", () => antragStatus("abgelehnt"));
  $("btn-an-zurueck").addEventListener("click", () => antragStatus("zurueckgezogen"));
}

function anMeldung(text) {
  const k = $("an-meldung");
  if (!k) return;
  if (!text) { k.hidden = true; return; }
  k.hidden = false;
  k.textContent = text;
}

async function antragStatus(status) {
  if (anLaeuft) return;
  const worte = { geprueft: "vormerken", abgelehnt: "ablehnen", zurueckgezogen: "als zurückgezogen eintragen" };
  if (status !== "geprueft" &&
      !confirm("Den Antrag wirklich " + worte[status] + "?")) return;

  anLaeuft = true;
  anMeldung("");
  try {
    await vvRequest("vv-antrag-status", {
      id: anAktuell.antrag.id, status, vermerk: ($("an-vermerk") || {}).value || ""
    });
  } catch (e) {
    anMeldung(e.message);
    anLaeuft = false;
    return;
  }
  anLaeuft = false;
  $("antrag-overlay").hidden = true;
  ladeAntraege();
}

async function antragAnnehmen() {
  if (anLaeuft) return;
  anMeldung("");

  const beschluss = $("an-beschluss").value;
  if (!beschluss) {
    anMeldung("Ohne das Datum des Vorstandsbeschlusses kann der Antrag nicht angenommen " +
              "werden (§ 4 der Satzung).");
    return;
  }

  const sparten = Array.from(document.querySelectorAll(".an-sparte"))
    .filter((h) => h.checked).map((h) => h.value);

  anLaeuft = true;
  let antwort;
  try {
    antwort = await vvRequest("vv-antrag-annehmen", {
      id: anAktuell.antrag.id,
      beschluss_am: beschluss,
      eintritt: $("an-eintritt").value,
      mitgliedsnummer: $("an-nummer").value,
      art: $("an-art").value,
      beitragsklasse_id: $("an-klasse").value,
      haushalt_id: $("an-haushalt").value,
      sparte_ids: sparten
    });
  } catch (e) {
    anMeldung(e.message);
    anLaeuft = false;
    return;
  }
  anLaeuft = false;

  $("antrag-overlay").hidden = true;
  ladeAntraege();
  // Die Mitgliederliste zeigt sonst noch den Stand von vorhin.
  if (typeof ladeUndZeige === "function") ladeUndZeige();

  $("an-erfolg").hidden = false;
  $("an-erfolg").className = "hinweis erfolg";
  $("an-erfolg").innerHTML =
    "Aufgenommen mit der Mitgliedsnummer <strong>" + esc(antwort.mitgliedsnummer) +
    "</strong>, Beschluss vom " + esc(datumDe(beschluss)) + ". " +
    (antwort.mandat_angelegt
      ? "Das SEPA-Mandat wurde aus der Unterschrift angelegt."
      : (antwort.mandat_hinweis ? esc(antwort.mandat_hinweis) : ""));
}

// ---------------------------------------------------------------------
// Papierantrag zum Abheften
// ---------------------------------------------------------------------
//
// Der Aufbau der vier Blaetter steht in antrag-druck.js -- dieselbe Datei
// benutzt der Sicht-Reiter des oeffentlichen Formulars. Eine zweite Kopie
// hier waere nach der ersten Aenderung eine andere: beide Ausdrucke
// muessen aber dasselbe Blatt ergeben.
function druckePapierantrag() {
  papierAntragOeffnen({
    antrag: anAktuell.antrag,
    sparten: anAktuell.alle_sparten,
    einstellungen: anEinstellungen,
    mitgliedsnummer: (anAktuell.vorschlag && anAktuell.vorschlag.mitgliedsnummer) || ""
  });
}

function antraegeVerdrahten() {
  $("btn-an-zu").addEventListener("click", () => { $("antrag-overlay").hidden = true; });
  $("btn-an-schliessen").addEventListener("click", () => { $("antrag-overlay").hidden = true; });

  $("btn-datei-zu").addEventListener("click", schliesseDatei);
  $("btn-datei-schliessen").addEventListener("click", schliesseDatei);
  // Klick auf den dunklen Rand schließt — aber nur dort. Ein Klick INS
  // Bild soll es nicht wegnehmen.
  $("datei-overlay").addEventListener("click", (e) => {
    if (e.target === $("datei-overlay")) schliesseDatei();
  });
  // ⚠️ KEIN eigener Escape-Handler hier. `app.js` führt bereits eine Kette
  // über alle Overlays und schließt das oberste; ein zweiter Handler
  // daneben nähme der Datei den Vorrang und klappte im selben Tastendruck
  // den Antrag darunter mit zu (im Browser gemessen, nicht vermutet).
  // `datei-overlay` steht deshalb dort ganz vorn in der Kette.
}
