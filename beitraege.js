// Beitragsordnung.
//
// Zwei Festlegungen aus dem echten Altbestand, die hier durchgehalten
// werden müssen:
//
//   1. Der Beitrag fällt EINMAL JE MITGLIED an, nicht je Sparte. Wer in
//      Fußball und Breitensport aktiv ist, zahlt einmal.
//   2. Die Beitragsklasse hängt NICHT am Alter, sondern ist eine
//      gepflegte Angabe. Im Bestand steht ein 75-Jähriger mit
//      Kinderbeitrag und ein Rentner mit 48. Wer die Klasse aus dem
//      Geburtsdatum berechnet, stellt ungefragt Beiträge um.
//
// Deshalb rechnet diese Seite nichts aus, was nicht in der Datenbank
// steht — sie zeigt an, was gespeichert ist, und meldet Fälle, die eine
// Rückfrage verdienen.

let beitragStand = null;

function eur(cent) {
  if (cent === null || cent === undefined) return "—";
  return (cent / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

// "96,00" und "96.00" und "96" sollen alle funktionieren. Ein Betrag,
// der sich nicht eindeutig lesen lässt, wird abgelehnt statt geraten.
function centAusText(text) {
  const t = String(text || "").trim().replace(/\s|€/g, "");
  if (!t) return null;
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t.replace(",", ".")) * 100);
}

function beitragMeldung(art, text) {
  const k = $("b-status");
  k.hidden = false;
  k.className = "hinweis " + art;
  k.textContent = text;
}

async function ladeBeitraege() {
  const ziel = $("b-klassen");
  ziel.innerHTML = '<div class="leer">Wird geladen …</div>';

  try {
    beitragStand = await vvRequest("vv-beitrag-uebersicht", {});
  } catch (e) {
    ziel.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }

  const klassen = beitragStand.klassen || [];

  if (!klassen.length) {
    ziel.innerHTML = '<div class="leer"><strong>Es ist noch keine Beitragsordnung angelegt.</strong><br>' +
      "Die drei Klassen und ihre Sätze werden aus dem übernommenen Bestand eingerichtet.</div>";
    $("btn-b-init").hidden = false;
    $("btn-b-zuordnen").hidden = true;
    $("b-karte-pruefen").hidden = true;
    return;
  }
  $("btn-b-init").hidden = true;
  $("btn-b-zuordnen").hidden = false;

  ziel.innerHTML = '<div class="tabelle-scroll"><table><thead><tr>' +
    "<th>Klasse</th><th>Jahresbeitrag</th><th>Mitglieder</th><th>Jahressumme</th>" +
    "</tr></thead><tbody>" +
    klassen.map((k) =>
      "<tr>" +
        '<td class="name">' + esc(k.name) + "</td>" +
        '<td class="betrag">' + eur(k.betrag_cent) + "</td>" +
        '<td class="betrag">' + k.anzahl + "</td>" +
        '<td class="betrag">' + eur(k.summe_cent) + "</td>" +
      "</tr>").join("") +
    '<tr class="summenzeile">' +
      "<td>Summe</td><td></td>" +
      '<td class="betrag">' + klassen.reduce((s, k) => s + k.anzahl, 0) + "</td>" +
      '<td class="betrag">' + eur(beitragStand.summeCent) + "</td>" +
    "</tr>" +
    "</tbody></table></div>";

  if (beitragStand.ohneKlasse) {
    beitragMeldung("warn", beitragStand.ohneKlasse +
      " Mitglieder haben noch keine Beitragsklasse und sind in der Summe nicht enthalten. " +
      "„Mitglieder zuordnen" + "“" + " übernimmt sie aus dem alten Bestand.");
  } else {
    beitragMeldung("info", "Alle Mitglieder sind einer Beitragsklasse zugeordnet.");
  }

  const auffaellig = beitragStand.auffaellig || [];
  $("b-karte-pruefen").hidden = !auffaellig.length;
  if (auffaellig.length) {
    $("b-auffaellig").innerHTML = '<div class="tabelle-scroll"><table><thead><tr>' +
      "<th>Name</th><th>Nr.</th><th>Alter</th><th>Klasse</th>" +
      "</tr></thead><tbody>" +
      auffaellig.map((a) =>
        '<tr data-id="' + esc(a.id) + '">' +
          '<td class="name">' + esc(a.nachname) + ", " + esc(a.vorname) + "</td>" +
          "<td>" + esc(a.mitgliedsnummer) + "</td>" +
          '<td class="betrag">' + esc(a.alter_jahre) + "</td>" +
          "<td>" + esc(a.klasse) + "</td>" +
        "</tr>").join("") +
      "</tbody></table></div>";
    // Klick öffnet das Mitglied — von hier aus soll man es direkt
    // korrigieren können, nicht erst in der Liste suchen.
    $("b-auffaellig").querySelectorAll("tbody tr").forEach((tr) => {
      tr.addEventListener("click", () => { waehleTab("tab-mitglieder"); oeffneDetail(tr.dataset.id); });
    });
  }

  const sel = $("b-satz-klasse");
  const vorher = sel.value;
  sel.innerHTML = klassen.map((k) =>
    '<option value="' + esc(k.id) + '">' + esc(k.name) + " (" + eur(k.betrag_cent) + ")</option>").join("");
  if (vorher) sel.value = vorher;
}

