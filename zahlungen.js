// Zahlungseingänge und offene Posten.
//
// Der Status einer Forderung wird nie von Hand gesetzt, sondern immer
// aus den Zahlungen abgeleitet (im Worker, mengenbasiert). Diese Seite
// zeigt deshalb nur an, was in der Datenbank steht — sie rechnet nichts
// nach, was dort schon berechnet ist. Zwei Zähler, die auseinanderlaufen
// können, sind ein Zähler zu viel.

let zOffene = null;
let zKonto = null;
let zHaushalt = null;
let zDarfBuchen = false;

function zMeldung(id, art, text) {
  const k = $(id);
  k.hidden = false;
  k.className = "hinweis " + art;
  k.innerHTML = text;
}

const Z_ART = {
  lastschrift: "Lastschrift", ueberweisung: "Überweisung",
  bar: "Bar", verrechnung: "Verrechnung"
};

const Z_STATUS = {
  offen: "offen", teilbezahlt: "teilweise bezahlt",
  bezahlt: "bezahlt", storniert: "storniert"
};

// ---------------------------------------------------------------------
// Offene Posten
// ---------------------------------------------------------------------

async function ladeOffenePosten() {
  const ziel = $("z-liste");
  ziel.innerHTML = '<div class="leer">Wird geladen …</div>';

  try {
    zOffene = await vvRequest("vv-offene-posten", {
      jahr: $("z-jahr").value || null,
      nur_faellig: $("z-nur-faellig").checked
    });
  } catch (e) {
    ziel.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    $("z-summe").textContent = "";
    return;
  }
  zDarfBuchen = !!zOffene.darfBuchen;

  $("z-summe").textContent = zOffene.anzahl
    ? zOffene.anzahl + " offene Forderungen über " + lEur(zOffene.summeCent)
    : "Nichts offen.";

  if (!zOffene.zeilen.length) {
    ziel.innerHTML = '<div class="leer"><strong>Keine offenen Posten.</strong><br>' +
      "Entweder ist alles bezahlt oder es wurde noch kein Beitragslauf durchgeführt.</div>";
    $("z-karte-konto").hidden = true;
    return;
  }

  const ueberfaellig = zOffene.zeilen.filter((z) => z.ueberfaellig).length;

  ziel.innerHTML =
    (ueberfaellig
      ? '<div class="hinweis warn">' + ueberfaellig + " Forderungen sind bereits fällig und nicht " +
        "bezahlt. Nach § 5 Abs. 3 der Satzung braucht ein Ausschluss <strong>zwei schriftliche " +
        "Mahnungen</strong> — das Mahnwesen ist noch nicht gebaut.</div>"
      : "") +
    (zOffene.abgeschnitten
      ? '<div class="hinweis info">Es werden die ersten 500 Forderungen angezeigt. Die Summe ' +
        "oben zählt trotzdem alle.</div>"
      : "") +
    '<div class="tabelle-scroll"><table><thead><tr>' +
    "<th>Nr.</th><th>Name</th><th>Forderung</th><th>Fällig</th><th>Betrag</th>" +
    "<th>bezahlt</th><th>offen</th><th>Status</th>" +
    "</tr></thead><tbody>" +
    zOffene.zeilen.map((z) =>
      '<tr class="klickbar" data-haushalt="' + esc(z.haushalt_id) + '" data-name="' + esc(z.name) + '">' +
        "<td>" + esc(z.mitgliedsnummer) + "</td>" +
        '<td class="name">' + esc(z.name) + "</td>" +
        "<td>" + esc(z.bezeichnung) +
          (z.art !== "beitrag" ? ' <span class="chip">' + esc(z.art) + "</span>" : "") + "</td>" +
        "<td" + (z.ueberfaellig ? ' class="ueberfaellig"' : "") + ">" + lDatum(z.faellig_am) + "</td>" +
        '<td class="betrag">' + lEur(z.betrag_cent) + "</td>" +
        '<td class="betrag">' + (z.bezahlt_cent ? lEur(z.bezahlt_cent) : "—") + "</td>" +
        '<td class="betrag">' + lEur(z.rest_cent) + "</td>" +
        '<td><span class="chip ' + esc(z.status) + '">' + esc(Z_STATUS[z.status] || z.status) +
          "</span></td>" +
      "</tr>").join("") +
    "</tbody></table></div>";

  ziel.querySelectorAll("tr.klickbar").forEach((tr) => {
    tr.addEventListener("click", () => oeffneKonto(tr.dataset.haushalt, tr.dataset.name));
  });
}

