// Bestandsuebernahme aus GLS Vereinsmeister.
//
// Bewusst OHNE Kenntnis des Quellformats gebaut: Es gibt keinen
// Probeexport der Altsoftware, und raten waere die schlechtere Wette als
// zuordnen lassen. Der Ablauf ist deshalb immer derselbe, egal was in der
// Datei steht: einlesen -> Spalten zuordnen -> Probelauf -> schreiben.
//
// Drei Zusagen, ohne die ein Import ueber 2500 Zeilen nicht taugt:
//
//   1. NICHTS GEHT VERLOREN. Was keinem Feld zugeordnet ist, landet als
//      Zusatzangabe beim Mitglied. Auch Spalten, deren Bedeutung heute
//      niemand kennt, sind nach dem Import noch da.
//   2. NICHTS WIRD GESCHRIEBEN, BEVOR DER PROBELAUF DURCH IST. Der
//      Probelauf laeuft ueber ALLE Zeilen und meldet, was scheitern
//      wuerde -- nicht ueber eine Stichprobe.
//   3. WIEDERHOLBAR. Bricht der Import in der Mitte ab, kann er erneut
//      gestartet werden. Bereits angelegte Mitgliedsnummern werden
//      uebersprungen statt doppelt angelegt.

let impDatei = null;      // { spalten: [], zeilen: [[...]], name }
let impZuordnung = {};    // Spaltenindex -> Zielfeld | "zusatz" | "weg"
let impGeprueft = false;

// Zielfelder mit Erkennungsmustern. Die Muster sind bewusst weit gefasst
// und duerfen sich ueberschneiden -- die erste Spalte, die passt, gewinnt,
// und die Zuordnung ist ohnehin von Hand korrigierbar.
const ZIELFELDER = [
  { feld: "mitgliedsnummer", text: "Mitgliedsnummer", muster: /mitgl.*(nr|nummer)|^nr\.?$|^nummer$|mgnr/ },
  { feld: "vorname",      text: "Vorname",            muster: /vorname|rufname/ },
  { feld: "nachname",     text: "Nachname",           muster: /nachname|familienname|zuname|^name$/ },
  { feld: "geburtsdatum", text: "Geburtsdatum",       muster: /geb/ },
  { feld: "geschlecht",   text: "Geschlecht",         muster: /geschlecht|anrede/ },
  { feld: "strasse",      text: "Straße",             muster: /stra|str\.|anschrift|adresse/ },
  { feld: "plz",          text: "PLZ",                muster: /plz|postleit/ },
  { feld: "ort",          text: "Ort",                muster: /^ort|wohnort|stadt/ },
  { feld: "email",        text: "E-Mail",             muster: /mail/ },
  { feld: "telefon",      text: "Telefon",            muster: /telefon|festnetz|^tel/ },
  { feld: "mobil",        text: "Mobil",              muster: /mobil|handy/ },
  { feld: "eintritt",     text: "Eintritt",           muster: /eintritt|beitritt|mitglied seit|^seit/ },
  { feld: "austritt",     text: "Austritt",           muster: /austritt|ausgetreten/ },
  { feld: "status",       text: "Status",             muster: /status/ },
  // "Beitragsart" ist bewusst NICHT hier: "Erwachsener" oder "Rentner"
  // ist eine Beitragsklasse, nicht die Mitgliedsart nach § 3 der Satzung.
  // Sie landet als Zusatzangabe und ist damit fuer die Beitragsstufe da.
  { feld: "art",          text: "Mitgliedsart",       muster: /mitgliedsart|^art$|^typ$/ },
  { feld: "sparten",      text: "Sparten (mehrere durch ; getrennt)", muster: /sparte|abteilung|sektion/ },
  { feld: "iban",         text: "IBAN",               muster: /iban/ },
  { feld: "bic",          text: "BIC",                muster: /bic|swift/ },
  { feld: "kontoinhaber", text: "Kontoinhaber",       muster: /kontoinhaber|inhaber/ },
  { feld: "mandatsreferenz", text: "SEPA-Mandatsreferenz", muster: /mandat/ },
  { feld: "bemerkung",    text: "Bemerkung",          muster: /bemerk|notiz|hinweis|memo/ }
];

