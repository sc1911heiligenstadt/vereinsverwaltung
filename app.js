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
    html += "<tr>" +
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

  start();
}

document.addEventListener("DOMContentLoaded", init);
