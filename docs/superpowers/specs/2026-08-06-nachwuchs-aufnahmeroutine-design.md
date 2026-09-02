# Nachwuchs-Aufnahmeroutine

**Stand:** 06.08.2026 · **Repo:** `Vereinsverwaltung` · **Status:** Entwurf, freigegeben

Ein neuer Jugendspieler soll über **einen Link** alles erledigen, was der Verein
von ihm braucht: Mitgliedsantrag nach § 4, Antrag auf Spielerlaubnis beim
Thüringer Fußball-Verband, und die Nachweise, die der Verband als Anlage
verlangt. Ausgefüllt und unterschrieben am Handy, digital beim Verein.

Heute geht das an zwei Stellen auf Papier auseinander: `antrag.html` deckt den
Mitgliedsantrag ab, der TFV-Bogen wird gedruckt, von Hand ausgefüllt und
eingesammelt.

## Abgrenzung

**Nicht Teil dieses Vorhabens:**

- **Die Trainer-Lücke.** Bestandspersonen ohne Mitgliedsantrag brauchen etwas
  anderes: eine Liste „wer hat noch keinen" aus dem Bestand plus einen
  persönlichen Link je Person. Eigene Spezifikation, eigener Plan.
- **Verhaltensregeln / Nachwuchskonzept.** Bewusst draußen (Entscheidung
  06.08.2026).
- **Mailversand.** Ohne DKIM/DMARC landet die Bestätigung bei Gmail im Spam.
  Gleiche Begründung wie bei Vorabankündigung, Mahnung und Aufnahmeantrag.
- **Übertragung nach DFBnet Pass-Online.** Bleibt Handarbeit der
  Geschäftsstelle. Der Papierantrag ist laut Bogen ohnehin nur *Voraussetzung*
  für die Antragstellung dort und wird beim Verein aufbewahrt.

## Der Weg des Nutzers

`nachwuchs.html` — eigene öffentliche Kachel neben „Mitgliedsantrag", ein
Durchlauf in sechs Schritten mit fortlaufendem Schrittzähler.

| # | Schritt | Inhalt |
|---|---|---|
| 1 | Kind | Name, Vorname, Geburtsdatum, Geburtsort, Geschlecht, **Nationalität**, Anschrift |
| 2 | Eltern | Erziehungsberechtigte, zweiter mit dem bestehenden Sorgerechts-Ausweg, Kontakt |
| 3 | Fußball | Art der Passausstellung; bei Vereinswechsel zusätzlich Pass-Nr., letzter Verein, Landesverband, Abmeldeweg |
| 4 | Beitrag | SEPA-Mandat, Beitragsklasse aus dem Alter |
| 5 | Erklärungen | die drei bestehenden Häkchen + **DFB-Marketing-Einwilligung**, dann Unterschriften |
| 6 | Nachweise | Fotos, je nach Wahl aus Schritt 3 |

### Schritt 3 im Einzelnen

Vier sich ausschließende Arten, wie auf dem Bogen:

- **Erstausstellung** → verlangt Geburtsurkunde oder amtliches Dokument
- **Vereinswechsel** → verlangt Pass-Nr., letzten Verein, Landesverband (nur bei
  Wechsel aus einem anderen), alten Spielerpass oder Verlusterklärung, und die
  Wahl des Abmeldewegs:
  - **(1)** bereits abgemeldet → Kündigung mit Einschreibebeleg als Nachweis
  - **(2)** noch nicht abgemeldet → beauftragt den aufnehmenden Verein
- **Rückkehrer**
- **Namensänderung/Korrektur** → verlangt amtliches Dokument der Änderung

Bei Erstausstellung bleiben Pass-Nr., letzter Verein und der Abmeldeblock
verborgen — sie ergeben dort keinen Sinn.

⚠️ **Die DFB-Marketing-Einwilligung ist eine eigene Erklärung**, kein viertes
Häkchen im vorhandenen Block. Sie betrifft einen anderen Empfänger (DFB, seine
Verbände und deren Partner) und einen anderen Zweck als die drei bestehenden.
Freiwillig, Vorgabe unangekreuzt. Wer sie nicht erteilt, bekommt den Antrag
trotzdem — das Kästchen auf dem Bogen bleibt dann leer.

