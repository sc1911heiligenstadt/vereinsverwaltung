// DFBnet-Abgleich -- Reiter „DFBnet Spieler"
//
// Liest den Export der Spielberechtigungen (XLSX) im BROWSER, schickt aus
// jeder Zeile genau fuenf Felder an den Worker und zeigt, was zwischen
// beiden Listen klafft.
//
// ⚠️ Es wird nichts gespeichert -- weder in D1 noch im localStorage. Die
// Datei ist eine Momentaufnahme aus dem DFBnet; sie irgendwo abzulegen
// hiesse, einen zweiten, alternden Bestand neben dem echten zu fuehren.
// Ein neuer Abgleich ist ein Klick, ein veralteter Stand waere ein
// Dauerproblem. (Dieselbe Ueberlegung wie bei reha.js -- dort gewinnt der
// localStorage, weil die Verbandserhebung nur einmal im Jahr erscheint
// und in eine Meldedatei einfliesst; hier wird nichts weitergerechnet.)
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
// Anzeige
// ---------------------------------------------------------------------

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

function dfbVorschlagZeile(v) {
  return '<div class="dfb-vorschlag">' +
    "<strong>" + esc(v.name) + "</strong> · " + esc(datumDe(v.geburtsdatum)) +
    (v.mitgliedsnummer ? " · Nr. " + esc(v.mitgliedsnummer) : "") +
    " · " + esc(v.herkunft) +
    '<span class="fussnote">' + esc((v.gruende || []).join(" · ")) + "</span></div>";
}

