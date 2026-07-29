// Vereinsverwaltung -- Oberflaeche
//
// Der Zustand bleibt bewusst klein: Bei 2500 Mitgliedern wird nicht der
// gesamte Bestand in den Browser geladen, sondern seitenweise abgefragt.
// Suche und Filter laufen serverseitig -- dort, wo auch die Rechte
// durchgesetzt werden.

let meineRechte = null;
let spartenListe = [];
let seite = 0;
let letzteGesamtzahl = 0;

// ---------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------

function $(id) { return document.getElementById(id); }

// Jeder Wert aus der Datenbank geht hier durch, bevor er ins Markup
// kommt. Namen und Ortsangaben sind Freitext aus einem Import.
function esc(wert) {
  if (wert === null || wert === undefined) return "";
  return String(wert)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function datumDe(iso) {
  if (!iso || typeof iso !== "string" || iso.length < 10) return "";
  const t = iso.slice(0, 10).split("-");
  return t[2] + "." + t[1] + "." + t[0];
}

// Alter zum heutigen Tag. Bewusst ueber die lokalen Datumsanteile --
// toISOString() rechnet nach UTC um und liefert in deutscher Sommerzeit
// vor 02:00 Uhr den Vortag.
function alterJahre(geburt) {
  if (!geburt || geburt.length < 10) return null;
  const g = geburt.slice(0, 10).split("-").map(Number);
  const heute = new Date();
  let alter = heute.getFullYear() - g[0];
  const monat = heute.getMonth() + 1;
  const tag = heute.getDate();
  if (monat < g[1] || (monat === g[1] && tag < g[2])) alter--;
  return alter;
}

function zeigeHinweis(behaelter, art, text) {
  behaelter.hidden = false;
  behaelter.className = "hinweis " + art;
  behaelter.textContent = text;
}

// ---------------------------------------------------------------------
// Anmeldung und Rechte
// ---------------------------------------------------------------------

function rollenText(r) {
  if (r.isAdmin) return "Administrator";
  const namen = {
    geschaeftsstelle: "Geschäftsstelle",
    schatzmeister: "Schatzmeister",
    abteilungsleiter: "Abteilungsleitung",
    vorstand: "Vorstand"
  };
  const liste = (r.rollen || []).map((x) => namen[x] || x);
  return liste.length ? liste.join(", ") : "Ohne Rolle";
}

async function start() {
  // Gate haengt ausschliesslich am Token, nicht an einem gemerkten
  // Zustand -- sonst haengt jemand dauerhaft am Anmelde-Schirm fest.
  if (!getSessionToken()) return;

  try {
    meineRechte = await ladeEigeneRechte();
  } catch (e) {
    if (e instanceof NotLoggedInError) return;
    $("anmelde-schirm").innerHTML =
      '<h2>Verbindung fehlgeschlagen</h2><p>' + esc(e.message) + "</p>";
    return;
  }

  $("anmelde-schirm").hidden = true;
  $("app-bereich").hidden = false;
  $("haupt-nav").hidden = false;

  const pille = $("rollen-pille");
  pille.hidden = false;
  pille.textContent = rollenText(meineRechte);

  if (!meineRechte.darfPersonenSehen) {
    $("liste-bereich").innerHTML =
      '<div class="hinweis warn">Ihre Rolle ist für Kennzahlen vorgesehen und hat keinen Zugriff auf Personendaten. ' +
      "Die Auswertungen entstehen in einer späteren Ausbaustufe.</div>";
    document.querySelector(".filterleiste").hidden = true;
    return;
  }

  await ladeSpartenAuswahl();
  await ladeUndZeige();
}

async function ladeSpartenAuswahl() {
  try {
    const antwort = await ladeSparten();
    spartenListe = antwort.sparten || [];
  } catch {
    spartenListe = [];
  }
  const sel = $("f-sparte");
  spartenListe.forEach((s) => {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name;
    sel.appendChild(o);
  });
}

// ---------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------

async function ladeUndZeige() {
  const bereich = $("liste-bereich");
  bereich.innerHTML = '<div class="leer">Wird geladen …</div>';

  let antwort;
  try {
    antwort = await ladeMitglieder({
      suche: $("f-suche").value,
      sparte: $("f-sparte").value,
      status: $("f-status").value,
      limit: SEITENGROESSE,
      offset: seite * SEITENGROESSE
    });
  } catch (e) {
    if (e instanceof NotLoggedInError) {
      bereich.innerHTML = '<div class="hinweis fehler">Die Anmeldung ist abgelaufen. Bitte die Seite neu laden.</div>';
      return;
    }
    bereich.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }

  letzteGesamtzahl = antwort.gesamt || 0;

  const hinweis = $("sicht-hinweis");
  if (antwort.eingeschraenkt) {
    zeigeHinweis(hinweis, "info",
      "Sie sehen ausschließlich Mitglieder Ihrer eigenen Sparte. Weitere Spartenzugehörigkeiten und Bankdaten werden nicht übertragen.");
  } else {
    hinweis.hidden = true;
  }

  zeichneTabelle(antwort.zeilen || []);
  zeichneBlaetterleiste();
}

function zeichneTabelle(zeilen) {
  const bereich = $("liste-bereich");

  if (!zeilen.length) {
    bereich.innerHTML = '<div class="leer">' +
      (letzteGesamtzahl === 0 ? "Keine Mitglieder gefunden." : "Auf dieser Seite stehen keine Einträge.") +
      "</div>";
    return;
  }

  let html = '<div class="tabelle-scroll"><table><thead><tr>' +
    "<th>Name</th><th>Nr.</th><th>Geburtsdatum</th><th>Alter</th>" +
    "<th>Sparten</th><th>Ort</th><th>Eintritt</th><th>Status</th>" +
    "</tr></thead><tbody>";

  zeilen.forEach((z) => {
    const alter = alterJahre(z.geburtsdatum);
    const status = z.status || "aktiv";
    html += '<tr data-id="' + esc(z.mitgliedschaft_id) + '" tabindex="0">' +
      '<td class="name">' + esc(z.nachname) + ", " + esc(z.vorname) + "</td>" +
      "<td>" + esc(z.mitgliedsnummer) + "</td>" +
      "<td>" + datumDe(z.geburtsdatum) + "</td>" +
      "<td>" + (alter === null ? "" : alter) + "</td>" +
      '<td class="sparten">' + esc(z.sparten || "—") + "</td>" +
      "<td>" + esc(z.ort) + "</td>" +
      "<td>" + datumDe(z.eintritt) + "</td>" +
      '<td><span class="chip ' + esc(status) + '">' +
        esc(STATUS_LABELS[status] || status) + "</span></td>" +
      "</tr>";
  });

  html += "</tbody></table></div>";
  bereich.innerHTML = html;

  // Ein Handler auf dem Behaelter statt einem je Zeile -- bei 50 Zeilen
  // je Seite und haeufigem Neuzeichnen sonst unnoetig viele Registrierungen.
  bereich.querySelectorAll("tbody tr").forEach((tr) => {
    tr.addEventListener("click", () => oeffneDetail(tr.dataset.id));
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); oeffneDetail(tr.dataset.id); }
    });
  });
}

