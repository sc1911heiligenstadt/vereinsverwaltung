// Papierantrag zum Abheften -- vier Blätter im Aufbau des gedruckten
// Vereinsformulars, gefüllt aus einem eingegangenen Online-Antrag.
//
// Diese Datei wird von ZWEI Seiten geladen: vom Reiter "Anträge" der
// Verwaltung (antraege.js) und vom Sicht-Reiter des öffentlichen
// Formulars (antrag.js). Sie ist deshalb bewusst eigenständig und
// bringt ihre eigenen Helfer mit (pEsc/pDatum) -- eine zweite Kopie in
// der anderen Datei liefe nach der ersten Änderung auseinander, und die
// beiden Ausdrucke müssten am Ende dasselbe Blatt ergeben.
//
// ⚠️ Der Datenschutz-Abschnitt gibt die Erklärungen wieder, die der
// Antragsteller WIRKLICH abgegeben hat -- die drei Häkchen mitsamt ihrer
// Antwort. Er übernimmt NICHT den Wortlaut des Papierbogens: dann stünde
// auf dem Ausdruck eine Einwilligung, die so nie erteilt wurde. Das
// Layout darf dem Papier gleichen, der Inhalt muss dem Vorgang folgen.

function pEsc(wert) {
  return String(wert === null || wert === undefined ? "" : wert)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pDatum(iso) {
  if (!iso) return "";
  const t = String(iso).slice(0, 10).split("-");
  return t.length === 3 ? t[2] + "." + t[1] + "." + t[0] : String(iso);
}

function pZeile(was, wert) {
  return "<tr><th>" + pEsc(was) + "</th><td>" + pEsc(wert || "") + "</td></tr>";
}

function pUnterschrift(titel, bild, ortDatum) {
  return '<div class="sig">' +
    (bild ? '<img src="' + pEsc(bild) + '" alt="">' : '<div class="sig-leer"></div>') +
    '<div class="sig-linie"></div>' +
    '<div class="sig-text"><span>' + pEsc(ortDatum || "") + "</span><span>" +
    pEsc(titel) + "</span></div></div>";
}

// Die Vereins-Bankverbindung steht in der Datenbank, nicht im Code --
// dieses Repo ist öffentlich. Fehlen die Stammdaten noch, bleibt die
// Zeile kürzer statt falsch dazustehen.
function pFusszeile(e) {
  const cfg = e || {};
  const teile = [];
  if (cfg.verein_iban) {
    teile.push("IBAN: " + cfg.verein_iban + (cfg.verein_bic ? ", BIC: " + cfg.verein_bic : ""));
  }
  if (cfg.glaeubiger_id) teile.push("Gläubiger-ID: " + cfg.glaeubiger_id);
  return '<div class="fuss">' + pEsc(cfg.verein_name || "1. SC 1911 Heiligenstadt e.V.") +
    (teile.length ? "<br>" + pEsc(teile.join(" · ")) : "") + "</div>";
}

const PAPIER_STIL =
  "@page { size: A4; margin: 18mm 16mm; }" +
  "body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #000; margin: 0; }" +
  ".blatt { page-break-after: always; position: relative; min-height: 245mm; }" +
  ".blatt:last-child { page-break-after: auto; }" +
  ".briefkopf { border-bottom: 2px solid #282562; padding-bottom: 6px; margin-bottom: 14px; }" +
  ".marke { font-size: 15pt; font-weight: 700; color: #282562; line-height: 1.2; }" +
  ".sparten-zeile { font-size: 9pt; letter-spacing: .06em; color: #444; margin-top: 3px; }" +
  "h1 { font-size: 17pt; margin: 16px 0 10px; }" +
  "h2 { font-size: 12pt; margin: 16px 0 8px; }" +
  "h3 { font-size: 11pt; margin: 12px 0 6px; }" +
  "p { margin: 6px 0; line-height: 1.45; }" +
  ".zeile { margin: 10px 0; }" +
  ".wert { display: inline-block; min-width: 55%; border-bottom: 1px solid #000; " +
  "        padding: 0 4px 1px; font-weight: 600; }" +
  ".klein { font-size: 9pt; color: #444; }" +
  "table { width: 100%; border-collapse: collapse; margin: 8px 0 4px; }" +
  "th, td { border: 1px solid #000; padding: 5px 7px; text-align: left; " +
  "         vertical-align: top; font-size: 10.5pt; }" +
  "th { width: 34%; font-weight: 400; background: #f2f2f4; }" +
  "td { font-weight: 600; }" +
  ".kasten { border: 1px solid #000; padding: 10px; margin: 10px 0; }" +
  ".sig { margin: 26px 0 10px; max-width: 320px; }" +
  ".sig img { display: block; height: 60px; margin-bottom: 2px; }" +
  ".sig-leer { height: 60px; }" +
  ".sig-linie { border-top: 1px solid #000; }" +
  ".sig-text { display: flex; justify-content: space-between; gap: 12px; " +
  "            font-size: 8.5pt; color: #333; padding-top: 3px; }" +
  ".auszug { margin-top: 20px; border-top: 1px solid #999; padding-top: 10px; font-size: 10pt; }" +
  ".fuss { position: absolute; bottom: 0; left: 0; right: 0; font-size: 7.5pt; " +
  "        color: #333; border-top: 1px solid #999; padding-top: 4px; }";

// Baut das vollständige Dokument. Getrennt vom Öffnen, damit es sich ohne
// Fenster prüfen lässt -- der Prüfstand ruft genau diese Funktion.
//
// opt: { antrag, sparten, einstellungen, mitgliedsnummer }
function papierAntragHtml(opt) {
  const a = opt.antrag || {};
  const i = a.inhalt || {};
  const spartenNamen = (opt.sparten || [])
    .filter((s) => (a.sparten || []).includes(s.id)).map((s) => s.name).join(", ");

  const ortDatum = (i.unterschrift_ort || i.ort || "") + ", " +
                   pDatum(a.signatur_zeit || a.eingang_am);
  const nummer = opt.mitgliedsnummer || "";
  const lastschrift = i.zahlungsart === "lastschrift";

  // Bei Minderjährigen trägt das Mandat die Unterschrift des gesetzlichen
  // Vertreters -- genau wie handleAntragAnnehmen es wählt.
  const mandatSig = i.minderjaehrig ? a.unterschrift_gesetzl : a.unterschrift;

  const seite1 =
    '<div class="blatt">' +
    '<div class="briefkopf"><div class="marke">1.Sportclub 1911<br>Heiligenstadt e.V.</div>' +
    '<div class="sparten-zeile">Fußball _ Reha-Sport _ Breitensport</div></div>' +
    "<h1>Aufnahmeantrag</h1>" +
    "<p>Hiermit beantrage ich für mich bzw. für nachstehendes Familienmitglied die " +
    "Mitgliedschaft beim 1. SC 1911 Heiligenstadt e.&nbsp;V.</p>" +
    '<p class="zeile">Mitgliedsnummer: <span class="wert">' + pEsc(nummer) +
    '</span> <span class="klein">(wird vom Verein vergeben)</span></p>' +
    '<p class="zeile">Gewünschte Sportart: <span class="wert">' + pEsc(spartenNamen) + "</span></p>" +
    "<h2>1. Beantragte Mitgliedschaft für:</h2>" +
    "<table>" +
    pZeile("Vorname", i.vorname) +
    pZeile("Name", i.nachname) +
    pZeile("Geb.-Datum", pDatum(i.geburtsdatum)) +
    pZeile("Geburtsort", i.geburtsort) +
    pZeile("PLZ, Ort", [i.plz, i.ort].filter(Boolean).join(" ")) +
    pZeile("Straße + Hausnummer", i.strasse) +
    pZeile("Tel. privat", i.telefon) +
    pZeile("Handy", i.mobil) +
    pZeile("E-Mail", i.email) +
    "</table>" +
    "<h2>2. Aus meiner Familie ist/sind bereits Mitglied beim 1. SC:</h2>" +
    '<p class="zeile">Name, Vorname: <span class="wert">' + pEsc(i.familie_hinweis || "—") + "</span></p>" +
    pFusszeile(opt.einstellungen) + "</div>";

  const seite2 =
    '<div class="blatt">' +
    "<h2>3. SEPA-Basislastschriftmandat für wiederkehrende Zahlungen</h2>" +
    (lastschrift
      ? "<p>1. SC 1911 Heiligenstadt e.&nbsp;V., Leineberg 2, 37308 Heilbad Heiligenstadt" +
        (opt.einstellungen && opt.einstellungen.glaeubiger_id
          ? "<br>Gläubiger-Identifikationsnummer " + pEsc(opt.einstellungen.glaeubiger_id) : "") +
        "</p>" +
        "<p>Ich ermächtige den 1. SC 1911 Heiligenstadt e.&nbsp;V., Zahlungen von meinem Konto " +
        "einmal jährlich mittels Lastschrift einzuziehen. Zugleich weise ich mein Kreditinstitut " +
        "an, die vom 1. SC 1911 Heiligenstadt e.&nbsp;V. auf mein Konto gezogenen Lastschriften " +
        "einzulösen.</p>" +
        "<p>Hinweis: Ich kann innerhalb von acht Wochen, beginnend mit dem Belastungsdatum, die " +
        "Erstattung des belasteten Betrages verlangen. Es gelten dabei die mit meinem " +
        "Kreditinstitut vereinbarten Bedingungen.</p>" +
        "<table>" +
        pZeile("Kontoinhaber", i.kontoinhaber) +
        pZeile("Adresse (wenn abweichend)", i.kontoinhaber_anschrift) +
        pZeile("Kreditinstitut", i.bank_name) +
        pZeile("IBAN", i.iban) +
        pZeile("BIC", i.bic) +
        "</table>" +
        pUnterschrift("Unterschrift Kontoinhaber", mandatSig, ortDatum)
      : '<div class="kasten">Es wurde <strong>keine Lastschrift</strong>, sondern Zahlung ' +
        "per Überweisung gewählt. Ein SEPA-Mandat liegt deshalb nicht vor.</div>") +
    pFusszeile(opt.einstellungen) + "</div>";

  const ja = (wert) => (wert ? "ja" : "nein");
  const seite3 =
    '<div class="blatt">' +
    "<h2>4. Erklärungen zum Datenschutz</h2>" +
    '<p class="klein">Wiedergegeben sind die Erklärungen, die im Online-Formular ' +
    "abgegeben wurden — mit der jeweils angekreuzten Antwort.</p>" +
    "<table>" +
    pZeile("Satzung und Beitragsordnung anerkannt", ja(i.einwilligung_satzung)) +
    pZeile("Speicherung zur Mitglieder- und Beitragsverwaltung sowie Meldung an " +
           "Landessportbund und Fachverbände", ja(i.einwilligung_datenschutz)) +
    pZeile("Veröffentlichung von Fotos von Vereinsveranstaltungen (freiwillig)",
           ja(i.einwilligung_fotos)) +
    "</table>" +
    "<p>Die Erhebung, Verarbeitung und Nutzung personenbezogener Daten erfolgt nach der " +
    "Datenschutz-Grundverordnung und dem Bundesdatenschutzgesetz. Über die Verarbeitung " +
    "wurde vor der Abgabe der Erklärungen nach Art. 13 DSGVO informiert; der Text ist Teil " +
    "des Online-Formulars. Bei Beendigung der Mitgliedschaft werden die Daten gelöscht, " +
    "soweit keine steuerrechtlichen Aufbewahrungsfristen entgegenstehen. Es besteht ein " +
    "Recht auf Auskunft und Berichtigung; erteilte Einwilligungen sind jederzeit mit " +
    "Wirkung für die Zukunft widerrufbar.</p>" +
    pUnterschrift(i.minderjaehrig
      ? "Unterschrift gesetzlicher Vertreter" : "Unterschrift Mitglied",
      i.minderjaehrig ? a.unterschrift_gesetzl : a.unterschrift, ortDatum) +
    pFusszeile(opt.einstellungen) + "</div>";

  const seite4 =
    '<div class="blatt">' +
    "<h2>5. Die Satzung des 1. SC 1911 Heiligenstadt e.&nbsp;V.</h2>" +
    "<p>habe ich zur Kenntnis erhalten und erkenne diese an.</p>" +
    pUnterschrift("Unterschrift Antragsteller", a.unterschrift, ortDatum) +
    (i.minderjaehrig
      ? pUnterschrift("bei Minderjährigen: " + (i.gesetzl_name || "gesetzlicher Vertreter"),
                      a.unterschrift_gesetzl, ortDatum) +
        (a.unterschrift_gesetzl2
          ? pUnterschrift("zweiter Erziehungsberechtigter: " + (i.gesetzl2_name || ""),
                          a.unterschrift_gesetzl2, ortDatum)
          : '<p class="klein">Eine zweite Unterschrift liegt nicht vor: es wurde ' +
            "<strong>alleiniges Sorgerecht</strong> erklärt.</p>")
      : "") +
    '<div class="auszug">' +
    "<h3>Auszug aus der Satzung §§ 4, 5, 7</h3>" +
    "<p><strong>§ 4 Abs. 1 Erwerb der Mitgliedschaft.</strong> Wer die Mitgliedschaft erwerben " +
    "will, hat an den Gesamtvorstand einen schriftlichen Antrag zu stellen.</p>" +
    "<p><strong>§ 5 Abs. 2 Beendigung der Mitgliedschaft.</strong> Der Austritt eines " +
    "ordentlichen Mitgliedes erfolgt durch schriftliche Erklärung an den Gesamtvorstand " +
    "halbjährlich zum 30.06. bzw. 31.12. eines Jahres mit vierwöchiger Kündigungsfrist.</p>" +
    "<p><strong>§ 7 Abs. 1 Beiträge und Dienstleistungen.</strong> Die ordentlichen Mitglieder " +
    "sind zur Entrichtung von Mitgliedsbeiträgen verpflichtet.</p>" +
    "<h3>Beitragsordnung gültig ab 01.01.2024</h3>" +
    "<table>" +
    pZeile("Erwachsene", "8,00 €/Monat") +
    pZeile("Rentner, Schwerbehinderte", "6,00 €/Monat") +
    pZeile("Kinder, Jugendliche", "6,00 €/Monat") +
    pZeile("Familienbeitrag", "1 Vollzahler (höchster Einzelbetrag), " +
           "jedes weitere Familienmitglied 50 % des Einzelbeitrags") +
    "</table></div>" +
    pFusszeile(opt.einstellungen) + "</div>";

  return "<!DOCTYPE html><html lang=\"de\"><head><meta charset=\"utf-8\">" +
    "<title>Aufnahmeantrag " + pEsc((i.vorname || "") + " " + (i.nachname || "")) + "</title>" +
    "<style>" + PAPIER_STIL + "</style></head><body>" +
    seite1 + seite2 + seite3 + seite4 +
    // Der Druckbefehl steht IM erzeugten Dokument, nicht als w.onload von
    // außen: nach document.write() ist das Fenster je nach Browser bereits
    // "geladen", und ein von außen gesetztes onload feuert dann nie. Erst
    // das eigene load-Event garantiert, dass die Unterschriftsbilder
    // gezeichnet sind -- sonst druckt es eine leere Fläche.
    "<script>window.addEventListener('load',function(){window.print();});<\/script>" +
    "</body></html>";
}

// ⚠️ window.open steht bewusst VOR jedem await -- alle Daten liegen schon
// vor. Nach einem await blockt iOS-Safari das Fenster lautlos.
function papierAntragOeffnen(opt) {
  const w = window.open("", "_blank");
  if (!w) {
    alert("Der Ausdruck konnte nicht geöffnet werden — bitte den Popup-Blocker für diese " +
          "Seite erlauben.");
    return false;
  }
  w.document.write(papierAntragHtml(opt));
  w.document.close();
  return true;
}
