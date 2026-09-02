# Zuordnung Abteilung → DOSB-Sportartennummer (LSB Thüringen)

Grundlage: **Sportartenliste des LSB Thüringen, Stand Dezember 2025**
(`https://www.thueringen-sport.de/fileadmin/user_upload/Sportartenliste.pdf`).
Gebraucht wird die Nummer für die CSV-Bestandsmeldung an
`unser-sportverein.net` (Spalte „Abteilungen").

**Zwei Nummern je Sportart.** Die zweite gilt, wenn der Verein im
zuständigen Landesfachverband **nicht** Mitglied ist („ohne LFV"); sie ist
immer die erste **+ 1000**. Die „ohne LFV"-Meldung kostet 2026 den
Anstatt-Beitrag (5 € bis 17 Jahre, 10 € ab 18) und **entfällt ab
01.01.2027 ersatzlos** — ab dann muss jedes Mitglied einem Fachverband
gemeldet werden, in dem der Verein Mitglied ist.

## Die acht aktiven Abteilungen

**Stand 10.08.2026: von Michel entschieden.** Diese sieben Nummern
werden in der App bei den Abteilungen eingetragen (Reiter „Anträge“).

| Abteilung (Mitglieder) | Sportart | Nr. | ohne LFV | Zuständiger Verband |
|---|---|---:|---:|---|
| Fussball (375) | Fußball | **81** | 1081 | Thüringer Fußball-Verband |
| Wandern (42) | Wandern | **291** | 1291 | Thür. Gebirgs- und Wanderverein |
| Radsport-Mountainbike (38) | Mountainbike | **155** | 1155 | Thüringer Radsport-Verband |
| Volleyball (27) | Volleyball | **287** | 1287 | Thüringer Volleyball-Verband |
| Turnen (25) | Gymnastik | **95** | 1095 | Thüringer Turnverband |
| Darts (20) | Dart (Steel) | **256** | 1256 | Thüringer Dartverband |
| Tischtennis (8) | Tischtennis | **275** | 1275 | Thür. Tischtennis-Verband |
| Breitensport (85) | — | — | — | **wird aufgeteilt, siehe unten** |

**Mitgliedschaft im Fachverband bestätigt** für Fußball-Verband,
Turnverband und Gebirgs- und Wanderverein (Michel, 10.08.2026) — dort
gilt die normale Nummer. Für Volleyball, Tischtennis, Dart und Radsport
ist sie **nicht** bestätigt; steht der Verein dort nicht als Mitglied,
gehört die +1000-Variante eingetragen, sonst weist der Verband die
Meldung zurück.

### Die Alternativen, gegen die entschieden wurde

**Radsport-Mountainbike** — Radsport-Verband führt mehrere:
Mountainbike 155 · Radsport 180 · Radwandern 183 · Radball 177 ·
Kunstradfahren 136 · BMX Freestyle 33 · Fahrradtrial 66.

**Turnen** — die Sportart „Turnen" gibt es in der Liste **nicht**. Alles
beim Thüringer Turnverband: Gymnastik 95 · Gerätturnen 354 ·
Fitness/Gesundheit 72 · Trampolinturnen 277 · Rope Skipping 207 ·
Rhythmische Sportgymnastik 190 · Aerobic 1 · Indiaca 102 · Prellball 173 ·
Parkour 496 · Tai-Chi 267 · Quigong 176 · Dance Gym 329.

**Darts** — der Verband trennt: Dart (Steel) 256 · Dart (Elektronik) 64.
Beide beim Thüringer Dartverband.

## Breitensport (85) — der Sammelposten

„Breitensport" ist **keine** DOSB-Sportart und steht in der Liste nicht.
Der Posten stammt aus dem GLS Vereinsmeister, der die elf realen
Abteilungen nur als Sammelposten kennt. Ausgehend von den am 31.07.2026
gelöschten Sparten, deren Mitglieder hier stecken:

| steckt vermutlich drin | Sportart | Nr. | ohne LFV | Verband |
|---|---|---:|---:|---|
| Kurstadtlauf | Leichtathletik | 141 | 1141 | Thür. Leichtathletik-Verband |
| Walken | Nordic Walking | 394 | 1394 | Thür. Leichtathletik-Verband |
| Reha-Sport | Para- und Rehabilitationssport | 132 | 1132 | Thür. Behinderten- und Reha-Sportverband |
| Tennis | Tennis (Court und Beach) | 274 | 1274 | Thüringer Tennis-Verband |
| Freizeit-Fussball | Fußball | 81 | 1081 | Thüringer Fußball-Verband |
| Yoga | **gibt es nicht** | — | — | ersatzweise Gymnastik 95 / Fitness-Gesundheit 72 / Quigong 176 |

⚠️ Ohne diese Aufteilung landen 85 Mitglieder in „ohne LFV" — 2026 rund
850 € Anstatt-Beitrag, ab 2027 gar nicht mehr meldbar.

## Was daraus im Code wird

Eine Spalte `sparte.dosb_sportart_nr` (Integer, nullable) plus Feld in der
Spartenverwaltung. Der Export setzt sie in die CSV-Spalte „Abteilungen";
eine Sparte ohne Nummer fällt auf und wird gemeldet, statt still zu fehlen.

**Nicht durchgesehen:** Seiten 6 und 10 der Sportartenliste (I–K und S,
also u. a. Judo, Karate, Kegeln, Klettern, Schwimmen, Ski). Für die acht
Abteilungen nicht gebraucht.
