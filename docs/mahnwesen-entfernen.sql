-- ---------------------------------------------------------------------
-- Mahnwesen aus der Datenbank entfernen (10.08.2026)
-- ---------------------------------------------------------------------
--
-- Gehoert zum Commit, der das Mahnwesen aus Client und Worker entfernt.
-- Der Code laeuft auch ohne diesen Schritt fehlerfrei -- er greift die
-- Tabelle `mahnung` nirgends mehr an. Dies raeumt sie auf.
--
-- WO EINSPIELEN: Cloudflare-Dashboard → Workers & Pages → D1 →
-- Datenbank `vereinsverwaltung` → Console.
--
-- ⚠️ Die D1-Konsole verliert beim Einfuegen die Zeilenumbrueche, wodurch
-- alles hinter dem ersten `--` zum Kommentar wird ("Requests without any
-- query are not supported"). Deshalb Abschnitt 1 und 2 EINZELN einfuegen
-- und dabei die Kommentarzeilen weglassen -- die beiden Befehle stehen
-- unten noch einmal nackt.
--
-- ⚠️ NICHT UMKEHRBAR. Die naechtliche Sicherung nach Nextcloud enthaelt
-- die Tabelle allerdings noch: `taeglich/vereinsverwaltung-<Wochentag>.json`
-- bzw. `monatlich/vereinsverwaltung-2026-08.json`. Wer sie zurueckholen
-- will, findet dort die Zeilen und im Commit davor das Schema.


-- ---------------------------------------------------------------------
-- 0) VORHER HINSEHEN -- was trifft der Loeschbefehl ueberhaupt?
-- ---------------------------------------------------------------------
-- Erst diese drei Zeilen laufen lassen. Stehen ueberall Nullen, ist der
-- Rest ein reiner Aufraeumschritt.

SELECT COUNT(*) AS mahnungen_gesamt FROM mahnung;

SELECT COUNT(*) AS mahngebuehr_forderungen, COALESCE(SUM(betrag_cent), 0) AS summe_cent
  FROM forderung WHERE art = 'mahngebuehr';

SELECT COUNT(*) AS mahn_einstellungen FROM einstellung
  WHERE schluessel IN ('mahn_karenz_tage', 'mahn_frist_tage', 'mahn_mindest_cent',
                       'mahn_gebuehr1_cent', 'mahn_gebuehr2_cent', 'anhoerung_tage');


-- ---------------------------------------------------------------------
-- 1) Die Tabelle und ihr Index
-- ---------------------------------------------------------------------
-- Der Index faellt mit der Tabelle; die Zeile steht nur da, falls die
-- Tabelle in einer Instanz schon fehlt.

DROP INDEX IF EXISTS idx_mahnung_haushalt;
DROP TABLE IF EXISTS mahnung;


-- ---------------------------------------------------------------------
-- 2) Die sechs Einstellungen
-- ---------------------------------------------------------------------
-- Ohne das blieben sie als Karteileichen stehen. Der Worker kennt die
-- Schluessel nicht mehr und wuerde sie ignorieren, aber die naechtliche
-- Sicherung zoege sie jede Nacht mit.

DELETE FROM einstellung
  WHERE schluessel IN ('mahn_karenz_tage', 'mahn_frist_tage', 'mahn_mindest_cent',
                       'mahn_gebuehr1_cent', 'mahn_gebuehr2_cent', 'anhoerung_tage');


-- ---------------------------------------------------------------------
-- 3) Mahngebuehren als Forderung -- NUR wenn Abschnitt 0 welche gefunden hat
-- ---------------------------------------------------------------------
-- ⚠️ Nicht blind ausfuehren. Steht in Abschnitt 0 eine Zahl groesser 0,
-- haengen daran moeglicherweise Zahlungen und Buchungen. Dann NICHT
-- loeschen, sondern stehen lassen: eine bezahlte Forderung zu entfernen
-- reisst die Buchhaltung auseinander (GoBD -- es wird storniert, nicht
-- geloescht). Der Code erzeugt ohnehin keine neuen mehr.
--
-- Nur wenn Abschnitt 0 GENAU NULL Treffer meldet, ist hier nichts zu tun.


-- ---------------------------------------------------------------------
-- Zum Einfuegen in die D1-Konsole (ohne Kommentare, einzeln)
-- ---------------------------------------------------------------------
-- DROP INDEX IF EXISTS idx_mahnung_haushalt; DROP TABLE IF EXISTS mahnung;
--
-- DELETE FROM einstellung WHERE schluessel IN ('mahn_karenz_tage','mahn_frist_tage','mahn_mindest_cent','mahn_gebuehr1_cent','mahn_gebuehr2_cent','anhoerung_tage');
--
-- Gegenprobe danach (muss 22 liefern, vorher 23):
-- SELECT COUNT(*) AS tabellen FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%';