function zeichneBlaetterleiste() {
  const seiten = Math.max(1, Math.ceil(letzteGesamtzahl / SEITENGROESSE));
  const von = letzteGesamtzahl === 0 ? 0 : seite * SEITENGROESSE + 1;
  const bis = Math.min((seite + 1) * SEITENGROESSE, letzteGesamtzahl);

  $("zaehler-text").textContent = letzteGesamtzahl === 1
    ? "1 Mitglied"
    : letzteGesamtzahl + " Mitglieder";
  $("zaehler-seite").textContent = letzteGesamtzahl
    ? "Angezeigt: " + von + "–" + bis
    : "";

  const leiste = $("blaetterleiste");
  leiste.hidden = seiten <= 1;
  $("seiten-info").textContent = "Seite " + (seite + 1) + " von " + seiten;
  $("btn-zurueck").disabled = seite === 0;
  $("btn-weiter").disabled = seite + 1 >= seiten;
}

// ---------------------------------------------------------------------
// Detailansicht
// ---------------------------------------------------------------------

let offenesMitglied = null;

const PERSONENFELDER = {
  "d-vorname": "vorname", "d-nachname": "nachname", "d-geburtsdatum": "geburtsdatum",
  "d-geschlecht": "geschlecht", "d-strasse": "strasse", "d-plz": "plz", "d-ort": "ort",
  "d-email": "email", "d-telefon": "telefon", "d-mobil": "mobil"
};
const MITGLIEDSFELDER = { "d-art": "art", "d-eintritt": "eintritt", "d-status": "status" };

