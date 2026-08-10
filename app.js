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

// Sortierung wird SERVERSEITIG gemacht. Im Browser lägen nur die 50
// Zeilen der aktuellen Seite -- eine Sortierung darüber würde eine
// Reihenfolge vortäuschen, die für die anderen 490 nicht gilt.
let sortierung = "name";
let sortRichtung = "auf";

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
    vorstand: "Vorstand",
    passstelle: "Passstelle"
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

  // Zwei Rollen kommen ohne Bestandssicht hierher, und sie brauchen
  // verschiedene Sätze: der Vorstand sieht wirklich nichts weiter, die
  // Passstelle hat einen eigenen Reiter. Ohne den Hinweis darauf sähe ihre
  // Anmeldung nach einem Fehler aus.
  if (!meineRechte.darfPersonenSehen) {
    $("liste-bereich").innerHTML = '<div class="hinweis warn">' +
      (meineRechte.darfNachwuchs
        ? "Ihre Rolle ist für die Spielerlaubnis vorgesehen: Der Mitgliederbestand " +
          "bleibt verschlossen, die Nachwuchs-Anmeldungen stehen im Reiter " +
          "<strong>Anträge</strong>."
        : "Ihre Rolle ist für Kennzahlen vorgesehen und hat keinen Zugriff auf Personendaten. " +
          "Die Auswertungen entstehen in einer späteren Ausbaustufe.") +
      "</div>";
    document.querySelector(".filterleiste").hidden = true;

    if (meineRechte.darfNachwuchs) {
      $("nav-antraege").hidden = false;
      // Formular-Schalter und Abteilungsauswahl sind Eingriffe in den
      // Aufnahmeweg des ganzen Vereins; ihre beiden Aktionen antworten der
      // Passstelle ohnehin mit 403, die Karte zeigte also nur Fehler.
      $("an-formular-karte").hidden = true;
      ladeAntraege();
    }
    return;
  }

  // Anlegen und Importieren haengen am selben Recht wie das Bearbeiten
  // der Mitgliedschaftsdaten. Ein Abteilungsleiter pflegt Kontaktdaten
  // seiner Leute -- wer neu aufgenommen wird, entscheidet der Verein.
  $("btn-neu").hidden = !meineRechte.darfSchreiben;
  // Der Import liegt seit 2026-08-10 im Reiter „Einstellungen“ und hat
  // keinen eigenen Leisten-Eintrag mehr. Das Recht wandert deshalb an den
  // Block: der Reiter selbst steht auch Rollen offen, die nicht
  // importieren duerfen.
  $("ein-import").hidden = !meineRechte.darfSchreiben;

  // Rollen entscheiden, wer Personendaten sieht. Das bleibt beim globalen
  // Administrator -- sonst koennte sich die Geschaeftsstelle selbst zum
  // Schatzmeister machen und damit an die Bankdaten. Ebenfalls im Reiter
  // „Einstellungen“, ebenfalls am Block statt am Leisten-Eintrag.
  $("ein-rollen").hidden = !meineRechte.isAdmin;
  $("nav-beitraege").hidden = !(meineRechte.darfSchreiben || meineRechte.darfBuchen);

  // Der Beitragslauf erzeugt Forderungen und eine Datei mit hunderten
  // IBANs. Ansehen darf ihn auch die Geschaeftsstelle -- ausloesen nur
  // der Schatzmeister, das erzwingt der Worker noch einmal selbst.
  $("nav-lauf").hidden = !(meineRechte.darfBuchen || meineRechte.darfSchreiben);
  $("nav-zahlungen").hidden = !(meineRechte.darfBuchen || meineRechte.darfSchreiben);

  // Aufnahmeanträge enthalten Bankdaten und werden zu Mitgliedschaften --
  // dasselbe Recht wie das Anlegen von Hand.
  $("nav-antraege").hidden = !meineRechte.darfSchreiben;

  // Der Reiter „Einstellungen“ trägt seit 2026-08-10 drei Blöcke mit drei
  // verschiedenen Rechten. Jeder ist oben einzeln versteckt; der Reiter
  // selbst erscheint, sobald einer davon etwas zu zeigen hat — sonst
  // stünde er leer da. Wer hier einen vierten Block ergänzt, nimmt sein
  // Recht in diese Zeile mit auf.
  $("ein-buchhaltung").hidden = !meineRechte.darfBuchen;
  $("nav-einstellungen").hidden = !(meineRechte.darfBuchen
    || meineRechte.darfSchreiben || meineRechte.isAdmin);

  // Die Auswertungen stehen jeder hinterlegten Rolle offen — der Vorstand
  // hat genau dafür eine. Eigene Seite, weil sie keinen Code lädt, der
  // etwas ändern kann.
  $("nav-auswertung").hidden = !(meineRechte.isAdmin
    || (meineRechte.rollen && meineRechte.rollen.length > 0));

  // Vor der ersten Abfrage von Personendaten: die Einzelansicht liest
  // p.geburtsort, und die Spalte entsteht erst hier. Nicht kritisch, wenn
  // es fehlschlaegt -- dann ist sie schon da oder die Rolle darf ohnehin
  // keine Person sehen.
  try { await vvRequest("vv-migration", {}); } catch { /* nicht kritisch */ }

  await ladeSpartenAuswahl();
  await ladeUndZeige();
  if (meineRechte.isAdmin) { ladeRollen(); ladeSicherung(); }
  if (meineRechte.darfSchreiben || meineRechte.darfBuchen) ladeBeitraege();
  if (meineRechte.darfBuchen || meineRechte.darfSchreiben) {
    // Reihenfolge zwingend: ladeStammdaten stößt die Migration an, und
    // ohne die gibt es weder die Spalte optionen_json noch die
    // Einstellungstabelle, die alles Weitere braucht.
    await ladeStammdaten();
    ladeLaeufe();
    ladeZahlungsJahre();
    ladeOffenePosten();
  }
  // Steht bewusst hinter dem Block darüber: die Annahme eines Antrags
  // schreibt beitragsklasse_id und familienbeitrag, und diese beiden
  // Spalten legt erst die Migration an, die ladeStammdaten() anstößt.
  if (meineRechte.darfSchreiben) {
    ladeAntraege();
    ladeAntragSchalter();
    // Die Meldedatei für den Landessportbund. Sie enthält Namen und
    // Geburtsdaten aller Mitglieder — deshalb dasselbe Recht wie das
    // Anlegen von Hand und nicht darfKennzahlenSehen, an dem die
    // Auswertungen hängen. Der Worker prüft es noch einmal selbst.
    lsbKarteZeigen();
  }
}

