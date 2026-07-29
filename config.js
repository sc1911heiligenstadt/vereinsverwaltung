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
