// Fuellt den Antrag auf Spielerlaubnis (national) des Thueringer
// Fussball-Verbandes -- Formular AO21.
//
// ⚠️ Das PDF hat KEIN AcroForm: null Felder, null Widgets auf beiden Seiten
// (nachgemessen, nicht vermutet). Es hat aber eine echte Textebene und ein
// exaktes Kaestchenraster. Deshalb wird der Text auf die UNVERAENDERTE
// Originalseite gedruckt statt Formularfelder anzulegen.
//
// Das erspart zugleich die bekannteste Falle des anderen Weges: ein
// gesetzter Feldwert ohne form.updateFieldAppearances(font) zeigt in
// Chrome ein leeres Blatt, waehrend Acrobat wegen NeedAppearances alles
// richtig rendert -- der Fehler faellt also erst beim Nutzer auf. Ein
// gezeichneter Text ist immer sichtbar.
//
// Wird von antraege.js (Verwaltung) und vom Sicht-Reiter geladen. Bringt
// eigene Helfer mit, damit sie nicht davon abhaengt, wer sie laedt --
// gleiche Bauform wie antrag-druck.js.

// Das leere Original liegt im Repo. Es ist ein vom Verband
// bereitgestelltes Formular ohne Personendaten; eine AUSGEFUELLTE Fassung
// darf dort nie liegen.
const TFV_VORLAGE = "AO21_spielerlaubnis_national.pdf";

// ⚠️ Der Bogen traegt die Kennung AO21 in der Fussleiste. Aendert der
// Verband das Formular, verschiebt sich das GANZE Raster unten -- und der
// Fehler faellt niemandem auf, weil ein falsch platzierter Text auf einem
// gueltig aussehenden Blatt steht. pdf-lib kann keinen Text auslesen;
// gemessen wird deshalb, woran ein Austausch mit Sicherheit erkennbar ist:
// Byteanzahl und Seitenmass der Vorlage vom 06.08.2026.
const TFV_VORLAGE_BYTES = 210320;
const TFV_SEITE_BREITE = 595.32;
const TFV_SEITE_HOEHE = 841.92;

// --- Raster, an der Vorlage gemessen (06.08.2026) --------------------
// Zellbreite 13,7pt, Schritt 14,18pt. Zeichen mittig, Grundlinie 2,6pt
// ueber der Kaestchenlinie.
const TFV_SCHRITT = 14.18;
const TFV_BASIS = 2.6;
const TFV_SCHRIFT = 11;

// [Seite, y der Kaestchenlinie, x der ersten Zelle, Anzahl Zellen]
const TFV_FELDER = {
  pass_nr:         [0, 695.5, 119.7,  9],
  vereins_nr:      [0, 695.5, 389.1,  8],
  vereinsname:     [0, 666.5, 119.7, 29],
  nachname:        [0, 638.6, 119.7, 29],
  vorname:         [0, 614.1, 119.7, 29],
  geburtsdatum:    [0, 588.2, 119.7,  8],
  nationalitaet:   [0, 561.1, 119.7, 29],
  strasse:         [0, 532.0, 119.7, 29],
  plz_ort:         [0, 507.6, 119.7, 29],
  letzter_verein:  [0, 347.6, 119.7, 29],
  landesverband:   [0, 317.4, 119.7, 29]
};

// [Seite, x der Mitte, y der Mitte]
const TFV_KREUZE = {
  maennlich:       [0, 410.2, 595.2],
  weiblich:        [0, 495.3, 595.2],
  marketing:       [0,  43.8, 477.6],
  erstausstellung: [0,  43.8, 420.2],
  vereinswechsel:  [0,  44.1, 393.6],
  rueckkehrer:     [0,  43.9, 296.9],
  namensaenderung: [0,  44.1, 266.2],
  abmeldung1:      [1,  67.2, 719.2],
  abmeldung2:      [1,  67.2, 671.5]
};

// Unterschriftsblock oben auf Seite 2. ⚠️ Die Beschriftung steht auf
// diesem Bogen UEBER der Abschlusslinie -- der beschreibbare Raum liegt
// also oberhalb der Beschriftung, nicht wie ueblich darunter.
const TFV_SIG = {
  ortdatum:        { x:  37.7, y: 316.0 },
  spieler:         { x: 200.0, y: 318.0, breite: 155, hoehe: 40 },
  erziehungsber:   { x: 363.0, y: 318.0, breite: 168, hoehe: 40 }
};

// ---------------------------------------------------------------------
// Helfer (eigene, siehe Dateikopf)
// ---------------------------------------------------------------------

