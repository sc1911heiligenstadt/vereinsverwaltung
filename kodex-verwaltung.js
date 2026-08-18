// Reiter „Elternkodex" der Verwaltung.
//
// Zwei Fragen auf einem Blatt:
//   1. Welche minderjaehrigen Mitglieder haben die Kenntnisnahme noch nicht
//      abgegeben? (Liste „offen")
//   2. Welche Erklaerungen sind eingegangen, passen aber zu keinem Kind?
//      (Karte „Nicht zuzuordnen")
//
// ⚠️ Der Kodex gilt AUSSCHLIESSLICH der Abteilung Fussball
// (Michel-Vorgabe vom 18.08.2026). Es gibt deshalb keinen
// Abteilungs-Filter: die Abteilung ist eine Festlegung des Vereins, keine
// Ansichtssache. Der Server entscheidet sie und nennt sie in der Antwort
// (`abteilung`); die Oberflaeche zeigt sie im Stand mit an, damit niemand
// die Zahl fuer den ganzen Verein liest.
//
// ⚠️ Die zweite Frage ist die wichtigere. Eine Erklaerung mit abweichender
// Schreibweise ist abgegeben, die Familie haelt sie fuer erledigt -- ohne
// diese Karte stuende sie in keiner Uebersicht und niemand erfuehre davon.
// Deshalb hat sie eine eigene Karte mit Zaehler und nicht eine Zeile
// irgendwo unten.

const KO_ADRESSE = "https://sc1911heiligenstadt.github.io/vereinsverwaltung/kodex.html";

const KO_SICHT = {
  offen: "Noch offen",
  bestaetigt: "Bestätigt",
  alle: "Alle"
};

let koSicht = "offen";
let koDaten = null;      // die letzte Antwort von vv-kodex-liste
let koSuche = "";

// Sortierung. Gleiches Muster wie die Mitgliederliste in app.js: immer
// genau EINE Spalte, erster Klick aufsteigend, zweiter dreht um.
//
// ⚠️ Hier wird im BROWSER sortiert, nicht im Server. Die Liste kommt
// vollstaendig in einer Antwort (kein Blaettern) -- ein Aufruf je
// Kopfklick waere Verschwendung, und die Suche filtert ohnehin schon
// clientseitig. Die Vorgabe entspricht dem, was der Server liefert
// (nachname, vorname), damit der Pfeil zur ersten Anzeige passt.
let koSort = "name";
let koSortAb = false;
// Bei der Handzuordnung: die Erklaerung, fuer die gerade ein Kind gesucht
// wird. Ohne den Merker wuesste der Klick auf ein Kind nicht, wohin.
let koZuordnenId = null;

// ---------------------------------------------------------------------
// Laden
// ---------------------------------------------------------------------

async function ladeKodex() {
  const ziel = $("ko-liste");
  ziel.innerHTML = '<div class="leer">Wird geladen …</div>';
  koMeldung("");

  let antwort;
  try {
    antwort = await ladeKodexListe();
  } catch (e) {
    // Die Tabelle entsteht in der Migration. Antwortet der Server mit 409,
    // ist sie noch nicht da -- das ist keine Stoerung, sondern eine noch
    // nicht gelaufene Einrichtung, und der Text sagt es genau so.
    ziel.innerHTML = '<div class="hinweis ' +
      (e && e.message && /Einrichtung/.test(e.message) ? "warn" : "fehler") + '">' +
      esc(e.message) + "</div>";
    return;
  }

  koDaten = antwort;
  zeichneKodexStand();
  zeichneKodexReiter();
  zeichneKodexListe();
  zeichneKodexOffene();
  zeichneKodexVerteilen();
}

// ---------------------------------------------------------------------
// Kopf: Stand und Verteilen
// ---------------------------------------------------------------------

function koMeldung(text, art) {
  const erfolg = $("ko-erfolg");
  const fehler = $("ko-fehler");
  erfolg.hidden = true;
  fehler.hidden = true;
  if (!text) return;
  const feld = art === "fehler" ? fehler : erfolg;
  feld.textContent = text;
  feld.hidden = false;
}