⚠️ **Bei Ausländern ab dem 10. Lebensjahr** verlangt der Bogen zusätzlich einen
Antrag auf internationale Freigabe. Das Formular rechnet das aus Nationalität
und Geburtsdatum aus und **weist darauf hin**; das Zusatzformular selbst ist
nicht Teil dieser Routine.

## Bausteine

| Datei | Rolle | neu? |
|---|---|---|
| `nachwuchs.html` | die öffentliche Seite | neu |
| `nachwuchs.js` | Ablauf, Schritte, Absenden | neu |
| `antrag-felder.js` | **geteilter Formularkern** | neu, aus `antrag.js` herausgelöst |
| `tfv-antrag.js` | füllt den TFV-Bogen per pdf-lib | neu |
| `AO21_spielerlaubnis_national.pdf` | das leere Original | neu, ins Repo |
| `antrag.js` | Mitgliedsantrag | lädt künftig `antrag-felder.js` |
| `antraege.js` | Reiter „Anträge" der Verwaltung | Knopf „TFV-Antrag erzeugen" |
| `vereinsverwaltung-worker.js` | Aktionen, Migration | erweitert |
| `db-antrag.js` | Worker-URL, Version, Changelog | zweiter Einstieg |

### Warum ein geteilter Formularkern

Person, Eltern, SEPA-Mandat und die Unterschriftsflächen sind auf beiden Seiten
dieselben. Eine Kopie wäre nach der ersten Änderung ein zweiter, anderer
Mitgliedsantrag — und niemand merkt es, bis ein Feld nur auf einer der beiden
Seiten ankommt. `antrag-druck.js` macht dieses Muster im Repo bereits vor: von
beiden Seiten geladen, mit eigenen Helfern, damit es nicht davon abhängt, wer
es lädt.

`antrag-felder.js` bekommt dieselbe Bauform: reine Funktionen, die Markup und
Prüfungen liefern, ohne globalen Zustand und ohne Annahme über die aufrufende
Seite.

⚠️ **`antrag.js` muss dabei ohne Verhaltensänderung durchkommen.** Der
Prüfstand `test-papierfelder.mjs` (86 Prüfungen) läuft vor und nach dem
Herauslösen und muss identisch bleiben.

### Das leere Formular im Repo

Das Repo ist öffentlich. Der TFV-Bogen ist ein leeres, vom Verband
bereitgestelltes Formular ohne Personendaten — unbedenklich, anders als eine
ausgefüllte Fassung, die dort nie liegen darf.

⚠️ **Die vorgedruckte Vereins-Nr. 650 vor dem Einbauen bestätigen.** Sie steht
bereits im Bogen. Ist sie nicht die des SC 1911 Heiligenstadt, sondern nur ein
Beispiel, muss sie stattdessen aus den Vereinsstammdaten gesetzt werden.

## Der TFV-Bogen: gemessenes Raster

Das PDF hat **kein AcroForm** — null Felder, null Widgets auf beiden Seiten.
Es hat aber eine echte Textebene (kein Scan) und ein exaktes Kästchenraster.
Deshalb **Overlay statt Formularfelder**: der Text wird auf die unveränderte
Originalseite gedruckt.

Damit entfällt die klassische Falle: ein gesetzter Feldwert ohne
`updateFieldAppearances` zeigt in Chrome ein leeres Blatt. Ein gezeichneter
Text ist immer sichtbar.

**Seitenmaß:** 595,32 × 841,92 pt (A4), zwei Seiten.

### Zellraster Seite 1

Zellbreite **13,7 pt**, Schritt **14,18 pt**. Zeichen **mittig** in der Zelle,
Grundlinie **2,6 pt** über der Kästchenlinie, Helvetica 11 pt.

Zellmitte = `x_start + i × 14,18 + 7,09`

| Feld | y | x_start | Zellen |
|---|---|---|---|
| Pass-Nr. | 695,5 | 119,7 | 9 |
| Vereins-Nr. | 695,5 | 389,1 | 8 (650 vorgedruckt) |
| Vereinsname (antragstellend) | 666,5 | 119,7 | 29 |
| Name | 638,6 | 119,7 | 29 |
| Vorname | 614,1 | 119,7 | 29 |
| Geburtsdatum | 588,2 | 119,7 | 8 (TTMMJJJJ) |
| Nationalität | 561,1 | 119,7 | 29 |
| Straße | 532,0 | 119,7 | 29 |
| PLZ + Ort | 507,6 | 119,7 | 29 |
| Vereinsname (letzter Verein) | 347,6 | 119,7 | 29 |
| Landesverband | 317,4 | 119,7 | 29 |

