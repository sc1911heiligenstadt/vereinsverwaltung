-- =====================================================================
-- Vereinsverwaltung 1. SC 1911 Heiligenstadt — D1-Schema
-- Stufe 1 (Mitglieder) + Stufe 2 (Beiträge/SEPA)
-- Die Buchhaltung (Stufe 4, ab 2027) kommt in einer eigenen Datei dazu.
-- =====================================================================
--
-- KONVENTIONEN — gelten für jede Tabelle, bitte nicht abweichen:
--
--   Geld       INTEGER in CENT. Niemals REAL/FLOAT. Feldname endet auf _cent.
--              (Bewusste Abweichung von der Float-Regel aus kassenbuch und
--              sc-heiligenstadt-budget: eine prüfungsfähige Buchhaltung
--              verträgt keine Rundungsdrift über zehntausende Buchungen.)
--   Datum      TEXT 'YYYY-MM-DD'. SQLite kennt keinen DATE-Typ.
--              ACHTUNG: im Client NIE über toISOString() bilden — das liefert
--              in deutscher Sommerzeit vor 02:00 Uhr den Vortag. Immer lokal
--              über getFullYear/getMonth/getDate (_heuteIsoDatum()-Muster).
--   Zeitstempel TEXT ISO-8601 mit Zone, z. B. '2026-07-29T14:03:11+02:00'.
--   IDs        TEXT UUID v4. Fachliche Nummern (Mitgliedsnummer,
--              Mandatsreferenz, Belegnummer) sind eigene Felder.
--   Löschen    Es wird nicht gelöscht. Stammdaten bekommen ein Ende-Datum,
--              Vorgänge werden storniert (storniert_am/_von/_grund).
--   Wer/Wann   Jede schreibende Tabelle führt erstellt_am/erstellt_von und
--              geaendert_am/geaendert_von. _von ist der Gateway-username.
--
-- D1-Besonderheiten, die das Schema mitträgt:
--   - Kein BEGIN/COMMIT über Requests. Atomar ist nur db.batch().
--     Deshalb gibt es an jeder Stelle, an der ein Vorgang wiederholt werden
--     könnte, einen UNIQUE-Index als Doppelausführungs-Sperre.
--   - Fremdschlüssel sind aktiv; bei Migrationen PRAGMA defer_foreign_keys.
--   - Zeilenlimit 2 MB. Deshalb liegen Unterschriften und PDFs als Datei in
--     Nextcloud, in der Datenbank steht nur die Referenz.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) STAMMDATEN — Person, Haushalt, Sparte
-- ---------------------------------------------------------------------

-- Ein Mensch existiert genau EINMAL, unabhängig davon, ob und wie oft er
-- Mitglied ist. Der Vater, der selbst bei den Alten Herren spielt und für
-- drei Kinder zahlt, ist eine Zeile — nicht vier.
CREATE TABLE person (
  id                TEXT PRIMARY KEY,
  haushalt_id       TEXT REFERENCES haushalt(id),

  vorname           TEXT NOT NULL,
  nachname          TEXT NOT NULL,
  geburtsdatum      TEXT,                      -- 'YYYY-MM-DD'

  -- Steht so auf dem Papier-Aufnahmeantrag. Bei zwei gleichnamigen
  -- Mitgliedern mit demselben Geburtsdatum ist er das einzige
  -- unterscheidende Merkmal, das der Verein hat.
  geburtsort        TEXT,

  -- Verlangt der Spielerlaubnisantrag des Landesverbandes. Gehört an die
  -- Person, nicht in den Antrag: beim nächsten Antrag desselben Kindes
  -- (Vereinswechsel, Namensänderung) muss sie schon dastehen.
  nationalitaet     TEXT,

  geschlecht        TEXT,                      -- 'w' | 'm' | 'd' | NULL

  -- Anschrift. Straße und Hausnummer bewusst in EINEM Feld — dieselbe
  -- Entscheidung wie in Trainerdaten, damit die Flotte konsistent bleibt.
  strasse           TEXT,
  plz               TEXT,
  ort               TEXT,

  email             TEXT,
  telefon           TEXT,
  mobil             TEXT,

  -- Verknüpfung ins Gateway, falls diese Person ein Konto hat (Trainer,
  -- Funktionär). Leer bei den allermeisten Mitgliedern.
  gateway_username  TEXT,

  -- Auffangfeld für den Import: Spalten aus der Altsoftware, die beim
  -- CSV-Import keiner Zielspalte zugeordnet werden konnten, landen hier
  -- als JSON. Es geht beim Import nichts verloren, auch wenn wir das
  -- Quellformat heute nicht kennen. Wird nirgends fachlich ausgewertet.
  zusatz_json       TEXT,

  bemerkung         TEXT,

  -- Gestuftes Löschkonzept: Personendaten dürfen nach Austritt weg,
  -- Buchungsbelege müssen zehn Jahre bleiben. Deshalb wird die Person
  -- anonymisiert statt gelöscht — Forderungen und Zahlungen behalten
  -- ihren Bezug, aber ohne Personendaten.
  anonymisiert_am   TEXT,

  erstellt_am       TEXT NOT NULL,
  erstellt_von      TEXT NOT NULL,
  geaendert_am      TEXT,
  geaendert_von     TEXT
);

