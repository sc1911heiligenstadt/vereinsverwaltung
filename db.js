// Zugriff auf den eigenen Worker.
//
// Unterschied zum Flotten-Standard: Diese App nutzt NICHT das generische
// dav-load/dav-save des zentralen Gateways. Grund ist die Sparten-Grenze
// der Abteilungsleiter -- dav-load liefert immer die komplette Datei aus,
// hier muss serverseitig gefiltert werden. Muster: Vereinsaufgaben.
//
// Die Anmeldung ist trotzdem dieselbe: Der Token kommt aus demselben
// localStorage-Schluessel wie in allen anderen Apps, weil alle unter
// derselben Origin sc1911heiligenstadt.github.io laufen. Eine Anmeldung gilt
// flottenweit.

const TOKEN_STORAGE_KEY = "tu_session_token";

class NotLoggedInError extends Error {
  constructor() {
    super("Nicht angemeldet");
    this.name = "NotLoggedInError";
  }
}

class KeinZugriffError extends Error {
  constructor(text) {
    super(text || "Kein Zugriff");
    this.name = "KeinZugriffError";
  }
}

function getSessionToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

async function vvRequest(action, body) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();

  let res;
  try {
    res = await fetch(WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify({ action, ...(body || {}) })
    });
  } catch (e) {
    // Ein harter Worker-Abbruch liefert keine CORS-Kopfzeilen, der
    // fetch scheitert dann mit TypeError statt mit einem Statuscode.
    throw new Error("Server nicht erreichbar");
  }

  if (res.status === 401) throw new NotLoggedInError();

  const daten = await res.json().catch(() => null);
  if (res.status === 403) throw new KeinZugriffError(daten && daten.error);
  if (!res.ok) {
    // Statuscode und Antwortkoerper mitgeben. Manche Aktionen antworten
    // mit einem 409, an dem mehr haengt als ein Satz -- vv-sparte-loeschen
    // nennt darin, wer der Abteilung noch zugeordnet ist, und der Aufrufer
    // macht daraus die Rueckfrage. Ohne das bliebe nur "Fehler 409".
    const fehler = new Error((daten && daten.error) || ("Fehler " + res.status));
    fehler.status = res.status;
    fehler.daten = daten;
    throw fehler;
  }
  return daten;
}

async function ladeEigeneRechte() {
  return vvRequest("vv-me");
}

async function ladeMitglieder(opt) {
  return vvRequest("vv-mitglieder", opt || {});
}

async function ladeSparten() {
  return vvRequest("vv-sparten");
}

async function ladeBestand() {
  return vvRequest("vv-status");
}

async function legeMitgliedAn(daten) {
  return vvRequest("vv-mitglied-anlegen", daten);
}

async function ordneSparteZu(daten) {
  return vvRequest("vv-sparte-zuordnen", daten);
}

// Ein Block je Aufruf. Die Aufteilung macht der Aufrufer, weil nur er
// weiss, wie weit er schon ist -- der Worker haelt keinen Zustand.
async function importiereBlock(saetze, optionen) {
  return vvRequest("vv-import", { saetze, ...(optionen || {}) });
}

// Externe Bibliothek erst bei Bedarf nachladen, nie fest im <head>:
// xlsx.full.min.js sind ~900 KB, die beim taeglichen Blick in die
// Mitgliederliste niemand braucht. Flottenregel.
const geladeneBibliotheken = {};
// --- Elternkodex ------------------------------------------------------

// Der Abgleich: welche minderjaehrigen Mitglieder haben die Kenntnisnahme
// abgegeben, welche nicht -- und welche Erklaerungen passen zu keinem Kind.
//
// ⚠️ Recht ist darfNachwuchs (Geschaeftsstelle, Schatzmeister, Passstelle,
// Administrator), NICHT darfPersonenSehen. Der Grund ist der
// Abteilungsleiter: seine Mitgliedersicht ist auf seine Sparten begrenzt,
// diese Liste ist es nicht -- an darfPersonenSehen gehaengt waere sie ein
// Weg um seine Spartengrenze herum.
//
// ⚠️ KEINE Abteilung im Koerper. Der Kodex gilt allein dem Fussball, und
// das entscheidet der Server -- ein mitgeschicktes sparte_id wuerde dort
// ignoriert. Welche Abteilung zugrunde lag, steht in der Antwort.
async function ladeKodexListe() {
  return vvRequest("vv-kodex-liste", {});
}

// Eigene Aktion, weil die Unterschrift 19 KB traegt und die Liste sie
// nicht anzeigt.
async function ladeKodexDetail(id) {
  return vvRequest("vv-kodex-detail", { id });
}

// Handzuordnung fuer den Fall, dass der Namensabgleich nicht trifft. Eine
// leere person_id hebt sie wieder auf.
async function ordneKodexZu(id, personId) {
  return vvRequest("vv-kodex-zuordnen", { id, person_id: personId || "" });
}