// Die Jahresliste kommt aus den vorhandenen Läufen, nicht aus einer
// gerechneten Spanne: sonst stehen Jahre zur Auswahl, zu denen es nichts
// gibt.
async function ladeZahlungsJahre() {
  const sel = $("z-jahr");
  let jahre = [];
  try {
    const r = await vvRequest("vv-lauf-liste", {});
    jahre = Array.from(new Set((r.laeufe || []).map((l) => l.jahr))).sort((a, b) => b - a);
  } catch { jahre = []; }
  const vorher = sel.value;
  sel.innerHTML = '<option value="">Alle</option>' +
    jahre.map((j) => '<option value="' + j + '">' + j + "</option>").join("");
  if (vorher) sel.value = vorher;
}

// ---------------------------------------------------------------------
// Kontoauszug eines Haushalts
// ---------------------------------------------------------------------

async function oeffneKonto(haushaltId, name) {
  zHaushalt = haushaltId;
  $("z-karte-konto").hidden = false;
  $("z-konto-titel").textContent = "Kontoauszug — " + (name || "Haushalt");
  $("z-konto").innerHTML = '<div class="leer">Wird geladen …</div>';
  $("z-konto-status").hidden = true;
  $("z-konto-knoepfe").innerHTML = "";

  try {
    zKonto = await vvRequest("vv-zahlungen", { haushalt_id: haushaltId });
  } catch (e) {
    $("z-konto").innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }

  const f = zKonto.forderungen || [];
  const z = zKonto.zahlungen || [];
  const offen = f.filter((x) => !x.storniert_am).reduce((s, x) => s + x.rest_cent, 0);

  $("z-konto").innerHTML =
    '<dl class="kennzahlen">' +
      "<div><dt>Forderungen</dt><dd>" + f.length + "</dd></div>" +
      "<div><dt>Zahlungen</dt><dd>" + z.filter((x) => !x.storniert_am).length + "</dd></div>" +
      "<div><dt>Noch offen</dt><dd>" + lEur(offen) + "</dd></div>" +
    "</dl>" +
    "<h3>Forderungen</h3>" +
    '<div class="tabelle-scroll"><table><thead><tr><th>Nr.</th><th>Name</th>' +
    "<th>Bezeichnung</th><th>Fällig</th><th>Betrag</th><th>offen</th><th>Status</th>" +
    (zKonto.darfBuchen ? "<th></th>" : "") + "</tr></thead><tbody>" +
    f.map((x) =>
      "<tr><td>" + esc(x.mitgliedsnummer) + '</td><td class="name">' + esc(x.name) + "</td>" +
      "<td>" + esc(x.bezeichnung) + "</td><td>" + lDatum(x.faellig_am) + "</td>" +
      '<td class="betrag">' + lEur(x.betrag_cent) + '</td><td class="betrag">' +
      (x.storniert_am ? "—" : lEur(x.rest_cent)) + "</td>" +
      '<td><span class="chip ' + esc(x.status) + '">' + esc(Z_STATUS[x.status] || x.status) +
      "</span>" + (x.storno_grund ? '<br><span class="fussnote">' + esc(x.storno_grund) +
        "</span>" : "") + "</td>" +
      (zKonto.darfBuchen
        ? "<td>" + (x.storniert_am || x.status === "bezahlt" ? "" :
            '<button class="btn grau klein" data-storno="' + esc(x.id) + '">stornieren</button>') + "</td>"
        : "") +
      "</tr>").join("") +
    "</tbody></table></div>" +
    (z.length
      ? "<h3>Zahlungen</h3>" +
        '<div class="tabelle-scroll"><table><thead><tr><th>Eingang</th><th>Art</th>' +
        "<th>Betrag</th><th>Zweck</th><th>Zuordnung</th>" +
        (zKonto.darfBuchen ? "<th></th>" : "") + "</tr></thead><tbody>" +
        z.map((x) =>
          '<tr' + (x.storniert_am ? ' class="storniert"' : "") + ">" +
          "<td>" + lDatum(x.eingang_am) + "</td>" +
          "<td>" + esc(Z_ART[x.art] || x.art) + "</td>" +
          '<td class="betrag">' + lEur(x.betrag_cent) + "</td>" +
          "<td>" + esc(x.verwendungszweck || "—") +
            (x.ruecklauf_grund
              ? '<br><span class="fussnote">zurückgegangen: ' + esc(x.ruecklauf_grund) +
                (x.ruecklauf_entgelt_cent ? ", Entgelt " + lEur(x.ruecklauf_entgelt_cent) : "") +
                "</span>"
              : (x.storniert_am ? '<br><span class="fussnote">storniert: ' +
                 esc(x.storno_grund || "") + "</span>" : "")) + "</td>" +
          "<td>" + esc(x.bezeichnung || "—") + "</td>" +
          (zKonto.darfBuchen
            ? "<td>" + (x.storniert_am ? "" :
                '<button class="btn grau klein" data-rueck="' + esc(x.id) + '" data-betrag="' +
                x.betrag_cent + '">Rücklastschrift</button>') + "</td>"
            : "") +
          "</tr>").join("") +
        "</tbody></table></div>"
      : "<h3>Zahlungen</h3><p class=\"fussnote\">Zu diesem Haushalt ist noch keine Zahlung erfasst.</p>");

  if (zKonto.darfBuchen) {
    $("z-konto-knoepfe").innerHTML =
      '<button class="btn" id="btn-z-zahlung">Zahlung erfassen</button>';
    $("btn-z-zahlung").addEventListener("click", () => oeffneZahlung(offen));
    $("z-konto").querySelectorAll("[data-storno]").forEach((b) => {
      b.addEventListener("click", () => storniereForderung(b.dataset.storno));
    });
    $("z-konto").querySelectorAll("[data-rueck]").forEach((b) => {
      b.addEventListener("click", () => oeffneRueck(b.dataset.rueck, Number(b.dataset.betrag)));
    });
  }
}

