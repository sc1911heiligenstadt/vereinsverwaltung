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

  ziel.innerHTML =
    "<h3>Abteilungen im Formular</h3>" +
    '<p class="fussnote">Angehakt heißt: steht im Aufnahmeantrag zur Auswahl. Zurzeit ' +
      "sind es <strong>" + aktive + " von " + sparten.length + "</strong>. Eine stillgelegte " +
      "Abteilung behält ihre Mitglieder und ihre Geschichte — sie wird nur nicht mehr " +
      "angeboten. Das × daneben löscht die Abteilung ganz; das geht nur, solange ihr " +
      "niemand mehr zugeordnet ist.</p>" +
    '<div class="ankreuz-raster">' + sparten.map((s) =>
      '<div class="sparte-zeile">' +
      '<label class="ankreuz"><input type="checkbox" class="an-sp-aktiv" data-id="' + esc(s.id) +
      '" data-name="' + esc(s.name) + '" data-anzahl="' + (s.mitglieder || 0) + '"' +
      (s.aktiv ? " checked" : "") + "><span>" + esc(s.name) +
      ' <span class="fussnote">(' + (s.mitglieder || 0) + ")</span></span></label>" +
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
}

// Der Server liefert Codes, die Saetze entstehen hier -- wie beim
// Mahnwesen. "rolle" und "buchung" sind Sperren, an denen kein Knopf
// vorbeifuehrt.
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
    ziel.innerHTML = '<div class="leer">Keine Anträge mit dem Status &bdquo;' +
      esc(AN_STATUS_TEXT[anStatus]) + "&ldquo;.</div>";
    return;
  }

  ziel.innerHTML =
    '<div class="tabelle-scroll"><table><thead><tr>' +
    "<th>Eingang</th><th>Name</th><th>Geboren</th><th>Ort</th>" +
    "<th>Art</th><th>Abt.</th><th>Zahlung</th><th></th>" +
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
        "<td>" + esc(a.zahlungsart === "lastschrift" ? "Lastschrift" : "Überweisung") + "</td>" +
        '<td><button class="btn klein" type="button">Öffnen</button></td>' +
      "</tr>").join("") +
    "</tbody></table></div>";

  ziel.querySelectorAll(".an-zeile").forEach((tr) => {
    tr.addEventListener("click", () => oeffneAntrag(tr.dataset.id));
  });
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
    anZeile("Anschrift", (i.strasse || "") + ", " + (i.plz || "") + " " + (i.ort || "")) +
    anZeile("E-Mail", i.email) +
    anZeile("Telefon", [i.mobil, i.telefon].filter(Boolean).join(" / ")) +
    anZeile("Mitgliedschaft", MITGLIEDSARTEN[i.art] || i.art) +
    anZeile("Eintritt gewünscht", datumDe(i.eintritt_wunsch)) +
    anZeile("Abteilungen", spartenNamen.join(", ")) +
    anZeile("Beitragswunsch", i.beitragsart_wunsch) +
    anZeile("Familie im Verein", i.familie_hinweis) +
    anZeile("Zahlungsart", i.zahlungsart === "lastschrift" ? "SEPA-Lastschrift" : "Überweisung") +
    anZeile("Kontoinhaber", i.kontoinhaber) +
    anZeile("IBAN", i.iban) +
    anZeile("BIC", i.bic) +
    anZeile("Gesetzlicher Vertreter", i.gesetzl_name
      ? i.gesetzl_name + (i.gesetzl_verhaeltnis ? " (" + i.gesetzl_verhaeltnis + ")" : "") : "") +
    anZeile("Fotoeinwilligung", i.einwilligung_fotos ? "erteilt" : "nicht erteilt") +
    anZeile("Anmerkung", i.bemerkung) +
    "</tbody></table></div>" +

    "<h3>Unterschrift</h3>" +
    '<div class="unterschrift-beleg">' +
      (a.unterschrift
        ? '<div><div class="unterschrift-titel">Antragsteller</div><img alt="Unterschrift" src="' +
          esc(a.unterschrift) + '"></div>' : "") +
      (a.unterschrift_gesetzl
        ? '<div><div class="unterschrift-titel">Gesetzlicher Vertreter</div>' +
          '<img alt="Unterschrift des gesetzlichen Vertreters" src="' +
          esc(a.unterschrift_gesetzl) + '"></div>' : "") +
    "</div>" +
    '<p class="fussnote">Unterschrieben am ' + esc(datumDe(a.signatur_zeit)) +
      ", Internetadresse " + esc(a.signatur_ip || "—") + ". Gerät: " +
      esc((a.signatur_agent || "—").slice(0, 90)) + "</p>" +

    (entschieden ? anAngenommenBlock(a) : anEntscheidungsBlock(a, i));

  if (!entschieden) anVerdrahteEntscheidung();
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

function antraegeVerdrahten() {
  $("btn-an-zu").addEventListener("click", () => { $("antrag-overlay").hidden = true; });
  $("btn-an-schliessen").addEventListener("click", () => { $("antrag-overlay").hidden = true; });
}
