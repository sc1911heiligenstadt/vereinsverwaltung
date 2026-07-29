// Rollenverwaltung.
//
// Zwei Rechtequellen, die hier zusammenkommen: Das Dashboard entscheidet,
// wer sich ueberhaupt anmelden darf; diese Seite entscheidet, was jemand
// in der Vereinsverwaltung sieht. Hier stehen deshalb NIE Passwoerter und
// nie Gruppen -- nur der Kontoname als Verweis.
//
// Die Trennung hat einen Preis: Wird ein Konto im Dashboard geloescht und
// spaeter ein gleichnamiges neu angelegt, erbt es die alte Rolle. Deshalb
// meldet die Liste verwaiste Eintraege, statt sie zu verschweigen.

let rollenStand = null;

const ROLLEN_TEXTE = {
  geschaeftsstelle: "Geschäftsstelle",
  schatzmeister: "Schatzmeister",
  abteilungsleiter: "Abteilungsleitung",
  vorstand: "Vorstand"
};

// Was eine Rolle bedeutet -- im Klartext neben der Auswahl, damit die
// Vergabe keine Ratesache ist.
const ROLLEN_ERKLAERUNG = {
  geschaeftsstelle: "Sieht und bearbeitet alle Mitglieder, legt neue an, erfasst Austritte und importiert Bestände. Sieht Bankdaten.",
  schatzmeister: "Wie die Geschäftsstelle, zusätzlich zuständig für Beiträge und Buchhaltung. Sieht Bankdaten.",
  abteilungsleiter: "Sieht ausschließlich Mitglieder der gewählten Sparte und darf deren Kontaktdaten pflegen. Sieht KEINE Bankdaten und erfährt nicht, in welchen weiteren Sparten jemand aktiv ist.",
  vorstand: "Sieht keine Personendaten. Vorgesehen für Kennzahlen und Auswertungen einer späteren Ausbaustufe."
};

function rollenMeldung(art, text) {
  const k = $("r-status");
  k.hidden = false;
  k.className = "hinweis " + art;
  k.textContent = text;
}

async function ladeRollen() {
  const liste = $("r-liste");
  liste.innerHTML = '<div class="leer">Wird geladen …</div>';

  try {
    rollenStand = await vvRequest("vv-rollen", {});
  } catch (e) {
    liste.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }

  // Kontoauswahl. Bereits vergebene Kombinationen bleiben waehlbar --
  // jemand kann mehrere Sparten leiten.
  const sel = $("r-nutzer");
  const vorher = sel.value;
  sel.innerHTML = rollenStand.nutzer.length
    ? rollenStand.nutzer
        .slice()
        .sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username, "de"))
        .map((u) => '<option value="' + esc(u.username) + '">' +
          esc(u.displayName || u.username) + " (" + esc(u.username) + ")</option>").join("")
    : '<option value="">— keine Konten lesbar —</option>';
  if (vorher) sel.value = vorher;

  const sparteSel = $("r-sparte");
  sparteSel.innerHTML = spartenListe.map((s) =>
    '<option value="' + esc(s.id) + '">' + esc(s.name) + "</option>").join("");

  const warnung = $("r-warnung");
  if (!rollenStand.verzeichnisLesbar) {
    zeigeHinweis(warnung, "warn",
      "Die Kontenliste des Dashboards konnte nicht gelesen werden. Vergeben ist weiterhin möglich, " +
      "verwaiste Einträge werden aber nicht erkannt.");
  } else if (rollenStand.verwaist.length) {
    zeigeHinweis(warnung, "warn",
      "Für diese Rollen gibt es kein Konto mehr im Dashboard: " + rollenStand.verwaist.join(", ") +
      ". Solange der Eintrag stehen bleibt, würde ein neu angelegtes gleichnamiges Konto die Rolle erben.");
  } else {
    warnung.hidden = true;
  }

  zeichneRollenListe();
}

function zeichneRollenListe() {
  const liste = $("r-liste");
  const rollen = rollenStand.rollen || [];

  if (!rollen.length) {
    liste.innerHTML = '<div class="leer"><strong>Es ist noch keine Rolle vergeben.</strong><br>' +
      "Bis dahin kann außer den globalen Administratoren des Dashboards niemand Mitgliederdaten sehen.</div>";
    return;
  }

  const namen = {};
  (rollenStand.nutzer || []).forEach((u) => { namen[u.username] = u.displayName || u.username; });
  const verwaist = new Set(rollenStand.verwaist || []);

  liste.innerHTML = '<div class="tabelle-scroll"><table><thead><tr>' +
    "<th>Konto</th><th>Rolle</th><th>Sparte</th><th>vergeben am</th><th></th>" +
    "</tr></thead><tbody>" +
    rollen.map((r) =>
      "<tr>" +
        '<td class="name">' + esc(namen[r.username] || r.username) +
          (verwaist.has(r.username) ? ' <span class="chip beendet">kein Konto</span>' : "") +
          '<br><span class="sp-info">' + esc(r.username) + "</span></td>" +
        "<td>" + esc(ROLLEN_TEXTE[r.rolle] || r.rolle) + "</td>" +
        "<td>" + esc(r.sparte_name || (r.rolle === "abteilungsleiter" ? "— fehlt —" : "—")) + "</td>" +
        "<td>" + datumDe(r.erstellt_am) + "</td>" +
        '<td><button class="btn grau klein" data-rolle="' + esc(r.id) + '">Entziehen</button></td>' +
      "</tr>").join("") +
    "</tbody></table></div>";

  liste.querySelectorAll("button[data-rolle]").forEach((b) => {
    b.addEventListener("click", () => entzieheRolle(b.dataset.rolle));
  });
}

async function setzeRolle() {
  const username = $("r-nutzer").value;
  const rolle = $("r-rolle").value;
  const sparteId = rolle === "abteilungsleiter" ? $("r-sparte").value : "";

  if (!username) { rollenMeldung("fehler", "Bitte ein Konto auswählen."); return; }
  if (rolle === "abteilungsleiter" && !sparteId) {
    rollenMeldung("fehler", "Für eine Abteilungsleitung muss eine Sparte gewählt werden. Sind noch keine Sparten angelegt?");
    return;
  }

  rollenMeldung("info", "Wird gespeichert …");
  try {
    await vvRequest("vv-rolle-setzen", { username, rolle, sparte_id: sparteId });
    rollenMeldung("info", "Rolle vergeben.");
    await ladeRollen();
  } catch (e) {
    rollenMeldung("fehler", e.message);
  }
}

async function entzieheRolle(id) {
  if (!confirm("Rolle wirklich entziehen? Der Zugriff auf Mitgliederdaten entfällt damit sofort.")) return;
  try {
    await vvRequest("vv-rolle-loeschen", { id });
    await ladeRollen();
  } catch (e) {
    rollenMeldung("fehler", e.message);
  }
}

function rollenVerdrahten() {
  const rolleGewaehlt = () => {
    const r = $("r-rolle").value;
    // Die Sparte gehoert nur zur Abteilungsleitung. Bei den anderen
    // Rollen waere das Feld nicht bloss ueberfluessig, sondern
    // irrefuehrend -- sie gelten fuer den ganzen Verein.
    $("r-sparte-feld").hidden = r !== "abteilungsleiter";
    $("r-erklaerung").textContent = ROLLEN_ERKLAERUNG[r] || "";
  };
  $("r-rolle").addEventListener("change", rolleGewaehlt);
  rolleGewaehlt();

  $("btn-rolle-setzen").addEventListener("click", setzeRolle);
}