-- Klammer um Personen, die gemeinsam abgerechnet werden. Trägt Zahler,
-- Mandat und Familienrabatt. Auch Alleinstehende bekommen einen Haushalt
-- (mit sich selbst als Zahler) — sonst bräuchte die Beitragsrechnung zwei
-- Wege statt einem.
CREATE TABLE haushalt (
  id                TEXT PRIMARY KEY,
  bezeichnung       TEXT,                      -- z. B. 'Familie Müller', optional

  -- Wer zahlt. Muss eine Person sein, muss NICHT Mitglied sein
  -- (Elternteil ohne eigene Mitgliedschaft ist der Normalfall).
  zahler_person_id  TEXT REFERENCES person(id),

  -- Abweichende Rechnungsanschrift, falls der Zahler woanders wohnt
  -- (getrennt lebende Eltern). Leer = Anschrift des Zahlers.
  abw_empfaenger    TEXT,
  abw_strasse       TEXT,
  abw_plz           TEXT,
  abw_ort           TEXT,

  zahlungsweise     TEXT NOT NULL DEFAULT 'jaehrlich',   -- 'jaehrlich' | 'halbjaehrlich'
  zahlungsart       TEXT NOT NULL DEFAULT 'lastschrift', -- 'lastschrift' | 'ueberweisung'

  erstellt_am       TEXT NOT NULL,
  erstellt_von      TEXT NOT NULL,
  geaendert_am      TEXT,
  geaendert_von     TEXT
);

-- Abteilungen des Vereins. Die Satzung kennt keine Abteilungen — das ist
-- eine faktische Struktur, deshalb frei pflegbar statt hartkodiert.
CREATE TABLE sparte (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  kurz              TEXT,
  sortierung        INTEGER NOT NULL DEFAULT 100,
  aktiv             INTEGER NOT NULL DEFAULT 1,   -- 0 = aufgelöst, Historie bleibt

  -- Zuschlag zusätzlich zum Grundbeitrag, pro Jahr. 0 = kein Zuschlag.
  zuschlag_cent     INTEGER NOT NULL DEFAULT 0,

  -- Sportartennummer aus der Sportartenliste des LSB Thüringen, für die
  -- Bestandsmeldung. NULL = noch nicht zugeordnet; diese Mitglieder
  -- laufen beim Verband unter „ohne Landesfachverband“.
  -- Keine Ableitung aus dem Namen: „Turnen“ steht in der Liste gar nicht
  -- und wird als Gymnastik (95) gemeldet.
  dosb_sportart_nr  INTEGER,

  erstellt_am       TEXT NOT NULL,
  erstellt_von      TEXT NOT NULL,
  geaendert_am      TEXT,
  geaendert_von     TEXT
);


-- ---------------------------------------------------------------------
-- 2) MITGLIEDSCHAFT
-- ---------------------------------------------------------------------

-- Hängt an einer Person. Eine Person kann im Lauf der Zeit mehrere
-- Mitgliedschaften haben (Austritt, Jahre später Wiedereintritt) — dann
-- gibt es zwei Zeilen mit unterschiedlicher Mitgliedsnummer.
CREATE TABLE mitgliedschaft (
  id                TEXT PRIMARY KEY,
  person_id         TEXT NOT NULL REFERENCES person(id),
  mitgliedsnummer   TEXT NOT NULL UNIQUE,

  -- Satzung § 3 und § 4 Abs. 5. Genau diese drei, nichts anderes.
  art               TEXT NOT NULL,   -- 'ordentlich' | 'ausserordentlich' | 'ehrenmitglied'

  eintritt          TEXT NOT NULL,   -- 'YYYY-MM-DD'

  -- Satzung § 5 Abs. 2: Austritt NUR zum 30.06. oder 31.12., vier Wochen
  -- Frist. Der Client bietet kein freies Datum an; der Worker prüft es
  -- zusätzlich, weil UI-Prüfungen keine Zusage sind.
  austritt          TEXT,
  austritt_grund    TEXT,            -- 'austritt' | 'ausschluss' | 'tod' | 'streichung'
  kuendigung_am     TEXT,            -- Eingang der schriftlichen Erklärung

  status            TEXT NOT NULL DEFAULT 'aktiv',
                                     -- 'antrag' | 'aktiv' | 'ruhend' | 'gekuendigt' | 'beendet'

  -- Satzung § 4: Aufnahme braucht Beschluss des Gesamtvorstands.
  -- Ohne diese beiden Felder ist die Mitgliedschaft nicht wirksam.
  beschluss_am      TEXT,
  beschluss_von     TEXT,

  -- Ermäßigung. Der NACHWEIS wird gesichtet, nicht gespeichert:
  -- eine Ausweiskopie wäre ein Gesundheitsdatum nach Art. 9 DSGVO und
  -- wird für die Beitragsrechnung nicht gebraucht.
  ermaessigt        INTEGER NOT NULL DEFAULT 0,
  ermaessigt_grund  TEXT,            -- 'schwerbehinderung' | 'schueler' | 'azubi' | 'rentner'
  nachweis_geprueft_am  TEXT,
  nachweis_gueltig_bis  TEXT,

  erstellt_am       TEXT NOT NULL,
  erstellt_von      TEXT NOT NULL,
  geaendert_am      TEXT,
  geaendert_von     TEXT
);

