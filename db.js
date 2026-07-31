// Zugriff auf den eigenen Worker.
//
// Unterschied zum Flotten-Standard: Diese App nutzt NICHT das generische
// dav-load/dav-save des zentralen Gateways. Grund ist die Sparten-Grenze
// der Abteilungsleiter -- dav-load liefert immer die komplette Datei aus,
// hier muss serverseitig gefiltert werden. Muster: Vereinsaufgaben.
//
// Die Anmeldung ist trotzdem dieselbe: Der Token kommt aus demselben
// localStorage-Schluessel wie in allen anderen Apps, weil alle unter
// derselben Origin tecko1985.github.io laufen. Eine Anmeldung gilt
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