function tfvDatumDe(iso) {
  if (!iso) return "";
  const t = String(iso).slice(0, 10).split("-");
  return t.length === 3 ? t[2] + "." + t[1] + "." + t[0] : String(iso);
}

// Die Standardschriften koennen nur Latin-1. Ein einziges typografisches
// Anfuehrungszeichen aus einem kopierten Text wirft beim Zeichnen und
// reisst die ganze Erzeugung mit.
function tfvLatin1(wert) {
  const ersatz = {
    "’": "'", "‘": "'", "‚": "'",
    "„": '"', "“": '"', "”": '"',
    "–": "-", "—": "-", "…": "...",
    " ": " ", " ": " "
  };
  let s = String(wert === null || wert === undefined ? "" : wert);
  for (const [a, b] of Object.entries(ersatz)) s = s.split(a).join(b);
  // Was danach noch uebrig ist, ersetzt ein Fragezeichen -- sichtbar
  // falsch ist besser als ein Abbruch ohne Dokument.
  return s.replace(/[^\x20-\xFF]/g, "?");
}

function tfvLadePdfLib() {
  if (window.PDFLib) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("pdf-lib konnte nicht geladen werden"));
    document.head.appendChild(s);
  });
}

// ---------------------------------------------------------------------
// Unterschrift zuschneiden
// ---------------------------------------------------------------------
//
// ⚠️ Eine Signatur-Canvas ist 600x180, die Unterschrift belegt davon einen
// Bruchteil. Wandert die ganze Flaeche ins PDF, bestimmt der weisse Rand
// die Skalierung und die Unterschrift wird winzig. Deshalb ueber den
// Alpha-Kanal die Bounding-Box bestimmen und nur die einbetten.
//
// Gibt eine Promise auf { dataUrl, breite, hoehe } oder null zurueck.
function tfvUnterschriftZuschneiden(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl) { resolve(null); return; }
    const bild = new Image();
    bild.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = bild.width;
        c.height = bild.height;
        const ctx = c.getContext("2d");
        ctx.drawImage(bild, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;

        let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
        for (let y = 0; y < c.height; y++) {
          for (let x = 0; x < c.width; x++) {
            // Alpha UND Helligkeit pruefen: manche Zeichenfelder malen auf
            // weissen Grund statt auf Transparenz, dort ist Alpha ueberall
            // 255 und die Box waere immer die ganze Flaeche.
            const i = (y * c.width + x) * 4;
            const undurchsichtig = d[i + 3] > 16;
            const dunkel = (d[i] + d[i + 1] + d[i + 2]) / 3 < 240;
            if (undurchsichtig && dunkel) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
        if (x1 < 0) { resolve(null); return; }   // nichts gezeichnet

        const rand = 4;
        x0 = Math.max(0, x0 - rand); y0 = Math.max(0, y0 - rand);
        x1 = Math.min(c.width - 1, x1 + rand);
        y1 = Math.min(c.height - 1, y1 + rand);
        const b = x1 - x0 + 1, h = y1 - y0 + 1;

        const z = document.createElement("canvas");
        z.width = b; z.height = h;
        z.getContext("2d").drawImage(c, x0, y0, b, h, 0, 0, b, h);
        resolve({ dataUrl: z.toDataURL("image/png"), breite: b, hoehe: h });
      } catch (e) {
        resolve(null);
      }
    };
    bild.onerror = () => resolve(null);
    bild.src = dataUrl;
  });
}

// ---------------------------------------------------------------------
// Werte aus dem Antrag in die Felder des Bogens
// ---------------------------------------------------------------------
//
// Reine Funktion ohne PDF und ohne Browser -- deshalb im Pruefstand
// einzeln nachrechenbar.
function tfvWerteAusAntrag(antrag, vereinsname) {
  const i = (antrag && antrag.inhalt) || {};
  const s = i.spielerlaubnis || {};
  const g = String(i.geburtsdatum || "").slice(0, 10).split("-");

  return {
    felder: {
      pass_nr:        s.pass_nr || "",
      // Die Vereins-Nr. steht auf dem Bogen bereits vorgedruckt. Sie wird
      // nur gesetzt, wenn sie in den Vereinsstammdaten hinterlegt ist --
      // sonst schriebe sie sich ueber den Aufdruck.
      vereins_nr:     "",
      vereinsname:    vereinsname || "",
      nachname:       i.nachname || "",
      vorname:        i.vorname || "",
      geburtsdatum:   g.length === 3 ? g[2] + g[1] + g[0] : "",
      nationalitaet:  i.nationalitaet || "",
      strasse:        i.strasse || "",
      plz_ort:        [i.plz, i.ort].filter(Boolean).join(" "),
      letzter_verein: s.letzter_verein || "",
      landesverband:  s.landesverband || ""
    },
    kreuze: {
      maennlich:       i.geschlecht === "m",
      weiblich:        i.geschlecht === "w",
      marketing:       s.einwilligung_dfb_marketing === true,
      erstausstellung: s.art === "erstausstellung",
      vereinswechsel:  s.art === "vereinswechsel",
      rueckkehrer:     s.art === "rueckkehrer",
      namensaenderung: s.art === "namensaenderung",
      abmeldung1:      s.art === "vereinswechsel" && s.abmeldeweg === "1",
      abmeldung2:      s.art === "vereinswechsel" && s.abmeldeweg === "2"
    }
  };
}