-- Mitglied in Sparte. Eigene Ein- und Austrittsdaten je Sparte, weil ein
-- Spartenwechsel zur Jahresmitte anteilig gerechnet werden muss.
CREATE TABLE mitgliedschaft_sparte (
  id                TEXT PRIMARY KEY,
  mitgliedschaft_id TEXT NOT NULL REFERENCES mitgliedschaft(id),
  sparte_id         TEXT NOT NULL REFERENCES sparte(id),

  eintritt          TEXT NOT NULL,
  austritt          TEXT,

  -- Abweichender Zuschlag für diesen Einzelfall (Vorstandsbeschluss,
  -- Härtefall). NULL = Standardzuschlag der Sparte.
  zuschlag_cent     INTEGER,

  erstellt_am       TEXT NOT NULL,
  erstellt_von      TEXT NOT NULL,
  geaendert_am      TEXT,
  geaendert_von     TEXT
);


-- ---------------------------------------------------------------------
-- 3) BEITRAGSREGELN
-- ---------------------------------------------------------------------

-- Grundbeitrag nach Alter und Status. Beitragssätze liegen als DATEN in
-- der Datenbank, nicht im Code — ein Beschluss der Mitgliederversammlung
-- darf kein Deploy sein.
CREATE TABLE beitragsklasse (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,          -- 'Kind bis 14', 'Erwachsener', 'Ehrenmitglied'
  alter_von         INTEGER,                -- Jahre, NULL = keine Untergrenze
  alter_bis         INTEGER,                -- Jahre, NULL = keine Obergrenze
  mitgliedsart      TEXT,                   -- NULL = gilt für alle Arten
  nur_ermaessigt    INTEGER NOT NULL DEFAULT 0,
  sortierung        INTEGER NOT NULL DEFAULT 100,
  aktiv             INTEGER NOT NULL DEFAULT 1,

  erstellt_am       TEXT NOT NULL,
  erstellt_von      TEXT NOT NULL
);

-- Betrag je Klasse und Gültigkeitszeitraum. Historisiert, damit eine
-- Beitragserhöhung alte Läufe nicht rückwirkend verändert.
CREATE TABLE beitragssatz (
  id                TEXT PRIMARY KEY,
  beitragsklasse_id TEXT NOT NULL REFERENCES beitragsklasse(id),
  gueltig_ab        TEXT NOT NULL,          -- 'YYYY-MM-DD'
  gueltig_bis       TEXT,
  betrag_cent       INTEGER NOT NULL,       -- Jahresbetrag
  beschluss_am      TEXT,                   -- Mitgliederversammlung, § 7
  beschluss_notiz   TEXT,

  erstellt_am       TEXT NOT NULL,
  erstellt_von      TEXT NOT NULL
);

-- Familienrabatt ab N zahlenden Mitgliedern im Haushalt. Wirkt auf die
-- HAUSHALTSSUMME, nicht je Person — sonst entstehen Rundungsdifferenzen
-- zwischen Forderungssumme und SEPA-Kontrollsumme.
CREATE TABLE familienrabatt (
  id                TEXT PRIMARY KEY,
  ab_anzahl         INTEGER NOT NULL,
  prozent           INTEGER,                -- entweder Prozent ...
  betrag_cent       INTEGER,                -- ... oder Festbetrag, nicht beides
  gueltig_ab        TEXT NOT NULL,
  gueltig_bis       TEXT,

  erstellt_am       TEXT NOT NULL,
  erstellt_von      TEXT NOT NULL
);


-- ---------------------------------------------------------------------
-- 4) SEPA
-- ---------------------------------------------------------------------

CREATE TABLE sepa_mandat (
  id                TEXT PRIMARY KEY,
  haushalt_id       TEXT NOT NULL REFERENCES haushalt(id),

  -- Frei belegbar, weil unklar ist, ob die Referenzen aus der Altsoftware
  -- übernommen werden können. Vorhandene werden unverändert übernommen;
  -- fehlt eine, vergibt die App eine eigene. Solange Gläubiger-ID UND
  -- Referenz gleich bleiben, bleibt ein Altmandat gültig.
  referenz          TEXT NOT NULL UNIQUE,

  kontoinhaber      TEXT NOT NULL,
  iban              TEXT NOT NULL,
  bic               TEXT,                   -- leer -> 'NOTPROVIDED' in der XML

  -- Beides steht auf dem Papier-Mandat und gehört deshalb an das Mandat,
  -- nicht in den Aufnahmeantrag: das Mandat ist das rechtlich maßgebliche
  -- Papier und wird noch gelesen, wenn der Antrag Jahre alt ist. Für die
  -- pain.008 werden beide NICHT gebraucht.
  bank_name         TEXT,                   -- Kreditinstitut des Zahlers
  kontoinhaber_anschrift TEXT,              -- nur wenn abweichend vom Mitglied

  erteilt_am        TEXT NOT NULL,          -- Unterschriftsdatum, muss in die XML
  erteilt_ort       TEXT,                   -- "Ort, Datum" des Papierformulars
  quelle            TEXT NOT NULL DEFAULT 'papier',  -- 'papier' | 'digital' | 'import'

  -- Beweismittel für digital erteilte Mandate. Die Unterschrift selbst
  -- liegt als Datei in Nextcloud (Zeilenlimit), hier nur die Referenz.
  unterschrift_datei TEXT,
  signatur_ip       TEXT,
  signatur_agent    TEXT,
  bestaetigung_gesendet_am TEXT,

  -- Erste Nutzung entscheidet über SeqTp FRST vs. RCUR in der XML.
  -- Ungenutzte Mandate verfallen nach 36 Monaten.
  erste_nutzung_am  TEXT,
  letzte_nutzung_am TEXT,

  widerrufen_am     TEXT,
  widerruf_grund    TEXT,

  erstellt_am       TEXT NOT NULL,
  erstellt_von      TEXT NOT NULL,
  geaendert_am      TEXT,
  geaendert_von     TEXT
);


