// Vereinsverwaltung 1. SC 1911 Heiligenstadt -- Konfiguration
//
// APP_VERSION bleibt dauerhaft "1.0" und wird NIE hochgezaehlt.
// Neue Funktionen bekommen einen neuen Block in CHANGELOG, der UEBER
// dem 1.0-Block steht. Das Versionsbadge zeigt weiterhin 1.0.

const APP_VERSION = "1.0";

// Eigener Worker, bewusst nicht der zentrale Gateway: die Daten liegen
// in Cloudflare D1, und die Rechte je Sparte werden serverseitig
// durchgesetzt. Siehe Datei-Kopf von vereinsverwaltung-worker.js.
const WORKER_URL = "https://vereinsverwaltung.michel-brunner.workers.dev";

const DASHBOARD_URL = "https://tecko1985.github.io/ToolsUebersicht/";

// Satzung § 3 und § 4 Abs. 5 -- genau diese drei, nichts anderes.
const MITGLIEDSARTEN = {
  ordentlich: "Ordentliches Mitglied",
  ausserordentlich: "Ausserordentliches Mitglied",
  ehrenmitglied: "Ehrenmitglied"
};

const STATUS_LABELS = {
  antrag: "Antrag",
  aktiv: "Aktiv",
  ruhend: "Ruhend",
  gekuendigt: "Gekuendigt",
  beendet: "Beendet"
};

// Satzung § 5 Abs. 2: Austritt ist nur zum 30.06. oder 31.12. moeglich.
// Der Client bietet deshalb kein freies Datum an.
const AUSTRITTSTERMINE = ["06-30", "12-31"];

// Satzung § 8 Abs. 2
const STIMMRECHT_AB_ALTER = 16;

const SEITENGROESSE = 50;

const CHANGELOG = [
  {
    version: "Sortierbare Liste",
    datum: "2026-07-29",
    punkte: [
      "Jede Spalte der Mitgliederliste lässt sich durch Anklicken der Überschrift sortieren, ein zweiter Klick dreht die Richtung um.",
      "Sortiert wird über den gesamten Bestand, nicht nur über die angezeigte Seite.",
      "Mitgliedsnummern werden numerisch sortiert (1, 2, 3 … statt 1, 10, 100).",
      "Einträge ohne Angabe stehen in beiden Richtungen am Ende."
    ]
  },
  {
    version: "Bestandsübernahme und Rollen",
    datum: "2026-07-29",
    punkte: [
      "Neuer Reiter Rollen: Geschäftsstelle, Schatzmeister, Abteilungsleitung und Vorstand lassen sich jetzt in der Oberfläche vergeben. Vorher konnten nur die Administratoren des Dashboards überhaupt etwas sehen.",
      "Neuer Reiter Import: Mitgliederdatei aus dem Vereinsmeister (CSV oder Excel) einlesen, Spalten selbst zuordnen, Probelauf vor dem ersten Schreibzugriff.",
      "Die gedruckten Vereinsmeister-Listen werden automatisch erkannt und in echte Spalten aufgelöst — auch ohne Kopfzeile.",
      "Eine zweite Datei kann fehlende Angaben nachtragen, ohne Vorhandenes zu überschreiben.",
      "Spalten, die keinem Feld zugeordnet werden, gehen nicht verloren — sie werden als Zusatzangabe beim Mitglied gespeichert.",
      "Der Import ist wiederholbar: bereits vorhandene Mitgliedsnummern werden übersprungen statt doppelt angelegt.",
      "SEPA-Mandatsreferenzen werden unverändert übernommen und nie neu vergeben.",
      "Personen mit gleichem Nachnamen unter derselben Anschrift können zu einem Haushalt zusammengefasst werden — Grundlage für Familienrabatt und ein gemeinsames Mandat.",
      "Neues Mitglied von Hand anlegen, Sparten einzeln zuordnen und beenden.",
      "Eine leere Liste sagt jetzt, ob der Filter zu eng steht oder die Datenbank leer ist."
    ]
  },
  {
    version: "1.0",
    datum: "2026-07-29",
    punkte: [
      "Erste Fassung: Mitgliederliste mit Suche, Filter nach Sparte und Status.",
      "Rechte werden serverseitig durchgesetzt: Abteilungsleiter sehen ausschliesslich Mitglieder ihrer eigenen Sparte, ohne Einblick in weitere Spartenzugehoerigkeiten.",
      "Bankdaten werden in der Liste grundsaetzlich nicht uebertragen.",
      "Datenhaltung in einer Cloudflare-D1-Datenbank statt einer JSON-Datei -- bei 2500 Mitgliedern traegt das bisherige Muster nicht mehr."
    ]
  }
];