// Welche Werte passen nicht ins Raster? ⚠️ Geprueft wird beim ERZEUGEN,
// nicht beim Absenden: in der Verwaltung laesst sich noch korrigieren, im
// abgeschickten Antrag nicht mehr. Kein stilles Abschneiden -- der Aufrufer
// bekommt die Liste und zeigt sie an.
function tfvUeberlaengen(felder) {
  const raus = [];
  for (const [name, wert] of Object.entries(felder)) {
    const def = TFV_FELDER[name];
    if (!def || !wert) continue;
    const zellen = def[3];
    const text = tfvLatin1(wert);
    if (text.length > zellen) {
      raus.push({ feld: name, wert: text, zellen, zuviel: text.length - zellen });
    }
  }
  return raus;
}

// Mitte der i-ten Zelle eines Feldes. Einzeln nachrechenbar, damit der
// Pruefstand die Position eines Zeichens gegen das gerenderte PDF halten
// kann, statt sie am Bild abzuschaetzen.
function tfvZellenMitte(feldName, i) {
  const def = TFV_FELDER[feldName];
  if (!def) return null;
  return def[2] + i * TFV_SCHRITT + TFV_SCHRITT / 2;
}

// ---------------------------------------------------------------------
// Erzeugen
// ---------------------------------------------------------------------
//
// opt: { antrag, vereinsname, unterschriftOrt, datum, vereinsNr }
// Gibt { bytes, hinweise } zurueck. bytes ist ein Uint8Array.
async function tfvAntragErzeugen(opt) {
  await tfvLadePdfLib();
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;

  const antwort = await fetch(TFV_VORLAGE);
  if (!antwort.ok) throw new Error("Das Verbandsformular konnte nicht geladen werden");
  const vorlage = await antwort.arrayBuffer();

  const pdf = await PDFDocument.load(vorlage);
  const seiten = pdf.getPages();
  if (seiten.length < 2) throw new Error("Das Verbandsformular hat nicht die erwarteten zwei Seiten");

  const schrift = await pdf.embedFont(StandardFonts.Helvetica);
  const fett = await pdf.embedFont(StandardFonts.HelveticaBold);
  const schwarz = rgb(0, 0, 0);
  const hinweise = [];

  // Ist es noch derselbe Bogen, an dem das Raster gemessen wurde? Nur ein
  // Hinweis, kein Abbruch -- ein neu gespeichertes, inhaltsgleiches PDF
  // waere sonst ein Totalausfall. Wer ihn sieht, muss die Koordinaten
  // nachmessen, bevor das Blatt zum Verband geht.
  const massOk = Math.abs(seiten[0].getWidth() - TFV_SEITE_BREITE) < 1 &&
                 Math.abs(seiten[0].getHeight() - TFV_SEITE_HOEHE) < 1;
  if (vorlage.byteLength !== TFV_VORLAGE_BYTES || !massOk) {
    hinweise.push("Das hinterlegte Verbandsformular weicht von dem ab, an dem die " +
                  "Feldpositionen gemessen wurden. Bitte das erzeugte Blatt pruefen, " +
                  "bevor es eingereicht wird.");
  }

  const werte = tfvWerteAusAntrag(opt.antrag, opt.vereinsname);
  if (opt.vereinsNr) werte.felder.vereins_nr = String(opt.vereinsNr);

  for (const zuLang of tfvUeberlaengen(werte.felder)) {
    hinweise.push('"' + zuLang.wert + '" passt nicht in die ' + zuLang.zellen +
                  " Kaestchen des Feldes (" + zuLang.zuviel +
                  (zuLang.zuviel === 1 ? " Zeichen" : " Zeichen") + " zu viel)");
  }

  // --- Kaestchenfelder zeichenweise ---
  for (const [name, wert] of Object.entries(werte.felder)) {
    const def = TFV_FELDER[name];
    if (!def || !wert) continue;
    const seite = seiten[def[0]];
    const text = tfvLatin1(wert).slice(0, def[3]);
    for (let i = 0; i < text.length; i++) {
      const zeichen = text[i];
      const breite = schrift.widthOfTextAtSize(zeichen, TFV_SCHRIFT);
      seite.drawText(zeichen, {
        x: tfvZellenMitte(name, i) - breite / 2,
        y: def[1] + TFV_BASIS,
        size: TFV_SCHRIFT, font: schrift, color: schwarz
      });
    }
  }

  // --- Ankreuzfelder ---
  for (const [name, gesetzt] of Object.entries(werte.kreuze)) {
    if (!gesetzt) continue;
    const def = TFV_KREUZE[name];
    if (!def) continue;
    const breite = fett.widthOfTextAtSize("X", 12);
    seiten[def[0]].drawText("X", {
      x: def[1] - breite / 2,
      y: def[2] - 4.2,
      size: 12, font: fett, color: schwarz
    });
  }

  // --- Ort und Datum ueber dem Unterschriftsblock ---
  const s2 = seiten[1];
  const ortDatum = tfvLatin1(
    [opt.unterschriftOrt || (opt.antrag && opt.antrag.inhalt && opt.antrag.inhalt.ort) || "",
     tfvDatumDe(opt.datum)].filter(Boolean).join(", ")
  );
  if (ortDatum) {
    s2.drawText(ortDatum, {
      x: TFV_SIG.ortdatum.x, y: TFV_SIG.ortdatum.y,
      size: 10, font: schrift, color: schwarz
    });
  }

  // --- Unterschriften ---
  //
  // ⚠️ Die Unterschrift des Kindes darf FEHLEN -- ein Siebenjaehriger
  // unterschreibt nicht. Ohne die der Erziehungsberechtigten wird dagegen
  // gar nicht erst erzeugt; das ist der Grund, warum der Bogen gilt.
  const a = opt.antrag || {};
  const sigEltern = a.unterschrift_gesetzl || null;
  if (!sigEltern) {
    throw new Error("Ohne die Unterschrift der Erziehungsberechtigten laesst sich " +
                    "der Verbandsantrag nicht erzeugen");
  }

  await tfvUnterschriftSetzen(pdf, s2, a.unterschrift || null, TFV_SIG.spieler);
  await tfvUnterschriftSetzen(pdf, s2, sigEltern, TFV_SIG.erziehungsber);

  // Der UNTERE Block bleibt leer: Vereinsstempel und Unterschrift des
  // Vereins setzt die Geschaeftsstelle nach dem Druck. Ein digital
  // eingesetzter Vereinsstempel waere eine Zusage, die niemand geprueft
  // hat.

  return { bytes: await pdf.save(), hinweise };
}

