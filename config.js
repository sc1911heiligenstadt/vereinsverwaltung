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
    version: "Datenschutz auf der Eltern-Seite, Löschen räumt vollständig",
    datum: "2026-08-18",
    punkte: [
      "Die Seite, auf der Eltern den Elternkodex bestätigen, sagt jetzt über dem Absenden-Knopf, was mit den Angaben geschieht: wer verantwortlich ist, wozu und auf welcher Grundlage verarbeitet wird, wie lange gespeichert bleibt und welche Rechte bestehen. Sie steht offen im Netz, und wer dort unterschreibt, hat kein Vereinskonto und keinen anderen Ort zum Nachlesen. Aufklappbar, zugeklappt als Vorgabe — wie im Aufnahmeantrag und in der Nachwuchs-Anmeldung.",
      "Gespeichert wird, solange das Kind Mitglied des Vereins ist. Der Text sagt auch, dass eine ersetzte Fassung als Nachweis daneben aufbewahrt wird.",
      "Wird eine Erklärung gelöscht, verschwinden jetzt auch die ersetzten Fassungen dazu. Vorher blieben sie stehen — mit Namen, Geburtsdatum, E-Mail, Anschrift-Kennung und Unterschrift, aber ohne die Zeile, zu der sie gehörten. Zieht eine Familie ihre Erklärung zurück, ist das eine ganze Löschung und keine halbe.",
      "Der entsprechende Hinweis in der Nachwuchs-Anmeldung kannte den Elternkodex noch nicht — er stand schon da, als die Kodex-Karte dazukam. Der fehlende Punkt ist ergänzt."
    ]
  },
  {
    version: "Die Kinderliste lässt sich sortieren",
    datum: "2026-08-18",
    punkte: [
      "Im Reiter „Elternkodex“ lässt sich die Kinderliste jetzt nach jeder Spalte sortieren: ein Klick auf die Überschrift sortiert, ein zweiter dreht die Richtung um. Ein Pfeil zeigt, wonach gerade sortiert ist. Mit der Tastatur geht es ebenso.",
      "Wann unterschrieben wurde, steht dafür in einer eigenen Spalte „Unterschrieben am“. Vorher stand das Datum im farbigen Feld der Spalte „Kenntnisnahme“ und ließ sich damit nicht sortieren; dieses Feld sagt jetzt nur noch, ob die Erklärung vorliegt.",
      "Kinder ohne Unterschrift stehen beim Sortieren nach dem Zeitpunkt immer am Ende — auch andersherum. Sonst sucht man die neuesten Erklärungen und sieht zuerst eine Seite voll offener Zeilen.",
      "Geburtstag und Mitgliedsnummer sortieren nach ihrem Wert, nicht nach ihrer Schreibweise: der 31.03. steht vor dem 17.11. desselben Jahres, und die 594 vor der 1816."
    ]
  },
  {
    version: "Ersetzte Erklärungen bleiben nachweisbar",
    datum: "2026-08-18",
    punkte: [
      "Wird eine Erklärung für dasselbe Kind ein zweites Mal abgeschickt, gilt weiterhin die neuere — die vorige bleibt jetzt aber vollständig erhalten, samt ihrer Unterschrift. Vorher war sie fort, und niemand konnte hinterher sehen, dass es sie überhaupt gab. Der Link für die Eltern kommt bewusst ohne Zugangscode aus, und Name und Geburtstag eines Kindes sind im Verein kein Geheimnis; ein Beleg darf deshalb nicht still verschwinden.",
      "Beide Listen zeigen an der Zeile, wie oft ersetzt wurde. Im Detail stehen die ersetzten Fassungen untereinander — mit ihrer Unterschrift und dem Vermerk, ob die Ersetzung vom selben Anschluss kam wie die ursprüngliche Erklärung. Eine Familie, die sich selbst korrigiert, sendet in aller Regel vom selben; steht dort „anderer Anschluss“, lohnt eine Rückfrage.",
      "Derselbe Klick zweimal — Doppelklick oder wackeliges Netz — bleibt folgenlos: keine zweite Zeile, kein Eintrag im Verlauf, kein Strich auf der Bremse.",
      "Die Bremse gegen Massenzusendungen zählt jetzt Vorgänge statt Zeilen. Wer immer dasselbe Kind schickte, lief vorher komplett an ihr vorbei.",
      "Welche Fassung des Kodex in der Nachwuchs-Anmeldung unterschrieben wurde, bestimmt jetzt der Server. Vorher kam die Angabe aus dem Browser — eine veraltete Seite im Zwischenspeicher schrieb damit die falsche Fassung in den Beleg."
    ]
  },
  {
    version: "Elternkodex nachreichen und abgleichen",
    datum: "2026-08-18",
    punkte: [
      "Neuer Reiter „Elternkodex“: er zeigt, von welchen Kindern die Kenntnisnahme vorliegt und von welchen noch nicht — mit Zähler und Suche.",
      "Der Kodex gilt ausschließlich der Abteilung Fußball. Der Abgleich läuft nur gegen deren minderjährige Mitglieder; Kinder aus Turnen, Volleyball oder Handball stehen nicht in der Liste und werden nicht angeschrieben. Kommt trotzdem eine Erklärung für ein Kind einer anderen Abteilung, steht sie mit dem Vermerk „andere Abteilung — nichts zu tun“ da statt als Schreibfehler.",
      "Eltern, deren Kind schon Mitglied ist, reichen die Erklärung über einen Link nach. Sie brauchen kein Vereinskonto und müssen keine Anmeldung wiederholen. Der Link steht im Reiter zum Kopieren, daneben ein Schalter, der die Seite wieder zudreht.",
      "Erklärungen, die zu keinem Kind im Bestand passen — meist eine abweichende Schreibweise oder ein Rufname —, stehen in einer eigenen Liste „Nicht zuzuordnen“ und lassen sich von Hand zuordnen. Sie verschwinden nicht stillschweigend: die Familie hält ihre Erklärung für erledigt.",
      "Abweichende Schreibweisen findet der Abgleich selbst: Umlaute, Groß- und Kleinschreibung, Bindestriche und vertauschte Vor- und Nachnamen führen auf dasselbe Kind, solange das Geburtsdatum stimmt.",
      "Findet sich die Abteilung Fußball nicht (umbenannt oder stillgelegt), sagt der Reiter das — statt eine Liste aller minderjährigen Mitglieder zu zeigen, die wie ein Ergebnis aussieht.",
      "Jede Erklärung lässt sich einzeln ansehen — mit Unterschrift, Zeitpunkt und der Fassung des Kodex, die gelesen wurde. Testeinträge und zurückgezogene Erklärungen lassen sich löschen.",
      "Ein zweites Absenden derselben Familie für dasselbe Kind ersetzt die vorige Erklärung statt eine zweite anzulegen."
    ]
  },
  {
    version: "Elternkodex in der Nachwuchs-Anmeldung",
    datum: "2026-08-18",
    punkte: [
      "Wer ein Kind anmeldet, lädt im Formular den Elternkodex des Vereins herunter, bestätigt die Kenntnisnahme und unterschreibt sie gesondert. Ohne beides nimmt der Server die Anmeldung nicht an.",
      "Die Unterschrift steht im Antrag neben den übrigen und wird auf dem Papierantrag mit ausgedruckt — zusammen mit der Fassung des Kodex, die unterschrieben wurde.",
      "Meldet sich jemand volljähriges selbst an, entfällt der Abschnitt: der Kodex verpflichtet die Eltern, und dann gibt es keine.",
      "Der allgemeine Aufnahmeantrag ist unverändert — er führt den Kodex nicht."
    ]
  },
  {
    version: "Vereinsname steht fest, Gläubiger-ID wird geprüft",
    datum: "2026-08-16",
    punkte: [
      "Der Name des Vereins ist kein Eingabefeld mehr, sondern steht fest in der App. Er war bisher Teil der Vereinsstammdaten, und ein dort eingetragener Probewert erschien dadurch im Begrüßungstext beider öffentlicher Formulare, im Text des SEPA-Mandats, auf dem Papierantrag und auf dem Verbandsbogen.",
      "Die Gläubiger-Identifikationsnummer wird jetzt auf ihre Prüfziffer geprüft — genau wie die IBAN. Ein Zahlendreher darin fiel bisher erst der Bank auf, und die weist dann die komplette Einreichung ab, nicht die eine Zeile.",
      "Ist die hinterlegte Nummer unbrauchbar, erscheint sie nicht mehr im Mandatstext des Antragsformulars, und die Vereinsstammdaten melden sich als unvollständig. Eine SEPA-Datei lässt sich dann nicht erzeugen.",
      "Die IBAN, die BIC und die Gläubiger-ID bleiben unverändert Einstellungen — sie gehören nicht in den Programmcode."
    ]
  },
  {
    version: "Neue Anträge nur noch per SEPA-Lastschrift",
    datum: "2026-08-14",
    punkte: [
      "Im Aufnahmeantrag und in der Nachwuchs-Anmeldung ist die Auswahl zwischen Lastschrift und Überweisung entfallen. Beide Formulare erteilen jetzt immer ein SEPA-Mandat; ohne gültige IBAN nimmt der Server keinen Antrag mehr an.",
      "Bestehende Mitglieder und bereits eingegangene Anträge bleiben unberührt: Wer als Überweiser geführt wird, wird weiterhin so angezeigt, gedruckt und angenommen, und der Beitragslauf überspringt ihn wie bisher namentlich."
    ]
  },
  {
    version: "Reiterleiste wie in den übrigen Vereins-Tools",
    datum: "2026-08-11",
    punkte: [
      "Die Reiterleiste sieht jetzt aus wie in allen anderen Vereins-Tools: gleiche Schriftgröße, gleicher Abstand zum Rand und dieselbe abgerundete Oberkante. Sie begann bisher als einzige der Familie weiter links als die blaue Kopfzeile darüber.",
      "„Einstellungen“ und „Info“ stehen weiterhin rechts, jetzt aber auf jeder Bildschirmbreite. Bisher rutschten sie auf schmalen Fenstern und am Handy nach links zu den übrigen Reitern.",
      "Die Knöpfe sind wie überall sonst in Halbfett gesetzt — sie standen hier als einzige App in normaler Stärke.",
      "Die Buchhaltung hat einen Reiter „Info“ bekommen. Sie war die einzige Seite ohne einen, dadurch stand die Versionsangabe dort nirgends."
    ]
  },
  {
    version: "Rehasport in der Bestandsmeldung",
    datum: "2026-08-10",
    punkte: [
      "Der Rehasport wird außerhalb dieser App geführt, gehört aber in die Meldung an den Landessportbund. Neuer Knopf „Rehasportdaten einlesen“ — in den Auswertungen bei der Bestandsmeldung und in der Vereinsverwaltung unter „Mitglieder“. Eingelesen wird die ausgefüllte Bestandserhebung des Behinderten- und Rehabilitationssportverbandes, so wie sie einmal im Jahr von dort kommt.",
      "Danach steht der Rehasport in beiden Ausgaben: in der Altersgruppen-Tabelle der Auswertungen als eigene, hervorgehobene Zeile mit Angabe der Quelle, und in der Datei für das Portal unser-sportverein.net.",
      "Die Verbandsdatei enthält keine Personen, sondern Zahlen je Jahrgang. Für das Portal, das nur Einzelpersonen einliest, entstehen daraus Platzhalter-Zeilen mit erkennbar erfundenen Namen („Rehasport, Nr. 0001“) und dem 1. Juli des Jahrgangs als Geburtstag. Gemeldet wird davon nur, was der Verband auswertet: Jahrgang, Geschlecht und Sportart.",
      "Nichtmitglieder des Rehasports und der Behindertensport lassen sich einzeln ab- und zuschalten. Dazu ein Feld für die Sportartennummer — ohne sie laufen diese Personen beim Verband unter „ohne Landesfachverband“.",
      "Die Datei wird gegengerechnet: stimmt die Kontrollspalte „Gesamtmitglieder im Verein“ nicht mit den Sportblöcken überein oder weicht die Summenzeile ab, steht das als Warnung da. Und sind die geladenen Zahlen aus einem anderen Jahr als der Stichtag, sagt die Karte das, statt sie stillschweigend mitzumelden.",
      "Die eingelesenen Zahlen bleiben im Browser und gehen nicht an den Server. Nach einem Wechsel des Geräts oder des Browsers ist die Datei erneut einzulesen."
    ]
  },
  {
    version: "Anträge löschen, und ein Icon im Browser-Tab",
    datum: "2026-08-10",
    punkte: [
      "Im Reiter „Anträge“ steht jetzt neben jedem Antrag ein Löschknopf. Bisher ließ sich nur der Status ändern — ein Probe- oder Fehleintrag blieb für immer stehen.",
      "Die Rückfrage nennt Name, Eingangsdatum und was mit weggeht: die hochgeladenen Nachweise und die Unterschriften. Gelöscht heißt hier wirklich gelöscht; der Vorgang steht danach nur noch im Protokoll, mit Name und Status.",
      "Die Nachweise werden zuerst entfernt, dann der Antrag. Schlägt das fehl, bleibt der Antrag stehen — der Schlüssel zu den Dateien steht nur dort, und ohne ihn läge eine Ausweiskopie unauffindbar in der Ablage.",
      "Ein angenommener Antrag bleibt gesperrt. An ihm hängen Mitgliedschaft und SEPA-Mandat; die Mitgliedschaft endet über den Austritt, nicht über das Formular. Die Passstelle kann ebenfalls nicht löschen.",
      "Alle fünf Seiten der Vereinsverwaltung zeigen jetzt das Vereinswappen als Icon im Browser-Tab."
    ]
  },
  {
    version: "Beiträge auch halb- und vierteljährlich einziehen",
    datum: "2026-08-10",
    punkte: [
      "Im Fenster „Neuer Beitragslauf“ steht jetzt ein Zahlungsrhythmus: jährlich, halbjährlich oder vierteljährlich. Jährlich bleibt die Vorgabe und rechnet unverändert.",
      "Ein Rhythmus legt einen eigenen Beitragslauf je Rate an — bei vierteljährlich also vier. Das ist Absicht: Das zweite Quartal wird im April eingereicht, nicht im Januar zusammen mit dem ersten. Jede Rate hat deshalb ihre eigene SEPA-Datei, ihren eigenen Zahlungseingang und ihre eigene Übernahme in die Buchhaltung.",
      "Die Fälligkeitstermine stehen einzeln im Fenster. Vorbelegt sind sie im Abstand der Perioden, jeder lässt sich für sich ändern.",
      "Der Jahresbeitrag wird geteilt, nicht vervielfacht: Die Summe aller Raten ist auf den Cent genau der Jahresbeitrag. Geht ein Betrag nicht glatt auf, liegt der Restcent auf der ersten Rate.",
      "Jede Rate erfasst den Bestand ihres eigenen Zeitraums. Wer im August eintritt, bekommt keine Forderung für das erste Quartal — und taucht deswegen auch nicht als Ausschluss in der Vorschau auf.",
      "Verwendungszweck, Vorabankündigung und die Kennungen der SEPA-Datei nennen die Rate mit. Bei vier Abbuchungen im Jahr muss auf dem Kontoauszug stehen, welche gemeint ist."
    ]
  },
  {
    version: "Löschen heißt jetzt wirklich löschen",
    datum: "2026-08-10",
    punkte: [
      "Sind zu einem Beitragslauf bereits Zahlungen verbucht, ist das Löschen keine Sackgasse mehr. Die Rückfrage nennt Anzahl und Summe der verbuchten Zahlungen und löscht sie auf Bestätigung mit.",
      "Vorher verwies die Meldung darauf, zuerst die Sammelbuchung zurückzunehmen — und genau das war nicht immer möglich. „Buchung zurücknehmen“ hängt an einer als eingegangen gebuchten SEPA-Datei; Zahlungen, die von Hand erfasst wurden oder deren Datei auf „offen“ steht, erreicht sie nicht. Der Lauf ließ sich dann überhaupt nicht mehr entfernen.",
      "Die Warnung in der Rückfrage ist entsprechend deutlich: Die Zahlungen werden gelöscht, nicht storniert. Das ist nur dann richtig, wenn bei der Bank wirklich nichts eingereicht wurde.",
      "Zahlungen, die zu einem anderen Lauf gehören und nur über die SEPA-Datei mit dranhängen, bleiben unangetastet — sie verlieren lediglich den Verweis auf die gelöschte Datei.",
      "Unverändert gesperrt bleiben ein festgeschriebener Lauf und einer, der in die Buchhaltung übernommen ist: dort wird storniert, nicht gelöscht. Was gelöscht wurde, steht mit Zahl und Summe im Protokoll."
    ]
  },
  {
    version: "Die Sicherung meldet sich, wenn sie ausbleibt",
    datum: "2026-08-10",
    punkte: [
      "Unter „Einstellungen“ steht bei der Sicherung jetzt eine Warnung, wenn der letzte erfolgreiche Lauf länger als einen Tag her ist. Vorher stand dort unverändert der letzte gelungene Lauf — eine seit Wochen ausgefallene Sicherung sah damit genauso aus wie eine gesunde.",
      "Bricht die nächtliche Sicherung an der Datenmenge ab, entsteht seitdem eine Teilsicherung mit ausdrücklichem Vermerk, statt dass gar keine Datei geschrieben wird. Was gesichert werden konnte, ist damit gesichert, und der Rest steht als Warnung dabei.",
      "„SEPA-Datei erzeugen“, die Sammelbuchung und die Eröffnungsbilanz lassen sich nicht mehr versehentlich doppelt anstoßen. Ein zweiter Klick, während der erste noch läuft, wird verworfen — beim Prüfen bleibt es beim Prüfen.",
      "Dieselbe Forderung kann aus derselben SEPA-Datei nicht mehr zweimal als bezahlt gebucht werden. Das war der Weg, auf dem ein nie eingegangener Beitrag still auf „bezahlt“ stehen konnte. Eine Zahlung zu stornieren und neu zu buchen geht unverändert.",
      "Vier Werkzeuge aus der Aufbauphase (Testdaten anlegen, zwei Messläufe, Testdaten löschen) sind entfernt. Sie wurden von der Oberfläche nie aufgerufen."
    ]
  },
  {
    version: "Import und Rollen liegen jetzt in den Einstellungen",
    datum: "2026-08-10",
    punkte: [
      "Die beiden Reiter „Import“ und „Rollen“ sind aus der Leiste verschwunden. Beide Bereiche stehen unverändert im Reiter „Einstellungen“ — zuerst die Rollenvergabe samt Sicherung der Datenbank, darunter die Bestandsübernahme aus dem Vereinsmeister, ganz unten der Zugang zur Buchhaltung.",
      "Nichts ist abgeschaltet oder gelöscht worden: Es sind dieselben Masken mit denselben Rechten. Die Rollenvergabe sieht weiterhin nur ein Administrator, den Import nur, wer Mitglieder anlegen darf, die Buchhaltung nur der Schatzmeister.",
      "Der Reiter „Einstellungen“ erscheint seitdem für jeden, der mindestens einen dieser drei Bereiche nutzen darf — vorher war er dem Schatzmeister vorbehalten.",
      "Die Reiterleiste ist damit von zehn auf acht Einträge geschrumpft."
    ]
  },
  {
    version: "Beitragsläufe löschen",
    datum: "2026-08-10",
    punkte: [
      "Jede Zeile in der Liste der Beitragsläufe hat jetzt einen Löschen-Knopf — für Probeläufe und für den Fall, dass beim Anlegen etwas schiefgegangen ist (etwa zwei Läufe für dasselbe Jahr nebeneinander).",
      "Vor dem Löschen wird gezeigt, was daran hängt: Zahl und Summe der Forderungen, vermerkte SEPA-Dateien und stornierte Zahlungen. Erst danach kommt die Rückfrage.",
      "Ein Vermerk über eine erzeugte SEPA-Datei blockiert das Löschen nicht mehr. Die Datei selbst wird nirgends gespeichert — ein Vermerk allein ist kein Beleg dafür, dass etwas bei der Bank liegt.",
      "Sind Zahlungen zu dem Lauf verbucht, wird ausdrücklich nachgefragt, bevor sie mitgelöscht werden (siehe den Eintrag ganz oben). Ist der Lauf in die Buchhaltung übernommen, nennt die Meldung die Belegnummer, unter der dort zu stornieren ist — dann bleibt er gesperrt.",
      "Ein festgeschriebener Lauf lässt sich weiterhin nicht löschen. Das ist der Sinn des Festschreibens; einzelne Forderungen lassen sich dort nach wie vor stornieren."
    ]
  },
  {
    version: "Mahnwesen entfernt",
    datum: "2026-08-10",
    punkte: [
      "Der gesamte Mahnbereich im Reiter „Zahlungen“ ist entfallen: Mahnlauf, Mahnungsliste, Serienbrief, die Ausschlussliste für den Vorstand und die Einstellungen für Fristen und Mahngebühren.",
      "Die offenen Posten bleiben unverändert — fällige und nicht bezahlte Forderungen werden dort weiterhin gezählt und hervorgehoben. Nur der Weg, daraus eine Mahnung zu erzeugen, gibt es nicht mehr.",
      "Wichtig für den Fall eines Ausschlusses: Die Satzung verlangt nach § 5 Abs. 3 zwei schriftliche Mahnungen und eine Anhörung. Diese Schritte müssen jetzt außerhalb der App belegt werden. Der Austrittsgrund „Ausschluss“ bleibt bestehen und vollzieht wie bisher einen Vorstandsbeschluss.",
      "Bereits erzeugte Mahnungen sind mit entfernt worden."
    ]
  },
  {
    version: "Meldedatei für den Landessportbund",
    datum: "2026-08-10",
    punkte: [
      "Neuer Kasten unter der Mitgliederliste: „Bestandsmeldung an den Landessportbund“. Er erzeugt die CSV-Datei im Format des LSB Thüringen — eine Zeile je Person mit Name, Vorname, Geschlecht, Geburtsdatum und Sportartennummer. Genau die liest das Portal unser-sportverein.net in Schritt 3 der Bestandserhebung ein und rechnet daraus selbst die Jahrgangs- und Fachverbandsmeldung.",
      "Die Zahlen je Altersgruppe in den Auswertungen bleiben, wo sie sind — sie sind zum Gegenrechnen da, hochladen lassen sie sich nicht.",
      "Jede Abteilung bekommt dafür im Reiter „Anträge“ ein Feld für ihre Sportartennummer aus der Sportartenliste des LSB. Ohne Nummer laufen ihre Mitglieder beim Verband unter „ohne Landesfachverband“: 2026 kostet das 5 € je Kind und 10 € je Erwachsenem, ab 2027 ist es gar nicht mehr möglich.",
      "Was der Meldung fehlt, wird namentlich genannt statt gezählt: Mitglieder ohne Abteilung, ohne Geburtsdatum, und jede Abteilung ohne Nummer samt der Zahl der Betroffenen."
    ]
  },
  {
    version: "Sammelbuchung lässt sich zurücknehmen",
    datum: "2026-08-10",
    punkte: [
      "Eine als eingegangen gebuchte SEPA-Datei lässt sich jetzt zurücknehmen — für den Fall, dass der Einzug in Wahrheit nie stattgefunden hat. Der Knopf steht in der Tabelle „SEPA-Dateien“ des Beitragslaufs, dort wo sonst „als eingegangen buchen“ steht.",
      "Die Zahlungen werden dabei storniert, nicht gelöscht: sie bleiben mit Grund und Urheber sichtbar. Die Forderungen stehen danach wieder offen und lassen sich erneut einziehen.",
      "Gesperrt ist der Weg, sobald der Einzug in die Buchhaltung übernommen wurde — dort wird zuerst storniert, sonst zeigt das Forderungskonto etwas anderes als die Beitragsverwaltung."
    ]
  },
  {
    version: "SEPA-Datei kommt jetzt wirklich an",
    datum: "2026-08-10",
    punkte: [
      "Die erzeugte SEPA-Datei wird jetzt sofort heruntergeladen, und der Kasten mit dem Link bleibt stehen, bis man ihn verlässt.",
      "Vorher erschien der Link nur für den Bruchteil einer Sekunde: unmittelbar danach lud die Seite den Lauf neu und blendete den Kasten dabei aus. Die Datei war damit verloren — sie wird bewusst nicht auf dem Server gespeichert, gespeichert ist nur, dass sie erzeugt wurde.",
      "Wer deshalb ein zweites Mal auf „SEPA-Datei erzeugen“ geklickt hat, bekam die Warnung, dass zu diesem Lauf bereits eine Datei erzeugt wurde. Die Warnung war richtig — angekommen war die erste Datei trotzdem nie."
    ]
  },
  {
    version: "Einstellungen und Info stehen rechts",
    datum: "2026-08-08",
    punkte: [
      "„Info“ steht jetzt am rechten Rand der Reiterleiste — so wie in allen anderen Werkzeugen des Vereins. Links daneben liegt der neue Reiter „Einstellungen“.",
      "Die Buchhaltung hat die Reiterleiste verlassen und liegt jetzt unter „Einstellungen“. Sie wird auf absehbare Zeit nicht gebraucht; gelöscht oder abgeschaltet ist an ihr nichts — wer sie öffnet, findet sie unverändert vor.",
      "Am schmalen Bildschirm bricht die Leiste weiterhin um; die Rechtsbündigkeit greift erst, wenn alle Reiter in eine Zeile passen."
    ]
  },
  {
    version: "Nachweise ansehen statt herunterladen",
    datum: "2026-08-06",
    punkte: [
      "Ein Klick auf eine Anlage öffnet sie jetzt in einem Fenster in der App — Bilder und PDF werden dort angezeigt. Der Knopf „Herunterladen“ steht daneben, wird aber nur noch gebraucht, wenn man die Datei wirklich speichern will.",
      "Vorher landete jede Anlage in einem neuen Tab, und was der Browser damit machte, hing vom Dateityp ab: bei manchen war es sofort ein Download. Am Handy verlor man dabei den Antrag, aus dem man kam.",
      "Das gilt genauso für das abgelegte Verbandsformular.",
      "Der Knopf für das Passbild heißt jetzt „Passbild“ statt „passbild“."
    ]
  },
  {
    version: "Passstelle: eigene Rolle für die Spielerlaubnis",
    datum: "2026-08-06",
    punkte: [
      "Wer die Spielerpässe macht, braucht dafür keinen Zugang zur Mitgliederverwaltung mehr. Die neue Rolle „Passstelle“ sieht ausschließlich die Nachwuchs-Anmeldungen samt ihren Nachweisen und erzeugt daraus den Antrag auf Spielerlaubnis.",
      "Bankdaten bleiben dabei außen vor: IBAN, Kontoinhaber und Kreditinstitut verlassen den Server für diese Rolle gar nicht erst. Auch der Mitgliederbestand und die Dublettensuche bleiben verschlossen.",
      "Über die Aufnahme in den Verein entscheidet weiterhin allein die Geschäftsstelle (§ 4 der Satzung). Die Passstelle kann einen Antrag weder annehmen noch ablehnen noch vormerken, und das öffentliche Formular kann sie nicht zudrehen.",
      "Vergeben wird die Rolle wie die übrigen im Reiter „Rollen“. Zusätzlich braucht das Konto in der Tools-Übersicht das Bearbeiten-Häkchen auf der Kachel „Vereinsverwaltung“ — sonst lassen sich die Nachweise nicht öffnen und das erzeugte Formular nicht ablegen."
    ]
  },
  {
    version: "Anmeldung Nachwuchs mit Spielerlaubnis",
    datum: "2026-08-06",
    punkte: [
      "Neue Jugendspieler melden sich über eine eigene Seite an. Aus einem Durchgang entstehen beide Anträge: die Aufnahme nach § 4 und der Antrag auf Spielerlaubnis beim Thüringer Fußball-Verband.",
      "Im Reiter „Anträge“ steht bei einer Nachwuchs-Anmeldung der Knopf „TFV-Antrag erzeugen“. Er füllt das Original-Formular des Verbandes aus — mit den Unterschriften der Familie darauf. Zu tun bleibt der Vereinsstempel und die Eingabe in DFBnet Pass-Online.",
      "Passt eine Angabe nicht in die Kästchen des Verbandsformulars, sagt der Knopf das vorher und nennt das Feld. Abgeschnitten wird nichts stillschweigend.",
      "Die Nachweise, die der Verband als Anlage verlangt, lassen sich beim Antrag ansehen. Sie liegen bewusst nicht in dieser Datenbank, sondern getrennt und zugriffsbeschränkt in der Vereins-Nextcloud — Ausweiskopien gehören nicht neben Beiträge und Buchhaltung.",
      "Die Staatsangehörigkeit gehört jetzt zu den Stammdaten einer Person. Der Verband verlangt sie, und beim nächsten Antrag desselben Kindes steht sie schon da.",
      "Die Nachwuchs-Anmeldung hat einen eigenen Schalter in den Einstellungen. Sie lässt sich zudrehen, ohne den allgemeinen Aufnahmeantrag mitzuschließen.",
      "Bei einer Erstausstellung und beim Vereinswechsel nimmt die Familie gleich ein Passbild auf. Die Kamera zeigt dabei ein Oval, in das der Kopf gehört — am Handy wie am Rechner, unter Android wie unter iOS. Danach lässt sich der Ausschnitt noch verschieben. Der Verbandsbogen hat kein Bildfeld; das Bild ist für die Eingabe in DFBnet Pass-Online da.",
      "Das erzeugte Verbandsformular wird zugleich beim Antrag in der Vereins-Nextcloud abgelegt, nicht nur heruntergeladen. Der Verband verlangt die Aufbewahrung für mindestens zwei Jahre. Liegt schon eines vor, sagt der Antrag das und bietet es zum Öffnen an."
    ]
  },
  {
    version: "Die Antragsseite wird ein eigenes Werkzeug",
    datum: "2026-08-06",
    punkte: [
      "Die Antragsseite hat jetzt dieselbe Kopfzeile wie die übrigen Vereins-Werkzeuge — mit Wappen und mit dem Rückweg zum Dashboard. Der Rückweg erscheint nur für Angemeldete: wer noch kein Vereinskonto hat, käme sonst in einem Anmeldefenster heraus.",
      "Ein Info-Reiter nennt die Version, die Geschäftsstelle und was sich am Formular geändert hat.",
      "Neuer Reiter „Eingegangene Anträge“: Geschäftsstelle und Schatzmeister sehen dort die eingegangenen Anträge, können sie ansehen und als Papierantrag ausdrucken — ohne den Umweg über die Mitgliederverwaltung.",
      "Beschlossen wird weiterhin nur in der Vereinsverwaltung. Dort hängen Dublettenprüfung, Haushalt und Beitragsklasse daran; zwei Orte für dieselbe Entscheidung wären einer zu viel."
    ]
  },
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
    version: "Mitgliederverwaltung",
    datum: "2026-07-29",
    punkte: [
      "Mitgliederliste mit Suche, Filter nach Sparte und Status.",
      "Rechte werden serverseitig durchgesetzt: Abteilungsleiter sehen ausschliesslich Mitglieder ihrer eigenen Sparte, ohne Einblick in weitere Spartenzugehoerigkeiten.",
      "Bankdaten werden in der Liste grundsaetzlich nicht uebertragen.",
      "Datenhaltung in einer Cloudflare-D1-Datenbank statt einer JSON-Datei -- bei 2500 Mitgliedern traegt das bisherige Muster nicht mehr."
    ]
  }
];
