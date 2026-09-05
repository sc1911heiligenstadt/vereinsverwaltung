// Beitragslauf und SEPA-Lastschrift.
//
// Der Ablauf ist bewusst vierstufig und in dieser Reihenfolge zwingend:
//
//   1. Vorschau    rechnet über den ganzen Bestand, schreibt nichts
//   2. Ausführen   erzeugt die Forderungen, blockweise und wiederaufsetzbar
//   3. SEPA-Datei  bündelt je Haushalt und erzeugt pain.008
//   4. Festschreiben
//
// Jede Stufe zeigt vorher, was passieren wird, und danach, was passiert
// ist — einschließlich der Fälle, die NICHT dabei sind. Ein Beitragslauf,
// der stillschweigend 36 Haushalte auslässt, ist schlimmer als einer, der
// abbricht.

let laufListe = [];
let laufAktuell = null;
let laufStammdaten = null;
let laufLaeuft = false;
let laufDarfBuchen = false;

function lEur(cent) {
  if (cent === null || cent === undefined) return "—";
  return (cent / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function lDatum(iso) {
  const t = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return "—";
  return t.slice(8, 10) + "." + t.slice(5, 7) + "." + t.slice(0, 4);
}

function lMeldung(id, art, text) {
  const k = $(id);
  k.hidden = false;
  k.className = "hinweis " + art;
  k.innerHTML = text;
}

// Lokal, nicht über toISOString(): das rechnet nach UTC um und liefert in
// deutscher Sommerzeit vor 02:00 Uhr den Vortag. Bei einem Fälligkeits-
// datum ist das kein Schönheitsfehler.
function lHeute() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
         "-" + String(d.getDate()).padStart(2, "0");
}

const LAUF_STATUS_TEXT = {
  entwurf: "Entwurf",
  laeuft: "Abgebrochen — kann fortgesetzt werden",
  fertig: "Durchgelaufen",
  festgeschrieben: "Festgeschrieben"
};

// ---------------------------------------------------------------------
// Vereinsstammdaten
// ---------------------------------------------------------------------

async function ladeStammdaten() {
  const ziel = $("l-stammdaten");

  // Die Tabelle einstellung und die Spalte beitragslauf.optionen_json gibt
  // es im ursprünglichen Schema nicht. Die Migration ist beliebig oft
  // aufrufbar und läuft deshalb beim Öffnen mit — sonst hinge der ganze
  // Reiter davon ab, ob jemand vorher zufällig auf „Beitragsordnung
  // anlegen" geklickt hat.
  try { await vvRequest("vv-migration", {}); } catch { /* nicht kritisch */ }

  try {
    laufStammdaten = await vvRequest("vv-einstellungen", {});
  } catch (e) {
    ziel.innerHTML = '<div class="hinweis ' + (/Einrichtung/.test(e.message) ? "warn" : "fehler") +
      '">' + esc(e.message) + "</div>";
    return;
  }

  // Nur die SEPA-Stammdaten. Weißliste, keine Sperrliste: hier gehören
  // ausschließlich die SEPA-Stammdaten hin. Mit "alles außer <Gruppe X>"
  // wäre jede künftige Einstellungsgruppe ungefragt in diesem Reiter
  // gelandet — genau das ist mit der Gruppe "antrag" beinahe passiert.
  const felder = laufStammdaten.felder.filter((f) => f.gruppe === "sepa");

  ziel.innerHTML = '<div class="formraster">' +
    felder.map((f) =>
      '<div class="feld' + (f.schluessel === "verwendungszweck" ? " breit" : "") + '">' +
        '<label for="ls-' + esc(f.schluessel) + '">' + esc(f.label) +
        (f.pflicht ? " *" : "") + "</label>" +
        '<input id="ls-' + esc(f.schluessel) + '" data-schluessel="' + esc(f.schluessel) +
        '" value="' + esc(f.wert) + '">' +
      "</div>").join("") +
    "</div>" +
    '<div class="knopfreihe"><button class="btn" id="btn-l-stamm-speichern">Stammdaten speichern</button></div>';

  $("btn-l-stamm-speichern").addEventListener("click", speichereStammdaten);

  if (!laufStammdaten.vollstaendig) {
    lMeldung("l-stamm-status", "warn",
      "Es fehlt noch: <strong>" + esc(laufStammdaten.fehlend.join(", ")) +
      "</strong>. Ohne diese Angaben lässt sich keine SEPA-Datei erzeugen.");
  } else {
    $("l-stamm-status").hidden = true;
  }
}

async function speichereStammdaten() {
  const knopf = $("btn-l-stamm-speichern");
  knopf.disabled = true;
  try {
    // Nacheinander, nicht parallel: die Antwort auf eine ungültige IBAN
    // soll genau dieses Feld benennen können.
    for (const f of laufStammdaten.felder) {
      const feld = document.getElementById("ls-" + f.schluessel);
      if (!feld || feld.value === f.wert) continue;
      await vvRequest("vv-einstellung-setzen", { schluessel: f.schluessel, wert: feld.value });
    }
    await ladeStammdaten();
    lMeldung("l-stamm-status", "erfolg", "Gespeichert.");
  } catch (e) {
    lMeldung("l-stamm-status", "fehler", esc(e.message));
  } finally {
    knopf.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Liste der Läufe
// ---------------------------------------------------------------------

async function ladeLaeufe() {
  const ziel = $("l-liste");
  ziel.innerHTML = '<div class="leer">Wird geladen …</div>';
  $("l-liste-status").hidden = true;

  let antwort;
  try {
    antwort = await vvRequest("vv-lauf-liste", {});
  } catch (e) {
    ziel.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  laufListe = antwort.laeufe || [];
  laufDarfBuchen = !!antwort.darfBuchen;
  $("btn-l-neu").hidden = !laufDarfBuchen;

  if (!laufListe.length) {
    ziel.innerHTML = '<div class="leer"><strong>Noch kein Beitragslauf angelegt.</strong><br>' +
      "Ein Lauf erzeugt für jedes Mitglied eine Forderung. Vorher zeigt eine Vorschau, " +
      "was entstehen würde — geschrieben wird erst danach.</div>";
    return;
  }

  ziel.innerHTML = '<div class="tabelle-scroll"><table><thead><tr>' +
    "<th>Bezeichnung</th><th>Jahr</th><th>Fällig</th><th>Status</th>" +
    "<th class=\"betrag\">Forderungen</th><th class=\"betrag\">Summe</th><th class=\"betrag\">SEPA</th>" +
    (laufDarfBuchen ? "<th></th>" : "") +
    "</tr></thead><tbody>" +
    laufListe.map((l) =>
      '<tr class="klickbar" data-id="' + esc(l.id) + '">' +
        '<td class="name">' + esc(l.bezeichnung) + "</td>" +
        "<td>" + esc(l.jahr) + "</td>" +
        "<td>" + lDatum(l.faelligkeit) + "</td>" +
        "<td>" + esc(LAUF_STATUS_TEXT[l.status] || l.status) + "</td>" +
        '<td class="betrag">' + (l.anzahl_erzeugt || 0) + "</td>" +
        '<td class="betrag">' + lEur(l.summe_cent) + "</td>" +
        '<td class="betrag">' + (l.sepa_dateien || 0) + "</td>" +
        (laufDarfBuchen
          ? '<td>' + (l.status === "festgeschrieben"
              ? '<span class="fussnote" title="Festgeschrieben — nicht löschbar">—</span>'
              : '<button class="btn klein warn" data-loeschen="' + esc(l.id) +
                '" title="Diesen Lauf löschen">Löschen</button>') + "</td>"
          : "") +
      "</tr>").join("") +
    "</tbody></table></div>";

  ziel.querySelectorAll("tr.klickbar").forEach((tr) => {
    tr.addEventListener("click", () => oeffneLauf(tr.dataset.id));
  });
  // ⚠️ Der Knopf sitzt IN der klickbaren Zeile. Ohne stopPropagation
  // liefe der Zeilen-Handler mit und oeffnete beim Abbrechen der
  // Rueckfrage trotzdem den Lauf -- dieselbe Falle wie beim Loeschknopf
  // der Abteilungen, der deshalb ausserhalb des <label> steht.
  ziel.querySelectorAll("[data-loeschen]").forEach((b) => {
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      loescheLauf(b.dataset.loeschen);
    });
  });
}

// Zweistufig: erst zaehlen lassen, dann mit den Zahlen fragen. Wer einen
// Lauf ueber 535 Forderungen wegwirft, soll vorher sehen, was daran
// haengt -- und was der Server dabei mitloescht.
async function loescheLauf(id) {
  let p;
  let mitZahlungen = false;
  try {
    p = await vvRequest("vv-lauf-verwerfen", { lauf_id: id, pruefen: true });
  } catch (e) {
    // ⚠️ Verbuchte Zahlungen sind hier KEIN Endpunkt mehr. Der Server
    // sperrt den ersten Aufruf und nennt die Zahlen; daraus wird die
    // schärfere Rückfrage. Vorher endete der Weg an dieser Meldung — und
    // sie verwies auf "Sammelbuchung zurücknehmen", das aber nur an einer
    // als eingegangen gebuchten SEPA-Datei hängt. Steht die Datei auf
    // offen, gibt es den Knopf gar nicht und der Lauf blieb für immer
    // stehen (bei Michel am 10.08.2026 genau so eingetreten).
    if (e.status === 409 && e.daten && e.daten.code === "zahlungen") {
      mitZahlungen = true;
      try {
        p = await vvRequest("vv-lauf-verwerfen",
          { lauf_id: id, pruefen: true, mit_zahlungen: true });
      } catch (e2) {
        lMeldung("l-liste-status", "fehler", esc(e2.message));
        return;
      }
    } else {
      lMeldung("l-liste-status", "fehler", esc(e.message));
      return;
    }
  }

  const anhang = [];
  if (p.forderungen) anhang.push(p.forderungen + " Forderungen über " + lEur(p.summeCent));
  if (p.sepaDateien) anhang.push(p.sepaDateien + " SEPA-Vermerk" + (p.sepaDateien > 1 ? "e" : ""));
  if (p.zahlungenAktiv) {
    anhang.push(p.zahlungenAktiv + " verbuchte Zahlungen über " + lEur(p.zahlungenAktivCent));
  }
  if (p.zahlungenStorniert) anhang.push(p.zahlungenStorniert + " stornierte Zahlungen");
  // Die Erinnerung, um die es geht: an diesem Lauf hängt Geld. Gelöscht
  // heißt hier wirklich gelöscht, nicht storniert -- das ist nur richtig,
  // wenn bei der Bank nie etwas eingereicht wurde.
  const warnung = p.zahlungenAktiv
    ? "\n\nACHTUNG: Die " + p.zahlungenAktiv + " verbuchten Zahlungen über " +
      lEur(p.zahlungenAktivCent) + " werden dabei GELÖSCHT, nicht storniert — als hätte es " +
      "diesen Einzug nie gegeben. Nur richtig, wenn bei der Bank wirklich nichts eingereicht " +
      "wurde."
    : "";
  // Nicht in dieselbe Zeile: diese Zahlungen gehören zu einem anderen
  // Lauf und bleiben stehen, sie verlieren nur den Verweis auf die Datei.
  // Der Mandats-Stempel wird mit zurückgenommen — das gehört in die
  // Rückfrage, weil es der einzige Teil ist, der über diesen Lauf hinaus
  // wirkt: der nächste Einzug dieser Haushalte ist dann wieder eine
  // Erstlastschrift.
  const mandate = p.mandateZurueck
    ? "\n\nBei " + p.mandateZurueck + " SEPA-Mandat" +
      (p.mandateZurueck > 1 ? "en wird" : " wird") + " der Vermerk „schon benutzt“ " +
      "zurückgenommen: der nächste Einzug dieser Haushalte zählt wieder als " +
      "Erstlastschrift."
    : "";
  const geloest = p.zahlungenGeloest
    ? "\n\nUnberührt bleiben " + p.zahlungenGeloest + " Zahlungen anderer Läufe; " +
      "sie verlieren nur den Verweis auf die SEPA-Datei."
    : "";

  if (!confirm("Beitragslauf " + p.bezeichnung + " (" + p.jahr + ") endgültig löschen?\n\n" +
               (anhang.length ? "Mitgelöscht wird: " + anhang.join(", ") + ".\n\n" : "") +
               "Das lässt sich nicht rückgängig machen. Der Vorgang steht danach nur noch im " +
               "Protokoll." + warnung + geloest + mandate)) return;

  try {
    const r = await vvRequest("vv-lauf-verwerfen",
      mitZahlungen ? { lauf_id: id, mit_zahlungen: true } : { lauf_id: id });
    $("l-karte-detail").hidden = true;
    $("l-karte-ergebnis").hidden = true;
    laufAktuell = null;
    await ladeLaeufe();
    lMeldung("l-liste-status", "erfolg",
      "<strong>" + esc(r.bezeichnung) + "</strong> gelöscht, mitsamt " + r.forderungen +
      " Forderungen" +
      (r.zahlungenAktivGeloescht
        ? " und " + r.zahlungenAktivGeloescht + " verbuchten Zahlungen über " +
          lEur(r.zahlungenAktivCent)
        : "") + ".");
  } catch (e) {
    lMeldung("l-liste-status", "fehler", esc(e.message));
  }
}

// ---------------------------------------------------------------------
// Neuen Lauf anlegen
// ---------------------------------------------------------------------

// Spiegel der RHYTHMEN aus dem Worker — hier nur so viel, wie die Maske
// zum Beschriften und Vorbelegen braucht. ⚠️ Die Wahrheit steht im
// Server: er leitet jeden Termin, den der Client nicht mitschickt,
// selbst ab und entscheidet über Perioden und Beträge. Wer hier eine
// Rate ergänzt, muss es dort auch tun.
const RHYTHMUS_RATEN = {
  jaehrlich:        [{ text: "Fällig am", vonMonat: 1 }],
  halbjaehrlich:    [{ text: "1. Halbjahr — fällig am", vonMonat: 1 },
                     { text: "2. Halbjahr — fällig am", vonMonat: 7 }],
  vierteljaehrlich: [{ text: "1. Quartal — fällig am", vonMonat: 1 },
                     { text: "2. Quartal — fällig am", vonMonat: 4 },
                     { text: "3. Quartal — fällig am", vonMonat: 7 },
                     { text: "4. Quartal — fällig am", vonMonat: 10 }]
};

// Datum um n Monate schieben, Tag auf das Monatsende begrenzt — dieselbe
// Regel wie im Worker, damit die angezeigten Termine genau die sind, die
// hinterher in der Datenbank stehen.
function lPlusMonate(iso, n) {
  const j = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), t = Number(iso.slice(8, 10));
  if (!j || !m || !t) return iso;
  const lfd = j * 12 + (m - 1) + n;
  const jahr = Math.floor(lfd / 12), monat = (lfd % 12) + 1;
  const letzter = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
  const zz = (x) => (x < 10 ? "0" + x : String(x));
  return jahr + "-" + zz(monat) + "-" + zz(Math.min(t, letzter));
}

// Die Terminfelder je Rate aufbauen. Bereits vom Nutzer gesetzte Werte
// bleiben stehen — ein Rhythmuswechsel darf keinen eingetippten Termin
// wegwerfen, nur die fehlenden ergänzen.
function zeigeTermine() {
  const rhythmus = $("nl-rhythmus").value;
  const raten = RHYTHMUS_RATEN[rhythmus] || RHYTHMUS_RATEN.jaehrlich;
  const erst = $("nl-faelligkeit").value;

  $("nl-faellig-label").textContent = raten[0].text + " *";

  // Nur die Felder ab der zweiten Rate werden neu gebaut; das erste ist
  // fest im HTML und trägt den Wert, aus dem alle anderen folgen.
  const ziel = $("nl-termine");
  ziel.querySelectorAll("[data-rate]").forEach((el) => el.remove());
  for (let i = 1; i < raten.length; i++) {
    const div = document.createElement("div");
    div.className = "feld";
    div.dataset.rate = String(i);
    div.innerHTML = '<label for="nl-faellig-' + i + '">' + esc(raten[i].text) + "</label>" +
                    '<input type="date" id="nl-faellig-' + i + '">';
    ziel.appendChild(div);
    const feld = div.querySelector("input");
    feld.value = erst ? lPlusMonate(erst, raten[i].vonMonat - raten[0].vonMonat) : "";
  }

  $("nl-rhythmus-hinweis").innerHTML = raten.length === 1
    ? "Ein Lauf, eine Forderung je Mitglied, ein Einzug."
    : "Es entstehen <strong>" + raten.length + " getrennte Beitragsläufe</strong> — je Rate einer, " +
      "mit eigener SEPA-Datei und eigenem Zahlungseingang. So wird das zweite Quartal auch " +
      "wirklich erst im zweiten Quartal eingereicht. Der Jahresbeitrag wird dabei geteilt, " +
      "nicht vervielfacht: die Summe aller Raten ist auf den Cent genau der Jahresbeitrag.";
}

function oeffneNeuerLauf() {
  const jahr = new Date().getFullYear() + 1;
  $("nl-jahr").value = String(jahr);
  $("nl-faelligkeit").value = jahr + "-03-15";
  $("nl-stichtag").value = jahr + "-01-01";
  $("nl-bezeichnung").value = "";
  $("nl-rhythmus").value = "jaehrlich";
  $("nl-anteilig").checked = false;
  $("nl-ehren").checked = false;
  $("nl-ruhend").checked = false;
  $("lauf-status").textContent = "";
  zeigeTermine();
  $("lauf-overlay").hidden = false;
}

async function speichereNeuerLauf(trotzdem) {
  const knopf = $("btn-lauf-speichern");
  knopf.disabled = true;
  $("lauf-status").textContent = "";

  const rhythmus = $("nl-rhythmus").value;
  const anzahl = (RHYTHMUS_RATEN[rhythmus] || RHYTHMUS_RATEN.jaehrlich).length;
  const termine = [$("nl-faelligkeit").value];
  for (let i = 1; i < anzahl; i++) {
    const feld = document.getElementById("nl-faellig-" + i);
    termine.push(feld ? feld.value : "");
  }

  const daten = {
    jahr: parseInt($("nl-jahr").value, 10),
    faelligkeit: $("nl-faelligkeit").value,
    stichtag: $("nl-stichtag").value,
    bezeichnung: $("nl-bezeichnung").value,
    rhythmus: rhythmus,
    termine: termine,
    anteilig: $("nl-anteilig").checked,
    ehrenmitglieder: $("nl-ehren").checked,
    ruhende: $("nl-ruhend").checked,
    trotzdem: !!trotzdem
  };

  try {
    const r = await vvRequest("vv-lauf-anlegen", daten);
    $("lauf-overlay").hidden = true;
    await ladeLaeufe();
    // Bei einer Serie wird der erste Lauf geöffnet, aber die Liste
    // darüber sagt, dass es mehr sind — sonst wirkt es, als hätte der
    // Rhythmus nur einen Lauf erzeugt.
    if (r.ids && r.ids.length > 1) {
      lMeldung("l-liste-status", "erfolg",
        "<strong>" + r.ids.length + " Beitragsläufe</strong> angelegt (" +
        (r.angelegt || []).map((a) => esc(a.text) + ", fällig " + lDatum(a.faelligkeit)).join(" · ") +
        "). Jeder wird einzeln vorgeschaut, ausgeführt und eingereicht.");
    }
    await oeffneLauf(r.id);
  } catch (e) {
    // Ein zweiter Lauf für dasselbe Jahr ist erlaubt, aber fast immer ein
    // Versehen. Deshalb nachfragen statt still anlegen oder hart ablehnen.
    if (/bereits einen Beitragslauf/.test(e.message)) {
      if (confirm(e.message + ".\n\nTrotzdem einen weiteren Lauf anlegen?")) {
        knopf.disabled = false;
        return speichereNeuerLauf(true);
      }
      $("lauf-status").textContent = "";
    } else {
      $("lauf-status").textContent = e.message;
    }
  } finally {
    knopf.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Ein Lauf im Detail
// ---------------------------------------------------------------------

async function oeffneLauf(id) {
  $("l-karte-detail").hidden = false;
  $("l-karte-ergebnis").hidden = true;
  $("l-detail").innerHTML = '<div class="leer">Wird geladen …</div>';
  $("l-detail-knoepfe").innerHTML = "";
  $("l-detail-status").hidden = true;
  $("l-fortschritt-huelle").hidden = true;

  let d;
  try {
    d = await vvRequest("vv-lauf-detail", { lauf_id: id });
  } catch (e) {
    $("l-detail").innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  laufAktuell = d;
  const l = d.lauf;
  $("l-detail-titel").textContent = l.bezeichnung;

  const opt = l.optionen || {};
  // Ein Ratenlauf rechnet nicht den Jahresbeitrag, sondern den Anteil
  // seines Zeitraums. Der Satz darf das nicht anders behaupten, als der
  // Server es tut.
  const teillauf = l.periode && l.periode !== "jahr";
  const regeln = [
    opt.anteilig
      ? "anteilig bei unterjährigem Eintritt"
      : (teillauf ? "voller Anteil des Zeitraums" : "voller Jahresbeitrag"),
    opt.ehrenmitglieder ? "Ehrenmitglieder zahlen mit" : "Ehrenmitglieder beitragsfrei",
    opt.ruhende ? "ruhende zahlen mit" : "ruhende zahlen nicht"
  ];

  $("l-detail").innerHTML =
    '<dl class="kennzahlen">' +
      "<div><dt>Status</dt><dd>" + esc(LAUF_STATUS_TEXT[l.status] || l.status) + "</dd></div>" +
      "<div><dt>Beitragsjahr</dt><dd>" + esc(l.jahr) + "</dd></div>" +
      (teillauf ? "<div><dt>Zeitraum</dt><dd>" + esc(l.periodeText || l.periode) + "</dd></div>" : "") +
      "<div><dt>Fällig am</dt><dd>" + lDatum(l.faelligkeit) + "</dd></div>" +
      "<div><dt>Forderungen</dt><dd>" + (l.anzahl_erzeugt || 0) + "</dd></div>" +
      "<div><dt>Summe</dt><dd>" + lEur(l.summe_cent) + "</dd></div>" +
    "</dl>" +
    '<p class="fussnote">Gerechnet wird: ' + esc(regeln.join(" · ")) + ". Stichtag " +
    lDatum(l.stichtag) + "." +
    (l.festgeschrieben_am
      ? " Festgeschrieben am " + lDatum(l.festgeschrieben_am) + " von " + esc(l.festgeschrieben_von) + "."
      : "") + "</p>" +
    (d.dateien.length
      ? "<h3>SEPA-Dateien</h3>" +
        '<p class="fussnote">Wenn der Einzug durch ist: hier als eingegangen buchen. Das setzt alle ' +
        "Posten dieser Datei auf bezahlt — die wenigen Rückläufer werden danach einzeln unter " +
        "<em>Zahlungen</em> erfasst. Andersherum, 441 Zahlungen von Hand, macht das niemand. " +
        "Hat der Einzug in Wahrheit nie stattgefunden, nimmt <em>Buchung zurücknehmen</em> die " +
        "ganze Sammelbuchung zurück; storniert wird dabei, gelöscht nichts.</p>" +
        '<div class="tabelle-scroll"><table><thead><tr>' +
        "<th>Nachrichten-Kennung</th><th>Erstellt</th><th>Einzug am</th><th>Art</th>" +
        "<th class=\"betrag\">Posten</th><th class=\"betrag\">Summe</th><th>gebucht</th>" +
        (d.darfBuchen ? "<th></th>" : "") + "</tr></thead><tbody>" +
        d.dateien.map((f) => "<tr><td>" + esc(f.msg_id) + "</td><td>" + lDatum(f.erstellt_datum) +
          "</td><td>" + lDatum(f.ausfuehrung_am) + "</td><td>" + esc(f.seq_typ) +
          '</td><td class="betrag">' + f.anzahl_posten + '</td><td class="betrag">' +
          lEur(f.summe_cent) + "</td><td>" +
          (f.gebucht_am ? lDatum(f.gebucht_am) : '<span class="fussnote">offen</span>') + "</td>" +
          (d.darfBuchen
            ? "<td>" + (f.gebucht_am
                ? '<button class="btn klein grau" data-zurueck="' + esc(f.id) +
                  '">Buchung zurücknehmen</button>'
                : '<button class="btn klein" data-buchen="' + esc(f.id) + '" data-am="' +
                  esc(f.ausfuehrung_am) + '">als eingegangen buchen</button>') + "</td>"
            : "") +
          "</tr>").join("") +
        "</tbody></table></div>"
      : "") +
    (d.proben.length
      ? "<h3>Stichproben</h3><p class=\"fussnote\">Die vollständige Herleitung steht bei jeder " +
        "Forderung — wer einem Mitglied den Betrag erklären muss, braucht diese Zeile.</p>" +
        '<div class="tabelle-scroll"><table><thead><tr><th>Nr.</th><th>Name</th>' +
        "<th>Klasse</th><th>Zeitraum</th><th class=\"betrag\">Betrag</th></tr></thead><tbody>" +
        d.proben.map((p) => "<tr><td>" + esc(p.mitgliedsnummer) + '</td><td class="name">' +
          esc(p.name) + "</td><td>" + esc(p.berechnung.klasse || "—") + "</td><td>" +
          (p.berechnung.anteilig
            ? p.berechnung.monate + " Monate (" + lDatum(p.berechnung.von) + "–" + lDatum(p.berechnung.bis) + ")"
            : "volles Jahr") +
          '</td><td class="betrag">' + lEur(p.betrag_cent) + "</td></tr>").join("") +
        "</tbody></table></div>"
      : "");

  $("l-detail").querySelectorAll("[data-buchen]").forEach((b) => {
    b.addEventListener("click", () => bucheSepaDatei(b.dataset.buchen, b.dataset.am, l.id));
  });
  $("l-detail").querySelectorAll("[data-zurueck]").forEach((b) => {
    b.addEventListener("click", () => nimmSammelZurueck(b.dataset.zurueck, l.id));
  });

  if (!d.darfBuchen) return;

  const knoepfe = [];
  if (l.status !== "festgeschrieben") {
    knoepfe.push('<button class="btn grau" id="btn-l-vorschau">Vorschau</button>');
    knoepfe.push('<button class="btn" id="btn-l-start">' +
      (l.status === "laeuft" ? "Fortsetzen" : (l.anzahl_erzeugt ? "Erneut durchlaufen" : "Forderungen erzeugen")) +
      "</button>");
  }
  if (l.status === "fertig" || l.status === "festgeschrieben") {
    // Eigenes Datumsfeld statt prompt(): auf dem Handy gibt es dort
    // keinen Kalender, und ein von Hand getipptes Einzugsdatum ist genau
    // die Sorte Fehler, die erst die Bank bemerkt.
    knoepfe.push('<span class="feld einzugsfeld"><label for="l-einzug">Einzug am</label>' +
      '<input type="date" id="l-einzug" value="' + esc(l.faelligkeit) + '"></span>');
    knoepfe.push('<button class="btn grau" id="btn-l-sepa-probe">SEPA prüfen</button>');
    knoepfe.push('<button class="btn" id="btn-l-sepa">SEPA-Datei erzeugen</button>');
    knoepfe.push('<button class="btn grau" id="btn-l-vorab">Vorabankündigung</button>');
  }
  if (l.status === "fertig") {
    knoepfe.push('<button class="btn" id="btn-l-fest">Festschreiben</button>');
  }
  if (l.status !== "festgeschrieben") {
    knoepfe.push('<button class="btn warn" id="btn-l-verwerfen">Lauf löschen</button>');
  }
  $("l-detail-knoepfe").innerHTML = knoepfe.join("");

  const binde = (id, fn) => { const b = $(id); if (b) b.addEventListener("click", fn); };
  binde("btn-l-vorschau", () => zeigeVorschau(l.id));
  binde("btn-l-start", () => starteLauf(l.id));
  binde("btn-l-sepa-probe", () => erzeugeSepa(l.id, true));
  binde("btn-l-sepa", () => erzeugeSepa(l.id, false));
  binde("btn-l-vorab", () => zeigeVorab(l.id));
  binde("btn-l-fest", () => schreibeFest(l.id));
  binde("btn-l-verwerfen", () => loescheLauf(l.id));
}

// Sammelbuchung: erst zeigen, was gebucht würde, dann fragen. Bei 497
// Forderungen ist ein Fehlklick sonst nur noch von Hand zu heilen.
async function bucheSepaDatei(dateiId, ausfuehrung, laufId) {
  if (bucheSepaDatei.laeuft) return;
  bucheSepaDatei.laeuft = true;
  try {
    return await bucheSepaDateiAusfuehren(dateiId, ausfuehrung, laufId);
  } finally {
    bucheSepaDatei.laeuft = false;
  }
}

async function bucheSepaDateiAusfuehren(dateiId, ausfuehrung, laufId) {
  let probe;
  try {
    probe = await vvRequest("vv-zahlung-sammel", { sepa_datei_id: dateiId, pruefen: true });
  } catch (e) {
    lMeldung("l-detail-status", "fehler", esc(e.message));
    return;
  }
  if (!probe.anzahl) {
    lMeldung("l-detail-status", "info", "Alle Posten dieser Datei sind bereits verbucht.");
    return;
  }
  // Kein typografisches Anführungszeichen im Quelltext: das öffnende ist
  // harmlos, das schließende beendet den String und macht die Datei zum
  // lautlosen SyntaxError. Hier steht deshalb gar keins.
  if (!confirm(probe.anzahl + " Forderungen über " + lEur(probe.summeCent) +
               " werden als bezahlt gebucht,\nmit Eingangsdatum " + lDatum(probe.eingang) + ".\n\n" +
               "Rückläufer danach einzeln im Reiter Zahlungen erfassen.")) return;
  try {
    const r = await vvRequest("vv-zahlung-sammel",
      { sepa_datei_id: dateiId, eingang_am: ausfuehrung });
    await oeffneLauf(laufId);
    lMeldung("l-detail-status", "erfolg",
      "<strong>" + r.anzahl + " Forderungen</strong> über <strong>" + lEur(r.summeCent) +
      "</strong> als bezahlt gebucht. Was offen bleibt, steht im Reiter " +
      "&bdquo;Zahlungen&ldquo;.");
  } catch (e) {
    lMeldung("l-detail-status", "fehler", esc(e.message));
  }
}

// Nimmt eine Sammelbuchung zurueck, die es nie gegeben hat -- der Fall vom
// 10.08.2026: die SEPA-Datei war nie bei der Bank, gebucht war sie trotzdem.
// Bewusst zweistufig: erst zaehlen lassen, dann mit Zahlen fragen. Wer eine
// Buchung ueber 36.876 Euro zurueckdreht, soll den Betrag vorher sehen.
async function nimmSammelZurueck(dateiId, laufId) {
  let probe;
  try {
    probe = await vvRequest("vv-sammel-zurueck", { sepa_datei_id: dateiId, pruefen: true });
  } catch (e) {
    lMeldung("l-detail-status", "fehler", esc(e.message));
    return;
  }
  if (!probe.anzahl) {
    lMeldung("l-detail-status", "info",
      "Zu dieser Datei steht keine Zahlung, die zurückgenommen werden könnte.");
    return;
  }
  if (!confirm(probe.anzahl + " Zahlungen über " + lEur(probe.summeCent) +
               " werden storniert.\nDie Forderungen stehen danach wieder offen und lassen sich " +
               "erneut einziehen.\n\nNur machen, wenn dieser Einzug wirklich nicht stattgefunden " +
               "hat.\nGelöscht wird nichts: die Zahlungen bleiben mit Storno-Vermerk sichtbar.")) return;

  const grund = prompt("Grund für die Rücknahme (steht im Storno-Vermerk):",
                       "Einzug hat nicht stattgefunden");
  if (grund === null) return;

  try {
    const r = await vvRequest("vv-sammel-zurueck", { sepa_datei_id: dateiId, grund: grund });
    await oeffneLauf(laufId);
    lMeldung("l-detail-status", "erfolg",
      "<strong>" + r.anzahl + " Zahlungen</strong> über <strong>" + lEur(r.summeCent) +
      "</strong> storniert. Die Forderungen stehen wieder offen.");
  } catch (e) {
    lMeldung("l-detail-status", "fehler", esc(e.message));
  }
}

function ergebnis(titel, html) {
  $("l-ergebnis-titel").textContent = titel;
  $("l-ergebnis").innerHTML = html;
  $("l-karte-ergebnis").hidden = false;
}

// ---------------------------------------------------------------------
// Vorschau
// ---------------------------------------------------------------------

async function zeigeVorschau(id) {
  lMeldung("l-detail-status", "info", "Wird über den gesamten Bestand gerechnet …");
  let v;
  try {
    v = await vvRequest("vv-lauf-vorschau", { lauf_id: id });
  } catch (e) {
    lMeldung("l-detail-status", "fehler", esc(e.message));
    return;
  }
  $("l-detail-status").hidden = true;

  ergebnis("Vorschau — es wurde nichts geschrieben",
    '<p><strong>' + v.anzahl + " Forderungen</strong> über zusammen <strong>" +
    lEur(v.summeCent) + "</strong>.</p>" +
    '<div class="tabelle-scroll"><table class="schmal"><thead><tr><th>Klasse</th><th class="betrag">Anzahl</th>' +
    "<th class=\"betrag\">Summe</th></tr></thead><tbody>" +
    v.verteilung.map((x) => '<tr><td class="name">' + esc(x.klasse) + '</td><td class="betrag">' +
      x.anzahl + '</td><td class="betrag">' + lEur(x.summe_cent) + "</td></tr>").join("") +
    "</tbody></table></div>" +
    (v.ausschlussGesamt
      ? "<h3>Nicht dabei — " + v.ausschlussGesamt + " Mitgliedschaften</h3>" +
        v.ausschluesse.map((a) =>
          "<p><strong>" + a.anzahl + "×</strong> " + esc(a.text) + "<br>" +
          '<span class="fussnote">' +
          esc(a.beispiele.map((b) => b.name + " (" + b.mitgliedsnummer + ")").join(", ")) +
          (a.anzahl > a.beispiele.length ? " …" : "") + "</span></p>").join("")
      : "<p>Kein Mitglied wurde ausgelassen.</p>"));
}

// ---------------------------------------------------------------------
// Ausführen
// ---------------------------------------------------------------------

function lFortschritt(anteil, text) {
  $("l-fortschritt-huelle").hidden = false;
  $("l-balken").style.width = Math.round(anteil * 100) + "%";
  $("l-fortschritt-text").textContent = text;
}

async function starteLauf(id) {
  if (laufLaeuft) return;
  if (!confirm("Jetzt die Forderungen erzeugen?\n\nEin bereits erzeugter Posten wird dabei nicht " +
               "doppelt angelegt. Verschickt wird noch nichts.")) return;

  laufLaeuft = true;
  $("l-detail-knoepfe").querySelectorAll("button").forEach((b) => { b.disabled = true; });
  // Immer bei null anfangen: sonst steht nach einem abgebrochenen Lauf
  // noch der Balken des vorherigen auf 100 %.
  lFortschritt(0, "Wird gestartet …");
  $("l-detail-status").hidden = true;

  let durchlaeufe = 0, letzte = null;
  try {
    do {
      letzte = await vvRequest("vv-lauf-ausfuehren", { lauf_id: id });
      durchlaeufe++;
      // Der Server zaehlt beim ersten Block, wie viele Mitgliedschaften
      // ueberhaupt in Frage kommen. Ohne diese Zahl waere der Balken nur
      // Dekoration.
      const erwartet = letzte.erwartet || 0;
      lFortschritt(letzte.fertig ? 1 : (erwartet ? Math.min(0.95, letzte.gesamt / erwartet) : 0.5),
        letzte.gesamt + (erwartet ? " von etwa " + erwartet : "") +
        " Forderungen über " + lEur(letzte.summeCent) +
        (letzte.fertig ? " — fertig" : " …"));
    } while (!letzte.fertig && durchlaeufe < 60);
  } catch (e) {
    lFortschritt(0, "");
    $("l-fortschritt-huelle").hidden = true;
    lMeldung("l-detail-status", "fehler",
      "Abgebrochen: " + esc(e.message) +
      "<br>Bereits erzeugte Forderungen bleiben stehen. Ein erneuter Start setzt dort fort, wo es " +
      "abgebrochen ist, und legt nichts doppelt an.");
    laufLaeuft = false;
    await oeffneLauf(id);
    return;
  }

  laufLaeuft = false;
  lMeldung("l-detail-status", "erfolg",
    "<strong>" + letzte.gesamt + " Forderungen</strong> über <strong>" + lEur(letzte.summeCent) +
    "</strong> erzeugt, in " + durchlaeufe + " Durchgängen.");
  await ladeLaeufe();
  await oeffneLauf(id);
}

// ---------------------------------------------------------------------
// SEPA
// ---------------------------------------------------------------------

// Doppelklick-Sperre. Ein zweiter Klick, solange der erste noch laeuft,
// erzeugt sonst eine zweite SEPA-Datei ueber dieselben Forderungen -- und
// nach einer Ruecklastschrift auf eine der Dubletten steht die Forderung
// auf bezahlt, obwohl nie Geld eingegangen ist.
//
// ⚠️ Der Waechter MUSS nurPruefen durchreichen. Ein btn.disabled am Knopf
// war der erste Entwurf und haette den zweiten Parameter verschluckt --
// aus "SEPA pruefen" waere damit eine echte Erzeugung geworden.
async function erzeugeSepa(id, nurPruefen) {
  if (erzeugeSepa.laeuft) return;
  erzeugeSepa.laeuft = true;
  try {
    return await erzeugeSepaAusfuehren(id, nurPruefen);
  } finally {
    erzeugeSepa.laeuft = false;
  }
}

async function erzeugeSepaAusfuehren(id, nurPruefen) {
  const feld = $("l-einzug");
  const eingabe = feld ? feld.value : "";
  if (!eingabe) {
    lMeldung("l-detail-status", "warn",
      "Bitte zuerst eintragen, an welchem Tag eingezogen werden soll. Erstlastschriften brauchen " +
      "üblicherweise fünf Bankarbeitstage Vorlauf, Folgelastschriften zwei.");
    return;
  }

  lMeldung("l-detail-status", "info", nurPruefen ? "Wird geprüft …" : "Datei wird erzeugt …");
  let s;
  try {
    s = await vvRequest("vv-sepa-erzeugen",
      { lauf_id: id, pruefen: !!nurPruefen, ausfuehrung_am: eingabe });
  } catch (e) {
    if (/bereits eine SEPA-Datei/.test(e.message)) {
      if (!confirm(e.message + ".\n\nWirklich eine weitere erzeugen? Wenn die erste schon bei der " +
                   "Bank liegt, wird doppelt eingezogen.")) {
        $("l-detail-status").hidden = true;
        return;
      }
      try {
        s = await vvRequest("vv-sepa-erzeugen",
          { lauf_id: id, ausfuehrung_am: eingabe, trotzdem: true });
      } catch (e2) {
        lMeldung("l-detail-status", "fehler", esc(e2.message));
        return;
      }
    } else {
      lMeldung("l-detail-status", "fehler", esc(e.message));
      return;
    }
  }
  $("l-detail-status").hidden = true;

  const uebersprungen = s.uebersprungenGesamt
    ? "<h3>Nicht einziehbar — " + s.uebersprungenGesamt + " Haushalte" +
      (s.uebersprungenSumme ? " über " + lEur(s.uebersprungenSumme) : "") + "</h3>" +
      '<p class="fussnote">Diese Beiträge bleiben offen und müssen auf anderem Weg eingefordert ' +
      "werden. Die Forderungen dazu stehen weiterhin in der Datenbank.</p>" +
      '<div class="tabelle-scroll"><table><thead><tr><th>Zahler</th><th>Grund</th>' +
      "<th class=\"betrag\">Betrag</th></tr></thead><tbody>" +
      s.uebersprungen.map((u) => '<tr><td class="name">' + esc(u.name) + "</td><td>" +
        esc(u.grund) + '</td><td class="betrag">' + lEur(u.betrag_cent) + "</td></tr>").join("") +
      "</tbody></table></div>"
    : "";

  const warnungen = (s.warnungen || []).length
    ? '<div class="hinweis warn">' + s.warnungen.map(esc).join("<br>") + "</div>"
    : "";

  const kopf =
    "<p><strong>" + s.anzahl + " Abbuchungen</strong> über zusammen <strong>" +
    lEur(s.summeCent) + "</strong>, Einzug am " + lDatum(s.ausfuehrung) + ".<br>" +
    '<span class="fussnote">Davon ' + s.erstlastschriften + " Erstlastschriften und " +
    s.folgelastschriften + " Folgelastschriften. Ein Haushalt wird einmal belastet, auch wenn " +
    "mehrere Mitglieder dazugehören.</span></p>";

  if (nurPruefen) {
    ergebnis("SEPA-Probe — es wurde keine Datei erzeugt", warnungen + kopf + uebersprungen);
    return;
  }

  // Die Datei liegt NUR in dieser Antwort -- der Server speichert sie
  // bewusst nicht. Deshalb zuerst herunterladen, dann erst auffrischen:
  // oeffneLauf() blendet die Ergebniskarte aus, und mit ihr verschwand bis
  // zum 10.08.2026 der einzige Link auf die Datei, keine Sekunde nachdem
  // er erschienen war. Gleiche Reihenfolge wie beim Spielerlaubnis-PDF:
  // die Handlung, die der Nutzer will, geht vor dem Aufraeumen.
  const blob = new Blob([s.xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = s.dateiname;
  document.body.appendChild(a);
  a.click();
  a.remove();

  await ladeLaeufe();
  await oeffneLauf(id);

  ergebnis("SEPA-Datei erzeugt",
    warnungen + kopf +
    '<p><a class="btn" download="' + esc(s.dateiname) + '" href="' + url + '">' +
    esc(s.dateiname) + " herunterladen</a></p>" +
    '<p class="fussnote">Der Download ist bereits angestoßen — der Knopf ist der zweite Weg, ' +
    "falls der Browser ihn abgefangen hat. <strong>Diesen Kasten nicht verlassen, bevor die " +
    "Datei auf der Platte liegt:</strong> sie wird <strong>nicht</strong> auf dem Server " +
    "gespeichert (eine Liste mit " + s.anzahl + " Bankverbindungen soll nirgends herumliegen), " +
    "gespeichert ist nur, <em>dass</em> sie erzeugt wurde (Kennung " + esc(s.msgId) + "). Vor " +
    "der ersten echten Einreichung eine Testdatei mit drei Posten bei der Bank einreichen.</p>" +
    uebersprungen);

  const karte = $("l-karte-ergebnis");
  if (karte.scrollIntoView) karte.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------------
// Vorabankündigung
// ---------------------------------------------------------------------

async function zeigeVorab(id) {
  lMeldung("l-detail-status", "info", "Wird zusammengestellt …");
  let v;
  try {
    v = await vvRequest("vv-vorabankuendigung", { lauf_id: id });
  } catch (e) {
    lMeldung("l-detail-status", "fehler", esc(e.message));
    return;
  }
  $("l-detail-status").hidden = true;

  // ⚠️ Bei vier Einzügen im Jahr sagt „Beitrag 2027" nichts mehr. Die
  // Rate gehört in die Ankündigung UND in den Dateinamen, sonst liegen
  // vier gleich benannte Listen nebeneinander und der Serienbrief nennt
  // einen Zeitraum, den der Kontoauszug nicht bestätigt.
  const wofuer = String(v.jahr) + (v.periodeText ? " " + v.periodeText : "");
  const kopf = ["Empfaenger", "EMail", "Strasse", "PLZ", "Ort", "Mitglieder",
                "Beitrag fuer", "Betrag", "Faellig", "Mandatsreferenz", "GlaeubigerID"];
  const zeilen = v.empfaenger.map((e) => [
    e.empfaenger, e.email, e.strasse, e.plz, e.ort,
    e.mitglieder.map((m) => m.name + " (" + m.nr + ")").join(" / "),
    wofuer,
    (e.betrag_cent / 100).toFixed(2).replace(".", ","),
    lDatum(v.faellig), e.mandat, v.glaeubiger_id
  ]);
  const csv = "﻿" + [kopf].concat(zeilen)
    .map((r) => r.map((f) => '"' + String(f === null || f === undefined ? "" : f)
      .replace(/"/g, '""') + '"').join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));

  ergebnis("Vorabankündigung",
    "<p><strong>" + v.anzahl + " Empfänger</strong> über zusammen <strong>" +
    lEur(v.summeCent) + "</strong> für <strong>" + esc(wofuer) + "</strong>, Einzug am " +
    lDatum(v.faellig) + ".<br>" +
    '<span class="fussnote">' + v.mitEmail + " haben eine E-Mail-Adresse hinterlegt, " +
    (v.anzahl - v.mitEmail) + " brauchen einen Brief.</span></p>" +
    '<p><a class="btn" download="Vorabankuendigung-' + esc(v.jahr) +
    (v.periode && v.periode !== "jahr" ? "-" + esc(v.periode.toUpperCase()) : "") +
    '.csv" href="' + url + '">' +
    "Liste als CSV herunterladen</a></p>" +
    '<div class="hinweis warn">Diese App <strong>verschickt nichts</strong>. Eine ' +
    "Vorabankündigung ist juristisch nur erfüllt, wenn sie ankommt — und solange für " +
    "<code>sc1911-heiligenstadt.de</code> kein DKIM/DMARC eingerichtet ist, landet eine " +
    "Sammelmail bei Gmail und Yahoo im Spam. Bis dahin ist der Serienbrief der sichere Weg." +
    "</div>" +
    '<p class="fussnote">Die Liste enthält alle Pflichtangaben: Betrag, Fälligkeit, ' +
    "Mandatsreferenz und Gläubiger-Identifikationsnummer. Die IBAN steht bewusst nur verkürzt " +
    "darin — mehr braucht eine Ankündigung nicht.</p>" +
    '<div class="tabelle-scroll"><table><thead><tr><th>Zahler</th><th>E-Mail</th>' +
    "<th>Mitglieder</th><th class=\"betrag\">Betrag</th></tr></thead><tbody>" +
    v.empfaenger.slice(0, 25).map((e) => '<tr><td class="name">' + esc(e.empfaenger) +
      "</td><td>" + (e.email ? esc(e.email) : '<span class="fussnote">Brief</span>') +
      "</td><td>" + esc(e.mitglieder.map((m) => m.name).join(", ")) +
      '</td><td class="betrag">' + lEur(e.betrag_cent) + "</td></tr>").join("") +
    "</tbody></table></div>" +
    (v.anzahl > 25 ? '<p class="fussnote">… und ' + (v.anzahl - 25) +
      " weitere, vollständig in der CSV.</p>" : ""));
}

// ---------------------------------------------------------------------
// Festschreiben und Verwerfen
// ---------------------------------------------------------------------

async function schreibeFest(id) {
  if (!confirm("Lauf festschreiben?\n\nDanach lassen sich die Forderungen dieses Laufs nicht mehr " +
               "gemeinsam ändern oder löschen — nur noch einzeln stornieren. Das ist so gewollt: " +
               "eine Buchhaltung, in der Vergangenes verschwinden kann, ist keine.")) return;
  try {
    await vvRequest("vv-lauf-festschreiben", { lauf_id: id });
    await ladeLaeufe();
    await oeffneLauf(id);
    lMeldung("l-detail-status", "erfolg", "Festgeschrieben.");
  } catch (e) {
    lMeldung("l-detail-status", "fehler", esc(e.message));
  }
}

// ---------------------------------------------------------------------
// Altmandate
// ---------------------------------------------------------------------

async function kennzeichneMandate() {
  const datum = $("l-mandat-datum").value;
  if (!datum) {
    lMeldung("l-mandat-status", "warn", "Bitte das Datum des letzten Einzugs durch den Vereinsmeister eintragen.");
    return;
  }
  let probe;
  try {
    probe = await vvRequest("vv-mandate-uebernommen", { stichtag: datum, pruefen: true });
  } catch (e) {
    lMeldung("l-mandat-status", "fehler", esc(e.message));
    return;
  }
  if (!probe.betroffen) {
    lMeldung("l-mandat-status", "info", "Alle Mandate sind bereits als genutzt gekennzeichnet.");
    return;
  }
  if (!confirm(probe.betroffen + " Mandate werden als bereits genutzt gekennzeichnet.\n\n" +
               "Damit werden künftige Einzüge als Folgelastschrift eingereicht. Das ist nur " +
               "richtig, wenn die Bank bestätigt hat, dass die alten Mandate weiterlaufen.")) return;
  try {
    const r = await vvRequest("vv-mandate-uebernommen", { stichtag: datum });
    lMeldung("l-mandat-status", "erfolg", r.betroffen + " Mandate gekennzeichnet.");
  } catch (e) {
    lMeldung("l-mandat-status", "fehler", esc(e.message));
  }
}

// ---------------------------------------------------------------------

function laufVerdrahten() {
  $("btn-l-neu-laden").addEventListener("click", () => { ladeLaeufe(); ladeStammdaten(); });
  $("btn-l-neu").addEventListener("click", oeffneNeuerLauf);
  $("btn-lauf-zu").addEventListener("click", () => { $("lauf-overlay").hidden = true; });
  $("btn-lauf-abbrechen").addEventListener("click", () => { $("lauf-overlay").hidden = true; });
  $("btn-lauf-speichern").addEventListener("click", () => speichereNeuerLauf(false));
  $("nl-rhythmus").addEventListener("change", zeigeTermine);
  // Der erste Termin ist der Anker: ändert er sich, rücken die übrigen
  // mit. Wer danach einen einzelnen Termin von Hand setzt, behält ihn —
  // bis er den ersten wieder anfasst, und das ist die verständlichere
  // Regel als ein Feld, das sich nie mehr bewegt.
  $("nl-faelligkeit").addEventListener("change", zeigeTermine);
  $("btn-l-mandate").addEventListener("click", kennzeichneMandate);
}
