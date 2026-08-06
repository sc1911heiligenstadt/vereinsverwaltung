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

const DASHBOARD_URL = "https://sc1911heiligenstadt.github.io/ToolsUebersicht/";

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
    version: "Antrag wie auf dem Papier",
    datum: "2026-08-06",
    punkte: [
      "Der Online-Aufnahmeantrag fragt jetzt dasselbe ab wie das gedruckte Formular des Vereins: Geburtsort, Kreditinstitut, die Anschrift des Kontoinhabers, wenn sie abweicht, und den Ort der Unterschrift.",
      "Bei Minderjährigen unterschreiben jetzt beide Erziehungsberechtigten. Wer allein sorgeberechtigt ist, kreuzt das an — dann genügt eine Unterschrift, und es steht später schwarz auf weiß, warum.",
      "Im Reiter Anträge druckt ein Knopf den eingegangenen Antrag als vierseitigen Papierantrag mit allen Unterschriften — zum Abheften in der Geschäftsstelle.",
      "Der Geburtsort steht auch beim Mitglied selbst und lässt sich dort pflegen. Bei zwei gleichnamigen Mitgliedern mit demselben Geburtsdatum ist er das einzige, was sie unterscheidet.",
      "Eine Ermäßigung für Schwerbehinderte steht bewusst nicht zur Auswahl: das wäre ein Gesundheitsdatum. Sie wird wie bisher mit der Geschäftsstelle geklärt, die den Nachweis sichtet und nicht speichert."
    ]
  },
  {
    version: "Einheitliches Aussehen",
    datum: "2026-08-05",
    punkte: [
      "Die Kopfzeile trägt jetzt dasselbe Blau wie alle anderen Vereins-Werkzeuge. Vorher war ihr Ton etwas dunkler, was beim Wechsel aus der Tools-Übersicht auffiel.",
      "Der Reiter „Info“ steht jetzt ganz rechts in der Leiste — wie überall sonst. Die Verweise auf Buchhaltung und Auswertungen sind davor gerückt.",
      "Die Versionsangabe steht als kleine Plakette in der Überschrift „Über die Vereinsverwaltung“ statt als eigene Zeile darunter.",
      "Am Handy zoomt das iPhone beim Antippen der Dateiauswahl im Import nicht mehr ungefragt in die Seite hinein."
    ]
  },
  {
    version: "Abteilungen löschen",
    datum: "2026-07-31",
    punkte: [
      "Im Reiter Anträge lässt sich eine Abteilung jetzt ganz löschen und nicht nur aus dem Antragsformular nehmen. Gedacht für die Abteilungen, die einmal angelegt wurden und nie ein Mitglied hatten.",
      "Gelöscht wird nur, was wirklich leer ist. Steht noch jemand darin, nennt die Rückfrage Namen und Mitgliedsnummer, und erst eine zweite Bestätigung nimmt die Zuordnungen mit. Die Personen bleiben Mitglied, ihr Beitrag ändert sich dadurch nicht.",
      "Ganz gesperrt bleibt das Löschen, solange eine Abteilungsleitung auf der Abteilung eingetragen ist, eine Buchung auf sie verweist oder ein offener Aufnahmeantrag sie nennt.",
      "Die Zahl in Klammern zählt nur laufende Zuordnungen. Ob wirklich nichts mehr an einer Abteilung hängt, prüft deshalb der Server und nicht die Anzeige.",
      "Stilllegen bleibt der schonende Weg: die Abteilung verschwindet aus dem Antragsformular, behält aber ihre Mitglieder und ihre Geschichte."
    ]
  },
  {
    version: "Nächtliche Sicherung",
    datum: "2026-07-30",
    punkte: [
      "Jede Nacht um kurz nach vier schreibt der Server den vollständigen Datenbestand nach Nextcloud. Bis dahin gab es von dieser Datenbank keine Sicherung.",
      "Die Datei enthält den Aufbau der Datenbank gleich mit. Zum Zurückspielen genügt sie allein — auch dann noch, wenn die App längst weitergewachsen ist.",
      "Daneben liegt eine Mitgliederliste als Tabelle zum Öffnen und Ausdrucken. Ohne Bankdaten: sie ist für den Notfall gedacht, und dafür braucht niemand eine IBAN.",
      "Die sieben Wochentagsdateien überschreiben sich der Reihe nach, vom Monatsersten bleibt eine Kopie dauerhaft stehen. Gelöscht wird nichts.",
      "Im Reiter Rollen steht, wann zuletzt gesichert wurde und wie lange es gedauert hat — samt Knopf für eine Sicherung von Hand. Eine Sicherung, die still ausfällt, merkt man sonst erst, wenn man sie braucht."
    ]
  },
  {
    version: "Buchhaltung und Auswertungen",
    datum: "2026-07-30",
    punkte: [
      "Neue Seite Buchhaltung für den Schatzmeister: doppelte Buchführung mit den vier Sphären des Gemeinnützigkeitsrechts.",
      "Kontenrahmen an SKR49 angelehnt, mit Klartext-Vorlagen für die üblichen Vorgänge. Jede Vorlage sagt, in welche Sphäre der Vorgang gehört und warum — daran hängt die Steuerpflicht.",
      "Die Sphäre hängt am Konto, nicht an der einzelnen Buchung. Eine Spende lässt sich nicht als ideell buchen, wenn sie auf dem Sponsoring-Konto landet.",
      "Beitragsläufe und Lastschrift-Einzüge werden auf Knopfdruck übernommen. Jeder Vorgang kann nur einmal gebucht werden, das erzwingt die Datenbank.",
      "Gelöscht wird nie: eine falsche Buchung wird storniert, und beide bleiben im Journal stehen. Belegnummern sind je Jahr lückenlos.",
      "Jahresabschluss stellt die Erfolgskonten glatt, bucht das Ergebnis ins Vereinsvermögen und schreibt die Eröffnungsbilanz des Folgejahres.",
      "Neue Seite Auswertungen: Bestand, Altersaufbau, Entwicklung über zehn Jahre, Beitragsklassen und Stimmberechtigte nach § 8 Abs. 2.",
      "Bestandsmeldung an den Landessportbund als Tabelle zum Herunterladen — Altersgruppen mal Geschlecht je Abteilung.",
      "Die Auswertungsseite lädt keinen Code, der Personendaten anzeigen könnte. Der Vorstand sieht Summen, keine Namen."
    ]
  },
  {
    version: "Online-Aufnahmeantrag nach § 4",
    datum: "2026-07-30",
    punkte: [
      "Neues öffentliches Formular unter antrag.html: Aufnahmeantrag und SEPA-Mandat am Handy ausfüllen und mit dem Finger unterschreiben. Kein Ausdruck, kein Login.",
      "Ein Antrag wird nie von selbst zur Mitgliedschaft. Sie entsteht erst, wenn im neuen Reiter Anträge das Datum des Vorstandsbeschlusses eingetragen wird — § 4 verlangt ihn, und die App kann ihn nicht erraten.",
      "Ist der Antragsteller minderjährig, verlangt das Formular Namen und Unterschrift des gesetzlichen Vertreters. Dessen Unterschrift trägt dann auch das Lastschriftmandat.",
      "Beim Öffnen eines Antrags wird gesucht, ob die Person schon im Bestand steht oder Familie unter derselben Anschrift wohnt. Beim Zuordnen zu deren Haushalt gilt der Familienbeitrag und ein vorhandenes Mandat wird weiterverwendet.",
      "Aus der Annahme entstehen in einem Zug Person, Haushalt, Mitgliedschaft, Abteilungen und — aus der Unterschrift — das SEPA-Mandat.",
      "Die Ehrenmitgliedschaft steht im Formular nicht zur Wahl: sie wird nach § 4 Abs. 5 verliehen, nicht beantragt.",
      "Die Foto-Einwilligung ist freiwillig und getrennt von der Aufnahme. Ob sie erteilt wurde, steht beim Mitglied.",
      "Das Formular lässt sich in der Verwaltung schließen und wieder öffnen.",
      "Die IBAN wird schon beim Tippen geprüft. Eine falsche Prüfziffer lässt sonst die komplette Einreichung bei der Bank scheitern.",
      "Nach dem Absenden bekommt der Antragsteller seine Erklärung samt Unterschrift zum Ausdrucken oder Speichern."
    ]
  },
  {
    version: "Mahnwesen nach § 5 Abs. 3",
    datum: "2026-07-30",
    punkte: [
      "Mahnlauf mit drei Stufen: erste Mahnung, zweite Mahnung, Anhörung vor dem Ausschluss.",
      "Eine Stufe wird erst erreicht, wenn die Frist der vorigen abgelaufen ist. Zwei Mahnungen am selben Tag sind keine zwei Mahnungen — daran scheitert ein Ausschluss.",
      "Erst der bestätigte Versand macht aus einer erzeugten Mahnung eine schriftliche Mahnung. Die Stufenzählung hängt daran, nicht am Erzeugen.",
      "Serienbrief zum Herunterladen: Adressliste und fertige Brieftexte mit allen Einzelposten. Die Anhörung nennt die Satzung und die Frist.",
      "Ausschlussliste für den Vorstand — erst wenn alle drei Voraussetzungen erfüllt sind. Die App schließt niemanden aus, das ist ein Vorstandsbeschluss.",
      "Wer bezahlt, dessen Mahnungen schließen sich von selbst. Eine Teilzahlung reicht nicht.",
      "Karenzzeit, Fristen, Mindestbetrag und Mahngebühren sind einstellbar. Die Anhörungsfrist lässt sich nicht unter zehn Tage setzen.",
      "Mahngebühren werden als eigene Forderung angelegt, nicht auf den Beitrag geschlagen."
    ]
  },
  {
    version: "Zahlungseingänge",
    datum: "2026-07-30",
    punkte: [
      "Neuer Reiter Zahlungen: wer schuldet was, seit wann — über den gesamten Bestand.",
      "Eine eingereichte SEPA-Datei wird mit einem Klick als eingegangen gebucht. Die wenigen Rückläufer werden danach einzeln erfasst; 441 Zahlungen von Hand macht niemand.",
      "Rücklastschrift: die ursprüngliche Zahlung wird storniert statt gelöscht und bleibt sichtbar, die Forderung lebt wieder auf. Das Entgelt der Bank wird als eigene Forderung angelegt, statt den Beitrag zu erhöhen.",
      "Einzelzahlungen (Überweisung, bar) werden auf die offenen Forderungen des Haushalts verteilt, die zuerst fällige zuerst. Bleibt etwas übrig, wird das gemeldet und nicht still einbehalten.",
      "Kontoauszug je Haushalt: alle Forderungen und alle Zahlungen, auch die zurückgegangenen.",
      "Eine Forderung wird nie gelöscht, nur storniert — mit Grund und Zeitstempel."
    ]
  },
  {
    version: "Beitragslauf und SEPA",
    datum: "2026-07-30",
    punkte: [
      "Neuer Reiter Beitragslauf: aus den Beitragsklassen werden echte Forderungen — für jedes Mitglied eine, mit voller Herleitung.",
      "Vor jedem Lauf zeigt eine Vorschau, was entstehen würde, und vor allem, wer nicht dabei ist und warum. Geschrieben wird erst danach.",
      "Der Lauf ist wiederaufsetzbar: bricht er ab, macht ein erneuter Start dort weiter und legt nichts doppelt an.",
      "SEPA-Lastschrift als pain.008-Datei. Ein Haushalt wird einmal belastet, auch wenn drei Kinder dazugehören — die Mitgliedsnummern stehen im Verwendungszweck.",
      "Umlaute werden lesbar umgeschrieben (Müller → Mueller). Ein Umlaut in der Datei würde die komplette Einreichung scheitern lassen, nicht nur die eine Zeile.",
      "Vorabankündigung als Liste zum Herunterladen, mit Betrag, Fälligkeit, Mandatsreferenz und Gläubiger-ID.",
      "Vereinsstammdaten (IBAN, Gläubiger-ID) liegen in der Datenbank, nicht im Programmcode.",
      "Ein festgeschriebener Lauf lässt sich nicht mehr löschen — nur noch einzeln stornieren."
    ]
  },
  {
    version: "Beitragsordnung",
    datum: "2026-07-29",
    punkte: [
      "Neuer Reiter Beiträge: die drei Beitragsklassen mit ihren Sätzen, wie viele Mitglieder darin stehen und die Jahressumme.",
      "Der Beitrag fällt einmal je Mitglied an, nicht je Sparte — wer in zwei Abteilungen aktiv ist, zahlt einmal.",
      "Die Klassen werden aus dem übernommenen Bestand zugeordnet und sind je Mitglied von Hand änderbar. Sie werden bewusst NICHT aus dem Alter berechnet: im Bestand gibt es einen 75-Jährigen mit Kinderbeitrag und Rentner ab 48.",
      "Beitragssätze liegen in der Datenbank und gelten ab einem Stichtag. Ein Beschluss der Mitgliederversammlung ändert den Satz, ohne dass Vergangenes umgerechnet wird.",
      "Zwei Prüflisten: Mitglieder, deren Klasse nicht zum Alter passt, und solche, deren Sparten verschiedene Beitragsarten nennen."
    ]
  },
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