function zeichneKodexStand() {
  const kinder = koDaten.kinder || [];
  const fertig = kinder.filter((k) => k.bestaetigung_id).length;
  const offen = kinder.length - fertig;
  const anteil = kinder.length ? Math.round((fertig / kinder.length) * 100) : 0;

  // ⚠️ Die Abteilung wird MITGENANNT. Ohne sie liest man „4 von 12" als
  // Aussage über den ganzen Verein — der Kodex gilt aber nur dem Fußball.
  const abteilung = koDaten.abteilung || "Fußball";

  $("ko-stand").innerHTML =
    '<div class="hinweis ' + (offen === 0 && kinder.length ? "erfolg" : "info") + '">' +
      "<strong>" + fertig + " von " + kinder.length + "</strong> minderjährigen " +
      "Mitgliedern der Abteilung <strong>" + esc(abteilung) + "</strong> liegt die " +
      "Kenntnisnahme vor (" + anteil + " %)." +
      (offen ? " <strong>" + offen + "</strong> " +
               (offen === 1 ? "fehlt" : "fehlen") + " noch." : "") +
    "</div>" +
    '<p class="fussnote">Stichtag ' + esc(datumDe(koDaten.stichtag)) +
    ", Fassung des Kodex: " + esc(koDaten.kodex_version || "—") + ".</p>";
}

// Der Link und der Schalter. Nur mit Schreibrecht -- den Eingangsweg des
// ganzen Vereins zuzudrehen ist kein Leserecht, und der Server weist die
// Aktion einer Nur-Lese-Rolle ohnehin ab.
async function zeichneKodexVerteilen() {
  if (!koDaten.darf_schreiben) {
    $("ko-verteilen-karte").hidden = true;
    return;
  }
  $("ko-verteilen-karte").hidden = false;
  $("ko-link").value = KO_ADRESSE;

  const ziel = $("ko-schalter");
  let antwort;
  try {
    antwort = await vvRequest("vv-einstellungen", {});
  } catch (e) {
    ziel.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }
  const feld = (antwort.felder || []).find((f) => f.schluessel === "kodex_offen");
  // Fehlt der Schluessel, gilt die Vorgabe des Servers (1 = offen). Ein
  // fehlender Wert darf nicht als „geschlossen" erscheinen -- dann suchte
  // jemand einen Schalter, der gar nicht umgelegt ist.
  const offen = !feld || feld.wert === null || feld.wert === undefined || feld.wert === ""
    || feld.wert === "1";

  ziel.innerHTML =
    '<div class="hinweis ' + (offen ? "erfolg" : "warn") + '" style="margin-top:12px">' +
      "Die Seite ist zurzeit <strong>" + (offen ? "geöffnet" : "geschlossen") + "</strong>." +
      (offen ? "" : " Wer den Link aufruft, bekommt einen Hinweis auf die Geschäftsstelle.") +
    "</div>" +
    '<div class="knopfreihe"><button class="btn ' + (offen ? "warn" : "") +
      '" id="btn-ko-umschalten">' +
      (offen ? "Seite schließen" : "Seite öffnen") + "</button></div>";

  $("btn-ko-umschalten").addEventListener("click", () => schalteKodex(offen ? "0" : "1"));
}

async function schalteKodex(wert) {
  try {
    await vvRequest("vv-einstellung-setzen", { schluessel: "kodex_offen", wert });
  } catch (e) {
    koMeldung(e.message, "fehler");
    return;
  }
  koMeldung(wert === "1" ? "Die Seite ist jetzt geöffnet."
                         : "Die Seite ist jetzt geschlossen.");
  zeichneKodexVerteilen();
}

// ---------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------

function zeichneKodexReiter() {
  const kinder = koDaten.kinder || [];
  const zahl = {
    offen: kinder.filter((k) => !k.bestaetigung_id).length,
    bestaetigt: kinder.filter((k) => k.bestaetigung_id).length,
    alle: kinder.length
  };
  $("ko-reiter").innerHTML = Object.keys(KO_SICHT).map((s) =>
    '<button class="btn klein ' + (s === koSicht ? "" : "grau") + '" data-kosicht="' +
    s + '">' + KO_SICHT[s] + " (" + zahl[s] + ")</button>").join(" ");

  $("ko-reiter").querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      koSicht = b.dataset.kosicht;
      zeichneKodexReiter();
      zeichneKodexListe();
    });
  });
}

