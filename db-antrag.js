// Zugriff fuer die OEFFENTLICHEN Seiten dieser App: antrag.html,
// nachwuchs.html und -- seit dem 18.08.2026 -- kodex.html. Sie sind die
// einzigen Wege der App, die ohne Anmeldung funktionieren.
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

// Was antrag.html kann -- steht im Info-Reiter als Karte "Funktionen".
// NICHT der Changelog: hier steht der Zustand, dort die Aenderung. Jede der
// drei oeffentlichen Seiten hat eine EIGENE Liste; eine gemeinsame waere auf
// jeder Seite zur Haelfte falsch. Quelle: Abschnitt MITGLIEDSANTRAG in
// E:\SC1911-Tools-Anleitung.txt.
const ANTRAG_FUNKTIONEN = [
  {
    title: "Mitglied werden — ohne Ausdruck",
    items: [
      "Der Aufnahmeantrag nach § 4 der Satzung wird am Handy ausgefüllt und mit dem Finger unterschrieben. Ein Vereinskonto ist dafür nicht nötig.",
      "Gefragt wird dasselbe wie auf dem gedruckten Antrag: Person, Geburtsort, Anschrift, gewünschte Abteilung, Kreditinstitut und der Ort der Unterschrift.",
      "Der Antrag ist noch keine Mitgliedschaft — über die Aufnahme entscheidet der Gesamtvorstand."
    ]
  },
  {
    title: "Beitrag per SEPA-Lastschrift",
    items: [
      "Der Beitrag wird ausschließlich per Lastschrift eingezogen; das Mandat wird mit dem Antrag erteilt. Eine Zahlung per Überweisung gibt es für neue Mitglieder nicht.",
      "Die IBAN wird schon beim Tippen geprüft. Weicht die Anschrift des Kontoinhabers ab, lässt sie sich getrennt angeben.",
      "Die Gläubiger-Identifikationsnummer erscheint nur, wenn sie gültig ist. Steht keine brauchbare Nummer bereit, bleibt die Zeile weg statt eine falsche zu nennen."
    ]
  },
  {
    title: "Bei Minderjährigen",
    items: [
      "Ist der Antragsteller minderjährig, unterschreiben die Erziehungsberechtigten; ihre Unterschrift trägt dann auch das Lastschriftmandat.",
      "Wer allein sorgeberechtigt ist, kreuzt das an — dann genügt eine Unterschrift.",
      "Für neue Jugendspieler im Fußball gibt es die eigene Nachwuchs-Anmeldung: daraus entstehen in einem Durchgang die Aufnahme und der Antrag auf Spielerlaubnis."
    ]
  },
  {
    title: "Nach dem Absenden",
    items: [
      "Es erscheint eine Bestätigungsseite mit allen Angaben und der Unterschrift. Sie ist die eigene Kopie der Erklärung und lässt sich drucken oder als PDF sichern.",
      "Die Einwilligung in Foto- und Videoaufnahmen ist freiwillig und von der Aufnahme getrennt."
    ]
  },
  {
    title: "Für die Geschäftsstelle",
    items: [
      "Wer angemeldet ist, sieht den Reiter „Eingegangene Anträge“ und kann jeden Eingang als vierseitigen Papierantrag mit allen Unterschriften ausdrucken.",
      "Je Zeile steht ein Löschknopf — gedacht für zurückgezogene Anträge und Testeinträge. Hochgeladene Nachweise und Unterschriften werden mitgelöscht.",
      "Ein bereits angenommener Antrag bleibt stehen: an ihm hängen die Mitgliedschaft und das SEPA-Mandat. Die Mitgliedschaft endet über den Austritt, nicht über dieses Formular."
    ]
  }
];