-- ---------------------------------------------------------------------
-- 5) BEITRAGSLAUF, FORDERUNGEN, ZAHLUNGEN
-- ---------------------------------------------------------------------

-- Ein Lauf erzeugt die Sollstellungen einer Periode. Die Zustandskette
-- ersetzt die fehlende Transaktion: Der Lauf ist über viele Requests
-- fortsetzbar und weiß, wo er stehen geblieben ist.
CREATE TABLE beitragslauf (
  id                TEXT PRIMARY KEY,
  bezeichnung       TEXT NOT NULL,          -- 'Jahresbeitrag 2027'
  jahr              INTEGER NOT NULL,
  periode           TEXT NOT NULL,          -- 'jahr' | 'h1' | 'h2'
  stichtag          TEXT NOT NULL,          -- Bestandsstichtag für die Berechnung
  faelligkeit       TEXT NOT NULL,          -- Belastungsdatum der Lastschrift

  status            TEXT NOT NULL DEFAULT 'entwurf',
                    -- 'entwurf' | 'laeuft' | 'fertig' | 'festgeschrieben' | 'abgebrochen'

  -- Wiederaufsetzpunkt: bis zu welcher Mitgliedschaft (sortiert) der Lauf
  -- gekommen ist. Ein abgebrochener Lauf wird fortgesetzt, nicht wiederholt.
  fortschritt_ab    TEXT,
  anzahl_erwartet   INTEGER,
  anzahl_erzeugt    INTEGER NOT NULL DEFAULT 0,
  summe_cent        INTEGER NOT NULL DEFAULT 0,

  -- Nach dem Festschreiben ist der Lauf unveränderlich. Korrekturen
  -- laufen ab da nur noch über Storno und Nachbuchung.
  festgeschrieben_am TEXT,
  festgeschrieben_von TEXT,

  erstellt_am       TEXT NOT NULL,
  erstellt_von      TEXT NOT NULL
);

-- Eine Sollstellung. Satzung § 7 kennt drei Arten: Beitrag,
-- Aufnahmegebühr und Umlage.
CREATE TABLE forderung (
  id                TEXT PRIMARY KEY,
  beitragslauf_id   TEXT REFERENCES beitragslauf(id),   -- NULL bei Einzelforderung
  mitgliedschaft_id TEXT NOT NULL REFERENCES mitgliedschaft(id),
  haushalt_id       TEXT NOT NULL REFERENCES haushalt(id),

  art               TEXT NOT NULL DEFAULT 'beitrag',
                    -- 'beitrag' | 'aufnahmegebuehr' | 'umlage' | 'sonstiges'
  bezeichnung       TEXT NOT NULL,
  jahr              INTEGER NOT NULL,
  periode           TEXT,

  betrag_cent       INTEGER NOT NULL,
  faellig_am        TEXT NOT NULL,

  -- Vollständige Herleitung als JSON: Grundbeitrag, jeder Spartenzuschlag,
  -- anteilige Kürzung, Familienrabatt, Restcent-Zuweisung. Ohne das kann
  -- niemand einem Mitglied erklären, warum genau 84,00 € dastehen.
  berechnung_json   TEXT,

  status            TEXT NOT NULL DEFAULT 'offen',
                    -- 'offen' | 'bezahlt' | 'teilbezahlt' | 'rueckläufer' | 'storniert' | 'erlassen'

  storniert_am      TEXT,
  storniert_von     TEXT,
  storno_grund      TEXT,

  erstellt_am       TEXT NOT NULL,
  erstellt_von      TEXT NOT NULL
);

-- Eine erzeugte SEPA-Datei. Die XML selbst liegt in Nextcloud, hier
-- stehen nur die Kennzahlen, die zur Bank gemeldet wurden — damit sich
-- eine Einreichung später eindeutig zuordnen lässt.
CREATE TABLE sepa_datei (
  id                TEXT PRIMARY KEY,
  beitragslauf_id   TEXT REFERENCES beitragslauf(id),
  msg_id            TEXT NOT NULL UNIQUE,   -- MsgId aus dem GrpHdr
  erstellt_datum    TEXT NOT NULL,
  ausfuehrung_am    TEXT NOT NULL,
  seq_typ           TEXT NOT NULL,          -- 'FRST' | 'RCUR' | 'gemischt'
  anzahl_posten     INTEGER NOT NULL,       -- muss NbOfTxs entsprechen
  summe_cent        INTEGER NOT NULL,       -- muss CtrlSum entsprechen
  datei_pfad        TEXT,
  eingereicht_am    TEXT,

  erstellt_am       TEXT NOT NULL,
  erstellt_von      TEXT NOT NULL
);

CREATE TABLE zahlung (
  id                TEXT PRIMARY KEY,
  forderung_id      TEXT REFERENCES forderung(id),
  haushalt_id       TEXT NOT NULL REFERENCES haushalt(id),
  sepa_datei_id     TEXT REFERENCES sepa_datei(id),

  betrag_cent       INTEGER NOT NULL,       -- negativ bei Rückläufer/Erstattung
  eingang_am        TEXT NOT NULL,
  art               TEXT NOT NULL,          -- 'lastschrift' | 'ueberweisung' | 'bar' | 'ruecklauf'
  verwendungszweck  TEXT,

  -- Rückläufer: Grund und Entgelt, das der Bank belastet wurde.
  ruecklauf_grund   TEXT,
  ruecklauf_entgelt_cent INTEGER,

  storniert_am      TEXT,
  storniert_von     TEXT,
  storno_grund      TEXT,

  erstellt_am       TEXT NOT NULL,
  erstellt_von      TEXT NOT NULL
);