// ---------------------------------------------------------------------
// Die Kinderliste
// ---------------------------------------------------------------------

// Die Spalten der Kinderliste. `wert` liefert den Sortierschluessel --
// bewusst getrennt von der Anzeige: „31.03.2015" sortiert als Text falsch,
// sortiert werden muss das ISO-Datum darunter.
const KO_SPALTEN = [
  { schluessel: "name",     text: "Name",
    wert: (k) => (k.nachname + " " + k.vorname).toLowerCase() },
  { schluessel: "geboren",  text: "Geboren",
    wert: (k) => k.geburtsdatum || "" },
  { schluessel: "nummer",   text: "Nr.",
    // ⚠️ Numerisch, nicht als Text: sonst stuende „1000" vor „658".
    // Nicht rein numerische Nummern (Testdaten wie „T417293841") fallen
    // auf den Text zurueck und sortieren hinter die Zahlen.
    wert: (k) => {
      const n = Number(k.mitgliedsnummer);
      return Number.isFinite(n) && /^[0-9]+$/.test(String(k.mitgliedsnummer || ""))
        ? n : Number.MAX_SAFE_INTEGER;
    },
    zweit: (k) => String(k.mitgliedsnummer || "") },
  { schluessel: "stand",    text: "Kenntnisnahme",
    // Offen zuerst -- wer noch fehlt, ist die Arbeit.
    wert: (k) => (k.bestaetigung_id ? 1 : 0) },
  { schluessel: "wann",     text: "Unterschrieben am",
    wert: (k) => k.bestaetigt_am || "" },
  { schluessel: "vonwem",   text: "Unterschrieben von",
    wert: (k) => (k.erz_name || "").toLowerCase() }
];

// Erster Klick auf eine neue Spalte sortiert aufsteigend, ein zweiter
// dreht um -- wie in der Mitgliederliste.
function waehleKodexSortierung(schluessel) {
  if (koSort === schluessel) koSortAb = !koSortAb;
  else { koSort = schluessel; koSortAb = false; }
  zeichneKodexListe();
}

function koSortiert(zeilen) {
  const spalte = KO_SPALTEN.find((s) => s.schluessel === koSort) || KO_SPALTEN[0];
  const name = KO_SPALTEN[0];
  // Kopie sortieren, nicht koDaten.kinder -- die Antwort bleibt, wie der
  // Server sie geschickt hat.
  return zeilen.slice().sort((a, b) => {
    const va = spalte.wert(a), vb = spalte.wert(b);
    let d = 0;
    if (va < vb) d = -1;
    else if (va > vb) d = 1;
    // ⚠️ LEERE WERTE immer nach hinten, in BEIDEN Richtungen. Ein Kind
    // ohne Datum hat keins -- es gehoert nicht an die Spitze, nur weil man
    // absteigend sortiert. Sonst sucht man die neuesten Unterschriften und
    // sieht zuerst eine Seite voll offener Zeilen.
    const leerA = va === "" || va === null || va === undefined;
    const leerB = vb === "" || vb === null || vb === undefined;
    if (leerA !== leerB) return leerA ? 1 : -1;
    if (d === 0 && spalte.zweit) {
      const za = spalte.zweit(a), zb = spalte.zweit(b);
      d = za < zb ? -1 : za > zb ? 1 : 0;
    }
    if (d !== 0) return koSortAb ? -d : d;
    // Gleichstand: nach Namen, damit die Reihenfolge zwischen zwei
    // Zeichnungen stabil bleibt.
    const na = name.wert(a), nb = name.wert(b);
    return na < nb ? -1 : na > nb ? 1 : 0;
  });
}

function koPasst(k) {
  if (koSicht === "offen" && k.bestaetigung_id) return false;
  if (koSicht === "bestaetigt" && !k.bestaetigung_id) return false;
  if (!koSuche) return true;
  return (k.vorname + " " + k.nachname).toLowerCase().includes(koSuche);
}