async function beitragsordnungAnlegen() {
  const b = $("btn-b-init");
  b.disabled = true;
  b.textContent = "Wird angelegt …";
  try {
    // Die Spalten für Klasse und Familienbeitrag gibt es im
    // ursprünglichen Schema noch nicht. Die Migration ist beliebig oft
    // aufrufbar und läuft deshalb einfach mit.
    await vvRequest("vv-migration", {});
    await vvRequest("vv-beitrag-init", {});
    await ladeBeitraege();
  } catch (e) {
    beitragMeldung("fehler", e.message);
  }
  b.disabled = false;
  b.textContent = "Beitragsordnung anlegen";
}

async function mitgliederZuordnen() {
  const b = $("btn-b-zuordnen");
  b.disabled = true;
  b.textContent = "Wird geprüft …";
  try {
    // Erst ein Probelauf: er zeigt die Summe, bevor irgendetwas
    // geschrieben wird.
    const probe = await vvRequest("vv-beitrag-zuordnen", { pruefen: true });
    const text = probe.zugeordnet + " Mitglieder werden zugeordnet, Jahressumme " +
      eur(probe.summeCent) + "." +
      (probe.schonGesetzt ? "\n" + probe.schonGesetzt + " haben bereits eine Klasse und bleiben unverändert." : "") +
      (probe.ohneAngabe ? "\n" + probe.ohneAngabe + " haben keine Beitragsangabe aus dem Altbestand und bleiben ohne Klasse." : "") +
      "\n\nJetzt übernehmen?";
    if (!confirm(text)) { b.disabled = false; b.textContent = "Mitglieder zuordnen"; return; }

    b.textContent = "Wird zugeordnet …";
    const a = await vvRequest("vv-beitrag-zuordnen", {});
    beitragMeldung("info", a.zugeordnet + " Mitglieder zugeordnet, Jahressumme " + eur(a.summeCent) + "." +
      (a.uneindeutigGesamt ? " " + a.uneindeutigGesamt +
        " Mitglieder nennen in ihren Sparten verschiedene Beitragsarten — siehe unten." : ""));
    zeichneUneindeutig(a.uneindeutig || [], a.uneindeutigGesamt || 0);
    await ladeBeitraege();
  } catch (e) {
    beitragMeldung("fehler", e.message);
  }
  b.disabled = false;
  b.textContent = "Mitglieder zuordnen";
}

async function beitragssatzSetzen() {
  const k = $("b-satz-status");
  const cent = centAusText($("b-satz-betrag").value);
  const ab = $("b-satz-ab").value;

  if (cent === null) { zeigeHinweis(k, "fehler", "Betrag bitte als Zahl angeben, z. B. 96,00."); return; }
  if (!ab) { zeigeHinweis(k, "fehler", "Ab wann soll der neue Satz gelten?"); return; }

  zeigeHinweis(k, "info", "Wird gespeichert …");
  try {
    await vvRequest("vv-beitragssatz-setzen", {
      beitragsklasse_id: $("b-satz-klasse").value,
      betrag_cent: cent,
      gueltig_ab: ab,
      beschluss_am: $("b-satz-beschluss").value
    });
    zeigeHinweis(k, "info", "Neuer Satz gilt ab " + datumDe(ab) + ".");
    $("b-satz-betrag").value = "";
    await ladeBeitraege();
  } catch (e) {
    zeigeHinweis(k, "fehler", e.message);
  }
}

// Mitglieder, deren Sparten verschiedene Beitragsarten nennen. Genommen
// wurde die erste -- die eigentliche Entscheidung gehört der
// Geschäftsstelle. Ohne diese Liste bliebe die Wahl unsichtbar.
function zeichneUneindeutig(liste, gesamt) {
  const karte = $("b-karte-uneindeutig");
  karte.hidden = !gesamt;
  if (!gesamt) return;

  $("b-uneindeutig").innerHTML =
    '<div class="tabelle-scroll"><table><thead><tr>' +
    "<th>Im Vereinsmeister hinterlegt</th><th>übernommen als</th>" +
    "</tr></thead><tbody>" +
    liste.map((x) =>
      '<tr data-id="' + esc(x.id) + '">' +
        '<td class="name">' + esc((x.arten || []).join("  /  ")) + "</td>" +
        "<td>" + esc(x.genommen) + "</td>" +
      "</tr>").join("") +
    "</tbody></table></div>" +
    (gesamt > liste.length
      ? '<p class="fussnote">' + (gesamt - liste.length) + " weitere werden nicht einzeln aufgeführt.</p>"
      : "");

  $("b-uneindeutig").querySelectorAll("tbody tr").forEach((tr) => {
    tr.addEventListener("click", () => { waehleTab("tab-mitglieder"); oeffneDetail(tr.dataset.id); });
  });
}

function beitraegeVerdrahten() {
  $("btn-b-neu-laden").addEventListener("click", ladeBeitraege);
  $("btn-b-init").addEventListener("click", beitragsordnungAnlegen);
  $("btn-b-zuordnen").addEventListener("click", mitgliederZuordnen);
  $("btn-b-satz").addEventListener("click", beitragssatzSetzen);
}
