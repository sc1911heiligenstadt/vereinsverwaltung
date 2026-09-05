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
  vorstand: "Vorstand",
  passstelle: "Passstelle"
};

// Was eine Rolle bedeutet -- im Klartext neben der Auswahl, damit die
// Vergabe keine Ratesache ist.
const ROLLEN_ERKLAERUNG = {
  geschaeftsstelle: "Sieht und bearbeitet alle Mitglieder, legt neue an, erfasst Austritte und importiert Bestände. Sieht Bankdaten.",
  schatzmeister: "Wie die Geschäftsstelle, zusätzlich zuständig für Beiträge und Buchhaltung. Sieht Bankdaten.",
  abteilungsleiter: "Sieht ausschließlich Mitglieder der gewählten Sparte und darf deren Kontaktdaten pflegen. Sieht KEINE Bankdaten und erfährt nicht, in welchen weiteren Sparten jemand aktiv ist.",
  vorstand: "Sieht keine Personendaten. Vorgesehen für die Kennzahlen und die Bestandsmeldung im Reiter „Auswertungen“.",
  passstelle: "Sieht ausschließlich die Nachwuchs-Anmeldungen mit ihren Nachweisen und erzeugt daraus den Antrag auf Spielerlaubnis für den Verband. Sieht KEINE Bankdaten und nicht den Mitgliederbestand; über die Aufnahme nach § 4 entscheidet sie nicht."
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
  $("btn-sicherung-jetzt").addEventListener("click", sicherungJetzt);
}

// ---------------------------------------------------------------------
// Sicherung
// ---------------------------------------------------------------------
//
// Die Anzeige ist der eigentliche Zweck dieses Blocks. Eine Sicherung,
// die nachts still ausfaellt, ist keine -- man merkt es erst an dem Tag,
// an dem man sie braucht. Deshalb steht hier nicht nur ein Knopf, sondern
// der Verlauf der letzten Laeufe.

function sicherungGroesse(zeichen) {
  if (!zeichen && zeichen !== 0) return "";
  if (zeichen < 1024) return zeichen + " Zeichen";
  if (zeichen < 1024 * 1024) return Math.round(zeichen / 1024) + " KB";
  return (zeichen / 1024 / 1024).toFixed(1).replace(".", ",") + " MB";
}

function sicherungDauer(ms) {
  if (ms === null || ms === undefined) return "";
  if (ms < 1000) return ms + " ms";
  return (ms / 1000).toFixed(1).replace(".", ",") + " s";
}

// In Worten, damit "seit 26 Stunden" nicht erst im Kopf aus zwei
// Zeitstempeln entstehen muss.
function sicherungAlter(ms) {
  const std = Math.floor(ms / 3600000);
  if (std < 48) return std + " Stunden";
  return Math.floor(std / 24) + " Tage";
}

function sicherungDatum(iso) {
  if (!iso) return "";
  const t = String(iso).slice(0, 10).split("-");
  if (t.length !== 3) return String(iso);
  return t[2] + "." + t[1] + "." + t[0];
}