async function oeffneDetail(mitgliedschaftId) {
  const overlay = $("detail-overlay");
  overlay.hidden = false;
  $("detail-status").textContent = "Wird geladen …";
  $("detail-hinweis").hidden = true;

  let antwort;
  try {
    antwort = await vvRequest("vv-mitglied", { id: mitgliedschaftId });
  } catch (e) {
    $("detail-status").textContent = e.message;
    return;
  }

  offenesMitglied = antwort;
  const m = antwort.mitglied;

  $("detail-titel").textContent = (m.vorname || "") + " " + (m.nachname || "");
  $("detail-status").textContent = "";

  Object.entries(PERSONENFELDER).forEach(([id, feld]) => { $(id).value = m[feld] || ""; });
  Object.entries(MITGLIEDSFELDER).forEach(([id, feld]) => { $(id).value = m[feld] || ""; });
  $("d-nummer").value = m.mitgliedsnummer || "";

  // Satzung § 4: ohne Vorstandsbeschluss ist die Mitgliedschaft nicht
  // wirksam. Das gehoert sichtbar gemacht, nicht stillschweigend geduldet.
  const bh = $("d-beschluss-hinweis");
  bh.textContent = m.beschluss_am
    ? "Aufnahme beschlossen am " + datumDe(m.beschluss_am) + (m.beschluss_von ? " durch " + m.beschluss_von : "")
    : "Kein Vorstandsbeschluss hinterlegt — nach § 4 der Satzung ist die Aufnahme damit noch nicht wirksam.";
  bh.style.color = m.beschluss_am ? "" : "var(--amber)";

  // Sperren statt nur den Speichern-Knopf zu blockieren.
  const kontakt = antwort.darfKontaktAendern;
  const mitgl = antwort.darfMitgliedschaftAendern;
  Object.keys(PERSONENFELDER).forEach((id) => { $(id).disabled = !kontakt; });
  Object.keys(MITGLIEDSFELDER).forEach((id) => { $(id).disabled = !mitgl; });
  $("btn-detail-speichern").hidden = !kontakt && !mitgl;
  $("d-austritt-bereich").hidden = !mitgl;

  if (antwort.eingeschraenkt) {
    zeigeHinweis($("detail-hinweis"), "info",
      "Sie sehen diesen Datensatz als Abteilungsleitung: nur Ihre eigenen Sparten, keine Bankdaten. " +
      "Mitgliedschaftsdaten wie Art, Eintritt und Status ändert die Geschäftsstelle.");
  }

  zeichneSparten(antwort.sparten || []);
  $("d-austritt-vorschau").hidden = true;
  $("d-kuendigung").value = "";
}

function zeichneSparten(liste) {
  const ziel = $("d-sparten");
  if (!liste.length) {
    ziel.innerHTML = '<p class="fussnote">Keiner Sparte zugeordnet.</p>';
    return;
  }
  ziel.innerHTML = liste.map((s) => {
    const beendet = !!s.austritt;
    return '<div class="sparten-zeile">' +
      '<span class="sp-name">' + esc(s.name) + "</span>" +
      '<span class="sp-info">seit ' + datumDe(s.eintritt) +
        (beendet ? ", ausgetreten " + datumDe(s.austritt) : "") + "</span>" +
      '<span class="sp-info">' + (s.zuschlag_cent ? (s.zuschlag_cent / 100).toFixed(2) + " € / Jahr" : "kein Zuschlag") + "</span>" +
      "</div>";
  }).join("");
}

function schliesseDetail() {
  $("detail-overlay").hidden = true;
  offenesMitglied = null;
}

async function speichereDetail() {
  if (!offenesMitglied) return;
  const nutzlast = { id: offenesMitglied.mitglied.id };

  if (offenesMitglied.darfKontaktAendern) {
    Object.entries(PERSONENFELDER).forEach(([id, feld]) => { nutzlast[feld] = $(id).value; });
  }
  if (offenesMitglied.darfMitgliedschaftAendern) {
    Object.entries(MITGLIEDSFELDER).forEach(([id, feld]) => { nutzlast[feld] = $(id).value; });
  }

  $("detail-status").textContent = "Wird gespeichert …";
  try {
    await vvRequest("vv-mitglied-speichern", nutzlast);
    $("detail-status").textContent = "Gespeichert.";
    await ladeUndZeige();
  } catch (e) {
    $("detail-status").textContent = "Fehler: " + e.message;
  }
}