function zeichneKodexListe() {
  const ziel = $("ko-liste");
  const zeilen = (koDaten.kinder || []).filter(koPasst);

  if (!zeilen.length) {
    ziel.innerHTML = '<div class="leer">' +
      (koSuche ? "Kein Kind gefunden."
        : koSicht === "offen"
          ? "Von allen minderjährigen Mitgliedern liegt die Kenntnisnahme vor."
          : "Keine Einträge.") + "</div>";
    return;
  }

  // Beim Zuordnen ist die Liste die AUSWAHL: ein Klick auf ein Kind
  // verbindet die vorgemerkte Erklaerung damit. Der Hinweis muss über der
  // Liste stehen, sonst klickt jemand und wundert sich.
  const zuordnen = !!koZuordnenId;

  const kopf = KO_SPALTEN.map((sp) => {
    const aktiv = koSort === sp.schluessel;
    return '<th class="sortierbar' + (aktiv ? " aktiv" : "") + '"' +
      ' data-kosort="' + sp.schluessel + '" tabindex="0" role="button"' +
      ' title="Nach ' + esc(sp.text) + ' sortieren">' +
      esc(sp.text) + '<span class="pfeil">' +
      (aktiv ? (koSortAb ? "▼" : "▲") : "") + "</span></th>";
  }).join("");

  ziel.innerHTML =
    (zuordnen
      ? '<div class="hinweis warn">Bitte das Kind anklicken, zu dem die vorgemerkte ' +
        "Erklärung gehört. " +
        '<button class="btn grau klein" id="btn-ko-zuordnen-ab">Abbrechen</button></div>'
      : "") +
    '<div class="tabelle-scroll"><table><thead><tr>' +
    kopf + "<th></th>" +
    "</tr></thead><tbody>" +
    koSortiert(zeilen).map((k) =>
      '<tr class="ko-kind" data-person="' + esc(k.person_id) + '">' +
        '<td class="name">' + esc(k.vorname + " " + k.nachname) + "</td>" +
        "<td>" + esc(datumDe(k.geburtsdatum)) + "</td>" +
        "<td>" + esc(k.mitgliedsnummer || "") + "</td>" +
        // Der Chip sagt nur noch den STAND. Das Datum steht in seiner
        // eigenen Spalte -- sonst liesse es sich nicht danach sortieren,
        // und „Kenntnisnahme: 18.08.2026" beantwortet die Frage „liegt sie
        // vor?" nur auf Umwegen.
        "<td>" + (k.bestaetigung_id
          ? '<span class="chip aktiv">liegt vor</span>' +
            (k.von_hand ? ' <span class="chip ruhend">von Hand</span>' : "") +
            // ⚠️ Eine ersetzte Erklärung sieht sonst aus wie jede andere.
            // Die Familie korrigiert sich selbst — oder jemand Fremdes hat
            // überschrieben; welches von beidem, steht im Detail.
            (k.ersetzt ? ' <span class="chip ruhend">' + k.ersetzt + "× ersetzt</span>" : "")
          : '<span class="chip gekuendigt">offen</span>') + "</td>" +
        "<td>" + esc(k.bestaetigt_am ? datumDe(k.bestaetigt_am) : "") + "</td>" +
        "<td>" + esc(k.erz_name || "") + "</td>" +
        "<td>" + (k.bestaetigung_id && !zuordnen
          ? '<button class="btn grau klein" data-ko-detail="' + esc(k.bestaetigung_id) +
            '">Ansehen</button>'
          : "") + "</td>" +
      "</tr>").join("") +
    "</tbody></table></div>";

  // Sortieren per Klick und per Tastatur -- ein Kopf, der nur mit der Maus
  // geht, ist für Tastaturnutzer keiner.
  ziel.querySelectorAll("th.sortierbar").forEach((th) => {
    const sortiere = () => waehleKodexSortierung(th.dataset.kosort);
    th.addEventListener("click", sortiere);
    th.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sortiere(); }
    });
  });

  ziel.querySelectorAll("[data-ko-detail]").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      zeigeKodexDetail(b.dataset.koDetail);
    });
  });

  if (zuordnen) {
    ziel.querySelectorAll("tr.ko-kind").forEach((tr) => {
      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => fuehreZuordnungAus(tr.dataset.person));
    });
    $("btn-ko-zuordnen-ab").addEventListener("click", () => {
      koZuordnenId = null;
      koMeldung("");
      zeichneKodexListe();
    });
  }
}