async function ladeSpartenAuswahl() {
  try {
    const antwort = await ladeSparten();
    spartenListe = antwort.sparten || [];
  } catch {
    spartenListe = [];
  }
  const sel = $("f-sparte");
  // Vollstaendig neu aufbauen statt anzuhaengen -- die Funktion laeuft
  // auch nach dem nachtraeglichen Anlegen der Sparten noch einmal.
  sel.innerHTML = '<option value="">Alle</option>';
  spartenListe.forEach((s) => {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name;
    sel.appendChild(o);
  });
}

function waehleTab(id) {
  document.querySelectorAll("#haupt-nav button").forEach((b) => {
    b.classList.toggle("aktiv", b.dataset.tab === id);
  });
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("aktiv", t.id === id);
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
      ...serverSortierung(),
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

// Eine leere Liste hat zwei sehr verschiedene Ursachen: der Filter ist zu
// eng, oder es steht nichts in der Datenbank. Wer das nicht unterscheiden
// kann, sucht den Fehler an der falschen Stelle -- deshalb fragt die
// Oberflaeche hier den tatsaechlichen Bestand ab, statt "keine Treffer"
// zu behaupten.
async function zeigeLeerGrund() {
  const bereich = $("liste-bereich");
  if (!meineRechte || !(meineRechte.isAdmin || meineRechte.darfSchreiben)) {
    bereich.innerHTML = '<div class="leer">Keine Mitglieder gefunden.</div>';
    return;
  }

  let bestand;
  try {
    bestand = (await ladeBestand()).bestand || {};
  } catch {
    bereich.innerHTML = '<div class="leer">Keine Mitglieder gefunden.</div>';
    return;
  }

  const filterAktiv = !!($("f-suche").value || $("f-sparte").value || $("f-status").value);

  if (bestand.mitgliedschaft > 0) {
    bereich.innerHTML = '<div class="leer">Kein Treffer für die aktuelle Suche.<br>' +
      "In der Datenbank stehen " + bestand.mitgliedschaft + " Mitgliedschaften" +
      (filterAktiv ? " — die Filter oben schränken die Anzeige ein." : ".") + "</div>";
    return;
  }

  bereich.innerHTML =
    '<div class="leer">' +
      "<strong>Die Datenbank ist leer.</strong><br>" +
      "Weder Mitglieder noch Personen sind gespeichert" +
      (bestand.sparte > 0
        ? " — die " + bestand.sparte + " Sparten sind noch da."
        : ", und auch keine Sparten.") +
    "</div>" +
    '<div class="leer-aktionen">' +
      (bestand.sparte > 0 ? "" : '<button class="btn grau" id="btn-sparten-anlegen">Sparten anlegen</button>') +
      // Beide Knoepfe schreiben. Der Weg zum Import fuehrt seit dem Umzug
      // in den Reiter „Einstellungen“, und dort ist der Block ohne
      // Schreibrecht versteckt -- ohne diese Bedingung landete ein
      // Abteilungsleiter auf einer leeren Seite.
      (meineRechte.darfSchreiben
        ? '<button class="btn" id="btn-zum-import">Bestand aus Datei übernehmen</button>'
        : "") +
    "</div>";

  const anlegen = $("btn-sparten-anlegen");
  if (anlegen) {
    anlegen.addEventListener("click", async () => {
      anlegen.disabled = true;
      anlegen.textContent = "Wird angelegt …";
      try {
        await vvRequest("vv-sparten-init", {});
        await ladeSpartenAuswahl(true);
        await ladeUndZeige();
      } catch (e) {
        anlegen.disabled = false;
        anlegen.textContent = "Fehler: " + e.message;
      }
    });
  }
  const zumImport = $("btn-zum-import");
  if (zumImport) {
    zumImport.addEventListener("click", () => {
      // Erst umschalten, dann scrollen: vorher steht der Reiter auf
      // display:none, und scrollIntoView auf etwas Verstecktes tut nichts.
      // ⚠️ OHNE behavior:"smooth" -- im Browser gemessen: mit smooth blieb
      // scrollY auf 0, der Nutzer landete oben im Reiter und sah statt des
      // Imports den Rollenkasten. Ein Sprung, der ankommt, ist besser als
      // ein weicher, der ausbleibt.
      waehleTab("tab-einstellungen");
      $("ein-import").scrollIntoView({ block: "start" });
    });
  }
}

// Spalten der Liste. "Alter" ist eine eigene Spalte in der Oberfläche,
// serverseitig aber dasselbe Feld wie das Geburtsdatum -- nur andersherum:
// der Älteste hat das früheste Datum. Die Umrechnung macht
// serverSortierung(), damit in der Anzeige der Pfeil steht, den man
// erwartet, und immer nur an EINER Spalte.
const SPALTEN = [
  { schluessel: "name",         text: "Name" },
  { schluessel: "nummer",       text: "Nr." },
  { schluessel: "geburtsdatum", text: "Geburtsdatum" },
  { schluessel: "alter",        text: "Alter" },
  { schluessel: "sparten",      text: "Sparten" },
  { schluessel: "ort",          text: "Ort" },
  { schluessel: "eintritt",     text: "Eintritt" },
  { schluessel: "status",       text: "Status" }
];

function serverSortierung() {
  if (sortierung !== "alter") return { sortierung, richtung: sortRichtung };
  return { sortierung: "geburtsdatum", richtung: sortRichtung === "auf" ? "ab" : "auf" };
}

// Erster Klick auf eine neue Spalte sortiert aufsteigend, ein zweiter
// Klick dreht um.
function waehleSortierung(schluessel) {
  if (sortierung === schluessel) {
    sortRichtung = sortRichtung === "auf" ? "ab" : "auf";
  } else {
    sortierung = schluessel;
    sortRichtung = "auf";
  }
  // Zurück auf Seite 1: Seite 6 einer anderen Sortierung zeigt ganz
  // andere Leute, das wäre eher verwirrend als hilfreich.
  seite = 0;
  ladeUndZeige();
}

function zeichneTabelle(zeilen) {
  const bereich = $("liste-bereich");

  if (!zeilen.length) {
    if (letzteGesamtzahl === 0) {
      bereich.innerHTML = '<div class="leer">Wird geprüft …</div>';
      zeigeLeerGrund();
    } else {
      bereich.innerHTML = '<div class="leer">Auf dieser Seite stehen keine Einträge.</div>';
    }
    return;
  }

  let html = '<div class="tabelle-scroll"><table><thead><tr>' +
    SPALTEN.map((s) => {
      const aktiv = sortierung === s.schluessel;
      return '<th class="sortierbar' + (aktiv ? " aktiv" : "") + '"' +
        ' data-sort="' + s.schluessel + '" tabindex="0" role="button"' +
        ' title="Nach ' + esc(s.text) + ' sortieren">' +
        esc(s.text) + '<span class="pfeil">' +
        (aktiv ? (sortRichtung === "ab" ? "▼" : "▲") : "") + "</span></th>";
    }).join("") +
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

  bereich.querySelectorAll("th.sortierbar").forEach((th) => {
    const sortiere = () => waehleSortierung(th.dataset.sort);
    th.addEventListener("click", sortiere);
    th.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sortiere(); }
    });
  });

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
  "d-geburtsort": "geburtsort",
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

  zeichneBeitrag(antwort, !!mitgl);
  zeichneSparten(antwort.sparten || [], !!mitgl);
  $("d-austritt-vorschau").hidden = true;
  $("d-kuendigung").value = "";
}