async function tfvUnterschriftSetzen(pdf, seite, dataUrl, feld) {
  const zug = await tfvUnterschriftZuschneiden(dataUrl);
  if (!zug) return;

  const bild = await pdf.embedPng(zug.dataUrl);
  // Seitenverhaeltnis wahren statt in den Rahmen zu strecken -- eine
  // gestauchte Unterschrift sieht gefaelscht aus.
  const faktor = Math.min(feld.breite / zug.breite, feld.hoehe / zug.hoehe);
  const b = zug.breite * faktor;
  const h = zug.hoehe * faktor;
  seite.drawImage(bild, {
    x: feld.x + (feld.breite - b) / 2,
    y: feld.y,
    width: b, height: h
  });
}

// Schickt fertige Bytes in den Download-Ordner. Getrennt vom Erzeugen,
// damit der Aufrufer dazwischen etwas anderes tun kann -- etwa das Blatt
// zugleich in Nextcloud ablegen.
//
// ⚠️ Ein Blob-Link, kein window.open: der braucht keine Nutzergeste und
// wird deshalb auch nach einem await nicht von iOS-Safari geblockt.
function tfvAntragSpeichern(bytes, antrag) {
  const i = (antrag && antrag.inhalt) || {};
  const name = ["Spielerlaubnis", i.nachname, i.vorname].filter(Boolean)
    .join("_").replace(/[^A-Za-z0-9_-]/g, "") + ".pdf";

  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return name;
}

// Bequemer Weg fuer Aufrufer, die nur herunterladen wollen.
async function tfvAntragHerunterladen(opt) {
  const { bytes, hinweise } = await tfvAntragErzeugen(opt);
  tfvAntragSpeichern(bytes, opt.antrag);
  return hinweise;
}
