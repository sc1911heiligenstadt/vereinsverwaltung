# 👥 Vereinsverwaltung

Mitglieder, Beiträge und Vereinsfinanzen an einer Stelle — mit Sparten, Haushalten und Beitragsklassen. Löst den GLS Vereinsmeister ab. Abteilungsleitungen sehen ausschließlich ihre eigene Sparte, ohne Bankdaten.

**➡️ [Vereinsverwaltung öffnen](https://sc1911heiligenstadt.github.io/vereinsverwaltung/)**

## Seiten

| Seite | Wofür |
|---|---|
| [Vereinsverwaltung](https://sc1911heiligenstadt.github.io/vereinsverwaltung/) | Mitglieder, Beiträge und Vereinsfinanzen an einer Stelle — mit Sparten, Haushalten und Beitragsklassen. Löst den GLS … |
| [Mitgliedsantrag](https://sc1911heiligenstadt.github.io/vereinsverwaltung/antrag.html) | Aufnahmeantrag zum Ausfüllen und Unterschreiben am Handy — ohne Anmeldung, ohne Ausdruck. Der Antrag geht an die Geschäftsstelle … |
| [Buchhaltung](https://sc1911heiligenstadt.github.io/vereinsverwaltung/buchhaltung.html) | Buchungen und Konten der Vereinsfinanzen |
| [Anmeldung Nachwuchs](https://sc1911heiligenstadt.github.io/vereinsverwaltung/nachwuchs.html) | Neue Jugendspieler in einem Durchgang anmelden: Aufnahmeantrag nach § 4 und Antrag auf Spielerlaubnis beim Thüringer … |
| [Auswertungen](https://sc1911heiligenstadt.github.io/vereinsverwaltung/vorstand.html) | Zahlen und Auswertungen für den Vorstand |

## Zugang

Die Anmeldung läuft über die [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) — dort einmal anmelden, danach ist dieses Werkzeug offen.

Die Rechte gelten in drei Stufen: **Sehen** (nur ansehen), **Bearbeiten** (Einträge pflegen) und **Administrieren** (Einstellungen und Verwaltung). Wer welche Stufe hat, legt die Tools-Übersicht fest.

## Lokal starten

Über den Eintrag `vereinsverwaltung` in `E:\.claude\launch.json` — der Server läuft dann auf `http://localhost:8810/`.

## Technik

Vanilla JavaScript ohne Build-Schritt — die Dateien werden so ausgeliefert, wie sie im Repo liegen. Veröffentlicht über GitHub Pages.

**Anders als die übrigen Werkzeuge liegen die Daten hier nicht in der Nextcloud**, sondern in einer Cloudflare-D1-Datenbank, angesprochen über den eigenen Worker `vereinsverwaltung-worker.js` (wird **nicht** über GitHub Pages ausgeliefert, sondern separat bei Cloudflare veröffentlicht). Grund sind die Größenordnung — 1200 bis 2500 Mitglieder — und die doppelte Buchführung, die einzelne, unteilbare Buchungen braucht. Beträge werden durchgehend in Cent geführt, nie als Kommazahl.

Die Anmeldung kommt weiterhin von der Tools-Übersicht; welche Rolle jemand hier hat (Geschäftsstelle, Schatzmeister, Abteilungsleitung, Passstelle, Vorstand), steht in der Datenbank dieses Werkzeugs. Die Rolle **Passstelle** sieht ausschließlich die Nachwuchs-Anmeldungen samt Nachweisen und erzeugt daraus den Antrag auf Spielerlaubnis — Bankdaten und Mitgliederbestand bleiben ihr verschlossen.

Jede Nacht wird die Datenbank nach Nextcloud gesichert, samt ihrem Aufbau; zum Zurückspielen genügt die Datei allein.

---

Ein Werkzeug des 1. SC 1911 Heiligenstadt. Alle Werkzeuge auf einen Blick: [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) · Erklärungen im [Toolbox Wiki](https://sc1911heiligenstadt.github.io/Vereinswiki/).