// Beitrag im Mitglied-Detail. Der Bereich ist für Abteilungsleitungen
// ganz weg -- sie bekommen die Klassenliste vom Server gar nicht erst.
function zeichneBeitrag(antwort, darfAendern) {
  const bereich = $("d-beitrag-bereich");
  const klassen = antwort.beitragsklassen || [];
  const m = antwort.mitglied;

  if (!darfAendern || !klassen.length) {
    bereich.hidden = true;
    return;
  }
  bereich.hidden = false;

  const sel = $("d-beitragsklasse");
  sel.innerHTML = '<option value="">— keine Klasse —</option>' +
    klassen.map((k) => '<option value="' + esc(k.id) + '"' +
      (m.beitragsklasse_id === k.id ? " selected" : "") + ">" +
      esc(k.name) + "</option>").join("");

  const zeigeBetrag = () => {
    const k = klassen.find((x) => x.id === sel.value);
    $("d-beitrag-betrag").textContent = k ? beitragText(k.betrag_cent) : "—";
  };
  sel.onchange = zeigeBetrag;
  zeigeBetrag();

  // Die alte Beitragsart erklärt, warum jemand in seiner Klasse steht.
  // Ohne sie wirkt eine ungewöhnliche Zuordnung wie ein Fehler der App.
  $("d-beitrag-hinweis").textContent = antwort.altBeitragsart
    ? "Aus dem Vereinsmeister übernommen als: " + antwort.altBeitragsart
    : "Keine Beitragsangabe aus dem alten Bestand vorhanden.";
}

