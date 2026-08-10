// Bestandsmeldung an den Landessportbund -- die Datei zum Hochladen
//
// Das Portal unser-sportverein.net liest in Schritt 3 eine CSV mit
// EINZELPERSONEN ein und rechnet daraus selbst die Jahrgangsmatrix. Die
// Auswertung auf vorstand.html liefert dagegen Summen je Altersgruppe:
// gut zum Gegenrechnen, aber nichts, was sich hochladen liesse.
//
// ⚠️ Diese Datei enthaelt Klarnamen, Geburtsdaten und die Abteilungen
// aller Mitglieder. Sie gehoert deshalb in die Verwaltung und NICHT auf
// die Vorstandsseite -- die laedt bewusst keinen Code, der Personendaten
// anzeigen kann.

let letzterLsbLauf = null;
let lsbSparten = [];

// Genau die Kopfzeile der Vorlage des LSB (Mitgliederliste.csv, 164
// Byte). Die beiden leeren Felder am Ende gehoeren dazu -- die Vorlage
// haelt dort Platz fuer weitere Abteilungen derselben Person.
const LSB_KOPF = ["Name", "Vorname", "Geschlecht", "Geburtsdatum", "Abteilungen", "", ""];
const LSB_SPALTEN_FUER_NUMMERN = 3;

function lsbStichtagVorgabe() {
  // Stichtag der Bestandserhebung ist der 1. Januar. Gemeldet wird im
  // Januar/Februar fuer das laufende Jahr.
  return new Date().getFullYear() + "-01-01";
}

function lsbKarteZeigen() {
  const karte = $("lsb-karte");
  if (!karte) return;
  karte.hidden = false;
  if (!$("lsb-stichtag").value) $("lsb-stichtag").value = lsbStichtagVorgabe();
  $("btn-lsb-liste").addEventListener("click", ladeLsbListe);
  $("btn-lsb-csv").addEventListener("click", lsbCsvHerunterladen);
  $("btn-lsb-vorschau").addEventListener("click", () => teileSparte(false));
  $("btn-lsb-aufteilen").addEventListener("click", () => teileSparte(true));
  ladeLsbSparten();
}

// Die Auswahllisten des Aufteil-Werkzeugs. Eigener Aufruf statt der
// Liste aus app.js: die dortige spartenListe enthaelt nur die AKTIVEN,
// und aufgeteilt wird gerade ein Sammelposten, der oft schon stillgelegt
// ist.
async function ladeLsbSparten() {
  let antwort;
  try {
    antwort = await vvRequest("vv-sparten", {});
  } catch (e) {
    $("lsb-teilen-ergebnis").innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  lsbSparten = antwort.sparten || [];

  const optionen = (nurMitNummer) => '<option value="">— bitte wählen —</option>' +
    lsbSparten.filter((s) => !nurMitNummer || s.dosb_sportart_nr)
      .map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) +
        (s.dosb_sportart_nr ? " (Nr. " + s.dosb_sportart_nr + ")" : " — ohne Nummer") +
        " · " + (s.mitglieder || 0) + "</option>").join("");

  $("lsb-quelle").innerHTML = optionen(false);
  $("lsb-ziel-ab").innerHTML = optionen(false);
  $("lsb-ziel-unter").innerHTML = optionen(false);
}