-- Hier stand bis zum 10.08.2026 die Tabelle `mahnung`. Sie ist auf
-- Michels Wunsch zusammen mit dem gesamten Mahnwesen entfernt worden
-- (Client, Worker-Aktionen, Einstellungen, Forderungsart 'mahngebuehr').
-- ⚠️ Der Ausschluss nach § 5 Abs. 3 setzt zwei schriftliche Mahnungen
-- voraus — dieser Nachweis entsteht seitdem außerhalb der App.


-- ---------------------------------------------------------------------
-- 6) AUFNAHMEANTRAG (login-los von außen)
-- ---------------------------------------------------------------------

-- Ein Antrag ist KEINE Mitgliedschaft. Satzung § 4 verlangt den Beschluss
-- des Gesamtvorstands — erst der erzeugt person/mitgliedschaft.
-- Diese Tabelle ist der einzige Schreibpunkt eines offenen Endpunkts.
CREATE TABLE aufnahmeantrag (
  id                TEXT PRIMARY KEY,
  eingang_am        TEXT NOT NULL,

  antrag_json       TEXT NOT NULL,          -- kompletter Formularinhalt, feldgeprüft
  sparten_json      TEXT,                   -- gewünschte Sparten

  unterschrift_datei     TEXT,
  unterschrift_gesetzl_datei TEXT,          -- bei Minderjährigen, § 4
  -- Das Papierformular verlangt die Unterschrift ALLER Erziehungs-
  -- berechtigten (§ 1629 BGB). Leer, wenn alleiniges Sorgerecht erklärt
  -- wurde — das steht dann als Erklärung im antrag_json.
  unterschrift_gesetzl2_datei TEXT,
  signatur_ip       TEXT,
  signatur_agent    TEXT,
  signatur_zeit     TEXT,

  -- Woher der Antrag kam: 'antrag' = allgemeiner Aufnahmeantrag,
  -- 'nachwuchs' = Anmeldung eines Jugendspielers mit Spielerlaubnis.
  -- Eine SPALTE, kein Feld im JSON: die Liste filtert und zählt danach.
  quelle            TEXT NOT NULL DEFAULT 'antrag',

  -- Schlüssel des abgeschotteten Bereichs beim admin-worker, in dem die
  -- Nachweise liegen (Geburtsurkunde, Spielerpass, Abmeldung). 32 Hex,
  -- vom Server dort vergeben. Die Dateien selbst liegen in Nextcloud —
  -- Ausweiskopien haben in dieser Datenbank nichts zu suchen.
  nachweis_owner    TEXT,

  status            TEXT NOT NULL DEFAULT 'neu',
                    -- 'neu' | 'geprueft' | 'angenommen' | 'abgelehnt' | 'zurueckgezogen'
  geprueft_am       TEXT,
  geprueft_von      TEXT,
  beschluss_am      TEXT,
  ablehnung_grund   TEXT,                   -- § 4 Abs. 2: Ablehnung braucht keine Begründung

  person_id         TEXT REFERENCES person(id),        -- gesetzt nach Annahme
  mitgliedschaft_id TEXT REFERENCES mitgliedschaft(id)
);


-- ---------------------------------------------------------------------
-- 7) SYSTEM — Rollen und Protokoll
-- ---------------------------------------------------------------------

-- Fachrolle. Das Gateway entscheidet nur "darf überhaupt rein"; WAS
-- jemand darf, steht hier. Es werden NIE Passwörter oder Gruppen
-- gespeichert — die Identität kommt ausschließlich aus me.
CREATE TABLE benutzer_rolle (
  id                TEXT PRIMARY KEY,
  username          TEXT NOT NULL,          -- Gateway-username, einzige Verknüpfung
  rolle             TEXT NOT NULL,
                    -- 'geschaeftsstelle' | 'schatzmeister' | 'abteilungsleiter' | 'vorstand'
  sparte_id         TEXT REFERENCES sparte(id),   -- nur bei abteilungsleiter

  erstellt_am       TEXT NOT NULL,
  erstellt_von      TEXT NOT NULL
);

-- Nachvollziehbarkeit. Pflicht für die Buchhaltung, und bei
-- Personendaten die Grundlage jeder Auskunft nach Art. 15 DSGVO.
CREATE TABLE protokoll (
  id                TEXT PRIMARY KEY,
  zeit              TEXT NOT NULL,
  username          TEXT,
  aktion            TEXT NOT NULL,
  objekt_typ        TEXT,
  objekt_id         TEXT,
  detail_json       TEXT
);


-- ---------------------------------------------------------------------
-- 8) INDIZES
-- ---------------------------------------------------------------------

-- Suche über 2500 Personen muss serverseitig laufen, nicht im Browser.
CREATE INDEX idx_person_name       ON person(nachname, vorname);
CREATE INDEX idx_person_haushalt   ON person(haushalt_id);
CREATE INDEX idx_person_gateway    ON person(gateway_username);

CREATE INDEX idx_mgs_person        ON mitgliedschaft(person_id);
CREATE INDEX idx_mgs_status        ON mitgliedschaft(status);
CREATE INDEX idx_mgs_eintritt      ON mitgliedschaft(eintritt);