function beitragText(cent) {
  if (cent === null || cent === undefined) return "kein Satz hinterlegt";
  return (cent / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " € / Jahr";
}

function zeichneSparten(liste, darfAendern) {
  const ziel = $("d-sparten");

  ziel.innerHTML = liste.length
    ? liste.map((s) => {
        const beendet = !!s.austritt;
        return '<div class="sparten-zeile">' +
          '<span class="sp-name">' + esc(s.name) + "</span>" +
          '<span class="sp-info">seit ' + datumDe(s.eintritt) +
            (beendet ? ", ausgetreten " + datumDe(s.austritt) : "") + "</span>" +
          '<span class="sp-info">' + (s.zuschlag_cent ? (s.zuschlag_cent / 100).toFixed(2) + " € / Jahr" : "kein Zuschlag") + "</span>" +
          (darfAendern && !beendet
            ? '<button class="btn grau klein" data-sparte="' + esc(s.sparte_id) + '">Beenden</button>'
            : "") +
          "</div>";
      }).join("")
    : '<p class="fussnote">Keiner Sparte zugeordnet.</p>';

  ziel.querySelectorAll("button[data-sparte]").forEach((b) => {
    b.addEventListener("click", () => beendeSparte(b.dataset.sparte));
  });

  // Auswahl nur mit den Sparten, die noch nicht offen zugeordnet sind --
  // eine zweite offene Zeile verhindert der Eindeutigkeitsindex ohnehin.
  const hinzu = $("d-sparte-hinzu");
  hinzu.hidden = !darfAendern;
  if (!darfAendern) return;

  const offen = new Set(liste.filter((s) => !s.austritt).map((s) => s.sparte_id));
  // Stillgelegte Abteilungen werden nicht mehr angeboten. Der FILTER oben
  // zeigt sie weiter — sonst fände man die Mitglieder einer aufgelösten
  // Abteilung nicht mehr —, aber jemanden neu hineinzuschreiben wäre
  // etwas anderes.
  const frei = spartenListe.filter((s) => s.aktiv && !offen.has(s.id));
  const sel = $("d-sparte-neu");
  sel.innerHTML = frei.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + "</option>").join("");
  hinzu.hidden = frei.length === 0;
}