async function ladeSicherung() {
  const stand = $("s-stand");
  const liste = $("s-liste");
  stand.innerHTML = '<div class="leer">Wird geladen …</div>';
  liste.innerHTML = "";

  let daten;
  try {
    daten = await vvRequest("vv-sicherung", {});
  } catch (e) {
    stand.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }

  if (!daten.eingerichtet) {
    stand.innerHTML = '<div class="hinweis warn"><strong>Noch nicht eingerichtet.</strong> ' +
      "Es gibt derzeit keine Sicherung dieser Datenbank. Im Cloudflare-Dashboard fehlen " +
      "unter Settings → Variables and Secrets: <code>" +
      daten.fehlendeSecrets.map(esc).join("</code>, <code>") + "</code>.</div>";
    $("btn-sicherung-jetzt").disabled = true;
    return;
  }
  $("btn-sicherung-jetzt").disabled = false;

  const laeufe = daten.laeufe || [];
  if (!laeufe.length) {
    stand.innerHTML = '<div class="hinweis warn">Eingerichtet, aber noch nie gelaufen. ' +
      "Einmal von Hand auslösen, dann ist geprüft, dass der Weg nach Nextcloud steht.</div>";
  } else {
    const l = laeufe[0];
    const wann = (l.zeitpunktBerlin || sicherungDatum(l.zeit)).replace(/^(\d{4})-(\d{2})-(\d{2})/,
      function (_, j, m, t) { return t + "." + m + "." + j; });
    if (l.erfolg) {
      const teile = [wann + " Uhr"];
      if (l.zeilen) teile.push(l.zeilen.toLocaleString("de-DE") + " Zeilen");
      if (l.zeichen) teile.push(sicherungGroesse(l.zeichen));
      if (l.dauerMs !== null && l.dauerMs !== undefined) teile.push(sicherungDauer(l.dauerMs));
      // ⚠️ Der eigentliche Zweck dieser Prüfung: Stirbt der nächtliche Lauf
      // am Speicher, bricht das Isolate am try/catch vorbei ab -- es
      // entsteht KEINE Fehlerzeile. Ohne Altersprüfung stünde hier
      // unverändert der letzte gelungene Lauf, und eine seit Wochen tote
      // Sicherung sähe aus wie eine gesunde.
      const alterMs = l.zeit ? Date.now() - new Date(l.zeit).getTime() : null;
      const zuAlt = alterMs !== null && isFinite(alterMs) && alterMs > 26 * 3600 * 1000;
      const unvollstaendig = l.vollstaendig === false;
      stand.innerHTML = '<div class="hinweis ' + (zuAlt || unvollstaendig ? "warn" : "info") +
        '"><strong>Letzte Sicherung:</strong> ' + esc(teile.join(" · ")) +
        (zuAlt
          ? "<br><strong>Achtung:</strong> Das ist " + esc(sicherungAlter(alterMs)) +
            " her. Die Sicherung läuft jede Nacht -- seitdem ist mindestens eine " +
            "ausgefallen, ohne eine Fehlerzeile zu hinterlassen."
          : "") +
        (unvollstaendig
          ? "<br>Achtung, unvollständig: " + esc((l.warnungen || []).join("; "))
          : "") + "</div>";
    } else {
      stand.innerHTML = '<div class="hinweis fehler"><strong>Die letzte Sicherung ist ' +
        "fehlgeschlagen</strong> (" + esc(wann) + "): " + esc(l.fehler || "Grund unbekannt") +
        "</div>";
    }
  }

  const zeilen = laeufe.map(function (l) {
    return "<tr><td>" + esc((l.zeitpunktBerlin || l.zeit || "").replace("T", " ").slice(0, 16)) +
      "</td><td>" + (l.erfolg ? "erfolgreich" : '<span class="warnung">fehlgeschlagen</span>') +
      "</td><td>" + esc(l.ausloeser === "hand" ? "von Hand" : "nachts") +
      '</td><td class="betrag">' + (l.zeilen ? l.zeilen.toLocaleString("de-DE") : "") +
      '</td><td class="betrag">' + esc(sicherungGroesse(l.zeichen)) +
      '</td><td class="betrag">' + esc(sicherungDauer(l.dauerMs)) +
      "</td></tr>";
  }).join("");

  liste.innerHTML = laeufe.length
    ? '<div class="tabelle-scroll"><table class="schmal"><thead><tr><th>Zeitpunkt</th><th>Ergebnis</th>' +
      '<th>Auslöser</th><th class="betrag">Zeilen</th><th class="betrag">Größe</th>' +
      '<th class="betrag">Dauer</th></tr></thead><tbody>' + zeilen + "</tbody></table></div>"
    : "";
}

async function sicherungJetzt() {
  const knopf = $("btn-sicherung-jetzt");
  const meldung = $("s-meldung");
  knopf.disabled = true;
  knopf.textContent = "Wird gesichert …";
  meldung.hidden = true;

  try {
    const e = await vvRequest("vv-sicherung-jetzt", {});
    meldung.hidden = false;
    meldung.className = "hinweis " + (e.vollstaendig === false ? "warn" : "info");
    meldung.innerHTML = "Gesichert: " + e.zeilen.toLocaleString("de-DE") + " Zeilen aus " +
      e.tabellen + " Tabellen, " + esc(sicherungGroesse(e.zeichen)) + ", " + sicherungDauer(e.dauerMs) + "." +
      (e.vollstaendig === false ? "<br>Unvollständig: " + esc((e.warnungen || []).join("; ")) : "");
  } catch (e) {
    meldung.hidden = false;
    meldung.className = "hinweis fehler";
    meldung.textContent = "Die Sicherung ist fehlgeschlagen: " + e.message;
  } finally {
    knopf.disabled = false;
    knopf.textContent = "Jetzt sichern";
    await ladeSicherung();
  }
}