// ---------------------------------------------------------------------
// Sonderfall: die Listen aus GLS Vereinsmeister
// ---------------------------------------------------------------------
//
// Was der Vereinsmeister ausgibt, ist KEIN Datenexport, sondern eine zum
// Drucken gesetzte Liste, die in eine Tabelle gekippt wurde. Ein Mitglied
// steht nicht in Spalten, sondern in vier Zellen mit Zeilenumbruechen:
//
//   Anschrift:  "Herr \n Erika Mustermann \n Musterweg 1 \n
//                12345 Musterstadt \n \n 1"
//   Etiketten:  "Festnetz privat \n Mobil privat \n EMail \n ..."
//   Werte:      " \n 0170/1234567 \n erika@example.invalid \n ..."
//
// Ein Spaltenzuordner kann damit nichts anfangen. Deshalb wird das Format
// erkannt und in echte Spalten aufgeloest, BEVOR die Zuordnung greift --
// danach laeuft alles weiter wie bei einer normalen Datei.
//
// Die Etiketten sind NICHT von Zeile zu Zeile gleich (mal "Festnetz
// geschaeftlich", mal ein zweites "Mobil privat", bei 40 Mitgliedern
// "BLZ/Konto" statt "BIC/IBAN"). Es wird deshalb je Zeile ueber die
// Etiketten gepaart, nie ueber feste Positionen.

const VM_ETIKETTEN = {
  "geb.datum": "Geb.Datum", "geburtsdatum": "Geb.Datum",
  "eintritt": "Eintritt", "austritt": "Austritt", "status": "Status",
  "festnetz privat": "Telefon", "mobil privat": "Mobil", "email": "EMail",
  "e-mail": "EMail", "iban": "IBAN", "bic": "BIC"
};

function vmZeilen(text) {
  return String(text === null || text === undefined ? "" : text).split("\n").map((z) => z.trim());
}

// Findet in einer Rasterzeile die vier tragenden Zellen. Gibt null
// zurueck, wenn es keine Mitgliedszeile ist -- Seitenkoepfe, Trennzeilen
// und der Berichtstitel fallen damit von selbst heraus.
function vmZeileZerlegen(zeile) {
  const belegt = [];
  zeile.forEach((wert, i) => {
    if (String(wert === null || wert === undefined ? "" : wert).trim() !== "") belegt.push({ i, text: String(wert) });
  });
  if (belegt.length < 3) return null;

  const zusatzEtikett = belegt.find((z) => /Geb\.?\s?Datum/i.test(z.text) && z.text.indexOf("\n") > -1);
  if (!zusatzEtikett) return null;

  const zusatzWerte = belegt.find((z) => z.i > zusatzEtikett.i);
  const linksDavon = belegt.filter((z) => z.i < zusatzEtikett.i);

  const kontaktEtikett = linksDavon.find((z) => /Festnetz|Mobil privat|EMail/i.test(z.text));
  // Die Wertespalte des Kontaktblocks kann leer aussehen ("\n\n\n") und
  // ist trotzdem die richtige -- entscheidend ist nur, dass sie rechts vom
  // Etikett und links vom Zusatzblock steht.
  const kontaktWerte = kontaktEtikett
    ? linksDavon.find((z) => z.i > kontaktEtikett.i)
    : null;

  const anschrift = linksDavon.find((z) => z.text.indexOf("\n") > -1
    && (!kontaktEtikett || z.i < kontaktEtikett.i));
  if (!anschrift) return null;

  return { anschrift: anschrift.text, kontaktEtikett, kontaktWerte, zusatzEtikett, zusatzWerte };
}

// Etiketten und Werte paaren. Kommt ein Etikett doppelt vor, gewinnt der
// erste nicht leere Wert -- sonst ueberschreibt ein leeres zweites
// "Mobil privat" die vorher gefundene Nummer.
function vmPaare(etikettZelle, werteZelle, ziel) {
  const e = vmZeilen(etikettZelle && etikettZelle.text);
  const w = vmZeilen(werteZelle && werteZelle.text);
  e.forEach((etikett, i) => {
    if (!etikett) return;
    const wert = w[i] || "";
    if (!wert) return;
    const name = VM_ETIKETTEN[etikett.toLowerCase()] || etikett;
    if (!ziel[name]) ziel[name] = wert;
  });
}

const VM_ANREDEN = /^(herr|frau|firma|familie)$/i;
const VM_TITEL = /^(dr|prof|dipl|ing|mag)\b\.?/i;

