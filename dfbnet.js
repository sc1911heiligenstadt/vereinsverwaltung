// DFBnet-Abgleich -- Reiter „DFBnet Spieler"
//
// Liest den Export der Spielberechtigungen (XLSX) im BROWSER, schickt aus
// jeder Zeile genau fuenf Felder an den Worker und zeigt, was zwischen
// beiden Listen klafft.
//
// ⚠️ Die eingelesene Liste wird in D1 GESPEICHERT (Michel, 11.09.2026).
// Daraus folgt der ganze Aufbau dieser Datei:
//   - Beim Oeffnen des Reiters wird NICHTS hochgeladen, sondern der
//     gespeicherte Stand abgerufen. Auch die Passstelle sieht ihn, die
//     die Datei gar nicht hat.
//   - Einlesen ist ein Schreibvorgang (vv-dfbnet-import, darfSchreiben),
//     der Abgleich ist Lesen (vv-dfbnet-abgleich, darfNachwuchs).
//   - Es gibt immer genau EINE gueltige Liste; ein neuer Export ersetzt
//     den alten. Zwei nebeneinander hiessen, dass jemand raten muss.
// Der Browser haelt deshalb keinen Stand mehr -- kein localStorage, keine
// zwischengespeicherte Datei. Was gilt, steht im Server.
//
// ⚠️ Erkannt wird ueber die UEBERSCHRIFTEN, nie ueber feste Spalten- oder
// Zeilennummern. Der DFBnet-Export traegt drei Kopfzeilen mit Vereinsname
// und Titel ueber der eigentlichen Tabelle, und jede Mannschaft hat ihr
// eigenes Blatt. Eine verdrahtete Position bricht beim naechsten Export
// lautlos.

// Diese Blattnamen tragen keinen Mannschaftsnamen -- aus ihnen wird
// keiner abgeleitet.
const DFB_BLATT_GENERISCH = /^(alle spieler|zuordnung|uebersicht|übersicht|tabelle\s*\d*|sheet\s*\d*)/i;

let dfbErgebnis = null;
let dfbLaeuft = false;