const ANTRAG_CHANGELOG = [
  {
    version: "1.3",
    groups: [
      {
        title: "Die E-Mail-Adresse wird sofort geprüft",
        items: [
          "Fehlt die E-Mail-Adresse oder ist sie unvollständig, steht das jetzt da, bevor der Antrag abgeschickt wird. Bisher kam die Absage erst danach — bei einem Bogen, der längst ausgefüllt und unterschrieben war."
        ]
      }
    ]
  },
  {
    version: "1.2",
    groups: [
      {
        title: "Im Info-Reiter steht jetzt, was die Seite kann",
        items: [
          "Die Liste der Änderungen und die Versionsnummer sind aus dem Info-Reiter verschwunden.",
          "Stattdessen steht dort die Karte „Funktionen“: was der Aufnahmeantrag kann, nach Themen geordnet.",
          "Was sich geändert hat, steht weiterhin in den Neuigkeiten auf der Startseite der Tools-Übersicht."
        ]
      }
    ]
  },
  {
    version: "1.1",
    groups: [
      {
        title: "Unterschrift bei Minderjährigen",
        items: [
          "Ist der Antragsteller minderjährig, unterschreiben die Erziehungsberechtigten; eine eigene Unterschrift des Kindes wird nicht mehr verlangt. Sie ist weiterhin möglich und wird dann auch übernommen."
        ]
      },
      {
        title: "Anträge löschen",
        items: [
          "Scheitert das Entfernen der hochgeladenen Nachweise am fehlenden Recht, benennt die Meldung den Grund: dafür wird „Administrieren“ auf der Kachel Vereinsverwaltung gebraucht. Bisher hieß es „Bitte noch einmal versuchen“, obwohl der Versuch nie gelingen konnte."
        ]
      }
    ]
  },
  {
    version: "1.0",
    groups: [
      {
        title: "Mitgliedschaft am Handy beantragen",
        items: [
          "Die Mitgliedschaft lässt sich am Handy beantragen und unterschreiben — ein Ausdruck ist nicht nötig.",
          "Nach dem Absenden erscheint eine Bestätigungsseite mit allen Angaben und der Unterschrift. Sie ist die eigene Kopie der Erklärung und lässt sich drucken oder als PDF sichern.",
          "Der Antrag ist noch keine Mitgliedschaft: über die Aufnahme entscheidet nach § 4 der Satzung der Gesamtvorstand."
        ]
      },
      {
        title: "Dieselben Angaben wie auf dem Papierantrag",
        items: [
          "Das Formular fragt dasselbe ab wie der gedruckte Aufnahmeantrag: Geburtsort, Kreditinstitut, die Anschrift des Kontoinhabers, wenn sie abweicht, und den Ort der Unterschrift.",
          "Bei Minderjährigen unterschreiben beide Erziehungsberechtigten. Wer allein sorgeberechtigt ist, kreuzt das an — dann genügt eine Unterschrift.",
          "Die Geschäftsstelle kann den eingegangenen Antrag als vierseitigen Papierantrag mit allen Unterschriften ausdrucken."
        ]
      },
      {
        title: "Beitrag per SEPA-Lastschrift",
        items: [
          "Der Beitrag wird ausschließlich per SEPA-Lastschrift eingezogen; das Mandat wird mit dem Antrag erteilt. Wer bereits Mitglied ist und überweist, ist davon nicht betroffen.",
          "Begrüßung und SEPA-Mandat nennen den Verein mit seinem vollen Namen, damit erkennbar ist, wem die Einzugsermächtigung erteilt wird.",
          "Die Gläubiger-Identifikationsnummer erscheint nur, wenn sie gültig ist. Steht keine brauchbare Nummer bereit, bleibt die Zeile weg statt eine falsche zu nennen — das Formular lässt sich trotzdem abschicken."
        ]
      },
      {
        title: "Eingegangene Anträge sichten und löschen",
        items: [
          "Im Reiter „Eingegangene Anträge“ steht je Zeile ein Löschknopf, gedacht für zurückgezogene Anträge und für Testeinträge.",
          "Hochgeladene Nachweise und Unterschriften werden mitgelöscht. Die Rückfrage sagt vorher, was daran hängt.",
          "Ein bereits angenommener Antrag bleibt stehen: an ihm hängen die Mitgliedschaft und das SEPA-Mandat. Die Mitgliedschaft endet über den Austritt, nicht über das Formular."
        ]
      }
    ]
  }
];

