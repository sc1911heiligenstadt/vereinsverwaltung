// Auswertungen (Stufe 5) -- eigene Seite fuer den Vorstand.
//
// Sie kennt genau zwei Aktionen: vv-kennzahlen und vv-bestandsmeldung.
// Beide liefern ausschliesslich Summen. Der Code zum Anzeigen einer
// Mitgliederliste ist auf dieser Seite nicht vorhanden -- eine Rechte-
// grenze, die man nicht versehentlich aufweichen kann, weil es nichts
// aufzuweichen gibt.

function $(id) { return document.getElementById(id); }

function esc(wert) {
  if (wert === null || wert === undefined) return "";
  return String(wert).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function eur(cent) {
  if (cent === null || cent === undefined) return "—";
  return (cent / 100).toLocaleString("de-DE",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

let letzteMeldung = null;

function kachel(zahl, text, hinweis) {
  return '<div class="kennzahl"><div class="kennzahl-zahl">' + esc(zahl) + "</div>" +
    '<div class="kennzahl-text">' + esc(text) + "</div>" +
    (hinweis ? '<div class="kennzahl-hinweis">' + esc(hinweis) + "</div>" : "") + "</div>";
}

// Balken statt nur Zahlen: bei neun Abteilungen sagt das Verhaeltnis mehr
// als die Zahl. Breite in Prozent des groessten Werts.
function balkenListe(zeilen, wert, name) {
  const max = zeilen.reduce((m, z) => Math.max(m, wert(z)), 0) || 1;
  return '<div class="balkenliste">' + zeilen.map((z) =>
    '<div class="balkenzeile"><div class="balken-name">' + esc(name(z)) + "</div>" +
    '<div class="balken"><div class="balken-fuellung" style="width:' +
      Math.round(wert(z) / max * 100) + '%"></div></div>' +
    '<div class="balken-wert">' + wert(z) + "</div></div>").join("") + "</div>";
}

async function start() {
  let rechte;
  try {
    rechte = await ladeEigeneRechte();
  } catch (e) {
    $("anmelde-schirm").hidden = false;
    if (!(e instanceof NotLoggedInError)) {
      $("anmelde-schirm").innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    }
    return;
  }
  $("anmelde-schirm").hidden = true;

  const hatRolle = rechte.isAdmin || (rechte.rollen && rechte.rollen.length > 0);
  if (!hatRolle) { $("kein-zugriff").hidden = false; return; }

  $("app-bereich").hidden = false;
  $("version-badge").textContent = "v" + APP_VERSION;

  const d = new Date();
  $("f-stichtag").value = d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

  $("btn-laden").addEventListener("click", laden);
  $("btn-meldung").addEventListener("click", ladeMeldung);
  $("btn-meldung-csv").addEventListener("click", meldungHerunterladen);
  laden();
}

async function laden() {
  $("status").innerHTML = '<p class="fussnote">Wird berechnet …</p>';
  let k;
  try {
    k = await vvRequest("vv-kennzahlen", { stichtag: $("f-stichtag").value });
  } catch (e) {
    $("status").innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  $("status").innerHTML = "";

  const b = k.bestand || {};
  $("k-bestand").innerHTML =
    kachel(b.gesamt || 0, "Mitglieder") +
    kachel(b.aktiv || 0, "aktiv") +
    kachel(b.ruhend || 0, "ruhend") +
    kachel(b.ehren || 0, "Ehrenmitglieder") +
    kachel(b.stimmberechtigt || 0, "stimmberechtigt",
           "ab " + k.stimmrecht_ab + " Jahren, § 8 Abs. 2");

  $("k-sparten").innerHTML = k.je_sparte.length
    ? balkenListe(k.je_sparte, (z) => z.n, (z) => z.name) +
      '<p class="fussnote">Summe ' + k.je_sparte.reduce((s, z) => s + z.n, 0) +
      " Abteilungsmitgliedschaften.</p>"
    : '<div class="leer">Keine Abteilungszuordnungen.</div>';

  const klassenSumme = k.je_klasse.reduce((s, z) => s + (z.summe_cent || 0), 0);
  $("k-klassen").innerHTML =
    '<div class="tabelle-scroll"><table><thead><tr><th>Klasse</th>' +
    '<th class="betrag">Mitglieder</th><th class="betrag">Jahresbeitrag gesamt</th>' +
    "</tr></thead><tbody>" +
    k.je_klasse.map((z) => "<tr><td>" + esc(z.name) + "</td>" +
      '<td class="betrag">' + z.n + "</td>" +
      '<td class="betrag">' + eur(z.summe_cent) + "</td></tr>").join("") +
    '<tr class="summenzeile"><td>Gesamt</td>' +
    '<td class="betrag">' + k.je_klasse.reduce((s, z) => s + z.n, 0) + "</td>" +
    '<td class="betrag">' + eur(klassenSumme) + "</td></tr>" +
    "</tbody></table></div>" +
    '<p class="fussnote">Das ist die Summe der geltenden Sätze zum Stichtag — nicht das, ' +
    "was tatsächlich gestellt oder eingegangen ist.</p>";

  // Altersaufbau: die Serverantwort kommt als Liste aus Gruppe mal
  // Geschlecht, hier wird sie zur Kreuztabelle.
  const nachGruppe = {};
  for (const z of k.je_alter) {
    if (!nachGruppe[z.gruppe]) nachGruppe[z.gruppe] = { w: 0, m: 0, d: 0, ohne: 0, gesamt: 0 };
    const s = ["w", "m", "d"].includes(z.geschlecht) ? z.geschlecht : "ohne";
    nachGruppe[z.gruppe][s] += z.n;
    nachGruppe[z.gruppe].gesamt += z.n;
  }
  const gruppen = k.altersgruppen.filter((g) => nachGruppe[g]);
  $("k-alter").innerHTML = gruppen.length
    ? '<div class="tabelle-scroll"><table><thead><tr><th>Alter</th>' +
      '<th class="betrag">weiblich</th><th class="betrag">männlich</th>' +
      '<th class="betrag">divers</th><th class="betrag">ohne Angabe</th>' +
      '<th class="betrag">gesamt</th></tr></thead><tbody>' +
      gruppen.map((g) => {
        const z = nachGruppe[g];
        return "<tr><td>" + esc(g) + "</td>" +
          '<td class="betrag">' + z.w + '</td><td class="betrag">' + z.m + "</td>" +
          '<td class="betrag">' + z.d + '</td><td class="betrag">' + z.ohne + "</td>" +
          '<td class="betrag"><strong>' + z.gesamt + "</strong></td></tr>";
      }).join("") + "</tbody></table></div>"
    : '<div class="leer">Keine Daten.</div>';

  const jahre = {};
  for (const z of k.zugaenge) jahre[z.jahr] = { jahr: z.jahr, zu: z.n, ab: 0 };
  for (const z of k.abgaenge) {
    if (!jahre[z.jahr]) jahre[z.jahr] = { jahr: z.jahr, zu: 0, ab: 0 };
    jahre[z.jahr].ab = z.n;
  }
  const reihe = Object.values(jahre).sort((a, b2) => a.jahr.localeCompare(b2.jahr));
  $("k-entwicklung").innerHTML = reihe.length
    ? '<div class="tabelle-scroll"><table><thead><tr><th>Jahr</th>' +
      '<th class="betrag">Eintritte</th><th class="betrag">Austritte</th>' +
      '<th class="betrag">Saldo</th></tr></thead><tbody>' +
      reihe.map((z) => "<tr><td>" + esc(z.jahr) + "</td>" +
        '<td class="betrag">' + z.zu + '</td><td class="betrag">' + z.ab + "</td>" +
        '<td class="betrag"><strong>' + (z.zu - z.ab > 0 ? "+" : "") + (z.zu - z.ab) +
        "</strong></td></tr>").join("") + "</tbody></table></div>"
    : '<div class="leer">Keine Bewegungen in den letzten zehn Jahren.</div>';

  const f = k.finanzen || {};
  $("k-finanzen").innerHTML =
    kachel(f.forderungen || 0, "Forderungen " + k.jahr) +
    kachel(eur(f.summe_cent), "gestellt") +
    kachel(eur(f.bezahlt_cent), "bezahlt") +
    kachel(eur(f.offen_cent), "offen");
}

async function ladeMeldung() {
  $("k-meldung").innerHTML = '<p class="fussnote">Wird gezählt …</p>';
  let m;
  try {
    m = await vvRequest("vv-bestandsmeldung", { stichtag: $("f-stichtag").value });
  } catch (e) {
    $("k-meldung").innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  letzteMeldung = m;
  $("btn-meldung-csv").hidden = false;

  $("k-meldung").innerHTML =
    '<div class="hinweis info">' + esc(m.hinweis) + "</div>" +
    '<div class="tabelle-scroll"><table><thead><tr><th>Abteilung</th><th>Alter</th>' +
    '<th class="betrag">weiblich</th><th class="betrag">männlich</th>' +
    '<th class="betrag">divers</th><th class="betrag">ohne Angabe</th>' +
    '<th class="betrag">gesamt</th></tr></thead><tbody>' +
    m.zeilen.map((z) => "<tr><td>" + esc(z.sparte) + "</td><td>" + esc(z.altersgruppe) + "</td>" +
      '<td class="betrag">' + z.w + '</td><td class="betrag">' + z.m + "</td>" +
      '<td class="betrag">' + z.d + '</td><td class="betrag">' + z.ohne + "</td>" +
      '<td class="betrag"><strong>' + z.gesamt + "</strong></td></tr>").join("") +
    '<tr class="summenzeile"><td>Gesamt</td><td></td><td></td><td></td><td></td><td></td>' +
    '<td class="betrag">' + m.gesamt + "</td></tr>" +
    "</tbody></table></div>";
}

function meldungHerunterladen() {
  if (!letzteMeldung) return;
  // Semikolon und BOM, damit Excel die Datei ohne Nachfragen richtig
  // oeffnet -- dieselbe Regel wie bei den uebrigen Ausgaben der Flotte.
  const zeilen = [["Abteilung", "Altersgruppe", "weiblich", "maennlich", "divers",
                   "ohne Angabe", "gesamt"]];
  for (const z of letzteMeldung.zeilen) {
    zeilen.push([z.sparte, z.altersgruppe, z.w, z.m, z.d, z.ohne, z.gesamt]);
  }
  const csv = "﻿" + zeilen.map((z) => z.map((w) => {
    const t = String(w === null || w === undefined ? "" : w);
    return /[";\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }).join(";")).join("\r\n");

  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = "Bestandsmeldung-" + letzteMeldung.stichtag + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

document.addEventListener("DOMContentLoaded", start);
