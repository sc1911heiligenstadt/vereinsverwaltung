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

// Die Nachweise zur Nachwuchs-Anmeldung gehen NICHT an den Worker oben,
// sondern an das Gateway der ToolsUebersicht. Grund: dieser Worker hat
// kein Nextcloud-Binding (seine Daten liegen in D1) und soll auch keines
// bekommen -- Ausweiskopien gehoeren nicht in dieselbe Datenbank wie
// Beitraege und Buchhaltung, die naechtliche Sicherung zoege sie sonst
// jedesmal mit.
const GATEWAY_URL = "https://landingpage.michel-brunner.workers.dev";

// Steht hier statt in config.js -- aus demselben Grund wie die
// Worker-Adresse. Sie bleibt wie flottenweit dauerhaft auf "1.0"; was
// sich geaendert hat, steht in ANTRAG_CHANGELOG.
const ANTRAG_VERSION = "1.0";

const ANTRAG_CHANGELOG = [
  {
    version: "Beitrag nur noch per SEPA-Lastschrift",
    datum: "2026-08-14",
    punkte: [
      "Die Auswahl zwischen Lastschrift und Überweisung ist entfallen. Der Beitrag wird ausschließlich per SEPA-Lastschrift eingezogen; das Mandat wird mit dem Antrag erteilt.",
      "Wer bereits Mitglied ist und überweist, ist davon nicht betroffen — die Änderung gilt für neue Anträge."
    ]
  },
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
      "Das SEPA-Lastschriftmandat wird im selben Zug erteilt.",
      "Nach dem Absenden erscheint eine Bestätigungsseite mit allen Angaben und der Unterschrift. Sie ist die eigene Kopie der Erklärung und lässt sich drucken oder als PDF sichern.",
      "Der Antrag ist noch keine Mitgliedschaft: über die Aufnahme entscheidet nach § 4 der Satzung der Gesamtvorstand."
    ]
  }
];

// Eigener Block fuer nachwuchs.html. Nicht ANTRAG_CHANGELOG mitbenutzen:
// der beschreibt den allgemeinen Aufnahmeantrag, und was den Nachwuchs
// betrifft, geht dort zwischen Beitragsart und Familienverbund unter.
const NACHWUCHS_CHANGELOG = [
  {
    version: "Beitrag nur noch per SEPA-Lastschrift",
    datum: "2026-08-14",
    punkte: [
      "Die Auswahl zwischen Lastschrift und Überweisung ist entfallen. Der Beitrag wird ausschließlich per SEPA-Lastschrift eingezogen; das Mandat wird mit der Anmeldung erteilt.",
      "Wer bereits Mitglied ist und überweist, ist davon nicht betroffen — die Änderung gilt für neue Anmeldungen."
    ]
  },
  {
    version: "Anmeldung und Spielerlaubnis in einem Durchgang",
    datum: "2026-08-06",
    punkte: [
      "Neue Jugendspieler werden über einen Link angemeldet — Aufnahmeantrag und Antrag auf Spielerlaubnis entstehen daraus zusammen. Zweimal dieselben Angaben einzutragen entfällt.",
      "Erstausstellung, Vereinswechsel, Rückkehrer und Namensänderung stehen zur Wahl. Beim Wechsel fragt das Formular nach dem bisherigen Verein und danach, ob die Abmeldung schon erfolgt ist oder der Verein sie übernehmen soll.",
      "Die Nachweise, die der Verband als Anlage verlangt — Geburtsurkunde, Ausweis, Spielerpass, Abmeldung — lassen sich als Foto mit dem Handy hochladen. Sie liegen getrennt von den übrigen Daten und sind nur für die Geschäftsstelle einsehbar.",
      "Unterschrieben wird am Bildschirm. Die Unterschriften stehen anschließend auf dem Verbandsformular, das die Geschäftsstelle ausdruckt, stempelt und einreicht."
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

// ⚠️ Eigene Aktion, nicht ein Feld "quelle" im Koerper von
// vv-antrag-senden: so haengt die Herkunft am aufgerufenen Weg statt an
// einer Behauptung des Clients und laesst sich nicht umschreiben.
function sendeNachwuchsAntrag(daten) {
  return antragRequest("vv-nachwuchs-senden", daten);
}

// --- Nachweise (Gateway, ohne Login) ----------------------------------

// Der Owner-Schluessel wird beim ERSTEN Upload vom Server vergeben und
// zurueckgegeben. Jeder weitere Nachweis desselben Antrags schickt ihn
// mit, damit alle Anlagen zusammen liegen. Nie selbst einen erfinden.
async function ladeNachweisHoch(slot, datei, owner) {
  const dataBase64 = await dateiAlsBase64(datei);

  let res;
  try {
    res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "vv-nachweis-put",
        slot,
        owner: owner || "",
        contentType: datei.type || "application/octet-stream",
        dataBase64
      })
    });
  } catch {
    throw new Error("Der Nachweis konnte nicht hochgeladen werden. Bitte die Verbindung pruefen.");
  }

  const daten = await res.json().catch(() => null);
  if (!res.ok) throw new Error((daten && daten.error) || ("Fehler " + res.status));
  return daten;   // { ok, owner, slot }
}

// ⚠️ Blob.arrayBuffer() gibt es erst ab iOS 14, und in der Flotte sind
// aeltere Geraete. Deshalb der FileReader als Weg, nicht als Rueckfall.
function dateiAlsBase64(datei) {
  return new Promise((resolve, reject) => {
    const leser = new FileReader();
    leser.onload = () => {
      const s = String(leser.result || "");
      const komma = s.indexOf(",");
      resolve(komma >= 0 ? s.slice(komma + 1) : s);
    };
    leser.onerror = () => reject(new Error("Die Datei konnte nicht gelesen werden"));
    leser.readAsDataURL(datei);
  });
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
