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

// Steht hier statt in config.js -- aus demselben Grund wie die
// Worker-Adresse. Sie bleibt wie flottenweit dauerhaft auf "1.0"; was
// sich geaendert hat, steht in ANTRAG_CHANGELOG.
const ANTRAG_VERSION = "1.0";

const ANTRAG_CHANGELOG = [
  {
    version: "Papier und Bildschirm gleichen sich",
    datum: "2026-08-06",
    punkte: [
      "Das Formular fragt jetzt dasselbe ab wie der gedruckte Aufnahmeantrag: Geburtsort, Kreditinstitut, die Anschrift des Kontoinhabers, wenn sie abweicht, und den Ort der Unterschrift.",
      "Bei Minderjährigen unterschreiben beide Erziehungsberechtigten. Wer allein sorgeberechtigt ist, kreuzt das an — dann genügt eine Unterschrift.",
      "Die Geschäftsstelle kann den eingegangenen Antrag als vierseitigen Papierantrag mit allen Unterschriften ausdrucken."
    ]
  },
  {
    version: "Online-Aufnahmeantrag",
    datum: "2026-07-30",
    punkte: [
      "Die Mitgliedschaft lässt sich am Handy beantragen und unterschreiben — ein Ausdruck ist nicht nötig.",
      "Das SEPA-Lastschriftmandat wird im selben Zug erteilt. Wer lieber überweist, kann das wählen.",
      "Nach dem Absenden erscheint eine Bestätigungsseite mit allen Angaben und der Unterschrift. Sie ist die eigene Kopie der Erklärung und lässt sich drucken oder als PDF sichern.",
      "Der Antrag ist noch keine Mitgliedschaft: über die Aufnahme entscheidet nach § 4 der Satzung der Gesamtvorstand."
    ]
  }
];

// Sitzungstoken aus demselben localStorage-Schluessel wie die uebrige
// Flotte -- alle laufen unter derselben Origin. Diese Seite verlangt ihn
// nicht: sie ist der einzige Weg der App, der auch OHNE Konto
// funktioniert. Vorhanden ist er nur, wenn jemand aus dem Dashboard kommt.
function antragToken() {
  try {
    return localStorage.getItem("tu_session_token") || null;
  } catch {
    return null;
  }
}

// Angemeldeter Aufruf fuer den Sicht-Reiter. Bewusst getrennt von
// antragRequest: der oeffentliche Weg darf nie einen Token mitschicken
// und der angemeldete nie ohne einen auskommen.
async function antragRequestMitToken(action, body) {
  const token = antragToken();
  if (!token) throw new Error("Nicht angemeldet");

  let res;
  try {
    res = await fetch(ANTRAG_WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify({ action, ...(body || {}) })
    });
  } catch {
    throw new Error("Der Server ist nicht erreichbar.");
  }

  const daten = await res.json().catch(() => null);
  if (!res.ok) {
    const fehler = new Error((daten && daten.error) || ("Fehler " + res.status));
    fehler.status = res.status;
    throw fehler;
  }
  return daten;
}

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

// --- Sicht-Reiter (nur angemeldet) ------------------------------------

function ladeEigeneRechteAntrag() {
  return antragRequestMitToken("vv-me");
}

function ladeEingegangeneAntraege(status) {
  return antragRequestMitToken("vv-antraege", { status });
}

function ladeAntragDetail(id) {
  return antragRequestMitToken("vv-antrag", { id });
}

// Fuer den Papierausdruck: Vereinsname, IBAN und Glaeubiger-ID stehen in
// der Datenbank, nicht im Code. Nur der Schatzmeister und die
// Geschaeftsstelle duerfen sie lesen -- schlaegt es fehl, bleibt die
// Fusszeile des Ausdrucks kuerzer.
function ladeStammdatenAntrag() {
  return antragRequestMitToken("vv-einstellungen", {});
}