// Der Anschriftsblock in seine Bestandteile. Zwei echte Sonderfaelle aus
// den Dateien, die beide toleriert werden muessen:
//   - Strasse und Ort in EINER Zeile
//   - eine zusaetzliche Titelzeile zwischen Name und Strasse
function vmAnschrift(text, ziel) {
  let zeilen = vmZeilen(text);

  // Mitgliedsnummer: entweder "Mitgl-Nr.: 12" oder als eigene Zahlzeile
  // ganz am Ende. Beide Fassungen kommen vor.
  for (let i = zeilen.length - 1; i >= 0; i--) {
    const m = zeilen[i].match(/Mitgl[.-]?\s?Nr\.?:?\s*(\d+)/i);
    if (m) { ziel.Mitgliedsnummer = m[1]; zeilen.splice(i, 1); break; }
    if (/^\d{1,6}$/.test(zeilen[i])) { ziel.Mitgliedsnummer = zeilen[i]; zeilen.splice(i, 1); break; }
  }
  zeilen = zeilen.filter(Boolean);
  if (!zeilen.length) return;

  if (VM_ANREDEN.test(zeilen[0])) { ziel.Anrede = zeilen.shift(); }
  if (!zeilen.length) return;

  ziel.Name = zeilen.shift();

  if (zeilen.length && VM_TITEL.test(zeilen[0])) { ziel.Titel = zeilen.shift(); }

  // Ortszeile von hinten suchen -- die Strasse kann Ziffern enthalten,
  // der Ort steht aber immer hinter einer fuenfstelligen Postleitzahl.
  let ortIndex = -1;
  for (let i = zeilen.length - 1; i >= 0; i--) {
    if (/^\d{5}\s+\S/.test(zeilen[i])) { ortIndex = i; break; }
  }

  if (ortIndex >= 0) {
    const m = zeilen[ortIndex].match(/^(\d{5})\s+(.+)$/);
    ziel.PLZ = m[1];
    ziel.Ort = m[2];
    ziel.Strasse = zeilen.slice(0, ortIndex).join(" ");
    return;
  }

  // Kein eigener Ort: steht die Postleitzahl mitten in der Strassenzeile,
  // wird dort getrennt.
  const zusammen = zeilen.join(" ");
  const m = zusammen.match(/^(.*?)\s+(\d{5})\s+(.+)$/);
  if (m) { ziel.Strasse = m[1]; ziel.PLZ = m[2]; ziel.Ort = m[3]; return; }

  // Postleitzahl am Zeilenende ohne Ort dahinter. Kommt vor; die PLZ
  // gehoert trotzdem ins PLZ-Feld und nicht in die Strasse.
  const m2 = zusammen.match(/^(.*?)\s+(\d{5})$/);
  if (m2) { ziel.Strasse = m2[1]; ziel.PLZ = m2[2]; return; }

  ziel.Strasse = zusammen;
}

// Vor- und Nachname aus einem Feld. Der letzte Bestandteil ist der
// Nachname -- "Hans Peter Mueller" wird damit richtig getrennt.
// Namenszusaetze wie "von" oder "van der" gehoeren zum Nachnamen.
const VM_ZUSATZ = new Set(["von", "van", "de", "der", "den", "dem", "zu", "zum",
                           "zur", "ten", "ter", "del", "di", "da", "le", "la", "vom"]);

function vmNameTrennen(name, ziel) {
  const teile = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!teile.length) return;
  if (teile.length === 1) { ziel.Nachname = teile[0]; return; }

  let ab = teile.length - 1;
  while (ab > 1 && VM_ZUSATZ.has(teile[ab - 1].toLowerCase())) ab--;

  ziel.Vorname = teile.slice(0, ab).join(" ");
  ziel.Nachname = teile.slice(ab).join(" ");
}

// Die Sparten stehen in eigenen Zeilen unter dem Mitglied, mit einer
// Zwischenueberschrift "Sparte | Bezeichnung | Beitragsart |
// Jahresbeitrag". Ueber deren Spaltenpositionen werden die Folgezeilen
// gelesen -- nicht ueber geratene Indizes.
function vmSpartenBlock(raster, von, bis) {
  const sparten = [];
  let spalten = null;

  for (let r = von; r < bis; r++) {
    const zeile = raster[r] || [];
    const belegt = [];
    zeile.forEach((wert, i) => {
      const t = String(wert === null || wert === undefined ? "" : wert).trim();
      if (t) belegt.push({ i, t });
    });
    if (!belegt.length) continue;

    const alsUeberschrift = belegt.map((z) => z.t.toLowerCase());
    if (alsUeberschrift.indexOf("sparte") > -1 && alsUeberschrift.indexOf("bezeichnung") > -1) {
      spalten = {
        name: belegt[alsUeberschrift.indexOf("bezeichnung")].i,
        art: alsUeberschrift.indexOf("beitragsart") > -1 ? belegt[alsUeberschrift.indexOf("beitragsart")].i : -1,
        beitrag: alsUeberschrift.indexOf("jahresbeitrag") > -1 ? belegt[alsUeberschrift.indexOf("jahresbeitrag")].i : -1
      };
      continue;
    }
    if (!spalten) continue;

    const name = String(zeile[spalten.name] || "").trim();
    if (!name) continue;
    sparten.push({
      name,
      art: spalten.art >= 0 ? String(zeile[spalten.art] || "").trim() : "",
      beitrag: spalten.beitrag >= 0 ? String(zeile[spalten.beitrag] || "").trim() : ""
    });
  }
  return sparten;
}