// Was nachwuchs.html kann. Eigene Liste, nicht ANTRAG_FUNKTIONEN
// mitbenutzen: Spielerlaubnis, Nachweise, Passbild und Elternkodex kommen
// im allgemeinen Aufnahmeantrag gar nicht vor.
const NACHWUCHS_FUNKTIONEN = [
  {
    title: "Zwei Anträge in einem Durchgang",
    items: [
      "Das Formular nimmt zugleich den Aufnahmeantrag nach § 4 der Satzung und die Angaben für den Antrag auf Spielerlaubnis beim Thüringer Fußball-Verband entgegen.",
      "Zur Wahl stehen Erstausstellung, Vereinswechsel, Rückkehrer und Namensänderung.",
      "Wer bereits Mitglied ist und nur eine Spielerlaubnis braucht, wendet sich an die Geschäftsstelle. Für eine Mitgliedschaft ohne Fußball gibt es den allgemeinen Aufnahmeantrag."
    ]
  },
  {
    title: "Nachweise und Passbild",
    items: [
      "Die Nachweise, die der Verband verlangt, lassen sich als Foto mit dem Handy mitschicken.",
      "Bei Erstausstellung und Vereinswechsel nimmt die Familie gleich ein Passbild auf — die Hilfslinie steht schon beim Fotografieren im Bild.",
      "Ein fehlender Nachweis hält den Antrag nicht auf: er geht trotzdem ein, und die Geschäftsstelle fragt nach."
    ]
  },
  {
    title: "Elternkodex",
    items: [
      "Ist das Kind minderjährig, gehört die Kenntnisnahme des Elternkodex zur Anmeldung. Er lässt sich herunterladen, bestätigen und am Bildschirm unterschreiben.",
      "Die Fassung des Textes wird mitgespeichert, damit später belegbar ist, was unterschrieben wurde.",
      "Der Kodex gilt nur der Abteilung Fußball. Wurde er versäumt, lässt er sich später über einen Eltern-Link nachreichen."
    ]
  },
  {
    title: "Unterschreiben",
    items: [
      "Bei Minderjährigen unterschreiben die Erziehungsberechtigten; wer allein sorgeberechtigt ist, kreuzt das an.",
      "Die Unterschrift des Kindes ist freiwillig — bleibt sie leer, bleiben die Felder auf beiden Anträgen frei.",
      "Nach dem Absenden erscheint eine Bestätigungsseite mit allen Angaben und der Unterschrift, zum Drucken oder als PDF."
    ]
  },
  {
    title: "Was danach geschieht",
    items: [
      "Der Antrag ist noch keine Mitgliedschaft: über die Aufnahme entscheidet der Gesamtvorstand.",
      "Die Geschäftsstelle bearbeitet den Eingang in der Vereinsverwaltung und druckt den Verbandsbogen aus. Vereinsstempel und Vereinsunterschrift setzt sie nach dem Druck.",
      "Das Passbild kommt nicht auf den Verbandsbogen — der hat kein Bildfeld. Es wird gesammelt, damit die Geschäftsstelle es beim Verband hochladen kann."
    ]
  }
];