function dfbZeichne() {
  const ziel = $("dfb-ergebnis");
  if (!ziel) return;
  const e = dfbErgebnis;
  if (!e) {
    ziel.innerHTML = "";
    $("dfb-stand").innerHTML = '<p class="fussnote">Noch keine Datei eingelesen. ' +
      "Der Abgleich läuft gegen die Abteilung Fußball und vergleicht nur die " +
      "Jahrgänge, die in der Datei wirklich vorkommen.</p>";
    return;
  }

  const offenUnklar = e.offen.filter((o) => o.lage === "unbekannt").length;

  $("dfb-stand").innerHTML =
    '<div class="hinweis ' + ((e.offen.length || e.nicht_gemeldet.length) ? "warn" : "erfolg") + '">' +
      "<strong>" + e.anzahl_gemeldet + "</strong> gemeldete Spieler aus der Datei, " +
      "<strong>" + e.anzahl_bestand + "</strong> Fußball-Mitglieder der Jahrgänge " +
      e.jahrgang_von + "–" + e.jahrgang_bis + " im Bestand. " +
      "<strong>" + e.treffer.length + "</strong> passen zusammen." +
    "</div>" +
    '<p class="fussnote">Abgeglichen zum ' + esc(datumDe(e.stichtag)) +
    " gegen die Abteilung " + esc(e.abteilung) + ". " +
    (e.doppelt ? e.doppelt + " doppelte Zeilen aus der Datei wurden zusammengefasst. " : "") +
    (e.ohne_geburtsdatum
      ? "<strong>" + e.ohne_geburtsdatum + " Zeilen ohne Geburtsdatum</strong> blieben außen vor" +
        (e.ohne_geburtsdatum_namen && e.ohne_geburtsdatum_namen.length
          ? " (" + esc(e.ohne_geburtsdatum_namen.join(", ")) + ")" : "") + ". "
      : "") +
    (e.volljaehrig_verborgen
      ? e.volljaehrig_verborgen + " volljährige Fußball-Mitglieder dieser Jahrgänge sind " +
        "ebenfalls nicht gemeldet; ihre Namen sieht nur die Geschäftsstelle. "
      : "") +
    "Es wurde nichts gespeichert — der Abgleich ist eine reine Gegenüberstellung.</p>";

  let html = "";

  // --- Gemeldet, aber nicht im Bestand --------------------------------
  html += '<div class="karte"><h2>Gemeldet, aber nicht als Fußball-Mitglied geführt ' +
    '<span class="version-badge">' + e.offen.length + "</span></h2>";
  if (!e.offen.length) {
    html += '<p class="fussnote">Keine. Jeder gemeldete Spieler ist Mitglied der ' +
      "Abteilung Fußball.</p>";
  } else {
    html += '<p class="fussnote">Diese Spieler haben eine Spielberechtigung, stehen im ' +
      "Bestand aber nicht als Fußball-Mitglied. " +
      (offenUnklar
        ? "Bei " + offenUnklar + " davon findet sich überhaupt kein Eintrag — unter der " +
          "Zeile stehen dann bis zu drei ähnliche Namen mit Begründung. Steht dort nichts, " +
          "fehlt meist nicht die Zuordnung, sondern die Anmeldung."
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
      e.offen.map((o) =>
        '<tr class="dfb-zeile">' +
          '<td class="umbruch">' + esc(o.name) + " " + dfbLageChip(o.lage) +
            (o.aktiv === "nein" ? ' <span class="chip ruhend">Spielrecht ruht</span>' : "") +
          "</td>" +
          "<td>" + esc(datumDe(o.geburtsdatum)) + "</td>" +
          '<td class="umbruch">' + esc(o.mannschaft) + "</td>" +
        "</tr>" +
        '<tr class="dfb-vorschlag-zeile"><td colspan="3">' +
          '<div class="dfb-vorschlag-inhalt">' +
          '<span class="fussnote">' + esc(o.hinweis) + "</span>" +
          ((o.vorschlaege && o.vorschlaege.length)
            ? o.vorschlaege.map(dfbVorschlagZeile).join("")
            : (o.lage === "unbekannt" && e.vollbild
                ? '<span class="fussnote">Kein ähnlicher Name im Bestand und in keinem ' +
                  "offenen Aufnahmeantrag.</span>"
                : "")) +
          "</div></td></tr>"
      ).join("") +
      "</tbody></table></div>";
  }
  html += "</div>";

  // --- Im Bestand, aber nicht gemeldet --------------------------------
  html += '<div class="karte"><h2>Fußball-Mitglied, aber nicht gemeldet ' +
    '<span class="version-badge">' + e.nicht_gemeldet.length + "</span></h2>";
  if (!e.nicht_gemeldet.length) {
    html += '<p class="fussnote">Keine. Für jedes Fußball-Mitglied dieser Jahrgänge liegt ' +
      "eine Spielberechtigung vor.</p>";
  } else {
    html += '<p class="fussnote">Diese Mitglieder zahlen Beitrag in der Abteilung Fußball, ' +
      "stehen aber in keiner Spielberechtigung der Datei. Das ist entweder eine fehlende " +
      "Spielerlaubnis — oder das Kind spielt gar nicht. Steht unter einem Namen der " +
      "Vermerk <em>vermutlich gemeldet als …</em>, gibt es einen gemeldeten Spieler mit " +
      "ähnlichem Namen: dann ist es <em>ein</em> Kind mit zwei Schreibweisen und kein " +
      "doppelter Fall.</p>" +
      // ⚠️ Der Hinweis auf die andere Schreibweise steht UNTER dem Namen,
      // nicht in einer vierten Spalte. Als Spalte lag er am Handy hinter
      // der Kante (gemessen: 407 px in einer 317-px-Huelle) -- und er ist
      // die eine Angabe, wegen der man diese Zeile nicht bearbeiten muss.
      '<div class="tabelle-scroll"><table><thead><tr>' +
        "<th>Name</th><th>Geboren</th>" +
        (e.vollbild ? "<th>Nr.</th>" : "") +
      "</tr></thead><tbody>" +
      e.nicht_gemeldet.map((n) =>
        "<tr>" +
          '<td class="umbruch">' + esc(n.name) +
            (n.status && n.status !== "aktiv"
              ? ' <span class="chip ruhend">' + esc(n.status) + "</span>" : "") +
            (n.vermutlich
              ? '<span class="fussnote">vermutlich gemeldet als „' + esc(n.vermutlich) +
                "“ — andere Schreibweise, dasselbe Kind</span>"
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
    e.treffer.length + ")</strong></summary>" +
    '<p class="fussnote">Diese gemeldeten Spieler sind Mitglied der Abteilung Fußball. ' +
    "Hier ist nichts zu tun; die Liste steht nur zum Nachschlagen.</p>" +
    '<div class="tabelle-scroll"><table><thead><tr>' +
      "<th>Name</th><th>Geboren</th><th>Mannschaft</th>" +
      (e.vollbild ? "<th>Nr.</th>" : "") +
    "</tr></thead><tbody>" +
    e.treffer.map((t) =>
      "<tr>" +
        '<td class="umbruch">' + esc(t.name) +
          (t.aktiv === "nein" ? ' <span class="chip ruhend">Spielrecht ruht</span>' : "") +
          (t.status && t.status !== "aktiv"
            ? ' <span class="chip ruhend">' + esc(t.status) + "</span>" : "") +
        "</td>" +
        "<td>" + esc(datumDe(t.geburtsdatum)) + "</td>" +
        '<td class="umbruch">' + esc(t.mannschaft) + "</td>" +
        (e.vollbild ? "<td>" + esc(t.mitgliedsnummer || "") + "</td>" : "") +
      "</tr>"
    ).join("") +
    "</tbody></table></div></details></div>";

  ziel.innerHTML = html;
}

async function dfbDateiGewaehlt(ereignis) {
  const datei = ereignis.target.files && ereignis.target.files[0];
  // ⚠️ Das Feld wird sofort geleert. Ohne das feuert `change` beim
  // zweiten Mal derselben Datei nicht -- und genau das tut man, wenn der
  // erste Lauf schiefging.
  ereignis.target.value = "";
  if (!datei || dfbLaeuft) return;

  dfbLaeuft = true;
  dfbMeldung("dfb-fehler", "", "fehler");
  dfbMeldung("dfb-hinweis", "Datei wird gelesen …", "info");
  try {
    const gelesen = await dfbDateiLesen(datei);
    dfbMeldung("dfb-hinweis", "Gelesen: " + gelesen.spieler.length + " Zeilen aus " +
      esc(gelesen.blaetter.join(", ")) + ". Abgleich läuft …", "info");
    // ⚠️ Kein Stichtagsfeld. Der Abgleich beantwortet „wer spielt HEUTE
    // ohne Mitgliedschaft" -- ein frei waehlbarer Stichtag machte daraus
    // eine Frage, deren Antwort niemand nachvollziehen kann, sobald der
    // Ausdruck auf dem Tisch liegt. Der Server nimmt den heutigen Tag.
    const antwort = await vvRequest("vv-dfbnet-abgleich", { spieler: gelesen.spieler });
    dfbErgebnis = antwort;
    dfbMeldung("dfb-hinweis", "", "info");
    dfbZeichne();
    $("dfb-weg").hidden = false;
  } catch (e) {
    dfbErgebnis = null;
    dfbZeichne();
    dfbMeldung("dfb-hinweis", "", "info");
    dfbMeldung("dfb-fehler", esc(e && e.message ? e.message : String(e)), "fehler");
  } finally {
    dfbLaeuft = false;
  }
}

function ladeDfbnet() {
  const feld = $("dfb-datei");
  if (!feld || feld.dataset.verdrahtet) { dfbZeichne(); return; }
  feld.dataset.verdrahtet = "1";
  feld.addEventListener("change", dfbDateiGewaehlt);
  $("dfb-weg").addEventListener("click", () => {
    dfbErgebnis = null;
    $("dfb-weg").hidden = true;
    dfbMeldung("dfb-fehler", "", "fehler");
    dfbZeichne();
  });
  dfbZeichne();
}