function vereinsmeisterLesen(raster) {
  // Erst alle Mitgliedszeilen finden, dann die Bloecke dazwischen den
  // Mitgliedern zuordnen. Andersherum waere das Ende eines Blocks nicht
  // bestimmbar.
  const anker = [];
  for (let r = 0; r < raster.length; r++) {
    const zerlegt = vmZeileZerlegen(raster[r] || []);
    if (zerlegt) anker.push({ r, zerlegt });
  }
  if (!anker.length) return null;

  const saetze = [];
  const spaltenNamen = [];
  const gesehen = new Set();
  function spalteMerken(name) {
    if (!gesehen.has(name)) { gesehen.add(name); spaltenNamen.push(name); }
  }

  anker.forEach((a, k) => {
    const satz = {};
    vmAnschrift(a.zerlegt.anschrift, satz);
    if (satz.Name) { vmNameTrennen(satz.Name, satz); delete satz.Name; }
    vmPaare(a.zerlegt.kontaktEtikett, a.zerlegt.kontaktWerte, satz);
    vmPaare(a.zerlegt.zusatzEtikett, a.zerlegt.zusatzWerte, satz);

    const bis = k + 1 < anker.length ? anker[k + 1].r : raster.length;
    const sparten = vmSpartenBlock(raster, a.r + 1, bis);
    if (sparten.length) {
      satz.Sparten = sparten.map((s) => s.name).join(";");
      const arten = sparten.map((s) => s.art).filter(Boolean);
      const betraege = sparten.map((s) => s.beitrag).filter(Boolean);
      if (arten.length) satz.Beitragsart = Array.from(new Set(arten)).join(";");
      if (betraege.length) satz.Jahresbeitrag = betraege.join(";");
    }

    // Reihenfolge der Spalten festhalten: die zuerst gesehene gewinnt,
    // damit die Zuordnungstabelle nicht bei jeder Datei anders aussieht.
    ["Mitgliedsnummer", "Anrede", "Vorname", "Nachname", "Titel", "Strasse", "PLZ", "Ort",
     "Geb.Datum", "Eintritt", "Austritt", "Status", "Telefon", "Mobil", "EMail",
     "IBAN", "BIC", "Sparten", "Beitragsart", "Jahresbeitrag"].forEach((n) => {
      if (satz[n] !== undefined) spalteMerken(n);
    });
    Object.keys(satz).forEach(spalteMerken);

    saetze.push(satz);
  });

  return {
    spalten: spaltenNamen,
    zeilen: saetze.map((s) => spaltenNamen.map((n) => (s[n] === undefined ? "" : s[n]))),
    anzahl: saetze.length
  };
}

// ---------------------------------------------------------------------
// Datei einlesen
// ---------------------------------------------------------------------

// CSV von Hand geparst statt mit einer Bibliothek: Anfuehrungszeichen um
// Felder mit Semikolon oder Zeilenumbruch darin sind der einzige Fall, an
// dem ein naives split() scheitert -- und den deckt diese Schleife ab.
function csvZerlegen(text, trenner) {
  const zeilen = [];
  let feld = "";
  let zeile = [];
  let inAnfuehrung = false;

  for (let i = 0; i < text.length; i++) {
    const z = text[i];

    if (inAnfuehrung) {
      if (z === '"') {
        if (text[i + 1] === '"') { feld += '"'; i++; }
        else inAnfuehrung = false;
      } else feld += z;
      continue;
    }

    // Nur ein Anfuehrungszeichen am FELDANFANG oeffnet ein Feld. Sonst
    // verschluckt ein einzelnes Zoll- oder Zitatzeichen mitten im Text
    // (Hausnr. 5 "Hinterhaus") den ganzen Rest der Zeile.
    if (z === '"' && feld === "") { inAnfuehrung = true; continue; }
    if (z === trenner) { zeile.push(feld); feld = ""; continue; }
    if (z === "\n") {
      zeile.push(feld); feld = "";
      zeilen.push(zeile); zeile = [];
      continue;
    }
    if (z === "\r") continue;
    feld += z;
  }
  if (feld !== "" || zeile.length) { zeile.push(feld); zeilen.push(zeile); }
  return zeilen.filter((z) => z.some((w) => String(w).trim() !== ""));
}

