# 👥 Vereinsverwaltung

Mitglieder, Beiträge und Vereinsfinanzen an einer Stelle — mit Sparten, Haushalten und Beitragsklassen. Löst den GLS Vereinsmeister ab. Abteilungsleitungen sehen ausschließlich ihre eigene Sparte, ohne Bankdaten.

**➡️ [Vereinsverwaltung öffnen](https://sc1911heiligenstadt.github.io/vereinsverwaltung/)**

## Seiten

| Seite | Wofür |
|---|---|
| [Vereinsverwaltung](https://sc1911heiligenstadt.github.io/vereinsverwaltung/) | Mitglieder, Beiträge und Vereinsfinanzen an einer Stelle — mit Sparten, Haushalten und Beitragsklassen. |
| [Mitgliedsantrag](https://sc1911heiligenstadt.github.io/vereinsverwaltung/antrag.html) | Aufnahmeantrag zum Ausfüllen und Unterschreiben am Handy — ohne Anmeldung, ohne Ausdruck. |
| [Anmeldung Nachwuchs](https://sc1911heiligenstadt.github.io/vereinsverwaltung/nachwuchs.html) | Neue Jugendspieler in einem Durchgang anmelden: Aufnahmeantrag nach § 4 und Antrag auf Spielerlaubnis beim Thüringer Fußball-Verband, unterschrieben am Handy. |
| [Elternkodex](https://sc1911heiligenstadt.github.io/vereinsverwaltung/kodex.html) | Eltern bestätigen den Elternkodex Fußball online — über einen Link, ohne Anmeldung. |
| [Buchhaltung](https://sc1911heiligenstadt.github.io/vereinsverwaltung/buchhaltung.html) | Doppelte Buchführung mit den vier Sphären des Gemeinnützigkeitsrechts, Kontenrahmen an SKR49 angelehnt. |
| [Auswertungen](https://sc1911heiligenstadt.github.io/vereinsverwaltung/vorstand.html) | Bestand, Altersaufbau, Entwicklung und Stimmberechtigte für den Vorstand — Summen ohne Namen. |

Die drei Formularseiten (*Mitgliedsantrag*, *Anmeldung Nachwuchs*, *Elternkodex*) stehen bewusst **ohne Anmeldung** offen; jede von ihnen nennt über dem Absenden-Knopf, was mit den Angaben geschieht. Sie lassen sich in der Verwaltung einzeln zudrehen und wieder öffnen.

## Was drin ist

| Reiter | Wofür |
|---|---|
| **Mitglieder** | Der gesamte Bestand mit Suche, Filtern und sortierbaren Spalten; Person, Mitgliedschaft, Sparten, Beitrag und Austritt. Darunter die **Bestandsmeldung an den Landessportbund** als CSV. |
| **Beiträge** | Die Beitragsklassen mit Sätzen, Mitgliederzahl und Jahressumme, dazu zwei Prüflisten und die Beitragssätze ab Stichtag. |
| **Beitragslauf** | Forderungen erzeugen — jährlich, halbjährlich oder vierteljährlich —, dazu SEPA-Datei (pain.008) und Vorabankündigung. Mit Vorschau vor dem Schreiben. |
| **Zahlungen** | Offene Posten über den ganzen Bestand, Sammelbuchung einer SEPA-Datei und ihre Rücknahme, Rücklastschriften, Einzelzahlungen und der Kontoauszug je Haushalt. |
| **Anträge** | Eingegangene Aufnahmeanträge sichten, als Papierantrag drucken und nach dem Vorstandsbeschluss annehmen; dazu die Abteilungen samt Sportartennummer und die Schalter für die öffentlichen Formulare. |
| **Elternkodex** | Wer die Kenntnisnahme abgegeben hat und wer nicht, der Link zum Nachreichen und die Liste „Nicht zuzuordnen“. |
| **Einstellungen** | Rollen vergeben, Sicherung der Datenbank, Mitgliederbestand aus dem Vereinsmeister übernehmen und der Zugang zur Buchhaltung. |
| **Info** | Rechte, Änderungen und der Datenschutzhinweis. |

## Zugang

Die Anmeldung läuft über die [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) — dort einmal anmelden, danach ist dieses Werkzeug offen.

**Was jemand hier darf, entscheidet aber nicht die Tools-Übersicht, sondern die Rolle in diesem Werkzeug.** Die beiden Quellen sind bewusst getrennt: die Tools-Übersicht beantwortet, wer überhaupt herein darf, die Datenbank dieses Werkzeugs, was er dann sieht.

| Rolle | Sieht und darf |
|---|---|
| **Geschäftsstelle** | Alle Mitglieder sehen und bearbeiten, Anträge annehmen, Abteilungen pflegen, Beitragsläufe und Zahlungen ansehen |
| **Schatzmeister** | Wie die Geschäftsstelle — und als Einziger einen Beitragslauf auslösen, die SEPA-Datei erzeugen, Zahlungen buchen und die Buchhaltung führen |
| **Abteilungsleitung** | Ausschließlich Mitglieder der eigenen Sparte — ohne Bankdaten und ohne Einblick, in welchen weiteren Sparten eine Person aktiv ist |
| **Passstelle** | Ausschließlich die Nachwuchs-Anmeldungen samt Nachweisen und den Antrag auf Spielerlaubnis — keine Bankdaten, kein Mitgliederbestand, keine Entscheidung über die Aufnahme |
| **Vorstand** | Nur die Auswertungen: Summen und Kennzahlen, keine Personendaten |

Vergeben werden die Rollen im Reiter *Einstellungen*; das darf nur ein Administrator der Tools-Übersicht. Wer Nachweise in der Vereins-Nextcloud öffnen oder ablegen soll — das betrifft auch die Passstelle —, braucht dort zusätzlich das Bearbeiten-Häkchen auf der Kachel *Vereinsverwaltung*.

Jede dieser Grenzen wird **auf dem Server** durchgesetzt, nicht in der Anzeige: Felder, die eine Rolle nicht sehen darf, stehen in ihren Abfragen gar nicht erst im SQL.

## Lokal starten

Über den Eintrag `vereinsverwaltung` in `E:\.claude\launch.json` — der Server läuft dann auf `http://localhost:8810/`.

## Technik

Vanilla JavaScript ohne Build-Schritt — die Dateien werden so ausgeliefert, wie sie im Repo liegen. Veröffentlicht über GitHub Pages.

**Anders als die übrigen Werkzeuge liegen die Daten hier nicht in der Nextcloud**, sondern in einer Cloudflare-D1-Datenbank, angesprochen über den eigenen Worker `vereinsverwaltung-worker.js` (wird **nicht** über GitHub Pages ausgeliefert, sondern separat bei Cloudflare veröffentlicht). Grund sind die Größenordnung — 1200 bis 2500 Mitglieder — und die doppelte Buchführung, die einzelne, unteilbare Buchungen braucht. Beträge werden durchgehend in Cent geführt, nie als Kommazahl.

Ausweiskopien und andere Nachweise liegen bewusst **nicht** in dieser Datenbank, sondern getrennt und zugriffsbeschränkt in der Vereins-Nextcloud.

Jede Nacht wird die Datenbank nach Nextcloud gesichert, samt ihrem Aufbau; zum Zurückspielen genügt die Datei allein. Bleibt eine Sicherung aus, steht das als Warnung in den Einstellungen.

---

Ein Werkzeug des 1. SC 1911 Heiligenstadt. Alle Werkzeuge auf einen Blick: [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) · Erklärungen im [Toolbox Wiki](https://sc1911heiligenstadt.github.io/Vereinswiki/).