// Eigener Block fuer nachwuchs.html. Nicht ANTRAG_CHANGELOG mitbenutzen:
// der beschreibt den allgemeinen Aufnahmeantrag, und was den Nachwuchs
// betrifft, geht dort zwischen Beitragsart und Familienverbund unter.
const NACHWUCHS_CHANGELOG = [
  {
    version: "1.4",
    groups: [
      {
        title: "Die E-Mail-Adresse wird sofort geprüft",
        items: [
          "Fehlt die E-Mail-Adresse oder ist sie unvollständig, steht das jetzt da, bevor die Anmeldung abgeschickt wird. Bisher kam die Absage erst danach — bei einem Bogen, der längst ausgefüllt und unterschrieben war."
        ]
      }
    ]
  },
  {
    version: "1.3",
    groups: [
      {
        title: "Im Info-Reiter steht jetzt, was die Seite kann",
        items: [
          "Die Liste der Änderungen und die Versionsnummer sind aus dem Info-Reiter verschwunden.",
          "Stattdessen steht dort die Karte „Funktionen“: was die Nachwuchs-Anmeldung kann, nach Themen geordnet.",
          "Was sich geändert hat, steht weiterhin in den Neuigkeiten auf der Startseite der Tools-Übersicht."
        ]
      }
    ]
  },
  {
    version: "1.2",
    groups: [
      {
        title: "Die Unterschrift des Kindes ist wirklich freiwillig",
        items: [
          "Unterschreibt das Kind nicht selbst — das Feld heißt „soweit es schon schreiben kann“ —, bleibt es jetzt leer. Bisher wurde still die Unterschrift der Erziehungsberechtigten hineinkopiert, damit die Vorprüfung zufrieden war. Sie wurde mitgeschickt und gespeichert.",
          "Folge davon: auf dem Antrag auf Spielerlaubnis, den die Geschäftsstelle stempelt und beim Thüringer Fußball-Verband einreicht, stand die Unterschrift der Eltern im Feld des Spielers; auf dem ausgedruckten Papierantrag stand dieselbe Unterschrift zweimal, einmal falsch beschriftet. Beides ist behoben — die Felder bleiben frei, wenn nicht unterschrieben wurde."
        ]
      }
    ]
  },
  {
    version: "1.1",
    groups: [
      {
        title: "Der Hinweis „Es fehlen noch Nachweise“ stimmt jetzt",
        items: [
          "Übernimmt der Verein die Abmeldung beim bisherigen Verein, gibt es keine Kündigung zum Hochladen. Trotzdem wurde sie als Anlage aufgeführt und die Bestätigungsseite behauptet, es fehlten Nachweise. Beides ist weg: die Zeile verschwindet, sobald „der Verein übernimmt die Abmeldung“ angekreuzt ist.",
          "Der Hinweis prüfte außerdem nur, ob weniger Anlagen hochgeladen wurden als verlangt. Wer erst „Vereinswechsel“ wählte, beide Anlagen hochlud und dann auf „Erstausstellung“ umstellte, bekam deshalb keinen Hinweis mehr — obwohl die dann einzige verlangte Anlage fehlte. Jetzt wird jede verlangte Anlage einzeln geprüft."
        ]
      }
    ]
  },
  {
    version: "1.0",
    groups: [
      {
        title: "Anmeldung und Spielerlaubnis in einem Durchgang",
        items: [
          "Neue Jugendspieler werden über einen Link angemeldet — Aufnahmeantrag und Antrag auf Spielerlaubnis entstehen daraus zusammen. Zweimal dieselben Angaben einzutragen entfällt.",
          "Erstausstellung, Vereinswechsel, Rückkehrer und Namensänderung stehen zur Wahl. Beim Wechsel fragt das Formular nach dem bisherigen Verein und danach, ob die Abmeldung schon erfolgt ist oder der Verein sie übernehmen soll.",
          "Unterschrieben wird am Bildschirm. Die Unterschriften stehen anschließend auf dem Verbandsformular, das die Geschäftsstelle ausdruckt, stempelt und einreicht."
        ]
      },
      {
        title: "Nachweise als Foto vom Handy",
        items: [
          "Die Anlagen, die der Verband verlangt — Geburtsurkunde, Ausweis, Spielerpass, Abmeldung — lassen sich als Foto hochladen.",
          "Sie liegen getrennt von den übrigen Daten und sind nur für die Geschäftsstelle einsehbar."
        ]
      },
      {
        title: "Beitrag per SEPA-Lastschrift",
        items: [
          "Der Beitrag wird ausschließlich per SEPA-Lastschrift eingezogen; das Mandat wird mit der Anmeldung erteilt.",
          "Wer bereits Mitglied ist und überweist, ist davon nicht betroffen."
        ]
      },
      {
        title: "Elternkodex wird mit angemeldet",
        items: [
          "Der Elternkodex des Vereins lässt sich im Formular herunterladen. Er regelt, wie sich Eltern, Angehörige und Fans bei Training, Spielen, Turnieren und Vereinsfahrten verhalten.",
          "Die Kenntnisnahme wird angekreuzt und gesondert unterschrieben — die Unterschrift steht anschließend mit auf dem Antrag, den die Geschäftsstelle ausdruckt.",
          "Gefragt wird nur dort, wo es Erziehungsberechtigte gibt: wer volljährig ist und sich selbst anmeldet, sieht den Abschnitt nicht."
        ]
      }
    ]
  }
];