// Der Vereinsmeister ist Windows-Software: Semikolon ist wahrscheinlicher
// als Komma, aber geraten wird trotzdem nicht -- es zaehlt, welcher
// Trenner in der Kopfzeile am haeufigsten vorkommt.
function trennerErkennen(kopfzeile) {
  const kandidaten = [";", "\t", ",", "|"];
  let bester = ";", meiste = 0;
  kandidaten.forEach((k) => {
    const n = kopfzeile.split(k).length - 1;
    if (n > meiste) { meiste = n; bester = k; }
  });
  return bester;
}

// Deutsche Windows-Software schreibt haeufig Windows-1252 statt UTF-8.
// Falsch dekodiert wird aus "Müller" ein "M?ller" -- und zwar lautlos.
// Deshalb: erst UTF-8 streng versuchen, bei Fehler auf 1252 zurueckfallen.
function textAusBytes(puffer) {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(puffer), kodierung: "UTF-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(puffer), kodierung: "Windows-1252" };
  }
}

// Blob.arrayBuffer() gibt es erst ab iOS 14, und in der Flotte sind
// aeltere Geraete. FileReader als Rueckfallweg. Flottenregel.
function dateiAlsBytes(datei) {
  if (typeof datei.arrayBuffer === "function") return datei.arrayBuffer();
  return new Promise((erfuellen, ablehnen) => {
    const leser = new FileReader();
    leser.onload = () => erfuellen(leser.result);
    leser.onerror = () => ablehnen(new Error("Datei nicht lesbar"));
    leser.readAsArrayBuffer(datei);
  });
}

async function impDateiEinlesen(datei) {
  const info = $("imp-datei-info");
  info.hidden = false;
  info.className = "hinweis info";
  info.textContent = "Datei wird gelesen …";

  const puffer = await dateiAlsBytes(datei);
  const istExcel = /\.xlsx?$/i.test(datei.name);
  let raster, spalten, zeilen, herkunft = "";

  if (istExcel) {
    await ladeTabellenBibliothek();
    const buch = XLSX.read(puffer, { type: "array", cellDates: true });
    const blatt = buch.Sheets[buch.SheetNames[0]];
    // raw:false + dateNF liefert Datumsangaben bereits als ISO-Text --
    // sonst kaeme die Excel-Seriennummer 45123 an, die niemand als
    // Datum erkennt.
    raster = XLSX.utils.sheet_to_json(blatt, { header: 1, raw: false, dateNF: "yyyy-mm-dd", defval: "" });
    if (!raster.length) throw new Error("Das erste Tabellenblatt ist leer");
    herkunft = "Excel, Blatt „" + buch.SheetNames[0] + "“";
  } else {
    const gelesen = textAusBytes(puffer);
    const ersteZeile = gelesen.text.split(/\r?\n/)[0] || "";
    const trenner = trennerErkennen(ersteZeile);
    raster = csvZerlegen(gelesen.text, trenner);
    if (!raster.length) throw new Error("Die Datei enthält keine Zeilen");
    herkunft = gelesen.kodierung + ", Trennzeichen „" + (trenner === "\t" ? "Tabulator" : trenner) + "“";
  }

  // Erst pruefen, ob es eine Vereinsmeister-Liste ist. Die hat keine
  // Kopfzeile und keine Spalten -- ihre erste Zeile als Ueberschrift zu
  // nehmen waere schlicht falsch.
  const vm = vereinsmeisterLesen(raster);
  if (vm) {
    spalten = vm.spalten;
    zeilen = vm.zeilen;
    herkunft += " · als Vereinsmeister-Liste erkannt und in Spalten aufgelöst";
  } else {
    spalten = (raster[0] || []).map((x) => String(x || "").trim());
    zeilen = raster.slice(1).filter((z) => z.some((w) => String(w).trim() !== ""));
  }

  impDatei = { spalten, zeilen, name: datei.name };
  impGeprueft = false;

  info.className = "hinweis info";
  info.innerHTML = "<strong>" + esc(datei.name) + "</strong><br>" +
    zeilen.length + " Datenzeilen, " + spalten.length + " Spalten · " + esc(herkunft);

  impZuordnungVorbelegen();
  impZuordnungZeichnen();
  $("imp-karte-zuordnung").hidden = false;
  $("imp-karte-bericht").hidden = true;
  $("btn-imp-start").disabled = true;
}