-- Trägt die Abteilungsleiter-Sicht: "alle Mitglieder MEINER Sparte".
CREATE INDEX idx_mgspa_sparte      ON mitgliedschaft_sparte(sparte_id, austritt);
CREATE INDEX idx_mgspa_mgs         ON mitgliedschaft_sparte(mitgliedschaft_id);

CREATE INDEX idx_ford_haushalt     ON forderung(haushalt_id, status);
CREATE INDEX idx_ford_mgs          ON forderung(mitgliedschaft_id);
CREATE INDEX idx_ford_offen        ON forderung(status, faellig_am);

CREATE INDEX idx_zahlung_haushalt  ON zahlung(haushalt_id, eingang_am);
CREATE INDEX idx_zahlung_forderung ON zahlung(forderung_id);

CREATE INDEX idx_mandat_haushalt   ON sepa_mandat(haushalt_id, widerrufen_am);
CREATE INDEX idx_antrag_status     ON aufnahmeantrag(status, eingang_am);
CREATE INDEX idx_rolle_username    ON benutzer_rolle(username);
CREATE INDEX idx_protokoll_zeit    ON protokoll(zeit);
CREATE INDEX idx_protokoll_objekt  ON protokoll(objekt_typ, objekt_id);

-- DIE wichtigste Zeile des Schemas.
-- D1 kennt keine Transaktion über mehrere Requests. Ein Beitragslauf über
-- 2500 Mitglieder läuft zwangsläufig in vielen Aufrufen. Bricht einer ab
-- und der Client wiederholt ihn, entstünde die Forderung zweimal — und
-- beim Mitglied käme eine doppelte Abbuchung an. Dieser Index macht das
-- unmöglich: dieselbe Mitgliedschaft kann in demselben Lauf nur genau
-- eine Forderung je Art haben.
CREATE UNIQUE INDEX idx_ford_lauf_eindeutig
  ON forderung(beitragslauf_id, mitgliedschaft_id, art)
  WHERE beitragslauf_id IS NOT NULL;

-- Ein Haushalt hat höchstens ein gültiges Mandat.
CREATE UNIQUE INDEX idx_mandat_aktiv
  ON sepa_mandat(haushalt_id)
  WHERE widerrufen_am IS NULL;

-- Eine Person ist nicht zweimal in derselben Sparte gleichzeitig.
CREATE UNIQUE INDEX idx_mgspa_aktiv
  ON mitgliedschaft_sparte(mitgliedschaft_id, sparte_id)
  WHERE austritt IS NULL;

-- Dieselbe Forderung wird aus derselben SEPA-Datei nur EINMAL bezahlt.
-- Läuft die Sammelbuchung zweimal zugleich, entstehen sonst zwei
-- Zahlungen über denselben Posten — und nach einer Rücklastschrift auf
-- eine der beiden steht die Forderung auf 'bezahlt', obwohl nie Geld
-- eingegangen ist. Sie verschwindet damit aus den offenen Posten.
-- D1 kennt kein BEGIN, die Prüfung im Code ist nicht Teil der
-- Schreibeinheit — entscheiden muss es die Datenbank.
--
-- ⚠️ 'storniert_am IS NULL' ist zwingend: ohne die Bedingung blockierte
-- der Index den legitimen Weg, eine Zahlung zu stornieren und neu zu
-- buchen. vv-sammel-zurueck storniert, statt zu löschen (GoBD), und die
-- stornierte Zeile bleibt stehen.
CREATE UNIQUE INDEX idx_zahlung_sepa_eindeutig
  ON zahlung(sepa_datei_id, forderung_id)
  WHERE sepa_datei_id IS NOT NULL AND storniert_am IS NULL;


-- ---------------------------------------------------------------------
-- 9) BUCHHALTUNG (Stufe 4)
-- ---------------------------------------------------------------------
--
-- Doppelte Buchführung mit den vier Sphären des Gemeinnützigkeitsrechts.
-- Diese Tabellen entstehen NICHT beim Einspielen des Schemas, sondern über
-- handleMigration (CREATE TABLE IF NOT EXISTS) -- die Datenbank läuft seit
-- Juli 2026 produktiv, ein zweites Einspielen des Schemas gibt es nicht.
-- Hier stehen sie als Referenz und für neue Instanzen.

-- Ein Kalenderjahr. Abgeschlossen wird es genau einmal; danach entstehen
-- Korrekturen nur noch als Storno im Folgejahr.
CREATE TABLE geschaeftsjahr (
  id                TEXT PRIMARY KEY,
  jahr              INTEGER NOT NULL UNIQUE,
  beginn            TEXT NOT NULL,
  ende              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'offen',   -- 'offen' | 'abgeschlossen'
  abgeschlossen_am  TEXT,
  abgeschlossen_von TEXT,
  ergebnis_json     TEXT,                   -- Ergebnis je Sphäre beim Abschluss
  erstellt_am       TEXT NOT NULL,
  erstellt_von      TEXT NOT NULL
);

