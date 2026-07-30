// Zugriff fuer antrag.html -- die einzige Seite dieser App ohne Anmeldung.
//
// Bewusst NICHT db.js: das schickt bei jedem Aufruf einen Bearer-Token mit
// und wirft NotLoggedInError, wenn keiner da ist. Hier gibt es keinen und
// soll es keinen geben -- wer Mitglied werden will, hat noch kein Konto.
//
// Ebenso bewusst NICHT config.js: dort steht der komplette Changelog der
// Verwaltung, und der hat auf einer oeffentlichen Seite nichts zu suchen.
// Die Worker-Adresse ist deshalb hier ein zweites Mal notiert.
// ACHTUNG: Aendert sich WORKER_URL in config.js, muss sie hier mitwandern.

const ANTRAG_WORKER_URL = "https://vereinsverwaltung.michel-brunner.workers.dev";

async function antragRequest(action, body) {
  let res;
  try {
    res = await fetch(ANTRAG_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...(body || {}) })
    });
  } catch {
    throw new Error("Der Server ist nicht erreichbar. Bitte die Internetverbindung pruefen.");
  }

  const daten = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((daten && daten.error) || ("Fehler " + res.status));
  }
  return daten;
}

// Abteilungen, Beitragssaetze und der Vereinsname fuer den Mandatstext.
function ladeAntragInfo() {
  return antragRequest("vv-antrag-info");
}

function sendeAntrag(daten) {
  return antragRequest("vv-antrag-senden", daten);
}