### Ankreuzfelder

| Feld | Mitte (x, y) | Seite |
|---|---|---|
| männlich | 410,2 · 595,2 | 1 |
| weiblich | 495,3 · 595,2 | 1 |
| Marketing-Einwilligung | 43,8 · 477,6 | 1 |
| Erstausstellung | 43,8 · 420,2 | 1 |
| Vereinswechsel | 44,1 · 393,6 | 1 |
| Rückkehrer | 43,9 · 296,9 | 1 |
| Namensänderung/Korrektur | 44,1 · 266,2 | 1 |
| Abmeldung (1) bereits abgemeldet | 67,2 · 719,2 | 2 |
| Abmeldung (2) beauftragt Verein | 67,2 · 671,5 | 2 |

### Unterschriftsblöcke Seite 2

Die Beschriftung steht **über** der Abschlusslinie, nicht darunter — der
beschreibbare Raum liegt also oberhalb der Beschriftung.

| Block | Linie y | Spalten (x von–bis) |
|---|---|---|
| oben | 295,7 | Ort/Datum 32–195 · Spieler 196–358 · Erziehungsberechtigte 359–535 |
| unten | 233,4 | Ort/Datum 32–195 · Vereinsstempel 195–535 |

Beschriftungs-Grundlinien: 309,1 (oben) und 246,9 (unten). Text und
Unterschriften sitzen darüber.

### Unterschriften einbetten

Die beiden Canvas-Unterschriften aus dem Formular werden auf Seite 2 in den
oberen Block gesetzt. **Der untere Block bleibt leer** — Vereinsstempel und
Vereinsunterschrift setzt die Geschäftsstelle nach dem Druck.

⚠️ **Vor dem Einbetten über den Alpha-Kanal zuschneiden.** Eine Signatur-Canvas
ist 600 × 180, die Unterschrift belegt davon einen Bruchteil. Wandert die ganze
Fläche ins PDF, bestimmt der weiße Rand die Skalierung und die Unterschrift
wird winzig. Seitenverhältnis beim Einpassen wahren.

⚠️ **Die Unterschrift des Kindes darf fehlen.** Ein Siebenjähriger unterschreibt
nicht; das Feld bleibt dann leer und der Bogen ist trotzdem gültig — die
Erziehungsberechtigten zeichnen. Ohne deren Unterschrift wird nicht erzeugt.

### Zeichengrenzen

Das Raster fasst 29 Zeichen. Gemessen: „37308 Heilbad Heiligenstadt" belegt 27,
„SC 1911 Heiligenstadt" 21. Lange Straßen und Doppelnamen reißen.

⚠️ **Geprüft wird beim Erzeugen, nicht beim Absenden.** In der Verwaltung kann
korrigiert werden, im abgeschickten Antrag nicht mehr. **Kein stilles
Abschneiden:** eine Hinweisliste neben dem Knopf nennt Feld, Inhalt und
Überlänge — Fehler je Feld sammeln, nie das ganze Dokument blockieren.

⚠️ **WinAnsi-Sanitizing.** Die Standardschriften können nur Latin-1. Ein
typografisches Anführungszeichen aus einem kopierten Text reißt die Erzeugung
mit. Zeichen vorher ersetzen.

## Datenmodell

`aufnahmeantrag` wird **erweitert**, es entsteht keine zweite Tabelle. Es ist
ein Vorgang: ein Absenden, eine Annahme nach § 4. Eine eigene
`spielerlaubnis`-Tabelle bräuchte einen eigenen Lebenszyklus und läge bei der
Annahme still daneben — derselbe Fehler, den der Sparten-Wunsch im JSON heute
vermeidet.

| Was | Wohin |
|---|---|
| Art, Pass-Nr., letzter Verein, Landesverband, Abmeldeweg, Marketing | Block `spielerlaubnis` in `antrag_json` |
| Nationalität | neue Spalte `person.nationalitaet` über `handleMigration` |
| Schlüssel der Nachweise | neue Spalte `nachweis_owner` |
| Herkunft des Antrags | neue Spalte `quelle` (`antrag` \| `nachwuchs`) |