// ---------------------------------------------------------------------
// Nicht zuzuordnende Erklaerungen
// ---------------------------------------------------------------------

function zeichneKodexOffene() {
  const liste = koDaten.offene_eingaenge || [];
  const karte = $("ko-offen-karte");

  if (!liste.length) { karte.hidden = true; return; }
  karte.hidden = false;
  $("ko-offen-zahl").textContent = liste.length;

  $("ko-offen-liste").innerHTML =
    '<div class="tabelle-scroll"><table><thead><tr>' +
    "<th>Eingang</th><th>Kind (Angabe der Eltern)</th><th>Geboren</th>" +
    "<th>Mannschaft</th><th>Unterschrieben von</th><th>E-Mail</th><th></th>" +
    "</tr></thead><tbody>" +
    liste.map((b) =>
      "<tr>" +
        "<td>" + esc(datumDe(b.eingang_am)) + "</td>" +
        '<td class="name">' + esc(b.kind_vorname + " " + b.kind_nachname) +
          // Eine Handzuordnung, die auf ein Kind zeigt, das nicht mehr in
          // der Liste steht (ausgetreten, volljaehrig, andere Abteilung).
          // Kein Fehler -- aber ohne den Hinweis sähe es nach einem aus.
          (b.zugeordnet
            ? ' <span class="chip ruhend">zugeordnet, nicht in der Liste</span>' : "") +
          // ⚠️ Nicht dasselbe wie „unbekannt": das Kind IST Mitglied und
          // minderjährig, nur nicht im Fußball. Hier ist nichts zu tun —
          // ohne den Vermerk sucht man einen Tippfehler, den es nicht gibt.
          (b.andere_abteilung
            ? ' <span class="chip ruhend">andere Abteilung — nichts zu tun</span>' : "") +
          // ⚠️ Auch hier, nicht nur in der Kinderliste. Genau diese Zeilen
          // sind die ungeklärten — eine davon mehrfach ersetzt zu sehen ist
          // der Hinweis, der die Geschäftsstelle zum Nachfragen bringt.
          // Beim ersten Wurf stand der Chip nur oben; im Browser gemessen
          // gefunden, nicht durch Lesen des Codes.
          (b.ersetzt ? ' <span class="chip ruhend">' + b.ersetzt +
                       "× ersetzt</span>" : "") +
          "</td>" +
        "<td>" + esc(datumDe(b.kind_geburtsdatum)) + "</td>" +
        "<td>" + esc(b.mannschaft || "") + "</td>" +
        "<td>" + esc(b.erz_name || "") + "</td>" +
        "<td>" + (b.erz_email
          ? '<a href="mailto:' + esc(b.erz_email) + '">' + esc(b.erz_email) + "</a>" : "") +
          "</td>" +
        '<td><button class="btn grau klein" data-ko-detail2="' + esc(b.id) +
          '">Ansehen</button></td>' +
      "</tr>").join("") +
    "</tbody></table></div>";

  $("ko-offen-liste").querySelectorAll("[data-ko-detail2]").forEach((b) => {
    b.addEventListener("click", () => zeigeKodexDetail(b.dataset.koDetail2));
  });
}

// ---------------------------------------------------------------------
// Eine Erklaerung ansehen
// ---------------------------------------------------------------------