-- Kontenrahmen, an SKR49 angelehnt. Die Nummern sind ein Startbestand und
-- ausdrücklich änderbar -- ein Kontenrahmen ist eine Absprache mit dem
-- Steuerberater, kein Programmzustand.
--
-- Die SPHÄRE hängt am Konto, nicht an der Buchung. Sonst gäbe es zwei
-- Wahrheiten darüber, ob eine Einnahme steuerpflichtig ist. Wer dieselbe
-- Art Einnahme in zwei Sphären braucht, legt zwei Konten an -- genau so
-- ist SKR49 aufgebaut.
CREATE TABLE konto (
  id                TEXT PRIMARY KEY,
  nummer            TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  art               TEXT NOT NULL,          -- 'aktiv' | 'passiv' | 'ertrag' | 'aufwand'
  sphaere           TEXT,                   -- nur bei ertrag/aufwand gesetzt
                    -- 'ideell' | 'vermoegen' | 'zweckbetrieb' | 'wirtschaft'
  gruppe            TEXT,                   -- Gliederung in der Auswertung
  aktiv             INTEGER NOT NULL DEFAULT 1,
  sortierung        INTEGER NOT NULL DEFAULT 100,
  erstellt_am       TEXT NOT NULL,
  erstellt_von      TEXT NOT NULL
);

-- Geführter Geschäftsvorfall in Klartext. Der Erklärungstext ist Pflicht:
-- die Sphäre falsch zu wählen trifft die Gemeinnützigkeit, und eine
-- Vorlage verteilt einen solchen Fehler flächiger als Handarbeit.
CREATE TABLE geschaeftsvorfall_vorlage (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  erklaerung        TEXT NOT NULL,
  soll_nummer       TEXT NOT NULL,
  haben_nummer      TEXT NOT NULL,
  sphaere           TEXT,                   -- muss zur Sphäre der Konten passen
  sortierung        INTEGER NOT NULL DEFAULT 100,
  aktiv             INTEGER NOT NULL DEFAULT 1,
  erstellt_am       TEXT NOT NULL,
  erstellt_von      TEXT NOT NULL
);

-- Ein Beleg. Belegnummern sind je Geschäftsjahr lückenlos -- das erzwingt
-- der eindeutige Index unten, weil D1 keine Transaktion über mehrere
-- Anweisungen kennt.
CREATE TABLE buchung (
  id                TEXT PRIMARY KEY,
  geschaeftsjahr_id TEXT NOT NULL REFERENCES geschaeftsjahr(id),
  belegnummer       INTEGER NOT NULL,
  belegdatum        TEXT NOT NULL,
  buchungsdatum     TEXT NOT NULL,
  text              TEXT NOT NULL,
  vorlage_id        TEXT REFERENCES geschaeftsvorfall_vorlage(id),
  summe_cent        INTEGER NOT NULL,       -- Sollsumme; Haben ist gleich groß
  art               TEXT NOT NULL DEFAULT 'normal',
                    -- 'normal' | 'eroeffnung' | 'abschluss' | 'storno'

  -- Herkunft aus der Beitragsverwaltung. Der eindeutige Teilindex darauf
  -- verhindert, dass derselbe Vorgang zweimal gebucht wird.
  quelle_typ        TEXT,                   -- 'beitragslauf' | 'sepa_datei' | 'zahlung'
  quelle_id         TEXT,

  -- GoBD: gelöscht wird nie. Ein Storno ist eine eigene Buchung, die auf
  -- die stornierte zeigt.
  storniert_am      TEXT,
  storniert_von     TEXT,
  storno_von_id     TEXT REFERENCES buchung(id),
  storno_grund      TEXT,

  erstellt_am       TEXT NOT NULL,
  erstellt_von      TEXT NOT NULL
);

CREATE TABLE buchungszeile (
  id                TEXT PRIMARY KEY,
  buchung_id        TEXT NOT NULL REFERENCES buchung(id),
  konto_id          TEXT NOT NULL REFERENCES konto(id),
  soll_cent         INTEGER NOT NULL DEFAULT 0,
  haben_cent        INTEGER NOT NULL DEFAULT 0,

  -- Abzug der Konto-Sphäre zum Buchungszeitpunkt. Eine spätere Änderung
  -- am Konto darf die Vergangenheit nicht umschreiben -- dieselbe Regel
  -- wie beim Beitragssatz mit Stichtag.
  sphaere           TEXT,
  sparte_id         TEXT REFERENCES sparte(id),
  text              TEXT
);

-- Lückenlose Belegnummern je Jahr. OHNE diesen Index vergibt ein zweiter
-- gleichzeitiger Klick dieselbe Nummer, und die Buchführung ist nicht
-- mehr ordnungsgemäß.
CREATE UNIQUE INDEX idx_buchung_beleg ON buchung(geschaeftsjahr_id, belegnummer);

-- Ein Vorgang aus der Beitragsverwaltung wird höchstens einmal gebucht.
CREATE UNIQUE INDEX idx_buchung_quelle ON buchung(quelle_typ, quelle_id)
  WHERE quelle_typ IS NOT NULL;

CREATE INDEX idx_buchung_jahr    ON buchung(geschaeftsjahr_id, belegdatum);
CREATE INDEX idx_bzeile_buchung  ON buchungszeile(buchung_id);
CREATE INDEX idx_bzeile_konto    ON buchungszeile(konto_id);


-- ---------------------------------------------------------------------
-- 10) EINSTELLUNGEN
-- ---------------------------------------------------------------------

-- Schlüssel-Wert-Ablage für Vereinsstammdaten (Name, IBAN, Gläubiger-ID),
-- die Vereinsnummer beim Landesverband und die Schalter für die beiden
-- öffentlichen Antragsformulare.
--
-- Nachgetragen am 30.07.2026: Die Tabelle entsteht seit Juli zur Laufzeit
-- in handleMigration und fehlte hier. Aufgefallen ist es der nächtlichen
-- Sicherung — die liest ihre Tabellenliste aus sqlite_master und meldete
-- 23 Tabellen, wo diese Datei nur 22 kennt. Genau dafür steht dort keine
-- fest verdrahtete Liste.
CREATE TABLE einstellung (
  schluessel        TEXT PRIMARY KEY,
  wert              TEXT,
  geaendert_am      TEXT,
  geaendert_von     TEXT
);


