// Mahnwesen nach § 5 Abs. 3 der Satzung.
//
// "Ein Mitglied kann ausgeschlossen werden, wenn es trotz zweier
//  schriftlicher Mahnungen mit dem Beitrag im Rückstand ist. Vor der
//  Entscheidung ist ihm Gelegenheit zur Äußerung zu geben, mit einer
//  Frist von zehn Tagen."
//
// Diese Oberfläche macht die drei Stufen sichtbar und sagt bei jedem
// Schritt, was noch fehlt. Der wichtigste Satz steht in der Karte
// „Ausschluss": die App legt dem Vorstand eine Liste vor, sie schließt
// niemanden aus.

let mVorschau = null;
let mListe = [];
let mEinstellungen = null;

const M_STUFE_KURZ = { 1: "1. Mahnung", 2: "2. Mahnung", 3: "Anhörung" };

// "1 Haushalte haben" liest sich wie ein Fehler und ist einer.
function mAnzahl(n, ein, viele) {
  return n + " " + (n === 1 ? ein : viele);
}

// Der Server liefert einen Code, keinen Satz — Umlaute und deutsches
// Datum gehören hierher.
function mGrund(k) {
  switch (k.grund) {
    case "bezahlt": return "nichts mehr offen";
    case "beendet": return "Mitgliedschaft bereits beendet";
    case "mahnungen_fehlen":
      return "erst " + mAnzahl(k.mahnungen_versendet, "Mahnung", "Mahnungen") +
             " von zwei versendet";
    case "anhoerung_nicht_versendet": return "Anhörung noch nicht versendet";
    case "frist_laeuft": return "Anhörungsfrist läuft noch bis " + lDatum(k.frist_bis);
    default: return k.grund || "—";
  }
}

function mMeldung(id, art, text) {
  const k = $(id);
  k.hidden = false;
  k.className = "hinweis " + art;
  k.innerHTML = text;
}

// ---------------------------------------------------------------------
// Fristen und Gebühren
// ---------------------------------------------------------------------