// ---------------------------------------------------------------------
// Zahlung erfassen
// ---------------------------------------------------------------------

function oeffneZahlung(offenCent) {
  $("nz-betrag").value = offenCent ? (offenCent / 100).toFixed(2).replace(".", ",") : "";
  $("nz-datum").value = lHeute();
  $("nz-art").value = "ueberweisung";
  $("nz-zweck").value = "";
  $("nz-empfaenger").textContent = $("z-konto-titel").textContent.replace("Kontoauszug — ", "") +
    " — offen " + lEur(offenCent);
  $("zahlung-status").textContent = "";
  $("zahlung-overlay").hidden = false;
}

async function speichereZahlung() {
  const cent = centAusText($("nz-betrag").value);
  if (!cent) { $("zahlung-status").textContent = "Betrag nicht lesbar."; return; }
  if (!$("nz-datum").value) { $("zahlung-status").textContent = "Eingangsdatum fehlt."; return; }

  const knopf = $("btn-zahlung-speichern");
  knopf.disabled = true;
  try {
    const r = await vvRequest("vv-zahlung-erfassen", {
      haushalt_id: zHaushalt,
      betrag_cent: cent,
      eingang_am: $("nz-datum").value,
      art: $("nz-art").value,
      verwendungszweck: $("nz-zweck").value
    });
    $("zahlung-overlay").hidden = true;
    await oeffneKonto(zHaushalt, null);
    await ladeOffenePosten();
    zMeldung("z-konto-status", r.ueberzahlung_cent ? "warn" : "erfolg",
      "Auf " + r.verteilt.length + " Forderung" + (r.verteilt.length === 1 ? "" : "en") + " gebucht." +
      (r.ueberzahlung_cent
        ? " <strong>" + lEur(r.ueberzahlung_cent) + " blieben übrig</strong> — dieser Haushalt hat " +
          "keine weiteren offenen Forderungen. Der Betrag ist nicht verbucht; ein Guthaben führt " +
          "diese App noch nicht."
        : ""));
  } catch (e) {
    $("zahlung-status").textContent = e.message;
  } finally {
    knopf.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Rücklastschrift
// ---------------------------------------------------------------------

let rueckZahlung = null;

function oeffneRueck(zahlungId, betragCent) {
  rueckZahlung = zahlungId;
  $("nr-grund").value = "";
  $("nr-entgelt").value = "";
  $("nr-weiter").checked = false;
  $("nr-zahlung").textContent = "Zahlung über " + lEur(betragCent) +
    " geht zurück. Die Forderung wird wieder offen.";
  $("rueck-status").textContent = "";
  $("rueck-overlay").hidden = false;
}

async function speichereRueck() {
  const grund = $("nr-grund").value.trim();
  if (!grund) { $("rueck-status").textContent = "Der Grund der Bank fehlt."; return; }
  const entgelt = $("nr-entgelt").value.trim() ? centAusText($("nr-entgelt").value) : 0;
  if ($("nr-entgelt").value.trim() && !entgelt) {
    $("rueck-status").textContent = "Entgelt nicht lesbar."; return;
  }

  const knopf = $("btn-rueck-speichern");
  knopf.disabled = true;
  try {
    const r = await vvRequest("vv-ruecklastschrift", {
      zahlung_id: rueckZahlung,
      grund,
      entgelt_cent: entgelt || null,
      weiterberechnen: $("nr-weiter").checked
    });
    $("rueck-overlay").hidden = true;
    await oeffneKonto(zHaushalt, null);
    await ladeOffenePosten();
    zMeldung("z-konto-status", "erfolg",
      "Gebucht. Die Forderung ist wieder offen." +
      (r.entgeltForderung ? " Das Entgelt steht als eigene Forderung daneben." : ""));
  } catch (e) {
    $("rueck-status").textContent = e.message;
  } finally {
    knopf.disabled = false;
  }
}

async function storniereForderung(id) {
  // Auf eine teilbezahlte Forderung ist schon Geld geflossen. Storniert
  // man sie, gehört dieses Geld nirgendwohin — das muss dastehen, bevor
  // jemand klickt, nicht danach auffallen.
  const f = ((zKonto && zKonto.forderungen) || []).find((x) => x.id === id);
  const schonGezahlt = f && f.bezahlt_cent > 0
    ? "\n\nACHTUNG: Auf diese Forderung sind bereits " +
      (f.bezahlt_cent / 100).toFixed(2).replace(".", ",") + " € eingegangen. Nach dem Storno " +
      "steht dieses Geld ohne Forderung da und muss erstattet oder verrechnet werden."
    : "";

  const grund = prompt("Warum wird diese Forderung storniert?\n\nSie wird nicht gelöscht — der " +
    "Eintrag bleibt mit Grund und Zeitstempel sichtbar." + schonGezahlt);
  if (!grund || !grund.trim()) return;
  try {
    await vvRequest("vv-forderung-stornieren", { forderung_id: id, grund });
    await oeffneKonto(zHaushalt, null);
    await ladeOffenePosten();
    zMeldung("z-konto-status", "erfolg", "Storniert.");
  } catch (e) {
    zMeldung("z-konto-status", "fehler", esc(e.message));
  }
}

// ---------------------------------------------------------------------

function zahlungenVerdrahten() {
  $("btn-z-neu-laden").addEventListener("click", ladeOffenePosten);
  $("z-jahr").addEventListener("change", ladeOffenePosten);
  $("z-nur-faellig").addEventListener("change", ladeOffenePosten);

  $("btn-zahlung-zu").addEventListener("click", () => { $("zahlung-overlay").hidden = true; });
  $("btn-zahlung-abbrechen").addEventListener("click", () => { $("zahlung-overlay").hidden = true; });
  $("btn-zahlung-speichern").addEventListener("click", speichereZahlung);

  $("btn-rueck-zu").addEventListener("click", () => { $("rueck-overlay").hidden = true; });
  $("btn-rueck-abbrechen").addEventListener("click", () => { $("rueck-overlay").hidden = true; });
  $("btn-rueck-speichern").addEventListener("click", speichereRueck);
}