async function beendeSparte(sparteId) {
  if (!offenesMitglied) return;
  if (!confirm("Zugehörigkeit zu dieser Sparte wirklich beenden?")) return;
  $("detail-status").textContent = "Wird gespeichert …";
  try {
    await ordneSparteZu({ id: offenesMitglied.mitglied.id, sparte_id: sparteId, aktion: "beenden" });
    await oeffneDetail(offenesMitglied.mitglied.id);
    await ladeUndZeige();
  } catch (e) {
    $("detail-status").textContent = "Fehler: " + e.message;
  }
}

async function fuegeSparteHinzu() {
  if (!offenesMitglied) return;
  const sparteId = $("d-sparte-neu").value;
  if (!sparteId) return;
  $("detail-status").textContent = "Wird gespeichert …";
  try {
    await ordneSparteZu({ id: offenesMitglied.mitglied.id, sparte_id: sparteId, aktion: "hinzufuegen" });
    await oeffneDetail(offenesMitglied.mitglied.id);
    await ladeUndZeige();
  } catch (e) {
    $("detail-status").textContent = "Fehler: " + e.message;
  }
}

// ---------------------------------------------------------------------
// Neues Mitglied
// ---------------------------------------------------------------------

const NEUFELDER = {
  "n-vorname": "vorname", "n-nachname": "nachname", "n-geburtsdatum": "geburtsdatum",
  "n-geburtsort": "geburtsort",
  "n-geschlecht": "geschlecht", "n-strasse": "strasse", "n-plz": "plz", "n-ort": "ort",
  "n-email": "email", "n-telefon": "telefon", "n-mobil": "mobil",
  "n-nummer": "mitgliedsnummer", "n-art": "art", "n-eintritt": "eintritt",
  "n-status": "status", "n-beschluss": "beschluss_am"
};

function oeffneNeu() {
  Object.keys(NEUFELDER).forEach((id) => { $(id).value = ""; });
  $("n-art").value = "ordentlich";
  $("n-status").value = "aktiv";
  // Datum lokal bilden, nicht ueber toISOString(): das rechnet nach UTC
  // um und liefert in deutscher Sommerzeit vor 02:00 Uhr den Vortag.
  const h = new Date();
  $("n-eintritt").value = h.getFullYear() + "-" +
    String(h.getMonth() + 1).padStart(2, "0") + "-" + String(h.getDate()).padStart(2, "0");

  const waehlbar = spartenListe.filter((s) => s.aktiv);
  $("n-sparten").innerHTML = waehlbar.length
    ? waehlbar.map((s) =>
        '<label class="ankreuz"><input type="checkbox" value="' + esc(s.id) + '"> ' + esc(s.name) + "</label>").join("")
    : '<p class="fussnote">Es sind noch keine Sparten angelegt.</p>';

  $("neu-status").textContent = "";
  $("neu-overlay").hidden = false;
  $("n-vorname").focus();
}