async function ladeLsbListe() {
  const ziel = $("lsb-ergebnis");
  ziel.innerHTML = '<p class="fussnote">Wird zusammengestellt …</p>';
  $("btn-lsb-csv").hidden = true;

  let m;
  try {
    m = await vvRequest("vv-lsb-export", { stichtag: $("lsb-stichtag").value });
  } catch (e) {
    ziel.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  letzterLsbLauf = m;
  $("btn-lsb-csv").hidden = false;

  // Wer in der Datei fehlt oder ohne Fachverband ankommt, steht NAMENTLICH
  // da. "Drei ohne Geburtsdatum" ist nichts, womit die Geschäftsstelle
  // arbeiten kann.
  const liste = (eintraege) => eintraege.map(
    (e) => esc(e.name) + " (Nr. " + esc(e.nummer) + ")").join(", ");

  let warnungen = "";
  if ((m.ohne_nummer || []).length) {
    warnungen += '<div class="hinweis warn"><strong>Ohne Sportartennummer: ' +
      m.ohne_nummer.map((s) => esc(s.name) + " (" + s.anzahl + ")").join(", ") +
      ".</strong> Diese Mitglieder kommen beim Verband unter „ohne Landesfachverband“ an — " +
      "2026 kostet das 5 € je Kind und 10 € je Erwachsenem, ab 2027 ist es gar nicht mehr " +
      "möglich. Die Nummer wird im Reiter „Anträge“ bei den Abteilungen eingetragen.</div>";
  }
  if ((m.ohne_abteilung || []).length) {
    warnungen += '<div class="hinweis warn">' + m.ohne_abteilung.length +
      " Mitglieder haben keine Abteilung: " + liste(m.ohne_abteilung) +
      ". Sie stehen in der Datei, aber ohne Sportart.</div>";
  }
  if ((m.ohne_geburtsdatum || []).length) {
    warnungen += '<div class="hinweis fehler">' + m.ohne_geburtsdatum.length +
      " Mitglieder haben kein Geburtsdatum: " + liste(m.ohne_geburtsdatum) +
      ". Das Portal ordnet nach Jahrgängen — diese Zeilen bleiben dort liegen.</div>";
  }
  if (m.ohne_geschlecht) {
    warnungen += '<div class="hinweis info">' + m.ohne_geschlecht +
      " Mitglieder ohne Geschlechtsangabe. Sie werden als „o“ gemeldet; das Portal führt " +
      "dafür eine eigene Spalte.</div>";
  }

  const mehrfach = (m.zeilen || []).filter((z) => z.nummern.length > LSB_SPALTEN_FUER_NUMMERN);

  ziel.innerHTML =
    '<div class="hinweis erfolg"><strong>' + m.mitglieder + " Mitglieder</strong> zum " +
      datumDe(m.stichtag) + ", daraus <strong>" + m.meldungen +
      " Meldungen an Fachverbände</strong>. Die zweite Zahl ist höher, sobald jemand zwei " +
      "Sportarten betreibt — das ist so gewollt.</div>" +
    warnungen +
    (mehrfach.length ? '<div class="hinweis warn">' + mehrfach.length +
      " Mitglieder sind in mehr als " + LSB_SPALTEN_FUER_NUMMERN +
      " Abteilungen. Die Vorlage des LSB hat nur so viele Spalten — die weiteren fehlen in " +
      "der Datei und müssen im Portal von Hand nachgetragen werden.</div>" : "") +
    '<div class="tabelle-scroll"><table class="schmal"><thead><tr><th>Name</th><th>Vorname</th>' +
    "<th>Geschl.</th><th>geboren</th><th>Abteilungen</th><th>Nummern</th></tr></thead><tbody>" +
    (m.zeilen || []).slice(0, 25).map((z) =>
      "<tr><td>" + esc(z.nachname) + "</td><td>" + esc(z.vorname) + "</td><td>" +
      esc(z.geschlecht) + "</td><td>" + esc(z.geburtsdatum) + "</td><td>" +
      esc(z.sparten.join(", ")) + "</td><td>" + esc(z.nummern.join(", ")) + "</td></tr>").join("") +
    "</tbody></table></div>" +
    (m.zeilen.length > 25 ? '<p class="fussnote">Die ersten 25 von ' + m.zeilen.length +
      " Zeilen. Vollständig in der Datei.</p>" : "");
}

// Reine Zeichenkette, ohne DOM — damit der Prüfstand genau den Code
// misst, der die Datei erzeugt, statt ihn nachzubauen.
function lsbCsvText(lauf) {
  const zeilen = [LSB_KOPF.slice()];
  for (const z of (lauf.zeilen || [])) {
    const felder = [z.nachname, z.vorname, z.geschlecht, z.geburtsdatum];
    for (let i = 0; i < LSB_SPALTEN_FUER_NUMMERN; i++) felder.push(z.nummern[i] || "");
    zeilen.push(felder);
  }

  // Semikolon und BOM wie bei den übrigen Ausgaben der Flotte: das
  // Portal erwartet Semikolon, und mit BOM öffnet Excel die Datei ohne
  // Nachfragen richtig, wenn jemand vorher hineinsehen will.
  return "﻿" + zeilen.map((z) => z.map((w) => {
    const t = String(w === null || w === undefined ? "" : w);
    return /[";\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }).join(";")).join("\r\n");
}

function lsbCsvHerunterladen() {
  if (!letzterLsbLauf) return;
  const csv = lsbCsvText(letzterLsbLauf);

  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = "Mitgliederliste-LSB-" + letzterLsbLauf.stichtag + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// Sammelposten aufteilen. Vorschau und Ausführen rufen dieselbe Aktion;
// erst „ausfuehren“ schreibt. Ohne den Zwischenschritt hinge an einem
// Klick die Abteilungszugehörigkeit von 85 Personen.
async function teileSparte(ausfuehren) {
  const ziel = $("lsb-teilen-ergebnis");
  const daten = {
    quelle_id: $("lsb-quelle").value,
    ziel_ab_id: $("lsb-ziel-ab").value,
    ziel_unter_id: $("lsb-ziel-unter").value,
    grenze: Number($("lsb-grenze").value),
    stichtag: $("lsb-stichtag").value,
    ausfuehren: !!ausfuehren
  };
  if (!daten.quelle_id || !daten.ziel_ab_id || !daten.ziel_unter_id) {
    ziel.innerHTML = '<div class="hinweis warn">Bitte den Sammelposten und beide Ziel-Abteilungen wählen.</div>';
    return;
  }

  if (ausfuehren && !confirm("Die Zuordnungen werden jetzt umgehängt.\n\n" +
      "Das ändert die Abteilung der betroffenen Mitglieder dauerhaft — Eintrittsdatum und " +
      "Beitrag bleiben unberührt. Einzelne Personen lassen sich danach im Mitglieder-Reiter " +
      "korrigieren.")) {
    return;
  }

  ziel.innerHTML = '<p class="fussnote">Wird gezählt …</p>';
  let a;
  try {
    a = await vvRequest("vv-sparte-aufteilen", daten);
  } catch (e) {
    ziel.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }

  ziel.innerHTML =
    '<div class="hinweis ' + (a.vorschau ? "info" : "erfolg") + '">' +
      (a.vorschau ? "Vorschau: aus " : "Umgehängt: aus ") + "<strong>" + esc(a.quelle) +
      "</strong> " + (a.vorschau ? "gingen" : "gingen") + " <strong>" + a.ab.anzahl +
      "</strong> Mitglieder ab " + a.grenze + " Jahren nach <strong>" + esc(a.ab.name) +
      "</strong> und <strong>" + a.unter.anzahl + "</strong> jüngere nach <strong>" +
      esc(a.unter.name) + "</strong>." +
    "</div>" +
    ((a.bleibt || []).length
      ? '<div class="hinweis warn"><strong>' + a.bleibt.length +
        " bleiben stehen</strong> — sie sind bereits in einer der beiden Ziel-Abteilungen " +
        "oder haben kein Geburtsdatum: " +
        a.bleibt.map((b) => esc(b.vorname + " " + b.nachname) + " (Nr. " + esc(b.mitgliedsnummer) +
          ")").join(", ") +
        ". Diese Zuordnungen im Mitglieder-Reiter von Hand bereinigen.</div>"
      : "");

  if (!a.vorschau) {
    ladeLsbSparten();
    if (typeof ladeSpartenAuswahl === "function") ladeSpartenAuswahl();
    if (typeof ladeAntragSparten === "function") ladeAntragSparten();
    letzterLsbLauf = null;
    $("btn-lsb-csv").hidden = true;
    $("lsb-ergebnis").innerHTML =
      '<p class="fussnote">Die Zuordnungen haben sich geändert — Liste neu erzeugen.</p>';
  }
}