// Was kodex.html kann. Die kuerzeste der drei Listen -- die Seite hat genau
// eine Aufgabe, und alles, was daran haengt, steht in vier Themen.
const KODEX_FUNKTIONEN = [
  {
    title: "Wofür diese Seite ist",
    items: [
      "Eltern, deren Kind schon in der Abteilung Fußball spielt, reichen hier die Kenntnisnahme des Elternkodex nach — ohne Vereinskonto und ohne die Anmeldung zu wiederholen.",
      "Wer ein Kind neu anmeldet, braucht die Seite nicht: dort wird der Kodex im Formular mitbestätigt.",
      "Für andere Abteilungen gilt der Kodex nicht."
    ]
  },
  {
    title: "Bestätigen und unterschreiben",
    items: [
      "Der Kodex wird auf der Seite heruntergeladen, angekreuzt und am Bildschirm unterschrieben.",
      "Angegeben werden Name und Geburtsdatum des Kindes, die Mannschaft, der Name der unterschreibenden Person und der Ort der Unterschrift. Eine E-Mail-Adresse ist freiwillig.",
      "Die Fassung des Textes wird mitgespeichert, damit später belegbar ist, was unterschrieben wurde."
    ]
  },
  {
    title: "Mehrere Kinder",
    items: [
      "Nach dem Absenden erscheint eine Bestätigungsseite mit allen Angaben und der Unterschrift. Sie lässt sich drucken oder als PDF sichern.",
      "Ein Knopf führt direkt zur nächsten Erklärung — Name und Ort bleiben stehen, unterschrieben wird erneut."
    ]
  },
  {
    title: "Was der Verein damit macht",
    items: [
      "Die Erklärung wird dem Kind auch dann zugeordnet, wenn der Name anders geschrieben ist als im Bestand: verglichen werden die sortierten Namensteile zusammen mit dem Geburtsdatum.",
      "Passt sie zu keinem Kind, landet sie in der Verwaltung in der Liste „Nicht zuzuordnen“ und wird von Hand zugeordnet.",
      "Wird eine vorhandene Erklärung ersetzt, bleibt die alte samt Unterschrift im Verlauf stehen. Ein zweiter, gleicher Klick bleibt folgenlos."
    ]
  }
];

