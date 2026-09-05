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
    version: "1.2",
    groups: [
      {
        title: "Eingegangene Anträge löschen",
        items: [
          "Scheitert das Entfernen der hochgeladenen Nachweise am fehlenden Recht, sagt die Meldung das jetzt: dafür wird „Administrieren“ auf der Kachel Vereinsverwaltung gebraucht, Bearbeiten allein reicht nicht. Bisher stand dort „Bitte noch einmal versuchen“ — ein Rat, dem nie ein Erfolg folgen konnte."
        ]
      },
      {
        title: "Verbandsformular AO21",
        items: [
          "Umlaute und ß stehen jetzt in jedem Fall richtig auf dem Blatt für den Thüringer Fußball-Verband. Wird ein Name zerlegt getippt oder aus einer anderen Anwendung kopiert — also mit einem eigenständigen Tremazeichen statt dem fertigen „ü“ —, wurde daraus bisher stillschweigend ein Fragezeichen: aus „Müller“ wurde „Mu?ller“.",
          "Bleibt trotzdem ein Zeichen übrig, das die Schrift des Formulars nicht kennt, steht das jetzt als Hinweis über dem erzeugten Blatt — wie schon bei zu langen Eintragungen. Vorher wurde es stumm gedruckt."
        ]
      },
      {
        title: "Buchhaltung",
        items: [
          "Lehnt der Server eine Buchung ab, steht der Grund jetzt im roten Kasten und bleibt stehen. Bisher erbte die Ablehnung die grüne Farbe einer unmittelbar vorher geglückten Buchung — grün heißt auf dieser Seite „gebucht“ — und wurde vom Ausblend-Zeitgeber der alten Meldung nach sechs Sekunden wieder weggenommen."
        ]
      },
      {
        title: "Erste Einrichtung",
        items: [
          "Nach „Sparten anlegen“ in der noch leeren Datenbank steht die Abteilungs-Auswahl sofort bereit. Bisher blieb sie leer, bis die Seite neu geladen wurde — es sah aus, als hätte das Anlegen nichts bewirkt."
        ]
      }
    ]
  },
  {
    version: "1.1",
    groups: [
      {
        title: "Elternkodex",
        items: [
          "Die Kenntnisnahme des Elternkodex, die Eltern schon bei der Nachwuchs-Anmeldung unterschrieben haben, zählt jetzt im Reiter „Elternkodex“ mit. Bisher las die Liste allein die nachgereichten Erklärungen — angemeldete und aufgenommene Kinder standen deshalb als „offen“ da, obwohl ihre Eltern längst unterschrieben hatten, und wären ein zweites Mal angeschrieben worden.",
          "Woher eine Kenntnisnahme stammt, steht an der Zeile: „aus der Anmeldung“ oder ohne Vermerk für eine nachgereichte Erklärung. „Ansehen“ zeigt in beiden Fällen die Unterschrift, die Fassung des Kodex und wer unterschrieben hat.",
          "Hat eine Familie beides abgegeben, gilt die nachgereichte Erklärung. Sie ist die spätere und kann zu einer neueren Fassung des Kodex gehören.",
          "Ein Aufnahmeantrag erscheint nie unter „Nicht zuzuordnen“. Passt er zu keinem Mitglied, ist er nicht falsch geschrieben, sondern noch nicht angenommen.",
          "Zuordnen, Aufheben und Löschen gibt es weiterhin nur für nachgereichte Erklärungen. Was mit der Anmeldung kam, gehört zum Aufnahmeantrag und wird dort verwaltet."
        ]
      }
    ]
  },
  {
    version: "1.0",
    groups: [
      {
        title: "Mitglieder, Sparten und Haushalte",
        items: [
          "Die Mitgliederliste zeigt den gesamten Bestand mit Suche sowie Filtern nach Sparte und Status. Jede Spalte lässt sich durch Anklicken der Überschrift sortieren, ein zweiter Klick dreht die Richtung um; sortiert wird über den ganzen Bestand und nicht nur über die angezeigte Seite. Mitgliedsnummern sortieren nach ihrem Wert (1, 2, 3 … statt 1, 10, 100), Einträge ohne Angabe stehen in beiden Richtungen am Ende.",
          "Zu jedem Mitglied stehen Person, Mitgliedschaft, Sparten und Beitrag. Erfasst werden auch Geburtsort und Staatsangehörigkeit — der Geburtsort ist bei zwei gleichnamigen Mitgliedern mit demselben Geburtsdatum oft das Einzige, was sie unterscheidet, und die Staatsangehörigkeit verlangt der Fußball-Verband für die Spielerlaubnis.",
          "Mitglieder lassen sich auch von Hand anlegen, Sparten einzeln zuordnen und beenden. Der Austritt ist nach § 5 Abs. 2 der Satzung nur zum 30. Juni oder zum 31. Dezember möglich; ein freies Datum bietet die App deshalb gar nicht erst an.",
          "Personen mit gleichem Nachnamen unter derselben Anschrift lassen sich zu einem Haushalt zusammenfassen. Das ist die Grundlage für den Familienbeitrag und für ein gemeinsames SEPA-Mandat.",
          "Abteilungen lassen sich anlegen, stilllegen und löschen. Stillgelegt verschwindet eine Abteilung aus dem Antragsformular, behält aber ihre Mitglieder und ihre Geschichte. Gelöscht wird nur, was wirklich leer ist: steht noch jemand darin, nennt die Rückfrage Namen und Mitgliedsnummer, und erst eine zweite Bestätigung nimmt die Zuordnungen mit — die Personen bleiben Mitglied, ihr Beitrag ändert sich nicht. Ganz gesperrt bleibt das Löschen, solange eine Abteilungsleitung eingetragen ist, eine Buchung auf die Abteilung verweist oder ein offener Aufnahmeantrag sie nennt.",
          "Eine leere Liste sagt, ob der Filter zu eng steht oder die Datenbank noch leer ist."
        ]
      },
      {
        title: "Beiträge und Beitragsläufe",
        items: [
          "Der Reiter „Beiträge“ zeigt die Beitragsklassen mit ihren Sätzen, wie viele Mitglieder darin stehen und die Jahressumme. Der Beitrag fällt einmal je Mitglied an, nicht je Sparte — wer in zwei Abteilungen aktiv ist, zahlt einmal.",
          "Die Klassen werden bewusst nicht aus dem Alter berechnet, sondern aus dem übernommenen Bestand zugeordnet und sind je Mitglied von Hand änderbar. Zwei Prüflisten helfen beim Nachsehen: Mitglieder, deren Klasse nicht zum Alter passt, und solche, deren Sparten verschiedene Beitragsarten nennen.",
          "Beitragssätze liegen in der Datenbank und gelten ab einem Stichtag. Ein Beschluss der Mitgliederversammlung ändert den Satz, ohne dass Vergangenes umgerechnet wird.",
          "Im Reiter „Beitragslauf“ werden aus den Beitragsklassen echte Forderungen — für jedes Mitglied eine, mit voller Herleitung. Vor jedem Lauf zeigt eine Vorschau, was entstehen würde, und vor allem, wer nicht dabei ist und warum; geschrieben wird erst danach. Bricht ein Lauf ab, macht ein erneuter Start dort weiter und legt nichts doppelt an.",
          "Eingezogen wird jährlich, halbjährlich oder vierteljährlich. Ein Rhythmus legt einen eigenen Beitragslauf je Rate an, mit eigener SEPA-Datei, eigenem Zahlungseingang und eigener Übernahme in die Buchhaltung — das zweite Quartal wird im April eingereicht und nicht im Januar zusammen mit dem ersten. Der Jahresbeitrag wird dabei geteilt und nicht vervielfacht: die Summe aller Raten ist auf den Cent genau der Jahresbeitrag, ein Restcent liegt auf der ersten Rate. Jede Rate erfasst den Bestand ihres eigenen Zeitraums, wer im August eintritt, bekommt also keine Forderung für das erste Quartal.",
          "Die Lastschrift entsteht als SEPA-Datei im Format pain.008. Ein Haushalt wird einmal belastet, auch wenn drei Kinder dazugehören — die Mitgliedsnummern stehen im Verwendungszweck. Umlaute werden lesbar umgeschrieben, aus „Müller“ wird „Mueller“; ein Umlaut in der Datei ließe die komplette Einreichung scheitern und nicht nur die eine Zeile. Verwendungszweck, Vorabankündigung und die Kennungen der Datei nennen die Rate mit, damit auf dem Kontoauszug steht, welche gemeint ist. Die Vorabankündigung gibt es als Liste zum Herunterladen, mit Betrag, Fälligkeit, Mandatsreferenz und Gläubiger-ID.",
          "Die erzeugte SEPA-Datei wird sofort heruntergeladen, und der Kasten mit dem Link bleibt stehen, bis man ihn verlässt. Gespeichert wird die Datei bewusst nirgends — gespeichert ist nur, dass sie erzeugt wurde.",
          "Ein Beitragslauf lässt sich löschen, solange er nicht festgeschrieben und nicht in die Buchhaltung übernommen ist. Vorher wird gezeigt, was daran hängt: Zahl und Summe der Forderungen, vermerkte SEPA-Dateien und stornierte Zahlungen. Sind Zahlungen verbucht, nennt die Rückfrage deren Anzahl und Summe und löscht sie auf Bestätigung mit — sie werden dabei gelöscht und nicht storniert, was nur dann richtig ist, wenn bei der Bank wirklich nichts eingereicht wurde. Ist der Lauf in die Buchhaltung übernommen, nennt die Meldung die Belegnummer, unter der dort zu stornieren ist."
        ]
      },
      {
        title: "Zahlungen und offene Posten",
        items: [
          "Der Reiter „Zahlungen“ zeigt über den gesamten Bestand, wer was schuldet und seit wann. Fällige und nicht bezahlte Forderungen werden gezählt und hervorgehoben.",
          "Eine eingereichte SEPA-Datei wird mit einem Klick als eingegangen gebucht; die wenigen Rückläufer werden danach einzeln erfasst. Dieselbe Forderung kann aus derselben Datei nicht zweimal als bezahlt gebucht werden.",
          "Eine solche Sammelbuchung lässt sich zurücknehmen, falls der Einzug in Wahrheit nie stattgefunden hat. Die Zahlungen werden dabei storniert und nicht gelöscht, sie bleiben also mit Grund und Urheber sichtbar; die Forderungen stehen danach wieder offen und lassen sich erneut einziehen. Gesperrt ist der Weg, sobald der Einzug in die Buchhaltung übernommen wurde — dort wird zuerst storniert.",
          "Bei einer Rücklastschrift wird die ursprüngliche Zahlung storniert statt gelöscht und bleibt sichtbar, die Forderung lebt wieder auf. Das Entgelt der Bank wird als eigene Forderung angelegt, statt den Beitrag zu erhöhen.",
          "Einzelzahlungen — Überweisung oder bar — werden auf die offenen Forderungen des Haushalts verteilt, die zuerst fällige zuerst. Bleibt etwas übrig, wird das gemeldet und nicht still einbehalten.",
          "Der Kontoauszug je Haushalt zeigt alle Forderungen und alle Zahlungen, auch die zurückgegangenen. Eine Forderung wird nie gelöscht, nur storniert — mit Grund und Zeitstempel.",
          "Ein Mahnwesen führt die App nicht. Die zwei schriftlichen Mahnungen und die Anhörung, die die Satzung nach § 5 Abs. 3 vor einem Ausschluss verlangt, sind außerhalb der App zu belegen; der Austrittsgrund „Ausschluss“ steht unverändert zur Verfügung."
        ]
      },
      {
        title: "Aufnahmeantrag und Nachwuchs-Anmeldung",
        items: [
          "Die Seite „antrag.html“ ist ein öffentliches Formular: Aufnahmeantrag nach § 4 der Satzung und SEPA-Mandat am Handy ausfüllen und mit dem Finger unterschreiben — kein Ausdruck, keine Anmeldung. Gefragt wird dasselbe wie auf dem gedruckten Formular des Vereins, also auch Geburtsort, Kreditinstitut, die Anschrift des Kontoinhabers, wenn sie abweicht, und der Ort der Unterschrift.",
          "Der Beitrag wird ausschließlich per SEPA-Lastschrift eingezogen; eine Auswahl zwischen Lastschrift und Überweisung gibt es nicht mehr, beide Formulare erteilen immer ein Mandat. Ohne gültige IBAN nimmt der Server keinen Antrag an. Geprüft wird schon beim Tippen, weil eine falsche Prüfziffer sonst die komplette Einreichung bei der Bank scheitern lässt. Bestehende Mitglieder, die als Überweiser geführt werden, bleiben davon unberührt.",
          "Bei Minderjährigen unterschreiben beide Erziehungsberechtigten. Wer allein sorgeberechtigt ist, kreuzt das an — dann genügt eine Unterschrift, und es steht später schwarz auf weiß, warum. Dieselbe Unterschrift trägt dann auch das Lastschriftmandat. Die Ehrenmitgliedschaft steht nicht zur Wahl: sie wird nach § 4 Abs. 5 verliehen, nicht beantragt. Die Foto-Einwilligung ist freiwillig und von der Aufnahme getrennt; ob sie erteilt wurde, steht beim Mitglied.",
          "Eine Ermäßigung für Schwerbehinderte steht bewusst nicht zur Auswahl — das wäre ein Gesundheitsdatum. Sie wird mit der Geschäftsstelle geklärt, die den Nachweis sichtet und nicht speichert.",
          "Nach dem Absenden bekommt der Antragsteller seine Erklärung samt Unterschrift zum Ausdrucken oder Speichern.",
          "Die Seite „nachwuchs.html“ meldet neue Jugendspieler an: aus einem Durchgang entstehen beide Anträge, die Aufnahme nach § 4 und der Antrag auf Spielerlaubnis beim Thüringer Fußball-Verband. Bei einer Erstausstellung und beim Vereinswechsel nimmt die Familie gleich ein Passbild auf — die Kamera zeigt ein Oval, in das der Kopf gehört, am Handy wie am Rechner, und der Ausschnitt lässt sich danach noch verschieben.",
          "Beide Formulare lassen sich in der Verwaltung einzeln zudrehen und wieder öffnen; die Nachwuchs-Anmeldung schließt sich also, ohne den allgemeinen Aufnahmeantrag mitzuschließen.",
          "Im Reiter „Anträge“ werden die eingegangenen Anträge gesichtet. Beim Öffnen wird gesucht, ob die Person schon im Bestand steht oder Familie unter derselben Anschrift wohnt; beim Zuordnen zu deren Haushalt gilt der Familienbeitrag, und ein vorhandenes Mandat wird weiterverwendet. Ein Antrag wird nie von selbst zur Mitgliedschaft — sie entsteht erst mit dem Datum des Vorstandsbeschlusses, den § 4 verlangt und den die App nicht erraten kann. Aus der Annahme entstehen dann in einem Zug Person, Haushalt, Mitgliedschaft, Abteilungen und, aus der Unterschrift, das SEPA-Mandat.",
          "Ein Knopf druckt den eingegangenen Antrag als vierseitigen Papierantrag mit allen Unterschriften zum Abheften in der Geschäftsstelle. Bei einer Nachwuchs-Anmeldung füllt ein zweiter Knopf das Original-Formular des Verbandes aus; passt eine Angabe nicht in dessen Kästchen, sagt er das vorher und nennt das Feld, abgeschnitten wird nichts stillschweigend. Das erzeugte Formular wird zugleich beim Antrag in der Vereins-Nextcloud abgelegt, weil der Verband die Aufbewahrung für mindestens zwei Jahre verlangt.",
          "Die hochgeladenen Nachweise öffnen sich in einem Fenster in der App — Bilder und PDF werden dort angezeigt, der Knopf „Herunterladen“ steht daneben. Sie liegen bewusst nicht in dieser Datenbank, sondern getrennt und zugriffsbeschränkt in der Vereins-Nextcloud: Ausweiskopien gehören nicht neben Beiträge und Buchhaltung.",
          "Ein Antrag lässt sich löschen, solange er nicht angenommen ist. Die Rückfrage nennt Name, Eingangsdatum und was mit weggeht: die hochgeladenen Nachweise und die Unterschriften. Danach steht der Vorgang nur noch im Protokoll. Ein angenommener Antrag bleibt gesperrt — an ihm hängen Mitgliedschaft und Mandat, und die Mitgliedschaft endet über den Austritt.",
          "Auch die Antragsseite hat eine Kopfzeile mit Wappen und den Rückweg zum Dashboard. Der Rückweg erscheint nur für Angemeldete, denn wer noch kein Vereinskonto hat, käme sonst in einem Anmeldefenster heraus. Geschäftsstelle und Schatzmeister sehen dort im Reiter „Eingegangene Anträge“ dieselben Anträge und können sie ausdrucken, ohne den Umweg über die Mitgliederverwaltung; beschlossen wird aber weiterhin nur in der Vereinsverwaltung."
        ]
      },
      {
        title: "Elternkodex",
        items: [
          "Der Elternkodex gilt ausschließlich der Abteilung Fußball. Wer ein Kind über die Nachwuchs-Anmeldung anmeldet, lädt ihn im Formular herunter, bestätigt die Kenntnisnahme und unterschreibt sie gesondert; ohne beides nimmt der Server die Anmeldung nicht an. Die Unterschrift steht im Antrag neben den übrigen und wird auf dem Papierantrag mit ausgedruckt, zusammen mit der Fassung des Kodex. Meldet sich jemand Volljähriges selbst an, entfällt der Abschnitt — der Kodex verpflichtet die Eltern. Der allgemeine Aufnahmeantrag führt ihn nicht.",
          "Eltern, deren Kind schon Mitglied ist, reichen die Erklärung über die Seite „kodex.html“ nach — ohne Vereinskonto und ohne die Anmeldung zu wiederholen. Der Link dorthin steht im Reiter „Elternkodex“ zum Kopieren, daneben ein Schalter, der die Seite wieder zudreht.",
          "Der Reiter „Elternkodex“ zeigt mit Zähler und Suche, von welchen Kindern die Kenntnisnahme vorliegt und von welchen noch nicht. Die Liste lässt sich nach jeder Spalte sortieren, auch mit der Tastatur; Kinder ohne Unterschrift stehen beim Sortieren nach dem Zeitpunkt in beiden Richtungen am Ende. Findet sich die Abteilung Fußball nicht, weil sie umbenannt oder stillgelegt wurde, sagt der Reiter das, statt eine Liste aller minderjährigen Mitglieder zu zeigen, die wie ein Ergebnis aussieht.",
          "Abweichende Schreibweisen findet der Abgleich selbst: Umlaute, Groß- und Kleinschreibung, Bindestriche und vertauschte Vor- und Nachnamen führen auf dasselbe Kind, solange das Geburtsdatum stimmt. Was trotzdem zu keinem Kind passt, steht in einer eigenen Liste „Nicht zuzuordnen“ und lässt sich von Hand zuordnen — es verschwindet nicht stillschweigend, denn die Familie hält ihre Erklärung für erledigt. Kommt eine Erklärung für ein Kind einer anderen Abteilung, steht sie mit dem Vermerk „andere Abteilung — nichts zu tun“ da und nicht als Schreibfehler.",
          "Ein zweites Absenden derselben Familie für dasselbe Kind ersetzt die vorige Erklärung, statt eine zweite anzulegen. Die ersetzte Fassung bleibt samt Unterschrift als Nachweis erhalten und steht im Detail darunter, mit dem Vermerk, ob die Ersetzung vom selben Anschluss kam wie die ursprüngliche Erklärung. Derselbe Klick zweimal — Doppelklick oder wackeliges Netz — bleibt folgenlos.",
          "Jede Erklärung lässt sich einzeln ansehen, mit Unterschrift, Zeitpunkt und der Fassung des Kodex, die gelesen wurde. Welche Fassung das war, bestimmt der Server und nicht der Browser. Testeinträge und zurückgezogene Erklärungen lassen sich löschen; die ersetzten Fassungen dazu verschwinden mit, denn ein Rückzug ist eine ganze Löschung und keine halbe."
        ]
      },
      {
        title: "Buchhaltung",
        items: [
          "Die Seite „buchhaltung.html“ führt für den Schatzmeister die doppelte Buchführung mit den vier Sphären des Gemeinnützigkeitsrechts. Der Kontenrahmen ist an SKR49 angelehnt, mit Klartext-Vorlagen für die üblichen Vorgänge; jede Vorlage sagt, in welche Sphäre der Vorgang gehört und warum — daran hängt die Steuerpflicht.",
          "Die Sphäre hängt am Konto und nicht an der einzelnen Buchung. Eine Spende lässt sich nicht als ideell buchen, wenn sie auf dem Sponsoring-Konto landet.",
          "Beitragsläufe und Lastschrift-Einzüge werden auf Knopfdruck übernommen. Jeder Vorgang kann nur einmal gebucht werden, das erzwingt die Datenbank.",
          "Gelöscht wird nie: eine falsche Buchung wird storniert, und beide bleiben im Journal stehen. Belegnummern sind je Jahr lückenlos.",
          "Der Jahresabschluss stellt die Erfolgskonten glatt, bucht das Ergebnis ins Vereinsvermögen und schreibt die Eröffnungsbilanz des Folgejahres.",
          "Die Seite wird auf absehbare Zeit nicht gebraucht und liegt deshalb nicht in der Reiterleiste, sondern unter „Einstellungen“. Abgeschaltet ist an ihr nichts."
        ]
      },
      {
        title: "Auswertungen und Meldung an den Landessportbund",
        items: [
          "Die Seite „vorstand.html“ zeigt dem Vorstand Bestand, Altersaufbau, die Entwicklung über zehn Jahre, die Beitragsklassen und die Stimmberechtigten nach § 8 Abs. 2 der Satzung. Sie lädt keinen Code, der Personendaten anzeigen könnte — der Vorstand sieht Summen, keine Namen.",
          "Für die Bestandserhebung entsteht die CSV-Datei im Format des LSB Thüringen: eine Zeile je Person mit Name, Vorname, Geschlecht, Geburtsdatum und Sportartennummer. Genau die liest das Portal unser-sportverein.net in Schritt 3 ein und rechnet daraus selbst die Jahrgangs- und Fachverbandsmeldung. Die Zahlen je Altersgruppe sind zum Gegenrechnen da, hochladen lassen sie sich nicht.",
          "Jede Abteilung hat im Reiter „Anträge“ ein Feld für ihre Sportartennummer aus der Sportartenliste des LSB. Ohne Nummer laufen ihre Mitglieder beim Verband unter „ohne Landesfachverband“, und das kostet Geld. Was der Meldung fehlt, wird namentlich genannt statt gezählt: Mitglieder ohne Abteilung, ohne Geburtsdatum, und jede Abteilung ohne Nummer samt der Zahl der Betroffenen.",
          "Der Rehasport wird außerhalb dieser App geführt, gehört aber in die Meldung. „Rehasportdaten einlesen“ nimmt die ausgefüllte Bestandserhebung des Behinderten- und Rehabilitationssportverbandes auf, so wie sie einmal im Jahr von dort kommt. Danach steht der Rehasport in der Altersgruppen-Tabelle als eigene, hervorgehobene Zeile mit Angabe der Quelle und in der Datei für das Portal. Weil die Verbandsdatei keine Personen enthält, sondern Zahlen je Jahrgang, entstehen für das Portal Platzhalter-Zeilen mit erkennbar erfundenen Namen; gemeldet wird davon nur, was der Verband auswertet.",
          "Die eingelesene Datei wird gegengerechnet: stimmt die Kontrollspalte nicht mit den Sportblöcken überein oder weicht die Summenzeile ab, steht das als Warnung da. Stammen die Zahlen aus einem anderen Jahr als der Stichtag, sagt die Karte das, statt sie stillschweigend mitzumelden. Nichtmitglieder des Rehasports und der Behindertensport lassen sich einzeln ab- und zuschalten. Die eingelesenen Zahlen bleiben im Browser und gehen nicht an den Server — nach einem Wechsel des Geräts oder des Browsers ist die Datei erneut einzulesen."
        ]
      },
      {
        title: "Rechte, Bestandsübernahme und Sicherung",
        items: [
          "Die Rechte werden auf dem Server durchgesetzt und nicht in der Anzeige. Geschäftsstelle und Schatzmeister sehen und bearbeiten alle Mitglieder; eine Abteilungsleitung sieht ausschließlich Mitglieder ihrer eigenen Sparte — ohne Bankdaten und ohne Einblick, in welchen weiteren Sparten eine Person aktiv ist. Der Vorstand sieht Kennzahlen, aber keine Personendaten. Bankdaten werden in der Mitgliederliste grundsätzlich nicht übertragen.",
          "Die Rolle „Passstelle“ sieht ausschließlich die Nachwuchs-Anmeldungen samt ihren Nachweisen und erzeugt daraus den Antrag auf Spielerlaubnis. IBAN, Kontoinhaber und Kreditinstitut verlassen den Server für diese Rolle gar nicht erst, Mitgliederbestand und Dublettensuche bleiben verschlossen, und über die Aufnahme entscheidet weiterhin allein die Geschäftsstelle. Zusätzlich braucht das Konto in der Tools-Übersicht das Bearbeiten-Häkchen auf der Kachel „Vereinsverwaltung“, sonst lassen sich die Nachweise nicht öffnen.",
          "Vergeben werden die Rollen im Reiter „Einstellungen“ — dort liegen auch die Bestandsübernahme, die Sicherung und der Zugang zur Buchhaltung. Der Reiter erscheint für jeden, der mindestens einen dieser Bereiche nutzen darf; die Rollenvergabe selbst sieht nur ein Administrator, die Bestandsübernahme nur, wer Mitglieder anlegen darf, die Buchhaltung nur der Schatzmeister.",
          "Die Bestandsübernahme liest die Mitgliederdatei aus dem Vereinsmeister als CSV oder Excel ein, mit selbst gewählter Spaltenzuordnung und einem Probelauf vor dem ersten Schreibzugriff. Die gedruckten Vereinsmeister-Listen werden erkannt und in echte Spalten aufgelöst, auch ohne Kopfzeile. Eine zweite Datei kann fehlende Angaben nachtragen, ohne Vorhandenes zu überschreiben. Spalten ohne passendes Feld gehen nicht verloren, sondern werden als Zusatzangabe beim Mitglied gespeichert. Der Import ist wiederholbar — bereits vorhandene Mitgliedsnummern werden übersprungen statt doppelt angelegt —, und SEPA-Mandatsreferenzen werden unverändert übernommen und nie neu vergeben.",
          "Jede Nacht um kurz nach vier schreibt der Server den vollständigen Datenbestand nach Nextcloud, samt dem Aufbau der Datenbank; zum Zurückspielen genügt die Datei allein, auch dann noch, wenn die App längst weitergewachsen ist. Daneben liegt eine Mitgliederliste als Tabelle zum Öffnen und Ausdrucken — ohne Bankdaten, denn sie ist für den Notfall gedacht. Die sieben Wochentagsdateien überschreiben sich der Reihe nach, vom Monatsersten bleibt eine Kopie dauerhaft stehen.",
          "Bei der Sicherung steht eine Warnung, wenn der letzte erfolgreiche Lauf länger als einen Tag her ist; eine seit Wochen ausgefallene Sicherung sähe sonst genauso aus wie eine gesunde. Bricht der nächtliche Lauf an der Datenmenge ab, entsteht eine Teilsicherung mit ausdrücklichem Vermerk, statt dass gar keine Datei geschrieben wird. Eine Sicherung von Hand lässt sich jederzeit anstoßen.",
          "Der Name des Vereins steht fest in der App und ist kein Eingabefeld mehr. Die Vereinsstammdaten — IBAN, BIC und Gläubiger-Identifikationsnummer — liegen in der Datenbank und nicht im Programmcode. Die Gläubiger-ID wird wie die IBAN auf ihre Prüfziffer geprüft; ist die hinterlegte Nummer unbrauchbar, erscheint sie nicht im Mandatstext des Antragsformulars, die Stammdaten melden sich als unvollständig, und eine SEPA-Datei lässt sich nicht erzeugen.",
          "Die Daten dieses Werkzeugs liegen in einer Cloudflare-D1-Datenbank auf Servern in Deutschland und werden ausschließlich für die Vereinsarbeit verwendet. Die öffentlichen Formulare — Aufnahmeantrag, Nachwuchs-Anmeldung und die Seite für den Elternkodex — sagen über dem Absenden-Knopf, was mit den Angaben geschieht: wer verantwortlich ist, wozu und auf welcher Grundlage verarbeitet wird, wie lange gespeichert bleibt und welche Rechte bestehen. Der Hinweis ist aufklappbar und zugeklappt als Vorgabe."
        ]
      }
    ]
  }
];