function dfbKopfWort(wert) {
  return String(wert === null || wert === undefined ? "" : wert)
    .replace(/ /g, " ")
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

// Sucht in einem Raster die Kopfzeile und liefert die Spaltennummern.
// Gefordert sind Nachname, Vorname UND Geburtsdatum -- zwei davon
// reichen nicht: ein Blatt mit Name und Mannschaft ohne Geburtsdatum
// waere fuer den Abgleich wertlos, und der Server lehnte jede Zeile ab.
function dfbKopfFinden(raster) {
  const grenze = Math.min(raster.length, 30);
  for (let i = 0; i < grenze; i++) {
    const zeile = raster[i] || [];
    const spalten = {};
    for (let j = 0; j < zeile.length; j++) {
      const w = dfbKopfWort(zeile[j]);
      if (!w) continue;
      if (w === "nachname" || w === "name") {
        // „Name" gilt nur, wenn daneben „Vorname" steht -- sonst ist es
        // die Spalte „Name" einer ganz anderen Tabelle.
        if (spalten.nachname === undefined) spalten.nachname = j;
      } else if (w === "vorname") spalten.vorname = j;
      else if (w === "geburtsdatum" || w === "geboren" || w === "geburtstag") spalten.geburt = j;
      else if (w === "mannschaft" || w === "team") spalten.mannschaft = j;
      else if (w === "aktiv") spalten.aktiv = j;
    }
    if (spalten.nachname !== undefined && spalten.vorname !== undefined
        && spalten.geburt !== undefined) {
      return { zeile: i, spalten };
    }
  }
  return null;
}

// Der Mannschaftsname, wenn das Blatt keine eigene Spalte dafuer hat.
// Die Titelzeile des Exports lautet „D-Junioren II - 17 Spieler ...".
function dfbMannschaftAusBlatt(raster, kopfZeile, blattName) {
  for (let i = 0; i < kopfZeile; i++) {
    for (const zelle of raster[i] || []) {
      const t = String(zelle === null || zelle === undefined ? "" : zelle).trim();
      const treffer = /^(.{2,60}?)\s+[-–]\s+\d+\s+Spieler/i.exec(t);
      if (treffer) return treffer[1].trim();
    }
  }
  return DFB_BLATT_GENERISCH.test(String(blattName || "").trim())
    ? "" : String(blattName || "").trim();
}

// Ein Geburtsdatum in ISO. Der Export liefert es je nach Weg als echtes
// Datum, als „27.10.2009" oder schon als ISO-Text.
//
// ⚠️ Aus einem Date-Objekt wird das Datum LOKAL gebildet, nicht ueber
// toISOString(): in deutscher Sommerzeit liefert das fuer Mitternacht den
// VORTAG -- und ein um einen Tag verschobenes Geburtsdatum bricht den
// Abgleichsschluessel lautlos. Dieselbe Falle steht im Worker an drei
// Stellen.
function dfbDatum(wert) {
  if (wert === null || wert === undefined || wert === "") return "";
  if (wert instanceof Date && !isNaN(wert)) {
    const z = (n) => String(n).padStart(2, "0");
    return wert.getFullYear() + "-" + z(wert.getMonth() + 1) + "-" + z(wert.getDate());
  }
  const t = String(wert).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/.exec(t);
  if (m) {
    return m[3] + "-" + String(m[2]).padStart(2, "0") + "-" + String(m[1]).padStart(2, "0");
  }
  return "";
}

// Liest ALLE Blaetter. Der Export fuehrt dieselben Spieler mehrfach (ein
// Blatt je Mannschaft plus ein Sammelblatt) -- zusammengefasst wird im
// SERVER ueber den Abgleichsschluessel, damit es nur eine Fassung dieser
// Regel gibt.
async function dfbDateiLesen(datei) {
  await ladeTabellenBibliothek();
  const puffer = await datei.arrayBuffer();
  const buch = XLSX.read(puffer, { type: "array", cellDates: true });

  const spieler = [];
  const blaetter = [];
  for (const name of buch.SheetNames) {
    const blatt = buch.Sheets[name];
    if (!blatt) continue;
    const raster = XLSX.utils.sheet_to_json(blatt, { header: 1, raw: true, defval: null });
    const kopf = dfbKopfFinden(raster);
    if (!kopf) continue;
    const sp = kopf.spalten;
    const ausBlatt = sp.mannschaft === undefined
      ? dfbMannschaftAusBlatt(raster, kopf.zeile, name) : "";

    let gezaehlt = 0;
    for (let i = kopf.zeile + 1; i < raster.length; i++) {
      const z = raster[i] || [];
      const nachname = String(z[sp.nachname] === null || z[sp.nachname] === undefined
        ? "" : z[sp.nachname]).trim();
      const vorname = String(z[sp.vorname] === null || z[sp.vorname] === undefined
        ? "" : z[sp.vorname]).trim();
      if (!nachname && !vorname) continue;
      spieler.push({
        nachname, vorname,
        geburtsdatum: dfbDatum(z[sp.geburt]),
        mannschaft: sp.mannschaft !== undefined
          ? String(z[sp.mannschaft] === null || z[sp.mannschaft] === undefined
              ? "" : z[sp.mannschaft]).trim()
          : ausBlatt,
        aktiv: sp.aktiv !== undefined
          ? String(z[sp.aktiv] === null || z[sp.aktiv] === undefined ? "" : z[sp.aktiv]).trim()
          : "ja"
      });
      gezaehlt++;
    }
    if (gezaehlt) blaetter.push(name + " (" + gezaehlt + ")");
  }
  if (!spieler.length) {
    throw new Error("In der Datei wurde keine Tabelle mit den Spalten Nachname, Vorname " +
                    "und Geburtsdatum gefunden.");
  }
  return { spieler, blaetter };
}

// ---------------------------------------------------------------------
// Anzeige, Filter und Handzuordnung
// ---------------------------------------------------------------------
//
// ⚠️ Die Filterfelder stehen im HTML, nicht in diesem gerenderten Block.
// Sie werden bei jedem Zeichnen sonst neu erzeugt -- und der Cursor
// spraenge beim Tippen aus dem Suchfeld. Nur `#dfb-ergebnis` wird ersetzt.
//
// ⚠️ Nach jeder Zuordnung wird der Abgleich im SERVER neu gerechnet,
// statt die Zeile im Browser umzuhaengen. Sonst gaebe es zwei Fassungen
// derselben Auswertung: die des Servers und die, die der Client sich
// daraus gebastelt hat -- und die zweite ginge beim ersten Sonderfall
// (Zuordnung auf ein Turnkind) daneben.

// Die Zeile, fuer die gerade ein Mitglied gesucht wird (Auswahlmodus).
let dfbWaehlt = null;
let dfbMitgliedTreffer = null;

function dfbMeldung(id, text, art) {
  const el = $(id);
  if (!el) return;
  el.hidden = !text;
  el.className = "hinweis " + (art || "info");
  el.innerHTML = text || "";
}

function dfbLageChip(lage) {
  if (lage === "andere_abteilung") return '<span class="chip ruhend">andere Abteilung</span>';
  if (lage === "ausgetreten") return '<span class="chip gekuendigt">ausgetreten</span>';
  if (lage === "antrag") return '<span class="chip ruhend">Antrag offen</span>';
  return '<span class="chip gekuendigt">nicht im Bestand</span>';
}

// Die Rohfelder eines gemeldeten Spielers als data-Attribute. Sie gehen
// unveraendert an den Server zurueck, der daraus den Schluessel bildet.
function dfbRohAttr(z) {
  return ' data-vorname="' + esc(z.vorname || "") + '"' +
         ' data-nachname="' + esc(z.nachname || "") + '"' +
         ' data-geb="' + esc(z.geburtsdatum || "") + '"';
}

function dfbVorschlagZeile(o, v, vollbild) {
  return '<div class="dfb-vorschlag">' +
    "<strong>" + esc(v.name) + "</strong> · " + esc(datumDe(v.geburtsdatum)) +
    (v.mitgliedsnummer ? " · Nr. " + esc(v.mitgliedsnummer) : "") +
    " · " + esc(v.herkunft) +
    '<span class="fussnote">' + esc((v.gruende || []).join(" · ")) + "</span>" +
    // ⚠️ Kein Knopf ohne person_id: ein Vorschlag kann auch aus einem
    // offenen Aufnahmeantrag stammen, und den gibt es als Person noch
    // gar nicht. Zuordnen liefe dort in einen 404.
    (vollbild && v.person_id
      ? '<button type="button" class="btn klein" data-dfb="zuordnen"' +
        dfbRohAttr(o) + ' data-person="' + esc(v.person_id) + '">Diesem Mitglied zuordnen</button>'
      : "") +
    "</div>";
}

// --- Filter -----------------------------------------------------------

function dfbFilterWerte() {
  return {
    suche: dfbSuchform(($("dfb-f-suche") && $("dfb-f-suche").value) || ""),
    mannschaft: ($("dfb-f-mannschaft") && $("dfb-f-mannschaft").value) || "",
    lage: ($("dfb-f-lage") && $("dfb-f-lage").value) || ""
  };
}

// ⚠️ Die Suche ist umlautblind, und zwar nach DERSELBEN Regel, nach der
// der Server Vorschlaege bildet (kodexHart). Sonst findet „Grünbaum"
// weder „Gruenbaum" noch „Grunbaum" -- und genau diese drei Schreibweisen
// sind der Grund, warum es diesen Reiter gibt. Ein Filter, der bei der
// haeufigsten Abweichung leer bleibt, liest sich wie „gibt es nicht".
function dfbSuchform(text) {
  return String(text || "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u").replace(/ss/g, "s")
    .replace(/[^a-z0-9]/g, "");
}

function dfbNameTrifft(name, suche) {
  return !suche || dfbSuchform(name).indexOf(suche) >= 0;
}

// Die Mannschaftsauswahl wird aus der DATEI gefuellt, nicht fest
// verdrahtet: der Verein hat mal drei D-Jugenden, mal zwei.
function dfbMannschaftenFuellen(e) {
  const feld = $("dfb-f-mannschaft");
  if (!feld) return;
  const alle = new Set();
  for (const z of e.treffer.concat(e.offen)) {
    for (const m of String(z.mannschaft || "").split(", ")) {
      if (m.trim()) alle.add(m.trim());
    }
  }
  const vorher = feld.value;
  feld.innerHTML = '<option value="">Alle Mannschaften</option>' +
    [...alle].sort().map((m) => '<option value="' + esc(m) + '">' + esc(m) + "</option>").join("");
  // ⚠️ Die Auswahl ueberlebt das Neuzeichnen nur, wenn es sie noch gibt.
  // Sonst stuende ein Filter im Feld, den niemand mehr wegklicken kann,
  // weil er zu keiner Zeile passt.
  feld.value = alle.has(vorher) ? vorher : "";
}

// --- Zeichnen ---------------------------------------------------------

function dfbZeichne() {
  const ziel = $("dfb-ergebnis");
  if (!ziel) return;
  const e = dfbErgebnis;
  const filterKarte = $("dfb-filter");
  // ⚠️ `leer` ist kein Fehler, sondern der Normalzustand vor dem ersten
  // Einlesen -- und der Zustand, den die Passstelle sieht, solange die
  // Geschaeftsstelle noch nichts hochgeladen hat. Deshalb ein Satz, der
  // sagt, worauf man wartet, und keine Fehlermeldung.
  // ⚠️ Die Knopfreihe haengt an vollbild aus der ANTWORT, nicht an
  // meineRechte: die Oberflaeche soll zeigen, was der Server geliefert
  // hat, nicht was sie zu duerfen glaubt. Dieselbe Regel wie in
  // antraege.js (antwort.nur_nachwuchs).
  if ($("dfb-knopfreihe")) $("dfb-knopfreihe").hidden = !(e && e.vollbild);
  if (!e || e.leer) {
    ziel.innerHTML = "";
    if (filterKarte) filterKarte.hidden = true;
    $("dfb-weg").hidden = true;
    $("dfb-stand").innerHTML = '<p class="fussnote">' +
      (e && e.eingerichtet === false
        ? "Die Tabellen für den Abgleich werden gerade eingerichtet. Bitte die Seite " +
          "in einem Moment neu laden."
        : (e && !e.vollbild
            ? "Es ist noch keine Meldeliste eingelesen. Sobald die Geschäftsstelle den " +
              "DFBnet-Export hochgeladen hat, steht der Abgleich hier."
            : "Noch keine Meldeliste eingelesen. Der Abgleich läuft gegen die Abteilung " +
              "Fußball und vergleicht nur die Jahrgänge, die in der Datei wirklich " +
              "vorkommen.")) + "</p>";
    return;
  }
  if (filterKarte) filterKarte.hidden = false;
  $("dfb-weg").hidden = !e.vollbild;

  const f = dfbFilterWerte();
  const offenAlle = e.offen;
  const offen = offenAlle.filter((o) =>
    dfbNameTrifft(o.name, f.suche) &&
    (!f.lage || o.lage === f.lage) &&
    (!f.mannschaft || String(o.mannschaft || "").split(", ").indexOf(f.mannschaft) >= 0));
  // ⚠️ Der Mannschaftsfilter gilt hier NICHT: ein Mitglied traegt keine
  // Mannschaft, die steht nur in der DFBnet-Datei. Ihn trotzdem
  // anzuwenden hiesse, diese Liste bei gesetztem Filter immer leer zu
  // zeigen -- und das laese sich als „alles in Ordnung" lesen.
  const nichtGemeldet = e.nicht_gemeldet.filter((n) => dfbNameTrifft(n.name, f.suche));
  const treffer = e.treffer.filter((t) =>
    dfbNameTrifft(t.name, f.suche) &&
    (!f.mannschaft || String(t.mannschaft || "").split(", ").indexOf(f.mannschaft) >= 0));

  const zahl = (gezeigt, gesamt) => gezeigt === gesamt
    ? '<span class="version-badge">' + gesamt + "</span>"
    : '<span class="version-badge">' + gezeigt + " von " + gesamt + "</span>";

  const offenUnklar = offenAlle.filter((o) => o.lage === "unbekannt").length;

  $("dfb-stand").innerHTML =
    '<div class="hinweis ' + ((e.offen.length || e.nicht_gemeldet.length) ? "warn" : "erfolg") + '">' +
      "<strong>" + e.anzahl_gemeldet + "</strong> gemeldete Spieler aus der Datei, " +
      "<strong>" + e.anzahl_bestand + "</strong> Fußball-Mitglieder der Jahrgänge " +
      e.jahrgang_von + "–" + e.jahrgang_bis + " im Bestand. " +
      "<strong>" + e.treffer.length + "</strong> passen zusammen." +
    "</div>" +
    '<p class="fussnote">Meldeliste eingelesen am ' +
    esc(datumDe(String(e.eingelesen_am || "").slice(0, 10))) +
    (e.eingelesen_von ? " von " + esc(e.eingelesen_von) : "") +
    (e.dateiname ? " aus " + esc(e.dateiname) : "") +
    ", abgeglichen zum " + esc(datumDe(e.stichtag)) +
    " gegen die Abteilung " + esc(e.abteilung) + ". " +
    (e.doppelt ? e.doppelt + " doppelte Zeilen aus der Datei wurden zusammengefasst. " : "") +
    (e.von_hand ? "<strong>" + e.von_hand + " davon sind von Hand zugeordnet.</strong> " : "") +
    (e.ohne_geburtsdatum
      ? "<strong>" + e.ohne_geburtsdatum + " Zeilen ohne Geburtsdatum</strong> blieben außen vor" +
        (e.ohne_geburtsdatum_namen && e.ohne_geburtsdatum_namen.length
          ? " (" + esc(e.ohne_geburtsdatum_namen.join(", ")) + ")" : "") + ". "
      : "") +
    (e.volljaehrig_verborgen
      ? e.volljaehrig_verborgen + " volljährige Fußball-Mitglieder dieser Jahrgänge sind " +
        "ebenfalls nicht gemeldet; ihre Namen sieht nur die Geschäftsstelle. "
      : "") +
    "Der Abgleich wird bei jedem Öffnen neu gerechnet; gespeichert sind die eingelesene " +
    "Liste und die Zuordnungen von Hand.</p>";

  let html = "";

  // --- Der Auswahlmodus ------------------------------------------------
  if (dfbWaehlt) {
    html += '<div class="karte dfb-waehlkarte"><div class="hinweis warn">' +
      "Zu wem gehört <strong>" + esc(dfbWaehlt.name) + "</strong> (" +
      esc(datumDe(dfbWaehlt.geburtsdatum)) + ")? " +
      "Bitte unten in <em>Fußball-Mitglied, aber nicht gemeldet</em> auf <em>Das ist er</em> " +
      "klicken — oder hier nach einem beliebigen Mitglied suchen." +
      ' <button type="button" class="btn grau klein" data-dfb="ab">Abbrechen</button>' +
      "</div>" +
      '<div class="feld"><label for="dfb-mitgliedsuche">Mitglied suchen ' +
      "(Name oder Mitgliedsnummer)</label>" +
      '<input id="dfb-mitgliedsuche" placeholder="z. B. Mustermann"></div>' +
      '<div class="knopfreihe">' +
      '<button type="button" class="btn grau" data-dfb="mitglied-suchen">Suchen</button></div>' +
      '<div id="dfb-mitgliedliste">' +
      (dfbMitgliedTreffer === null
        ? ""
        : (dfbMitgliedTreffer.length
            ? dfbMitgliedTreffer.map((m) =>
                '<div class="dfb-vorschlag"><strong>' + esc(m.vorname + " " + m.nachname) +
                "</strong> · " + esc(datumDe(m.geburtsdatum)) +
                (m.mitgliedsnummer ? " · Nr. " + esc(m.mitgliedsnummer) : "") +
                " · " + esc(m.sparten || "ohne Abteilung") +
                (m.status && m.status !== "aktiv" ? " · " + esc(m.status) : "") +
                '<button type="button" class="btn klein" data-dfb="zuordnen"' +
                dfbRohAttr(dfbWaehlt) + ' data-person="' + esc(m.person_id) +
                '">Zuordnen</button></div>').join("")
            : '<p class="fussnote">Kein Mitglied gefunden.</p>')) +
      "</div></div>";
  }

  // --- Gemeldet, aber nicht im Bestand --------------------------------
  html += '<div class="karte"><h2>Gemeldet, aber nicht als Fußball-Mitglied geführt ' +
    zahl(offen.length, offenAlle.length) + "</h2>";
  if (!offenAlle.length) {
    html += '<p class="fussnote">Keine. Jeder gemeldete Spieler ist Mitglied der ' +
      "Abteilung Fußball.</p>";
  } else if (!offen.length) {
    html += '<p class="fussnote">Kein Treffer für diesen Filter. ' + offenAlle.length +
      " Zeilen sind vorhanden.</p>";
  } else {
    html += '<p class="fussnote">Diese Spieler haben eine Spielberechtigung, stehen im ' +
      "Bestand aber nicht als Fußball-Mitglied. " +
      (offenUnklar
        ? "Bei " + offenUnklar + " davon findet sich überhaupt kein Eintrag — unter der " +
          "Zeile stehen dann bis zu drei ähnliche Namen mit Begründung. Passt keiner, " +
          "führt <em>Mitglied wählen</em> zur Suche über den ganzen Bestand. Steht dort " +
          "nichts, fehlt meist nicht die Zuordnung, sondern die Anmeldung."
        : "") + "</p>" +
      // ⚠️ Nur DREI Spalten, und die Lage steht als Plakette beim Namen.
      // Am Handy scrollt diese Tabelle in ihrer Huelle, und beim ersten
      // Wurf lag ausgerechnet die Spalte "Lage" hinter der Kante --
      // also genau die Auskunft, wegen der die Zeile hier steht. Der
      // erklaerende Satz steht deshalb in der Unterzeile, die am linken
      // Rand klebt und immer sichtbar bleibt. (Im Browser bei 375 px
      // gemessen: 407 px Tabelle in einer 317-px-Huelle.)
      '<div class="tabelle-scroll"><table><thead><tr>' +
        "<th>Name</th><th>Geboren</th><th>Mannschaft</th>" +
      "</tr></thead><tbody>" +
      offen.map((o) =>
        '<tr class="dfb-zeile">' +
          '<td class="umbruch">' + esc(o.name) + " " + dfbLageChip(o.lage) +
            (o.von_hand ? ' <span class="chip antrag">von Hand</span>' : "") +
            (o.aktiv === "nein" ? ' <span class="chip ruhend">Spielrecht ruht</span>' : "") +
          "</td>" +
          "<td>" + esc(datumDe(o.geburtsdatum)) + "</td>" +
          '<td class="umbruch">' + esc(o.mannschaft) + "</td>" +
        "</tr>" +
        '<tr class="dfb-vorschlag-zeile"><td colspan="3">' +
          '<div class="dfb-vorschlag-inhalt">' +
          '<span class="fussnote">' + esc(o.hinweis) + "</span>" +
          (o.vorschlaege || []).map((v) => dfbVorschlagZeile(o, v, e.vollbild)).join("") +
          (e.vollbild && o.lage === "unbekannt" && !o.von_hand && !(o.vorschlaege || []).length
            ? '<span class="fussnote">Kein ähnlicher Name im Bestand und in keinem ' +
              "offenen Aufnahmeantrag.</span>"
            : "") +
          (e.vollbild
            ? '<div class="knopfreihe dfb-zeilen-knoepfe">' +
              (o.von_hand
                ? '<button type="button" class="btn grau klein" data-dfb="aufheben"' +
                  dfbRohAttr(o) + ">Zuordnung aufheben</button>"
                : '<button type="button" class="btn grau klein" data-dfb="waehlen"' +
                  dfbRohAttr(o) + ' data-name="' + esc(o.name) + '">Mitglied wählen …</button>') +
              "</div>"
            : "") +
          "</div></td></tr>"
      ).join("") +
      "</tbody></table></div>";
  }
  html += "</div>";

  // --- Im Bestand, aber nicht gemeldet --------------------------------
  html += '<div class="karte"><h2>Fußball-Mitglied, aber nicht gemeldet ' +
    zahl(nichtGemeldet.length, e.nicht_gemeldet.length) + "</h2>";
  if (!e.nicht_gemeldet.length) {
    html += '<p class="fussnote">Keine. Für jedes Fußball-Mitglied dieser Jahrgänge liegt ' +
      "eine Spielberechtigung vor.</p>";
  } else if (!nichtGemeldet.length) {
    html += '<p class="fussnote">Kein Treffer für diesen Filter. ' + e.nicht_gemeldet.length +
      " Mitglieder sind vorhanden.</p>";
  } else {
    html += '<p class="fussnote">Diese Mitglieder zahlen Beitrag in der Abteilung Fußball, ' +
      "stehen aber in keiner Spielberechtigung der Datei. Das ist entweder eine fehlende " +
      "Spielerlaubnis — oder das Kind spielt gar nicht. Steht unter einem Namen der " +
      "Vermerk <em>vermutlich gemeldet als …</em>, gibt es einen gemeldeten Spieler mit " +
      "ähnlichem Namen: dann ist es <em>ein</em> Kind mit zwei Schreibweisen und kein " +
      "doppelter Fall." +
      (f.mannschaft
        ? " <strong>Der Mannschaftsfilter gilt hier nicht</strong> — eine Mannschaft steht " +
          "nur in der DFBnet-Datei, nicht am Mitglied."
        : "") + "</p>" +
      // ⚠️ Der Hinweis auf die andere Schreibweise steht UNTER dem Namen,
      // nicht in einer vierten Spalte. Als Spalte lag er am Handy hinter
      // der Kante (gemessen: 407 px in einer 317-px-Huelle) -- und er ist
      // die eine Angabe, wegen der man diese Zeile nicht bearbeiten muss.
      '<div class="tabelle-scroll"><table><thead><tr>' +
        "<th>Name</th><th>Geboren</th>" +
        (e.vollbild ? "<th>Nr.</th>" : "") +
      "</tr></thead><tbody>" +
      nichtGemeldet.map((n) =>
        "<tr>" +
          '<td class="umbruch">' + esc(n.name) +
            (n.status && n.status !== "aktiv"
              ? ' <span class="chip ruhend">' + esc(n.status) + "</span>" : "") +
            (n.vermutlich
              ? '<span class="fussnote">vermutlich gemeldet als „' + esc(n.vermutlich) +
                "“ — andere Schreibweise, dasselbe Kind</span>"
              : "") +
            // ⚠️ Der Knopf steht IN der Namensspalte, nicht in einer
            // eigenen. Als vierte Spalte lag er am Handy hinter der
            // Kante (gemessen: 347 px in einer 315-px-Huelle) -- und er
            // ist im Auswahlmodus das Einzige, was man anklicken soll.
            // Dieselbe Falle wie zweimal zuvor in diesem Reiter.
            (dfbWaehlt && n.person_id
              ? '<span class="fussnote"><button type="button" class="btn klein" ' +
                'data-dfb="zuordnen"' + dfbRohAttr(dfbWaehlt) +
                ' data-person="' + esc(n.person_id) + '">Das ist er</button></span>'
              : "") +
          "</td>" +
          "<td>" + esc(datumDe(n.geburtsdatum)) + "</td>" +
          (e.vollbild ? "<td>" + esc(n.mitgliedsnummer || "") + "</td>" : "") +
        "</tr>"
      ).join("") +
      "</tbody></table></div>";
  }
  html += "</div>";

  // --- Die Treffer, zuletzt und zugeklappt ----------------------------
  html += '<div class="karte"><details class="dfb-klapp"><summary><strong>Passt zusammen (' +
    (treffer.length === e.treffer.length
      ? e.treffer.length : treffer.length + " von " + e.treffer.length) + ")</strong></summary>" +
    '<p class="fussnote">Diese gemeldeten Spieler sind Mitglied der Abteilung Fußball. ' +
    "Hier ist nichts zu tun; die Liste steht nur zum Nachschlagen. Zeilen mit " +
    "<em>von Hand</em> wurden zugeordnet, weil der Name anders geschrieben ist — dort " +
    "lässt sich die Zuordnung auch wieder aufheben.</p>" +
    '<div class="tabelle-scroll"><table><thead><tr>' +
      "<th>Name</th><th>Geboren</th><th>Mannschaft</th>" +
      (e.vollbild ? "<th>Nr.</th>" : "") +
    "</tr></thead><tbody>" +
    treffer.map((t) =>
      "<tr>" +
        '<td class="umbruch">' + esc(t.name) +
          (t.von_hand ? ' <span class="chip antrag">von Hand</span>' : "") +
          (t.aktiv === "nein" ? ' <span class="chip ruhend">Spielrecht ruht</span>' : "") +
          (t.status && t.status !== "aktiv"
            ? ' <span class="chip ruhend">' + esc(t.status) + "</span>" : "") +
          (t.von_hand && t.mitglied !== t.name
            ? '<span class="fussnote">zugeordnet zu ' + esc(t.mitglied) + "</span>" : "") +
          (t.von_hand && e.vollbild
            ? '<span class="fussnote"><button type="button" class="btn grau klein" ' +
              'data-dfb="aufheben"' + dfbRohAttr(t) + ">Zuordnung aufheben</button></span>"
            : "") +
        "</td>" +
        "<td>" + esc(datumDe(t.geburtsdatum)) + "</td>" +
        '<td class="umbruch">' + esc(t.mannschaft) + "</td>" +
        (e.vollbild ? "<td>" + esc(t.mitgliedsnummer || "") + "</td>" : "") +
      "</tr>"
    ).join("") +
    "</tbody></table></div></details></div>";

  ziel.innerHTML = html;
}

// --- Abgleich laufen lassen -------------------------------------------

// ⚠️ Kein Stichtagsfeld. Der Abgleich beantwortet „wer spielt HEUTE ohne
// Mitgliedschaft" -- ein frei waehlbarer Stichtag machte daraus eine
// Frage, deren Antwort niemand nachvollziehen kann, sobald der Ausdruck
// auf dem Tisch liegt. Der Server nimmt den heutigen Tag.
async function dfbAbgleichen(meldung) {
  dfbMeldung("dfb-hinweis", meldung || "Abgleich läuft …", "info");
  const antwort = await vvRequest("vv-dfbnet-abgleich", {});
  dfbErgebnis = antwort;
  if (!antwort.leer) dfbMannschaftenFuellen(antwort);
  dfbMeldung("dfb-hinweis", "", "info");
  dfbZeichne();
}

async function dfbDateiGewaehlt(ereignis) {
  const datei = ereignis.target.files && ereignis.target.files[0];
  // ⚠️ Das Feld wird sofort geleert. Ohne das feuert `change` beim
  // zweiten Mal derselben Datei nicht -- und genau das tut man, wenn der
  // erste Lauf schiefging.
  ereignis.target.value = "";
  if (!datei || dfbLaeuft) return;

  // ⚠️ Die Rueckfrage steht VOR dem Lesen, nicht danach: ein neuer Export
  // ersetzt den gespeicherten, und wer das nicht will, soll es erfahren,
  // bevor etwas passiert.
  if (dfbErgebnis && !dfbErgebnis.leer &&
      !confirm("Die gespeicherte Meldeliste vom " +
               datumDe(String(dfbErgebnis.eingelesen_am || "").slice(0, 10)) +
               " wird durch diese Datei ersetzt. Fortfahren?")) {
    return;
  }

  dfbLaeuft = true;
  dfbWaehlt = null;
  dfbMitgliedTreffer = null;
  dfbMeldung("dfb-fehler", "", "fehler");
  dfbMeldung("dfb-hinweis", "Datei wird gelesen …", "info");
  try {
    const gelesen = await dfbDateiLesen(datei);
    dfbMeldung("dfb-hinweis", "Gelesen: " + gelesen.spieler.length + " Zeilen. " +
      "Wird gespeichert …", "info");
    await vvRequest("vv-dfbnet-import", {
      spieler: gelesen.spieler,
      // ⚠️ Nur der Dateiname, nicht der Pfad. Ein Pfad sagt etwas ueber
      // den Rechner der Geschaeftsstelle und nichts ueber die Meldung.
      dateiname: String(datei.name || "").slice(0, 200),
      blaetter: gelesen.blaetter.join(", ")
    });
    await dfbAbgleichen("Gespeichert. Abgleich läuft …");
  } catch (e) {
    dfbMeldung("dfb-hinweis", "", "info");
    dfbMeldung("dfb-fehler", esc(e && e.message ? e.message : String(e)), "fehler");
  } finally {
    dfbLaeuft = false;
  }
}

// --- Zuordnen ---------------------------------------------------------

async function dfbZuordnen(roh, personId) {
  if (dfbLaeuft) return;
  dfbLaeuft = true;
  dfbMeldung("dfb-fehler", "", "fehler");
  try {
    await vvRequest("vv-dfbnet-zuordnen", {
      vorname: roh.vorname, nachname: roh.nachname, geburtsdatum: roh.geburtsdatum,
      person_id: personId || null
    });
    dfbWaehlt = null;
    dfbMitgliedTreffer = null;
    await dfbAbgleichen(personId ? "Zugeordnet. Abgleich läuft neu …"
                                 : "Zuordnung aufgehoben. Abgleich läuft neu …");
  } catch (e) {
    dfbMeldung("dfb-hinweis", "", "info");
    dfbMeldung("dfb-fehler", esc(e && e.message ? e.message : String(e)), "fehler");
  } finally {
    dfbLaeuft = false;
  }
}

// Sucht ueber die bestehende Mitgliederliste. ⚠️ Bewusst keine eigene
// Aktion: `vv-mitglieder-liste` kann das laengst, haengt an
// darfPersonenSehen und filtert einen Abteilungsleiter serverseitig auf
// seine Sparte. Eine zweite Suche waere eine zweite Rechtegrenze.
async function dfbMitgliedSuchen() {
  const feld = $("dfb-mitgliedsuche");
  const suche = feld ? feld.value.trim() : "";
  if (!suche) return;
  dfbMeldung("dfb-fehler", "", "fehler");
  try {
    const antwort = await vvRequest("vv-mitglieder-liste", { suche, limit: 8 });
    dfbMitgliedTreffer = antwort.zeilen || [];
    dfbZeichne();
    const neu = $("dfb-mitgliedsuche");
    if (neu) { neu.value = suche; neu.focus(); }
  } catch (e) {
    dfbMeldung("dfb-fehler", esc(e && e.message ? e.message : String(e)), "fehler");
  }
}

// --- Verdrahtung ------------------------------------------------------

function ladeDfbnet() {
  const feld = $("dfb-datei");
  if (!feld || feld.dataset.verdrahtet) { dfbZeichne(); return; }
  feld.dataset.verdrahtet = "1";
  feld.addEventListener("change", dfbDateiGewaehlt);

  // ⚠️ Der Knopf loescht jetzt wirklich etwas und fragt deshalb nach.
  // Vorher hiess er "Ergebnis schliessen" und warf nur eine Anzeige weg.
  $("dfb-weg").addEventListener("click", async () => {
    if (dfbLaeuft) return;
    if (!confirm("Die gespeicherte Meldeliste wird gelöscht. Die von Hand gesetzten " +
                 "Zuordnungen bleiben erhalten. Fortfahren?")) return;
    dfbLaeuft = true;
    dfbWaehlt = null;
    dfbMitgliedTreffer = null;
    dfbMeldung("dfb-fehler", "", "fehler");
    try {
      await vvRequest("vv-dfbnet-import", { loeschen: true });
      await dfbAbgleichen("Gelöscht.");
    } catch (e) {
      dfbMeldung("dfb-hinweis", "", "info");
      dfbMeldung("dfb-fehler", esc(e && e.message ? e.message : String(e)), "fehler");
    } finally {
      dfbLaeuft = false;
    }
  });

  // Die Filterfelder stehen im HTML und ueberleben das Neuzeichnen.
  for (const id of ["dfb-f-suche", "dfb-f-mannschaft", "dfb-f-lage"]) {
    const el = $(id);
    if (el) el.addEventListener("input", dfbZeichne);
  }
  const zurueck = $("dfb-f-weg");
  if (zurueck) {
    zurueck.addEventListener("click", () => {
      for (const id of ["dfb-f-suche", "dfb-f-mannschaft", "dfb-f-lage"]) {
        const el = $(id);
        if (el) el.value = "";
      }
      dfbZeichne();
    });
  }

  // ⚠️ EIN Zuhoerer am Behaelter statt einer je Knopf: der Inhalt wird
  // bei jedem Zeichnen ersetzt, und einzeln verdrahtete Knoepfe waeren
  // nach der ersten Zuordnung tot.
  $("dfb-ergebnis").addEventListener("click", (ev) => {
    const knopf = ev.target.closest("[data-dfb]");
    if (!knopf) return;
    const was = knopf.dataset.dfb;
    const roh = {
      vorname: knopf.dataset.vorname || "",
      nachname: knopf.dataset.nachname || "",
      geburtsdatum: knopf.dataset.geb || "",
      name: knopf.dataset.name || ""
    };
    if (was === "zuordnen") dfbZuordnen(roh, knopf.dataset.person);
    else if (was === "aufheben") dfbZuordnen(roh, null);
    else if (was === "waehlen") {
      dfbWaehlt = roh;
      dfbMitgliedTreffer = null;
      dfbZeichne();
      const k = document.querySelector(".dfb-waehlkarte");
      // ⚠️ Ohne behavior:"smooth" -- mit smooth blieb scrollY auf 0, und
      // die Karte erschien, ohne dass jemand sie zu sehen bekam.
      if (k) k.scrollIntoView({ block: "start" });
    } else if (was === "ab") {
      dfbWaehlt = null;
      dfbMitgliedTreffer = null;
      dfbZeichne();
    } else if (was === "mitglied-suchen") dfbMitgliedSuchen();
  });

  // Enter im Suchfeld sucht, statt das Formular zu nichts zu bewegen.
  $("dfb-ergebnis").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && ev.target && ev.target.id === "dfb-mitgliedsuche") {
      ev.preventDefault();
      dfbMitgliedSuchen();
    }
  });

  dfbZeichne();
  // Den gespeicherten Stand holen. ⚠️ Ein Fehlschlag darf den Reiter
  // nicht leer lassen: dfbZeichne() hat oben bereits den Wartetext
  // gesetzt, hier kommt nur die Meldung dazu.
  dfbAbgleichen("Abgleich wird geladen …").catch((e) => {
    dfbMeldung("dfb-hinweis", "", "info");
    dfbMeldung("dfb-fehler", esc(e && e.message ? e.message : String(e)), "fehler");
  });
}