async function loescheKodex(id) {
  return vvRequest("vv-kodex-loeschen", { id });
}

function ladeBibliothek(url) {
  if (geladeneBibliotheken[url]) return geladeneBibliotheken[url];
  geladeneBibliotheken[url] = new Promise((erfuellen, ablehnen) => {
    const s = document.createElement("script");
    s.src = url;
    s.onload = () => erfuellen();
    s.onerror = () => {
      delete geladeneBibliotheken[url];
      ablehnen(new Error("Bibliothek nicht ladbar: " + url));
    };
    document.head.appendChild(s);
  });
  return geladeneBibliotheken[url];
}

function ladeTabellenBibliothek() {
  return ladeBibliothek("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
}

// --- Nachweise der Nachwuchs-Anmeldung --------------------------------
//
// ⚠️ Diese beiden Wege gehen an das Gateway der ToolsUebersicht, NICHT an
// den eigenen Worker: dort liegen die Dateien, weil dieser Worker kein
// Nextcloud-Binding hat und keines bekommen soll -- Ausweiskopien
// gehoeren nicht in dieselbe Datenbank wie Beitraege und Buchhaltung.
//
// Das Recht prueft das Gateway an der Kachel "vereinsverwaltung"
// (Bearbeiten schliesst Administrieren ein). Es kennt die Rollen dieser
// App nicht -- die liegen in D1.
const VV_GATEWAY_URL = "https://landingpage.michel-brunner.workers.dev";

async function gatewayRequest(action, body) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();

  let res;
  try {
    res = await fetch(VV_GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify({ action, ...(body || {}) })
    });
  } catch {
    throw new Error("Das Gateway ist nicht erreichbar.");
  }
  return res;
}

async function ladeNachweisListe(owner) {
  const res = await gatewayRequest("vv-nachweis-liste", { owner });
  const daten = await res.json().catch(() => null);
  if (!res.ok) throw new Error((daten && daten.error) || ("Fehler " + res.status));
  return daten;
}

// Ohne slot faellt der ganze Ordner des Antrags weg -- der Regelfall,
// wenn ein Antrag entfernt wird. ⚠️ Die Dateien liegen im Gateway, der
// Antrag in D1: wer nur die Zeile loescht, laesst Ausweiskopien liegen,
// deren Schluessel danach niemand mehr kennt.
async function loescheNachweise(owner) {
  const res = await gatewayRequest("vv-nachweis-loeschen", { owner });
  const daten = await res.json().catch(() => null);
  if (!res.ok) throw new Error((daten && daten.error) || ("Fehler " + res.status));
  return daten;
}

// Gibt einen Blob zurueck, keinen JSON-Satz: die Aktion liefert rohe
// Bytes mit dem Content-Type aus Nextcloud.
async function ladeNachweisDatei(owner, slot) {
  const res = await gatewayRequest("vv-nachweis-get", { owner, slot });
  if (!res.ok) {
    const daten = await res.json().catch(() => null);
    throw new Error((daten && daten.error) || ("Fehler " + res.status));
  }
  return await res.blob();
}

// --- Das erzeugte Verbandsformular ------------------------------------
//
// Der Verband verlangt Aufbewahrung des unterschriebenen Antrags beim
// Verein fuer mindestens zwei Jahre. Aufbewahrt wurde bis 06.08.2026 nur
// die QUELLE (Antrag in D1, Anlagen in Nextcloud) -- nicht das Blatt, das
// die Geschaeftsstelle gestempelt und eingereicht hat.
async function legeTfvAntragAb(antragId, bytes) {
  const res = await gatewayRequest("vv-antrag-pdf-put", {
    antrag_id: antragId,
    dataBase64: bytesZuBase64(bytes)
  });
  const daten = await res.json().catch(() => null);
  if (!res.ok) throw new Error((daten && daten.error) || ("Fehler " + res.status));
  return daten;
}

async function ladeTfvAntragStatus(antragId) {
  const res = await gatewayRequest("vv-antrag-pdf-status", { antrag_id: antragId });
  const daten = await res.json().catch(() => null);
  if (!res.ok) throw new Error((daten && daten.error) || ("Fehler " + res.status));
  return daten;
}

async function ladeTfvAntragDatei(antragId) {
  const res = await gatewayRequest("vv-antrag-pdf-get", { antrag_id: antragId });
  if (!res.ok) {
    const daten = await res.json().catch(() => null);
    throw new Error((daten && daten.error) || ("Fehler " + res.status));
  }
  return await res.blob();
}

// ⚠️ In Bloecken umwandeln, nicht in einem Rutsch: String.fromCharCode mit
// einem 300-KB-Array auf einmal wirft in Safari "too many arguments".
function bytesZuBase64(bytes) {
  let s = "";
  const block = 0x8000;
  for (let i = 0; i < bytes.length; i += block) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + block));
  }
  return btoa(s);
}