async function speichereNeu() {
  const nutzlast = {};
  Object.entries(NEUFELDER).forEach(([id, feld]) => { nutzlast[feld] = $(id).value; });
  nutzlast.sparte_ids = Array.from($("n-sparten").querySelectorAll("input:checked")).map((c) => c.value);

  if (!nutzlast.vorname.trim() || !nutzlast.nachname.trim()) {
    $("neu-status").textContent = "Vor- und Nachname sind erforderlich.";
    return;
  }

  $("neu-status").textContent = "Wird angelegt …";
  try {
    const a = await legeMitgliedAn(nutzlast);
    $("neu-overlay").hidden = true;
    await ladeUndZeige();
    await oeffneDetail(a.id);
  } catch (e) {
    $("neu-status").textContent = "Fehler: " + e.message;
  }
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
    // Nur mitschicken, wenn der Bereich überhaupt sichtbar war -- sonst
    // würde ein Speichern die Klasse eines Mitglieds löschen, dessen
    // Beitragsordnung noch gar nicht angelegt ist.
    if (!$("d-beitrag-bereich").hidden) {
      nutzlast.beitragsklasse_id = $("d-beitragsklasse").value;
      // Der Familienbeitrag steckt in der gewählten Klasse selbst
      // (eigene Klasse "… (Familie)"), das Kennzeichen zieht mit.
      const gewaehlt = (offenesMitglied.beitragsklassen || [])
        .find((k) => k.id === $("d-beitragsklasse").value);
      nutzlast.familienbeitrag = gewaehlt && /\(Familie\)/.test(gewaehlt.name) ? 1 : 0;
    }
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
      "<h3>" + esc(block.version) + "</h3>" +
      '<div class="changelog-datum">' + datumDe(block.datum) + "</div>" +
      "<ul>" + block.punkte.map((p) => "<li>" + esc(p) + "</li>").join("") + "</ul>" +
    "</div>"
  ).join("");
}

// ---------------------------------------------------------------------
// Verdrahtung
// ---------------------------------------------------------------------

function init() {
  $("version-badge-2").textContent = APP_VERSION;
  zeichneChangelog();

  document.querySelectorAll("#haupt-nav button").forEach((b) => {
    b.addEventListener("click", () => waehleTab(b.dataset.tab));
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

  $("btn-sparte-hinzu").addEventListener("click", fuegeSparteHinzu);

  $("btn-neu").addEventListener("click", oeffneNeu);
  $("btn-neu-zu").addEventListener("click", () => { $("neu-overlay").hidden = true; });
  $("btn-neu-abbrechen").addEventListener("click", () => { $("neu-overlay").hidden = true; });
  $("btn-neu-speichern").addEventListener("click", speichereNeu);

  impVerdrahten();
  rollenVerdrahten();
  beitraegeVerdrahten();
  laufVerdrahten();
  zahlungenVerdrahten();
  antraegeVerdrahten();

  // Klick auf die abgedunkelte Flaeche schliesst, Klick im Dialog nicht.
  $("detail-overlay").addEventListener("click", (e) => {
    if (e.target === $("detail-overlay")) schliesseDetail();
  });
  $("neu-overlay").addEventListener("click", (e) => {
    if (e.target === $("neu-overlay")) $("neu-overlay").hidden = true;
  });
  ["lauf-overlay", "zahlung-overlay", "rueck-overlay", "antrag-overlay"].forEach((id) => {
    $(id).addEventListener("click", (e) => { if (e.target === $(id)) $(id).hidden = true; });
  });
  // Der obere Dialog zuerst: sonst schliesst Escape im Anlegen-Dialog die
  // dahinterliegende Detailansicht mit.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // ⚠️ Das Dateifenster liegt über allem (z-index 1010) und weicht
    // deshalb zuerst. Es wird über schliesseDatei() zugemacht und nicht
    // über hidden — sonst bleibt seine Blob-URL liegen, solange die Seite
    // offen ist. Die Funktion steht in antraege.js, das VOR app.js geladen
    // wird.
    if (!$("datei-overlay").hidden) { schliesseDatei(); return; }
    for (const id of ["rueck-overlay", "zahlung-overlay", "lauf-overlay",
                      "antrag-overlay", "neu-overlay"]) {
      if (!$(id).hidden) { $(id).hidden = true; return; }
    }
    if (!$("detail-overlay").hidden) schliesseDetail();
  });

  start();
}

document.addEventListener("DOMContentLoaded", init);