// ---------------------------------------------------------------------
// Zuordnung
// ---------------------------------------------------------------------

function impZuordnungVorbelegen() {
  impZuordnung = {};
  const vergeben = new Set();

  impDatei.spalten.forEach((name, i) => {
    const klein = name.toLowerCase();
    // "Nachname" enthaelt "name" -- ohne die Reihenfolge der Liste und
    // das Vergeben-Set wuerde die Spalte doppelt belegt.
    const treffer = ZIELFELDER.find((z) => !vergeben.has(z.feld) && z.muster.test(klein));
    if (treffer) {
      impZuordnung[i] = treffer.feld;
      vergeben.add(treffer.feld);
    } else {
      // Voreinstellung ist ausdruecklich NICHT "verwerfen". Eine Spalte,
      // deren Bedeutung wir nicht kennen, ist der haeufigste Fall -- und
      // wegwerfen kann man sie nach dem Import immer noch.
      impZuordnung[i] = "zusatz";
    }
  });
}

function impZuordnungZeichnen() {
  const ziel = $("imp-zuordnung");
  const zeigeZeilen = impDatei.zeilen.slice(0, 3);

  let html = '<div class="tabelle-scroll"><table><thead><tr>' +
    "<th>Spalte in der Datei</th><th>Beispielwerte</th><th>wird übernommen als</th>" +
    "</tr></thead><tbody>";

  impDatei.spalten.forEach((name, i) => {
    const beispiele = zeigeZeilen.map((z) => String(z[i] === undefined ? "" : z[i]).trim())
                                 .filter(Boolean).slice(0, 2).join(" · ");
    html += "<tr>" +
      '<td class="name">' + esc(name || "(ohne Überschrift)") + "</td>" +
      '<td class="sparten">' + esc(beispiele || "—") + "</td>" +
      "<td><select data-spalte=\"" + i + "\">" +
        ZIELFELDER.map((z) =>
          '<option value="' + z.feld + '"' + (impZuordnung[i] === z.feld ? " selected" : "") + ">" +
          esc(z.text) + "</option>").join("") +
        '<option value="zusatz"' + (impZuordnung[i] === "zusatz" ? " selected" : "") + ">übernehmen, ohne Feld</option>" +
        '<option value="weg"' + (impZuordnung[i] === "weg" ? " selected" : "") + ">nicht übernehmen</option>" +
      "</select></td></tr>";
  });

  html += "</tbody></table></div>";
  ziel.innerHTML = html;

  ziel.querySelectorAll("select").forEach((sel) => {
    sel.addEventListener("change", () => {
      impZuordnung[sel.dataset.spalte] = sel.value;
      impGeprueft = false;
      $("btn-imp-start").disabled = true;
      impMeldung("info", "Zuordnung geändert — bitte den Probelauf wiederholen.");
    });
  });
}

// ---------------------------------------------------------------------
// Werte umsetzen
// ---------------------------------------------------------------------

// Datumsangaben kommen als 31.12.1978, 31.12.78, 1978-12-31 oder
// 31/12/1978. Alles andere wird NICHT geraten, sondern unveraendert
// zurueckgegeben -- der Server lehnt es dann mit Zeilennummer ab.
function datumNachIso(wert) {
  const t = String(wert || "").trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  const m = t.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
  if (!m) return t;

  let jahr = Number(m[3]);
  if (jahr < 100) {
    // Zweistellige Jahre: alles ueber dem laufenden Jahrhundert-Rest ist
    // ein Geburtsjahr aus dem letzten Jahrhundert. 30 als Grenze, weil
    // ein Vereinsmitglied eher 1978 als 2078 geboren ist.
    jahr += jahr <= 30 ? 2000 : 1900;
  }
  const monat = String(Number(m[2])).padStart(2, "0");
  const tag = String(Number(m[1])).padStart(2, "0");
  return jahr + "-" + monat + "-" + tag;
}

function geschlechtNormal(wert) {
  const t = String(wert || "").trim().toLowerCase();
  if (/^(w|f|weibl|weiblich|frau|female)$/.test(t)) return "w";
  if (/^(m|maennl|männl|männlich|maennlich|herr|male)$/.test(t)) return "m";
  if (/^(d|divers)$/.test(t)) return "d";
  return null;
}