⚠️ **`quelle` gehört in eine Spalte, nicht ins JSON.** Die Liste im Reiter muss
danach filtern und zählen können, ohne jedes JSON zu entpacken.

⚠️ **Nationalität wandert bei der Annahme an die Person**, wie `geburtsort` seit
dem 06.08. Sie ist eine Stammdatenangabe, kein Antragsdetail — beim nächsten
Spielerlaubnisantrag desselben Kindes muss sie schon dastehen.

Die neuen Felder gehen durch die **Weißliste in `pruefeAntrag`**: der Server
baut den Datensatz selbst, mitgeschickte `status`, `person_id`, `eingang_am`,
`id`, `quelle` und `nachweis_owner`-Fremdwerte werden ignoriert bzw. geprüft.

## Nachweise

Der Vereinsverwaltungs-Worker hat **kein Nextcloud-Binding**, und eins
nachzurüsten wäre eine zweite Baustelle. Der Browser lädt die Nachweise
deshalb **direkt zum `admin-worker`** der ToolsUebersicht — neue Aktion nach
dem Vorbild von `fahrtenbuch-extern-fuehrerschein-put`:

- ohne Login, abgeschotteter Bereich nach dem `RESTRICTED_FILE_APPS`-Muster
- **der Server vergibt den Owner-Schlüssel** (`crypto.randomUUID()` ohne
  Bindestriche, 32 Hex, passt in `USERNAME_RE {3,32}`) und gibt ihn zurück
- der Antrag speichert nur diesen Schlüssel
- Einsicht später ausschließlich über `dav-restricted-get` mit Login und
  Gruppenprüfung

Damit landen Ausweiskopien **nicht in D1** und nicht in der nächtlichen
Sicherung. Unterschriften bleiben, wo sie sind: als PNG-Data-URL in der
Datenbank, 5–20 KB, weit unter dem Zeilenlimit.

⚠️ **Der Owner-Schlüssel kommt vom Client zurück** — anders geht es bei einem
Upload vor dem Absenden nicht. Er ist nicht erratbar, aber `nachweis_owner`
wird streng auf `/^[0-9a-f]{32}$/` geprüft, sonst steht dort irgendwann ein
Pfad.

⚠️ **Mehrere Nachweise je Antrag.** Der abgeschottete Bereich legt heute **eine**
Datei je Owner ab. Beim Vereinswechsel können zwei nötig sein (alter Pass +
Abmeldenachweis). Lösung: ein Owner je Antrag, die Dateien darunter
durchnummeriert — die Aktion braucht dafür einen `slot`-Parameter, serverseitig
auf eine kleine Weißliste begrenzt (`geburtsurkunde`, `spielerpass`,
`abmeldung`, `namensaenderung`).

## Rechte und Bremsen

Die Seite ist wie `antrag.html` **ohne Zugangscode** erreichbar — Eltern haben
kein Vereinskonto, ein Code machte das Formular sinnlos. Dieselben vier Bremsen:

- **Weißliste im Server** — der Datensatz entsteht serverseitig
- **Zählwerk je `CF-Connecting-IP`** — 5 je Stunde, 20 je Tag, in einer Abfrage
- **Eigener Schalter `nachwuchs_offen`**, Gruppe `antrag`, an `darfSchreiben`
- **Die Unterschrift** — ein Skript zeichnet keine

⚠️ **Ein eigener Schalter, nicht `antrag_offen`.** Sonst dreht man mit der
Nachwuchs-Anmeldung den Aufnahmeantrag mit zu.

⚠️ **Die neuen öffentlichen Aktionen laufen VOR `verifySession`**, im
bestehenden Zweig vor der `LANDINGPAGE`-Prüfung. Ein fehlendes Service Binding
darf die Verwaltung lahmlegen, nicht das öffentliche Formular.

⚠️ **Folge fürs Deploy-Protokoll:** „Aktion ohne Token → 401" beweist bei diesem
Worker nichts über einzelne neue Aktionen. Beleg bleibt der byte-genaue
Abgleich plus ein 200 auf eine öffentliche Aktion.

## Der Rückweg

Der Antrag erscheint im vorhandenen Reiter „Eingegangene Anträge" mit
Kennzeichnung `nachwuchs`. Dort:

| Knopf | Wirkung |
|---|---|
| Mitgliedsantrag drucken | vorhanden, `antrag-druck.js` |
| **TFV-Antrag erzeugen** | neu, `tfv-antrag.js` → ausgefülltes PDF zum Download |
| Nachweise ansehen | neu, über `dav-restricted-get` |

⚠️ **Der Sicht-Reiter beschließt weiterhin nicht.** Die Aufnahme nach § 4 hängt
an Dublettenprüfung, Haushalt und Beitragsklasse und bleibt im Reiter „Anträge"
der Verwaltung. Er verlinkt dorthin.

⚠️ **`window.open` steht vor jedem `await`** — iOS-Safari blockt danach lautlos.
Gilt für den TFV-Download genauso wie für den Papierausdruck.

## Fehlerfälle

| Fall | Verhalten |
|---|---|
| Nachweis-Upload scheitert | Antrag geht **trotzdem** durch, am Eintrag steht „Nachweis fehlt". Ein vollständiger Antrag darf nicht an einem zu großen Foto sterben. |
| Spalte fehlt (Deploy vor Migration) | **503** statt still gekürzt — gleiche Regel wie bei der zweiten Unterschrift |
| Feld zu lang fürs Raster | Hinweisliste beim Erzeugen, kein stilles Abschneiden |
| `nachwuchs_offen = 0` | Hinweistext statt Formular; Reiterwechsel funktioniert weiter |
| Unterschrift der Eltern fehlt | Server nimmt den Antrag nicht an |

⚠️ **`hatNationalitaetSpalte` merkt sich nur das Ja.** Die Migration läuft in
einem anderen Isolate als der öffentliche Antrag; ein gemerktes Nein erreicht
das erste nie und der Worker wiese noch stundenlang mit 503 ab, obwohl die
Spalte längst da ist. Am Prüfstand von `test-papierfelder.mjs` schon einmal als
Fehler entlarvt.

## Prüfstand

`test-nachwuchs.mjs`, **im Repo**, nicht im Scratchpad. Gegen das echte Schema
mit dem echten Worker-Code, wie die elf vorhandenen Läufe.

| Abschnitt | Prüft |
|---|---|
| A | Migration und ihre Wiederholung, `nationalitaet`, `nachweis_owner`, `quelle` |
| B | Weißliste: Fremdfelder, gefälschter `quelle`-Wert, ungültiger Owner-Schlüssel |
| C | Vereinswechsel-Zweig in allen vier Arten, Abmeldeweg (1)/(2) |
| D | Absenden und Annehmen gegen eine echte SQLite-Datenbank |
| E | Das Fenster zwischen Deploy und erster Migration (503) |
| F | **Rasterprobe:** erzeugtes PDF zurücklesen, Zeichenposition nachrechnen |
| G | **Gleichheitsprobe:** `antrag-felder.js` liefert beiden Seiten dasselbe |

### Abschnitt F im Einzelnen

Die Rasterprobe ist der Beweis, der ohne Browser geht und ohne den ein
Positionsfehler erst beim Verband auffällt:

1. PDF mit Musterdaten erzeugen
2. zurücklesen und Textpositionen je Zeichen auslesen
3. für jedes Zeichen prüfen: `|x_gemessen − Zellmitte| < 1 pt`
4. Ankreuzfelder: liegt das X im Kästchen?
5. Unterschriften: XObject-Ressourcen der Seite zählen

⚠️ **`Contents` kann ein Array sein** — ein Regex nur über den ersten Stream
findet nichts.

⚠️ **Beim Escaping nicht auf die Zeichenfolge selbst prüfen.** Sie steht als
Text weiterhin im Dokument und ist genau dann harmlos, wenn das öffnende `<` zu
`&lt;` geworden ist.

## Offene Punkte

1. **Vereins-Nr. 650 bestätigen** — vorgedruckt im Bogen, Herkunft ungeklärt.
2. **Aufbewahrungsfrist.** Der Bogen verlangt Aufbewahrung beim Verein für
   mindestens 2 Jahre. Ob und wann Nachweise danach gelöscht werden, ist noch
   nicht entschieden — bis dahin bleiben sie liegen.
3. **Bogen-Version.** `AO21` steht in der Fußzeile. Ändert der Verband das
   Formular, verschiebt sich das Raster. Die Kennung beim Erzeugen gegen das
   geladene PDF prüfen und bei Abweichung warnen.