// Eigener Block fuer kodex.html. Der Weg richtet sich an eine andere
// Gruppe (Familien, deren Kind schon Mitglied ist) und wird zu anderen
// Zeiten gebraucht als eine Anmeldung -- in NACHWUCHS_CHANGELOG ginge er
// zwischen Spielerlaubnis und Passbild unter.
const KODEX_CHANGELOG = [
  {
    version: "1.1",
    groups: [
      {
        title: "Im Info-Reiter steht jetzt, was die Seite kann",
        items: [
          "Die Liste der Änderungen und die Versionsnummer sind aus dem Info-Reiter verschwunden.",
          "Stattdessen steht dort die Karte „Funktionen“: was diese Seite kann, nach Themen geordnet.",
          "Was sich geändert hat, steht weiterhin in den Neuigkeiten auf der Startseite der Tools-Übersicht."
        ]
      }
    ]
  },
  {
    version: "1.0",
    groups: [
      {
        title: "Elternkodex nachreichen",
        items: [
          "Eltern, deren Kind schon in der Abteilung Fußball spielt, können die Kenntnisnahme des Elternkodex über einen Link nachreichen — ohne Vereinskonto und ohne die Anmeldung zu wiederholen.",
          "Der Kodex wird auf der Seite heruntergeladen, angekreuzt und am Bildschirm unterschrieben. Die Fassung des Textes wird mitgespeichert.",
          "Nach dem Absenden erscheint eine Bestätigungsseite mit allen Angaben und der Unterschrift. Sie ist die eigene Kopie der Erklärung und lässt sich drucken oder als PDF sichern.",
          "Bei mehreren Kindern führt ein Knopf direkt zur nächsten Erklärung — Name und Ort bleiben stehen, unterschrieben wird erneut."
        ]
      }
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
    const fehler = new Error((daten && daten.error) || ("Fehler " + res.status));
    // ⚠️ Der Status wird MITGEGEBEN, obwohl die beiden Antragsseiten ihn
    // nicht lesen. Auf einem Weg ohne Anmeldung ist ein 401 keine Aussage
    // ueber den Aufrufer, sondern heisst: der Worker kennt diese Aktion
    // nicht (noch nicht deployt, umbenannt). Ohne den Status stuende dem
    // Nutzer "Nicht angemeldet" auf einer Seite, die nie eine Anmeldung
    // verlangt -- und er suchte den Fehler bei sich.
    fehler.status = res.status;
    throw fehler;
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

// --- Elternkodex nachreichen (ohne Login) -----------------------------

// Schalter, Vereinsname und die Fassung des Kodex. Alles drei aus dem
// Server: was er ausliefert, wirkt auch fuer Browser, die das alte JS
// noch im Cache haben.
function ladeKodexInfo() {
  return antragRequest("vv-kodex-info");
}

// ⚠️ Eigene Aktion, kein Feld im Koerper einer bestehenden. Wie bei
// vv-nachwuchs-senden haengt damit die Herkunft am aufgerufenen Weg statt
// an einer Behauptung des Clients.
//
// ⚠️ Der Server baut den Eintrag aus einzelnen, gecappten Feldern selbst
// zusammen -- nie ein rohes Objekt. Ein Weg ohne Anmeldung ist eine
// schwaechere Vertrauensstufe, und der Absender darf nichts setzen, was
// der Server besser weiss (Fassung, Zeitpunkt, Zuordnung).
function sendeKodex(daten) {
  return antragRequest("vv-kodex-senden", daten);
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

// Zweistufig wie in der Verwaltung: mit pruefen=true zaehlt der Server
// nur, was an dem Antrag haengt, und schreibt nichts. Erst der Aufruf
// ohne die Flagge loescht.
//
// ⚠️ Die Antwort traegt in BEIDEN Stufen nachweis_owner -- der Schluessel
// zu den Ausweiskopien steht nur im Antrag, und nach dem DELETE kennt ihn
// niemand mehr. Wer ihn nicht vorher liest, laesst die Dateien
// unauffindbar in der Ablage liegen.
function loescheAntragSatz(id, pruefen) {
  return antragRequestMitToken("vv-antrag-loeschen",
    pruefen ? { id, pruefen: true } : { id });
}

// Gegenstueck zu ladeNachweisHoch, aber MIT Token: das Hochladen macht die
// Familie ohne Konto, das Loeschen ausschliesslich die Geschaeftsstelle.
// ⚠️ Der Gateway verlangt hier session.isAdmin, nicht nur das
// Bearbeiten-Haekchen der Kachel. Wer Antraege loeschen darf, aber kein
// Administrator ist, bekommt an dieser Stelle 403 -- der Antrag bleibt
// dann stehen, statt halb geloescht zu werden.
async function loescheNachweiseAntrag(owner) {
  const token = antragToken();
  if (!token) throw new Error("Nicht angemeldet");

  let res;
  try {
    res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify({ action: "vv-nachweis-loeschen", owner })
    });
  } catch {
    throw new Error("Die Ablage ist nicht erreichbar.");
  }

  const daten = await res.json().catch(() => null);
  if (!res.ok) {
    // Status mitgeben: nur so kann der Aufrufer den 403 (fehlendes
    // Administrieren-Recht) von einer Stoerung unterscheiden.
    const fehler = new Error((daten && daten.error) || ("Fehler " + res.status));
    fehler.status = res.status;
    throw fehler;
  }
  return daten;
}