function statusNormal(wert) {
  const t = String(wert || "").trim().toLowerCase();
  if (!t) return null;
  if (/aktiv/.test(t)) return "aktiv";
  if (/antrag|beantragt/.test(t)) return "antrag";
  if (/ruh|passiv/.test(t)) return "ruhend";
  if (/gekuend|gekünd|kuendig/.test(t)) return "gekuendigt";
  if (/beendet|ausgetreten|inaktiv|ehemalig/.test(t)) return "beendet";
  return null;
}

function artNormal(wert) {
  const t = String(wert || "").trim().toLowerCase();
  if (/ehren/.test(t)) return "ehrenmitglied";
  if (/ausser|außer|juristisch|firma|verein/.test(t)) return "ausserordentlich";
  return "ordentlich";
}

// Aus einer Rohzeile den Satz bauen, den der Worker erwartet.
function impSatzAusZeile(zeile, nummer) {
  const satz = { zeile: nummer, zusatz: {} };

  impDatei.spalten.forEach((name, i) => {
    const ziel = impZuordnung[i];
    if (ziel === "weg") return;
    const wert = String(zeile[i] === undefined ? "" : zeile[i]).trim();

    if (ziel === "zusatz") {
      if (wert) satz.zusatz[name || ("Spalte " + (i + 1))] = wert;
      return;
    }
    if (!wert) return;

    switch (ziel) {
      case "geburtsdatum": case "eintritt": case "austritt":
        satz[ziel] = datumNachIso(wert); break;
      case "geschlecht": satz.geschlecht = geschlechtNormal(wert); break;
      case "status":     satz.status = statusNormal(wert); break;
      case "art":        satz.art = artNormal(wert); break;
      case "sparten":
        satz.sparten = wert.split(/[;,\/|]/).map((x) => x.trim()).filter(Boolean);
        break;
      case "iban":
        // Leerzeichen in der IBAN sind in Exporten die Regel und machen
        // sie fuer jede spaetere Pruefung unbrauchbar.
        satz.iban = wert.replace(/\s+/g, "").toUpperCase();
        break;
      default: satz[ziel] = wert;
    }
  });

  return satz;
}

function impAlleSaetze() {
  return impDatei.zeilen.map((z, i) => impSatzAusZeile(z, i + 2)); // +2: Kopfzeile ist Zeile 1
}

// ---------------------------------------------------------------------
// Probelauf und Import
// ---------------------------------------------------------------------

function impMeldung(art, text) {
  const k = $("imp-status");
  k.hidden = false;
  k.className = "hinweis " + art;
  k.textContent = text;
}

function impFortschritt(fertig, gesamt) {
  $("imp-fortschritt").hidden = false;
  const anteil = gesamt ? Math.round((fertig / gesamt) * 100) : 0;
  $("imp-balken").style.width = anteil + "%";
  $("imp-fortschritt-text").textContent = fertig + " von " + gesamt + " Zeilen (" + anteil + " %)";
}

// Beide Laeufe teilen sich diese Schleife. Der einzige Unterschied ist
// das Feld pruefen -- so kann der Probelauf gar nicht versehentlich
// anders zaehlen als der echte Lauf.
async function impLauf(nurPruefen) {
  const saetze = impAlleSaetze();
  const block = 40;
  const haushalte = $("imp-haushalte").checked;
  const ergebnisse = [];
  const neueSparten = new Set();
  let angelegt = 0, uebersprungen = 0, fehlerhaft = 0;

  $("btn-imp-probe").disabled = true;
  $("btn-imp-start").disabled = true;

  try {
    for (let i = 0; i < saetze.length; i += block) {
      const antwort = await importiereBlock(saetze.slice(i, i + block), {
        pruefen: nurPruefen,
        haushalte_bilden: haushalte,
        ergaenzen: $("imp-ergaenzen").checked,
        sparten_anlegen: $("imp-sparten-anlegen").checked
      });
      angelegt += antwort.angelegt || 0;
      uebersprungen += antwort.uebersprungen || 0;
      fehlerhaft += antwort.fehlerhaft || 0;
      (antwort.neueSparten || []).forEach((s) => neueSparten.add(s));
      ergebnisse.push(...(antwort.ergebnisse || []));
      impFortschritt(Math.min(i + block, saetze.length), saetze.length);
    }
  } catch (e) {
    impMeldung("fehler", "Abgebrochen: " + e.message +
      (nurPruefen ? "" : " — bereits angelegte Mitglieder bleiben bestehen. Ein erneuter Start setzt dort fort, wo es abgebrochen ist."));
    $("btn-imp-probe").disabled = false;
    impBerichtZeichnen(ergebnisse, { angelegt, uebersprungen, fehlerhaft, nurPruefen, abgebrochen: true });
    return;
  }

  $("btn-imp-probe").disabled = false;
  impBerichtZeichnen(ergebnisse, { angelegt, uebersprungen, fehlerhaft, nurPruefen });

  const spartenSatz = neueSparten.size
    ? " Neu angelegte Sparten: " + Array.from(neueSparten).join(", ") + "."
    : "";

  if (nurPruefen) {
    impGeprueft = fehlerhaft === 0 || angelegt > 0;
    $("btn-imp-start").disabled = angelegt === 0;
    impMeldung(fehlerhaft ? "warn" : "info",
      (fehlerhaft
        ? angelegt + " Zeilen sind in Ordnung, " + fehlerhaft + " haben Fehler. Fehlerhafte Zeilen werden beim Import übersprungen."
        : "Alle " + angelegt + " Zeilen sind in Ordnung. Der Import kann gestartet werden.") + spartenSatz);
  } else {
    impMeldung("info", angelegt + " Mitglieder angelegt oder ergänzt, " + uebersprungen +
      " unverändert, " + fehlerhaft + " fehlerhaft." + spartenSatz);
    await ladeSpartenAuswahl();
    await ladeUndZeige();
  }
}