-- ---------------------------------------------------------------------
-- 11) ELTERNKODEX
-- ---------------------------------------------------------------------

-- Nachgereichte Kenntnisnahmen des Elternkodex. Die Nachwuchs-ANMELDUNG
-- erhebt sie seit dem 18.08.2026 mit; wer schon Mitglied ist, hat sie nie
-- abgegeben. Diese Tabelle nimmt auf, was über den Eltern-Link
-- (kodex.html) nachkommt.
--
-- Eigene Tabelle und kein Feld an mitgliedschaft: die Erklärung gibt nicht
-- das Kind ab, sondern die Erziehungsberechtigten, sie trägt eine eigene
-- Unterschrift und die Fassung des Textes, der gelesen wurde — und sie
-- kommt von außen, bevor irgendjemand sie einer Person zugeordnet hat.
CREATE TABLE elternkodex_bestaetigung (
  id                TEXT PRIMARY KEY,
  eingang_am        TEXT NOT NULL,

  -- Wie die Eltern es geschrieben haben, unverändert. Der Abgleich läuft
  -- über abgleich_schluessel; hier steht das Original, weil eine
  -- Erklärung ein Beleg ist und kein Suchindex.
  kind_vorname      TEXT NOT NULL,
  kind_nachname     TEXT NOT NULL,
  kind_geburtsdatum TEXT NOT NULL,           -- 'YYYY-MM-DD'

  -- Freitext. Die Mannschaften führt der Kadermanager, nicht diese
  -- Datenbank. Als Angabe der Eltern sagt sie der Geschäftsstelle, bei
  -- welchem Trainerteam nachzufassen ist.
  mannschaft        TEXT,

  erz_name          TEXT NOT NULL,
  erz_email         TEXT,                    -- freiwillig, nur zum Nachfassen
  ort               TEXT,

  -- Ohne die Fassung ließe sich in zwei Jahren nicht sagen, WAS jemand
  -- unterschrieben hat. Der Kodex wird fortgeschrieben.
  kodex_version     TEXT NOT NULL,
  unterschrift_datei TEXT NOT NULL,          -- data:image/png;base64,…

  -- Namensteile normalisiert und SORTIERT, dahinter das Geburtsdatum.
  -- Steht als Spalte da, weil der eindeutige Index daran hängt — die
  -- einzige Klammer gegen eine Doppelbestätigung aus einem zweiten Klick.
  abgleich_schluessel TEXT NOT NULL,

  -- HANDZUORDNUNG, nicht der Regelweg: greift nur, wenn der Name so
  -- anders geschrieben ist, dass der Schlüssel nicht trifft.
  person_id         TEXT REFERENCES person(id),
  zugeordnet_am     TEXT,
  zugeordnet_von    TEXT,

  signatur_ip       TEXT,
  signatur_agent    TEXT,
  signatur_zeit     TEXT
);

CREATE UNIQUE INDEX idx_kodex_abgleich ON elternkodex_bestaetigung(abgleich_schluessel);

-- Ersetzte Fassungen einer Kenntnisnahme (nachgeruestet 18.08.2026).
--
-- Der Nachreich-Weg hat bewusst keinen Zugriffscode, und der
-- Abgleichsschluessel ist Name plus Geburtstag des Kindes -- beides weiss
-- im Verein jeder. Ein zweites Absenden ersetzte die vorhandene Erklaerung
-- bis dahin KOMMENTARLOS: die Unterschrift der Familie war fort, die Liste
-- zeigte weiter "liegt vor", und niemand konnte sagen, dass etwas passiert
-- war. Eine Erklaerung ist ein Beleg; ein Beleg darf nicht still
-- verschwinden. Ersetzt wird weiter -- die neuere Fassung gilt --, aber die
-- alte wandert vorher hierher, samt Unterschrift und Signaturspur.
CREATE TABLE elternkodex_verlauf (
  -- id der ersetzten Zeile plus ihr Eingangszeitpunkt: zusammen eindeutig,
  -- damit zwei gleichzeitige Ersetzungen nicht zwei Kopien anlegen.
  id                  TEXT PRIMARY KEY,
  bestaetigung_id     TEXT NOT NULL,
  abgleich_schluessel TEXT NOT NULL,
  ersetzt_am          TEXT NOT NULL,
  -- Der Anschluss der ERSETZENDEN Erklaerung. Der der alten steht in
  -- signatur_ip; nur beide zusammen unterscheiden die Selbstkorrektur der
  -- Familie von einer fremden Ueberschreibung.
  ersetzt_von_ip      TEXT,
  eingang_am          TEXT NOT NULL,
  kind_vorname        TEXT,
  kind_nachname       TEXT,
  kind_geburtsdatum   TEXT,
  mannschaft          TEXT,
  erz_name            TEXT,
  erz_email           TEXT,
  ort                 TEXT,
  kodex_version       TEXT,
  unterschrift_datei  TEXT,
  signatur_ip         TEXT,
  signatur_agent      TEXT,
  signatur_zeit       TEXT
);

CREATE INDEX idx_kodex_verlauf_zeile ON elternkodex_verlauf(bestaetigung_id);