// Der Termin wird beim Server erfragt statt im Browser gerechnet -- so
// gibt es nur eine Stelle, an der die Satzungsregel steht.
async function zeigeAustrittVorschau() {
  const datum = $("d-kuendigung").value;
  const kasten = $("d-austritt-vorschau");
  const grund = $("d-austritt-grund").value;

  if (!datum) { kasten.hidden = true; return; }

  if (grund === "tod" || grund === "ausschluss") {
    kasten.hidden = false;
    kasten.textContent = "Die Mitgliedschaft endet sofort zum " + datumDe(datum) +
      " — die Kündigungsfrist des § 5 Abs. 2 gilt nur für den Austritt auf eigenen Wunsch.";
    return;
  }
  try {
    const a = await vvRequest("vv-austritt-vorschau", { kuendigung_am: datum });
    kasten.hidden = false;
    kasten.textContent = a.austritt
      ? "Nächstmöglicher Austrittstermin: " + datumDe(a.austritt)
      : "Kein gültiger Termin ermittelbar.";
  } catch (e) {
    kasten.hidden = false;
    kasten.textContent = e.message;
  }
}

async function eintragenAustritt() {
  if (!offenesMitglied) return;
  const datum = $("d-kuendigung").value;
  if (!datum) { $("detail-status").textContent = "Bitte das Eingangsdatum der Kündigung angeben."; return; }

  const grund = $("d-austritt-grund").value;
  if (!confirm("Austritt wirklich eintragen? Alle Spartenzugehörigkeiten werden zum selben Termin beendet.")) return;

  $("detail-status").textContent = "Wird eingetragen …";
  try {
    const a = await vvRequest("vv-austritt", { id: offenesMitglied.mitglied.id, kuendigung_am: datum, grund });
    $("detail-status").textContent = "Austritt eingetragen zum " + datumDe(a.austritt) + ".";
    await ladeUndZeige();
    await oeffneDetail(offenesMitglied.mitglied.id);
  } catch (e) {
    $("detail-status").textContent = "Fehler: " + e.message;
  }
}

// ---------------------------------------------------------------------
// Info
// ---------------------------------------------------------------------

function zeichneChangelog() {
  const ziel = $("changelog-liste");
  ziel.innerHTML = CHANGELOG.map((block) =>
    '<div class="changelog-block">' +
      "<h3>Version " + esc(block.version) + "</h3>" +
      '<div class="changelog-datum">' + datumDe(block.datum) + "</div>" +
      "<ul>" + block.punkte.map((p) => "<li>" + esc(p) + "</li>").join("") + "</ul>" +
    "</div>"
  ).join("");
}

// ---------------------------------------------------------------------
// Verdrahtung
// ---------------------------------------------------------------------

function init() {
  $("version-badge").textContent = "v" + APP_VERSION;
  $("version-badge-2").textContent = APP_VERSION;
  zeichneChangelog();

  document.querySelectorAll("#haupt-nav button").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#haupt-nav button").forEach((x) => x.classList.remove("aktiv"));
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("aktiv"));
      b.classList.add("aktiv");
      $(b.dataset.tab).classList.add("aktiv");
    });
  });

  const neuSuchen = () => { seite = 0; ladeUndZeige(); };
  $("btn-suchen").addEventListener("click", neuSuchen);
  $("f-sparte").addEventListener("change", neuSuchen);
  $("f-status").addEventListener("change", neuSuchen);
  $("f-suche").addEventListener("keydown", (e) => {
    if (e.key === "Enter") neuSuchen();
  });

  $("btn-zurueck").addEventListener("click", () => {
    if (seite > 0) { seite--; ladeUndZeige(); }
  });
  $("btn-weiter").addEventListener("click", () => {
    if ((seite + 1) * SEITENGROESSE < letzteGesamtzahl) { seite++; ladeUndZeige(); }
  });

  $("btn-detail-zu").addEventListener("click", schliesseDetail);
  $("btn-detail-abbrechen").addEventListener("click", schliesseDetail);
  $("btn-detail-speichern").addEventListener("click", speichereDetail);
  $("btn-austritt").addEventListener("click", eintragenAustritt);
  $("d-kuendigung").addEventListener("change", zeigeAustrittVorschau);
  $("d-austritt-grund").addEventListener("change", zeigeAustrittVorschau);

  // Klick auf die abgedunkelte Flaeche schliesst, Klick im Dialog nicht.
  $("detail-overlay").addEventListener("click", (e) => {
    if (e.target === $("detail-overlay")) schliesseDetail();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("detail-overlay").hidden) schliesseDetail();
  });

  start();
}

document.addEventListener("DOMContentLoaded", init);