function impBerichtZeichnen(ergebnisse, zahlen) {
  $("imp-karte-bericht").hidden = false;
  const ziel = $("imp-bericht");

  const kopf = '<div class="bericht-zahlen">' +
    '<span class="chip aktiv">' + zahlen.angelegt + (zahlen.nurPruefen ? " bereit" : " angelegt") + "</span>" +
    (zahlen.uebersprungen ? '<span class="chip ruhend">' + zahlen.uebersprungen + " übersprungen</span>" : "") +
    (zahlen.fehlerhaft ? '<span class="chip beendet">' + zahlen.fehlerhaft + " fehlerhaft</span>" : "") +
    "</div>";

  // Nur Auffaelliges auflisten. Bei 2500 in Ordnung befundenen Zeilen ist
  // eine vollstaendige Liste nicht lesbar -- und sagt nichts.
  const auffaellig = ergebnisse.filter((e) => e.status === "fehler" || e.status === "uebersprungen"
                                          || e.status === "ergaenzt"
                                          || /unbekannte Sparte/.test(e.text || ""));

  if (!auffaellig.length) {
    ziel.innerHTML = kopf + '<p class="fussnote">Keine Auffälligkeiten.</p>';
    return;
  }

  const zeigen = auffaellig.slice(0, 200);
  ziel.innerHTML = kopf +
    '<div class="tabelle-scroll"><table><thead><tr><th>Zeile</th><th>Status</th><th>Hinweis</th></tr></thead><tbody>' +
    zeigen.map((e) =>
      "<tr><td>" + esc(e.zeile) + "</td>" +
      '<td><span class="chip ' + (e.status === "fehler" ? "beendet" : e.status === "uebersprungen" ? "ruhend" : "aktiv") + '">' +
        esc(e.status) + "</span></td>" +
      '<td class="sparten">' + esc(e.text) + "</td></tr>").join("") +
    "</tbody></table></div>" +
    (auffaellig.length > zeigen.length
      ? '<p class="fussnote">' + (auffaellig.length - zeigen.length) + " weitere Auffälligkeiten werden nicht einzeln aufgeführt.</p>"
      : "");
}

// ---------------------------------------------------------------------

function impVerdrahten() {
  $("imp-datei").addEventListener("change", async (e) => {
    const datei = e.target.files && e.target.files[0];
    if (!datei) return;
    try {
      await impDateiEinlesen(datei);
    } catch (fehler) {
      const info = $("imp-datei-info");
      info.hidden = false;
      info.className = "hinweis fehler";
      info.textContent = "Datei nicht lesbar: " + fehler.message;
      $("imp-karte-zuordnung").hidden = true;
    }
  });

  $("btn-imp-probe").addEventListener("click", () => impLauf(true));

  $("btn-imp-start").addEventListener("click", () => {
    if (!impGeprueft) { impMeldung("warn", "Bitte zuerst den Probelauf starten."); return; }
    if (!confirm("Import wirklich starten? Es werden Mitglieder in die Vereinsdatenbank geschrieben.")) return;
    impLauf(false);
  });
}