async function zeigeKodexDetail(id) {
  const inhalt = $("ko-inhalt");
  inhalt.innerHTML = '<div class="leer">Wird geladen …</div>';
  $("kodex-overlay").hidden = false;

  let d;
  try {
    d = await ladeKodexDetail(id);
  } catch (e) {
    inhalt.innerHTML = '<div class="hinweis fehler">' + esc(e.message) + "</div>";
    return;
  }

  const zeile = (titel, wert) => wert
    ? "<tr><th>" + esc(titel) + "</th><td>" + wert + "</td></tr>" : "";

  inhalt.innerHTML =
    '<div class="tabelle-scroll"><table class="zusammenfassung"><tbody>' +
      zeile("Eingegangen", esc(datumDe(d.eingang_am))) +
      zeile("Kind (Angabe der Eltern)", esc(d.kind_vorname + " " + d.kind_nachname)) +
      zeile("Geburtsdatum", esc(datumDe(d.kind_geburtsdatum))) +
      zeile("Mannschaft", esc(d.mannschaft)) +
      zeile("Unterschrieben von", esc(d.erz_name)) +
      zeile("E-Mail", d.erz_email
        ? '<a href="mailto:' + esc(d.erz_email) + '">' + esc(d.erz_email) + "</a>" : "") +
      zeile("Ort", esc(d.ort)) +
      // Die Fassung gehoert zum Beleg: ohne sie ist nicht sagbar, WAS
      // anerkannt wurde. Der Kodex wird fortgeschrieben.
      zeile("Fassung des Kodex", esc(d.kodex_version)) +
      zeile("Zugeordnet zu", d.person_name
        ? esc(d.person_name) + ' <span class="chip ruhend">von Hand, ' +
          esc(datumDe(d.zugeordnet_am)) + " durch " + esc(d.zugeordnet_von || "") + "</span>"
        : "") +
    "</tbody></table></div>" +
    '<p class="fussnote">Erklärt wurde: Der Elternkodex des Vereins wurde ' +
      "heruntergeladen, gelesen und wird anerkannt.</p>" +
    '<div class="unterschrift-block">' +
      '<div class="unterschrift-titel">Unterschrift der Erziehungsberechtigten</div>' +
      (d.unterschrift
        ? '<img alt="Unterschrift der Erziehungsberechtigten" ' +
          'style="max-width:100%;background:#fff" src="' + esc(d.unterschrift) + '">'
        : '<div class="leer">Keine Unterschrift gespeichert.</div>') +
    "</div>" +
    // ⚠️ Ersetzte Fassungen. Der Weg hat keinen Zugriffscode, und die
    // Kennung ist Name plus Geburtstag des Kindes — beides weiß im Verein
    // jeder. Ein zweites Absenden ersetzt deshalb, und ohne diesen Block
    // wäre nicht zu sehen, DASS es eines gab. Der Anschluss unterscheidet
    // die Selbstkorrektur der Familie von einer fremden Überschreibung.
    ((d.verlauf || []).length
      ? '<div class="hinweis warn" style="margin-top:14px">' +
          "<strong>Diese Erklärung wurde " + d.verlauf.length + "× ersetzt.</strong> " +
          "Eine Familie, die sich selbst korrigiert, sendet vom selben Anschluss. " +
          "Steht unten „anderer Anschluss“, kam die Ersetzung von woanders — dann " +
          "bitte bei der Familie nachfragen." +
        "</div>" +
        d.verlauf.map((v) =>
          '<div class="unterschrift-block" style="margin-top:10px">' +
            '<div class="unterschrift-titel">Ersetzt am ' + esc(datumDe(v.ersetzt_am)) +
              " · eingegangen war sie am " + esc(datumDe(v.eingang_am)) +
              " · " + (v.gleicher_anschluss
                ? '<span class="chip aktiv">gleicher Anschluss</span>'
                : '<span class="chip gekuendigt">anderer Anschluss</span>') +
            "</div>" +
            '<p class="fussnote">Unterschrieben von ' + esc(v.erz_name || "—") +
              (v.ort ? ", " + esc(v.ort) : "") +
              " · Fassung " + esc(v.kodex_version || "—") + "</p>" +
            (v.unterschrift
              ? '<img alt="Ersetzte Unterschrift" ' +
                'style="max-width:100%;background:#fff" src="' + esc(v.unterschrift) + '">'
              : '<div class="leer">Keine Unterschrift gespeichert.</div>') +
          "</div>").join("")
      : "") +
    (d.darf_schreiben
      ? '<div class="knopfreihe" style="margin-top:14px">' +
          '<button class="btn" id="btn-ko-zuordnen" data-id="' + esc(d.id) + '">' +
            (d.person_id ? "Anderem Kind zuordnen" : "Von Hand zuordnen") + "</button>" +
          (d.person_id
            ? '<button class="btn grau" id="btn-ko-loesen" data-id="' + esc(d.id) +
              '">Zuordnung aufheben</button>' : "") +
          '<button class="btn warn" id="btn-ko-loeschen" data-id="' + esc(d.id) +
            '">Erklärung löschen</button>' +
        "</div>" +
        '<p class="fussnote">Löschen ist für zurückgezogene Erklärungen und Testeinträge ' +
        "gedacht. Die Unterschrift wird mitgelöscht.</p>"
      : "");

  if (d.darf_schreiben) {
    $("btn-ko-zuordnen").addEventListener("click", () => starteZuordnung(d.id));
    if ($("btn-ko-loesen")) {
      $("btn-ko-loesen").addEventListener("click", () => loeseZuordnung(d.id));
    }
    $("btn-ko-loeschen").addEventListener("click", () => loescheErklaerung(d.id, d));
  }
}