async function ladeMahnEinstellungen() {
  const ziel = $("m-einstellungen");
  let antwort;
  try {
    antwort = await vvRequest("vv-einstellungen", {});
  } catch (e) {
    ziel.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  mEinstellungen = antwort.felder.filter((f) => f.gruppe === "mahnung");

  ziel.innerHTML = '<div class="formraster">' +
    mEinstellungen.map((f) =>
      '<div class="feld"><label for="me-' + esc(f.schluessel) + '">' + esc(f.label) + "</label>" +
      '<input id="me-' + esc(f.schluessel) + '" inputmode="numeric" value="' + esc(f.wert) + '">' +
      "</div>").join("") +
    "</div>" +
    '<div class="knopfreihe"><button class="btn" id="btn-m-einst-speichern">Speichern</button></div>';

  $("btn-m-einst-speichern").addEventListener("click", speichereMahnEinstellungen);
  zeigeRegeln();
}

// Die Regeln im Klartext über den Knopf schreiben — wer mahnt, soll
// vorher wissen, wonach gerechnet wird, statt es aus dem Ergebnis
// zurückzuschließen.
function zeigeRegeln() {
  if (!mEinstellungen) return;
  const w = {};
  mEinstellungen.forEach((f) => { w[f.schluessel] = Number(f.wert); });
  $("m-regeln").innerHTML =
    "Gemahnt wird, was seit <strong>" + w.mahn_karenz_tage + " Tagen</strong> fällig und nicht " +
    "bezahlt ist, ab <strong>" + lEur(w.mahn_mindest_cent) + "</strong> Rückstand. Jede Mahnung " +
    "setzt eine Frist von <strong>" + w.mahn_frist_tage + " Tagen</strong>; die nächste Stufe " +
    "wird erst danach erreicht. Nach der zweiten Mahnung folgt die Anhörung mit <strong>" +
    w.anhoerung_tage + " Tagen</strong> Frist (§ 5 Abs. 3)." +
    (w.mahn_gebuehr1_cent || w.mahn_gebuehr2_cent
      ? " Gebühren: " + lEur(w.mahn_gebuehr1_cent) + " / " + lEur(w.mahn_gebuehr2_cent) +
        " — als eigene Forderung, nicht auf den Beitrag geschlagen."
      : " Es werden keine Mahngebühren berechnet.");
}

async function speichereMahnEinstellungen() {
  const knopf = $("btn-m-einst-speichern");
  knopf.disabled = true;
  try {
    for (const f of mEinstellungen) {
      const feld = document.getElementById("me-" + f.schluessel);
      if (!feld || feld.value === f.wert) continue;
      await vvRequest("vv-einstellung-setzen", { schluessel: f.schluessel, wert: feld.value });
    }
    await ladeMahnEinstellungen();
    mMeldung("m-einst-status", "erfolg", "Gespeichert.");
  } catch (e) {
    mMeldung("m-einst-status", "fehler", esc(e.message));
  } finally {
    knopf.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Mahnlauf
// ---------------------------------------------------------------------

async function mahnProbe() {
  mMeldung("m-status", "info", "Wird geprüft …");
  $("btn-m-start").hidden = true;
  try {
    mVorschau = await vvRequest("vv-mahnlauf", { pruefen: true });
  } catch (e) {
    mMeldung("m-status", "fehler", esc(e.message));
    $("m-vorschau").innerHTML = "";
    return;
  }
  $("m-status").hidden = true;
  zeichneVorschau();
}

function zeichneVorschau() {
  const v = mVorschau;
  const ziel = $("m-vorschau");

  if (!v.faellig.length) {
    ziel.innerHTML = '<div class="leer"><strong>Derzeit ist niemand mahnfällig.</strong><br>' +
      (v.wartend ? mAnzahl(v.wartend, "Haushalt steht", "Haushalte stehen") +
        " unter laufender Frist. " : "") +
      (v.zuKlein ? v.zuKlein + " liegen unter der Mindestgrenze (" + lEur(v.zuKleinSumme) + "). " : "") +
      "</div>" + zeichneAusschlussHinweis(v);
    $("btn-m-start").hidden = true;
    return;
  }
  $("btn-m-start").hidden = false;

  ziel.innerHTML =
    "<p><strong>" + mAnzahl(v.faellig.length, "Haushalt", "Haushalte") +
    "</strong> mit zusammen <strong>" + lEur(v.summeCent) + "</strong> Rückstand.</p>" +
    '<div class="tabelle-scroll"><table class="schmal"><thead><tr><th>Stufe</th><th class="betrag">Anzahl</th>' +
    "<th class=\"betrag\">Summe</th></tr></thead><tbody>" +
    v.nachStufe.map((s) => '<tr><td class="name">' + esc(s.text) + '</td><td class="betrag">' +
      s.anzahl + '</td><td class="betrag">' + lEur(s.summe_cent) + "</td></tr>").join("") +
    "</tbody></table></div>" +
    (v.wartend || v.zuKlein
      ? '<p class="fussnote">Nicht dabei: ' +
        (v.wartend ? v.wartend + " unter laufender Frist" : "") +
        (v.wartend && v.zuKlein ? ", " : "") +
        (v.zuKlein ? v.zuKlein + " unter der Mindestgrenze (" + lEur(v.zuKleinSumme) + ")" : "") +
        ".</p>"
      : "") +
    "<h3>Wer gemahnt würde</h3>" +
    '<div class="tabelle-scroll"><table><thead><tr><th>Empfänger</th><th>Stufe</th>' +
    "<th>Mitglieder</th><th class=\"betrag\">Rückstand</th><th>Frist bis</th><th>Weg</th>" +
    "</tr></thead><tbody>" +
    v.faellig.slice(0, 60).map((f) =>
      "<tr><td class=\"name\">" + esc(f.empfaenger) + "</td>" +
      "<td>" + esc(M_STUFE_KURZ[f.stufe] || f.stufe) + "</td>" +
      "<td>" + esc(f.mitglieder.map((m) => m.name).join(", ")) + "</td>" +
      '<td class="betrag">' + lEur(f.offen_cent) +
        (f.gebuehr_cent ? '<br><span class="fussnote">+ ' + lEur(f.gebuehr_cent) +
          " Gebühr</span>" : "") + "</td>" +
      "<td>" + lDatum(f.frist_bis) + "</td>" +
      "<td>" + (f.email ? "E-Mail" : (f.hatAnschrift ? "Brief" :
        '<span class="fussnote warnfarbe">weder noch</span>')) + "</td></tr>").join("") +
    "</tbody></table></div>" +
    (v.faellig.length > 60 ? '<p class="fussnote">… und ' + (v.faellig.length - 60) +
      " weitere.</p>" : "") +
    zeichneAusschlussHinweis(v);
}

function zeichneAusschlussHinweis(v) {
  if (!v.ausschluss || !v.ausschluss.length) return "";
  return '<div class="hinweis warn">' +
    mAnzahl(v.ausschluss.length, "Haushalt hat", "Haushalte haben") +
    " die Anhörung bereits erhalten und wird nicht weiter gemahnt. " +
    "Sie stehen unten unter <em>Ausschluss nach § 5 Abs. 3</em>.</div>";
}

async function mahnlaufStarten() {
  const v = mVorschau;
  if (!v || !v.faellig.length) return;
  const dritte = v.faellig.filter((f) => f.stufe === 3).length;
  if (!confirm(v.faellig.length + " Mahnungen erzeugen?\n\n" +
      (dritte ? dritte + " davon sind Anhörungen vor dem Ausschluss.\n\n" : "") +
      "Verschickt wird nichts — die Briefe werden danach als Liste zum Herunterladen " +
      "bereitgestellt.")) return;

  const knopf = $("btn-m-start");
  knopf.disabled = true;
  try {
    const r = await vvRequest("vv-mahnlauf", {});
    mMeldung("m-status", "erfolg",
      "<strong>" + r.erzeugt + " Mahnungen</strong> erzeugt" +
      (r.gebuehren ? ", davon " + r.gebuehren + " mit Gebühr" : "") +
      ". Sie gelten erst als <em>schriftliche Mahnung</em> im Sinne des § 5 Abs. 3, wenn der " +
      "Versand unten bestätigt ist.");
    $("m-vorschau").innerHTML = "";
    $("btn-m-start").hidden = true;
    mVorschau = null;
    await ladeMahnungen();
    await ladeAusschluss();
    await ladeOffenePosten();
  } catch (e) {
    mMeldung("m-status", "fehler", esc(e.message));
  } finally {
    knopf.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Liste der Mahnungen
// ---------------------------------------------------------------------

async function ladeMahnungen() {
  const ziel = $("m-liste");
  ziel.innerHTML = '<div class="leer">Wird geladen …</div>';
  let antwort;
  try {
    antwort = await vvRequest("vv-mahnungen", { auch_erledigte: $("m-auch-erledigte").checked });
  } catch (e) {
    ziel.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  mListe = antwort.mahnungen || [];

  if (!mListe.length) {
    ziel.innerHTML = '<div class="leer">Keine Mahnungen.</div>';
    return;
  }

  const offenerVersand = {};
  mListe.forEach((m) => {
    if (!m.versendet_am && !m.erledigt_am) {
      offenerVersand[m.stufe] = (offenerVersand[m.stufe] || 0) + 1;
    }
  });

  ziel.innerHTML =
    Object.keys(offenerVersand).map((st) =>
      '<div class="hinweis warn">' + offenerVersand[st] + " × " + esc(M_STUFE_KURZ[st] || st) +
      (offenerVersand[st] === 1 ? " ist" : " sind") +
      " erzeugt, aber noch nicht als versendet bestätigt. Erst der Versand macht daraus eine " +
      "schriftliche Mahnung — die Stufenzählung des § 5 Abs. 3 hängt daran." +
      (antwort.darfBuchen
        ? ' <button class="btn klein" data-brief="' + esc(st) + '">Briefe herunterladen</button>' +
          ' <button class="btn grau klein" data-versendet="' + esc(st) + '">Versand bestätigen</button>'
        : "") +
      "</div>").join("") +
    '<div class="tabelle-scroll"><table><thead><tr>' +
    "<th>Empfänger</th><th>Stufe</th><th>Erstellt</th><th>Frist</th><th class=\"betrag\">Rückstand damals</th>" +
    "<th class=\"betrag\">heute offen</th><th>Versand</th>" + (antwort.darfBuchen ? "<th></th>" : "") +
    "</tr></thead><tbody>" +
    mListe.map((m) =>
      '<tr' + (m.erledigt_am ? ' class="erledigt"' : "") + ">" +
      '<td class="name">' + esc(m.empfaenger) + "</td>" +
      "<td>" + esc(M_STUFE_KURZ[m.stufe] || m.stufe) + "</td>" +
      "<td>" + lDatum(m.erstellt_datum) + "</td>" +
      "<td" + (m.frist_abgelaufen ? ' class="ueberfaellig"' : "") + ">" + lDatum(m.frist_bis) + "</td>" +
      '<td class="betrag">' + lEur(m.summe_cent) + "</td>" +
      '<td class="betrag">' + (m.erledigt_am ? "—" : lEur(m.aktuell_offen)) + "</td>" +
      "<td>" + (m.erledigt_am
        ? '<span class="chip bezahlt">erledigt</span>'
        : (m.versendet_am
            ? lDatum(m.versendet_am) + '<br><span class="fussnote">' + esc(m.versand_art) + "</span>"
            : '<span class="chip offen">nicht versendet</span>')) + "</td>" +
      (antwort.darfBuchen
        ? "<td>" + (m.erledigt_am ? "" :
            '<button class="btn grau klein" data-erledigt="' + esc(m.id) + '">abschließen</button>') +
          "</td>"
        : "") +
      "</tr>").join("") +
    "</tbody></table></div>";

  ziel.querySelectorAll("[data-brief]").forEach((b) => {
    b.addEventListener("click", () => ladeBriefe(Number(b.dataset.brief)));
  });
  ziel.querySelectorAll("[data-versendet]").forEach((b) => {
    b.addEventListener("click", () => versandBestaetigen(Number(b.dataset.versendet)));
  });
  ziel.querySelectorAll("[data-erledigt]").forEach((b) => {
    b.addEventListener("click", () => mahnungAbschliessen(b.dataset.erledigt));
  });
}

// ---------------------------------------------------------------------
// Serienbrief
// ---------------------------------------------------------------------

async function ladeBriefe(stufe) {
  let b;
  try {
    b = await vvRequest("vv-mahnung-brief", { stufe });
  } catch (e) {
    mMeldung("m-status", "fehler", esc(e.message));
    return;
  }
  if (!b.anzahl) {
    mMeldung("m-status", "info", "Keine unversendeten Schreiben dieser Stufe.");
    return;
  }

  // Zwei Dateien: eine Adressliste zum Seriendruck und ein fertiger Text
  // je Empfänger. Der Text nennt die Einzelposten — eine Mahnung ohne
  // Aufstellung, wofür gemahnt wird, kann niemand prüfen.
  const kopf = ["Empfaenger", "Strasse", "PLZ", "Ort", "EMail", "Stufe",
                "Datum", "FristBis", "Summe", "Posten"];
  const csv = "﻿" + [kopf].concat(b.briefe.map((x) => [
    x.empfaenger, x.strasse, x.plz, x.ort, x.email, x.stufe_text,
    x.erstellt_datum, x.frist_bis,
    (x.summe_cent / 100).toFixed(2).replace(".", ","),
    x.posten.map((p) => p.bezeichnung + " (Nr. " + p.nr + ", fällig " + p.faellig_am + "): " +
      (p.rest_cent / 100).toFixed(2).replace(".", ",") + " EUR").join(" | ")
  ])).map((r) => r.map((f) => '"' + String(f === null || f === undefined ? "" : f)
    .replace(/"/g, '""') + '"').join(";")).join("\r\n");

  const text = b.briefe.map((x) =>
    x.empfaenger + "\n" + x.strasse + "\n" + x.plz + " " + x.ort + "\n\n" +
    b.verein + ", " + lDatum(x.erstellt_datum) + "\n\n" +
    x.stufe_text + "\n\n" +
    (x.stufe === 3
      ? "vor einer Entscheidung des Vorstands über den Ausschluss aus dem Verein geben wir Ihnen " +
        "nach § 5 Abs. 3 der Satzung Gelegenheit zur Äußerung. Trotz zweier schriftlicher " +
        "Mahnungen sind folgende Beiträge offen:"
      : "trotz " + (x.stufe === 2 ? "unserer Mahnung " : "Fälligkeit ") +
        "sind folgende Beiträge noch offen:") + "\n\n" +
    x.posten.map((p) => "  " + p.name + " (Nr. " + p.nr + "), " + p.bezeichnung +
      ", fällig am " + lDatum(p.faellig_am) + ": " +
      (p.rest_cent / 100).toFixed(2).replace(".", ",") + " EUR").join("\n") + "\n\n" +
    "  Summe: " + (x.summe_cent / 100).toFixed(2).replace(".", ",") + " EUR\n\n" +
    (x.stufe === 3
      ? "Bitte äußern Sie sich bis zum " + lDatum(x.frist_bis) + ". Geht bis dahin keine Zahlung " +
        "und keine Stellungnahme ein, legen wir den Vorgang dem Vorstand zur Entscheidung vor."
      : "Wir bitten um Ausgleich bis zum " + lDatum(x.frist_bis) + ".") + "\n\n" +
    (x.stufe === 2
      ? "Sollte auch diese Frist verstreichen, werden wir Sie nach § 5 Abs. 3 der Satzung anhören " +
        "und den Vorgang dem Vorstand vorlegen.\n\n"
      : "") +
    "Mit freundlichen Grüßen\n" + b.verein +
    "\n\n" + "-".repeat(70) + "\n\n").join("");

  const csvUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const txtUrl = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const ohneAnschrift = b.briefe.filter((x) => !x.strasse || !x.ort).length;

  mMeldung("m-status", "info",
    "<strong>" + b.anzahl + " Schreiben</strong> vorbereitet.<br>" +
    '<a class="btn" download="Mahnungen-Stufe' + stufe + '.csv" href="' + csvUrl +
    '">Adressliste (CSV)</a> ' +
    '<a class="btn grau" download="Mahnungen-Stufe' + stufe + '.txt" href="' + txtUrl +
    '">Brieftexte (TXT)</a><br>' +
    (ohneAnschrift
      ? '<span class="fussnote">Achtung: bei ' + ohneAnschrift + " Empfängern fehlt die " +
        "Anschrift. Eine Mahnung, die nicht zugestellt werden kann, zählt nicht.</span><br>"
      : "") +
    '<span class="fussnote">Nach dem Versand hier den Versand bestätigen — vorher zählt die ' +
    "Mahnung nicht.</span>");
}

async function versandBestaetigen(stufe) {
  const datum = prompt("An welchem Tag wurden die Schreiben verschickt?\n\n" +
    "Erst dieses Datum macht aus der erzeugten Mahnung eine schriftliche Mahnung im Sinne " +
    "des § 5 Abs. 3 — die Frist läuft ab hier.", lHeute());
  if (!datum) return;
  try {
    const r = await vvRequest("vv-mahnung-versendet", { stufe, versendet_am: datum });
    await ladeMahnungen();
    await ladeAusschluss();
    mMeldung("m-status", "erfolg", r.anzahl + " Schreiben als versendet vermerkt.");
  } catch (e) {
    mMeldung("m-status", "fehler", esc(e.message));
  }
}

async function mahnungAbschliessen(id) {
  const grund = prompt("Warum wird diese Mahnung abgeschlossen?\n\n" +
    "Bezahlte Rückstände schließen sich von selbst — das hier ist für Sonderfälle, " +
    "etwa eine Stundung oder einen Irrtum.");
  if (grund === null) return;
  try {
    await vvRequest("vv-mahnung-erledigt", { id, grund });
    await ladeMahnungen();
    await ladeAusschluss();
  } catch (e) {
    mMeldung("m-status", "fehler", esc(e.message));
  }
}

// ---------------------------------------------------------------------
// Ausschluss-Vorlage
// ---------------------------------------------------------------------

async function ladeAusschluss() {
  const ziel = $("m-ausschluss");
  let a;
  try {
    a = await vvRequest("vv-ausschluss-kandidaten", {});
  } catch (e) {
    ziel.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }

  if (!a.kandidaten.length && !a.nochNicht.length) {
    ziel.innerHTML = '<div class="leer">Es läuft kein Ausschlussverfahren.</div>';
    return;
  }

  ziel.innerHTML =
    (a.kandidaten.length
      ? '<div class="hinweis warn"><strong>' +
        mAnzahl(a.kandidaten.length, "Mitglied", "Mitglieder") + "</strong> " +
        (a.kandidaten.length === 1 ? "erfüllt" : "erfüllen") +
        " alle drei Voraussetzungen: zwei versendete Mahnungen, versendete Anhörung, " +
        "Frist abgelaufen, Rückstand weiterhin offen. Der Vorstand kann entscheiden.</div>" +
        '<div class="tabelle-scroll"><table><thead><tr><th>Nr.</th><th>Name</th>' +
        "<th class=\"betrag\">Rückstand</th><th>Anhörungsfrist lief bis</th></tr></thead><tbody>" +
        a.kandidaten.map((k) => "<tr><td>" + esc(k.mitgliedsnummer || "—") +
          '</td><td class="name">' + esc(k.name || "—") + '</td><td class="betrag">' +
          lEur(k.offen_cent) + "</td><td>" + lDatum(k.frist_bis) + "</td></tr>").join("") +
        "</tbody></table></div>" +
        '<p class="fussnote">Beschließt der Vorstand den Ausschluss, wird er beim Mitglied unter ' +
        "<em>Mitglieder</em> eingetragen, Grund &bdquo;Ausschluss&ldquo;. Der endet sofort, " +
        "nicht erst zum " +
        "30.06. oder 31.12.; die Frist des § 5 Abs. 2 gilt nur für den Austritt auf eigenen " +
        "Wunsch.</p>"
      : "") +
    (a.nochNicht.length
      ? "<h3>Verfahren läuft — noch nicht entscheidungsreif</h3>" +
        '<div class="tabelle-scroll"><table><thead><tr><th>Nr.</th><th>Name</th>' +
        "<th class=\"betrag\">Rückstand</th><th>Was noch fehlt</th></tr></thead><tbody>" +
        a.nochNicht.slice(0, 60).map((k) => "<tr><td>" + esc(k.mitgliedsnummer || "—") +
          '</td><td class="name">' + esc(k.name || "—") + '</td><td class="betrag">' +
          lEur(k.offen_cent) + "</td><td>" + esc(mGrund(k)) + "</td></tr>").join("") +
        "</tbody></table></div>" +
        (a.nochNicht.length > 60 ? '<p class="fussnote">… und ' + (a.nochNicht.length - 60) +
          " weitere.</p>" : "")
      : "");
}

// ---------------------------------------------------------------------

function mahnungVerdrahten() {
  $("btn-m-probe").addEventListener("click", mahnProbe);
  $("btn-m-start").addEventListener("click", mahnlaufStarten);
  $("btn-m-neu-laden").addEventListener("click", ladeMahnungen);
  $("m-auch-erledigte").addEventListener("change", ladeMahnungen);
}