// ---------------------------------------------------------------------
// Handzuordnung
// ---------------------------------------------------------------------

// Zweistufig: erst vormerken, dann in der Kinderliste anklicken. Ein
// Auswahlfeld mit dreihundert Namen wäre am Handy unbedienbar, und die
// Liste steht ohnehin schon da -- samt Suchfeld.
function starteZuordnung(id) {
  koZuordnenId = id;
  $("kodex-overlay").hidden = true;
  koMeldung("Erklärung vorgemerkt. Bitte unten das Kind anklicken, zu dem sie gehört.");
  koSicht = "alle";
  zeichneKodexReiter();
  zeichneKodexListe();
  $("ko-liste").scrollIntoView({ block: "start" });
}

async function fuehreZuordnungAus(personId) {
  if (!koZuordnenId) return;
  const id = koZuordnenId;
  koZuordnenId = null;

  try {
    const antwort = await ordneKodexZu(id, personId);
    koMeldung("Die Erklärung ist " + (antwort.person_name || "dem Kind") + " zugeordnet.");
  } catch (e) {
    koMeldung(e.message, "fehler");
  }
  ladeKodex();
}

async function loeseZuordnung(id) {
  if (!confirm("Die Zuordnung dieser Erklärung aufheben?\n\n" +
               "Die Erklärung selbst bleibt gespeichert. Sie wird danach wieder " +
               "über den Namen abgeglichen.")) return;
  try {
    await ordneKodexZu(id, "");
    koMeldung("Die Zuordnung ist aufgehoben.");
  } catch (e) {
    koMeldung(e.message, "fehler");
  }
  $("kodex-overlay").hidden = true;
  ladeKodex();
}

async function loescheErklaerung(id, d) {
  if (!confirm("Die Erklärung für " + d.kind_vorname + " " + d.kind_nachname +
               " endgültig löschen?\n\nDie Unterschrift wird mitgelöscht. " +
               "Das Kind erscheint danach wieder als offen.")) return;
  try {
    await loescheKodex(id);
    koMeldung("Die Erklärung ist gelöscht.");
  } catch (e) {
    koMeldung(e.message, "fehler");
  }
  $("kodex-overlay").hidden = true;
  ladeKodex();
}

// ---------------------------------------------------------------------
// Verdrahtung
// ---------------------------------------------------------------------

function verdrahteKodex() {
  $("btn-ko-zu").addEventListener("click", () => { $("kodex-overlay").hidden = true; });
  $("btn-ko-schliessen").addEventListener("click", () => { $("kodex-overlay").hidden = true; });
  $("kodex-overlay").addEventListener("click", (e) => {
    if (e.target === $("kodex-overlay")) $("kodex-overlay").hidden = true;
  });

  // Rein im Browser gefiltert: die Liste liegt schon vollstaendig da, ein
  // Server-Aufruf je Tastendruck waere Verschwendung.
  $("ko-suche").addEventListener("input", () => {
    koSuche = $("ko-suche").value.trim().toLowerCase();
    if (koDaten) zeichneKodexListe();
  });

  $("btn-ko-kopieren").addEventListener("click", async () => {
    const feld = $("ko-link");
    try {
      await navigator.clipboard.writeText(feld.value);
      koMeldung("Der Link ist kopiert.");
    } catch {
      // Ohne Berechtigung fuer die Zwischenablage (aeltere Geraete, kein
      // https): markieren, damit der Link von Hand kopierbar ist, statt
      // nur zu melden, dass es nicht ging.
      feld.focus();
      feld.select();
      koMeldung("Bitte den markierten Link von Hand kopieren.");
    }
  });
}
