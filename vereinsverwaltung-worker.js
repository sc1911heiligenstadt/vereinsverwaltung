// =====================================================================
// Vereinsverwaltung 1. SC 1911 Heiligenstadt — Cloudflare Worker
// =====================================================================
//
// EINRICHTUNG (einmalig im Cloudflare-Dashboard):
//
//   1. Worker anlegen, Name: vereinsverwaltung
//   2. Settings -> Bindings -> D1 database binding
//        Variable name: VV_DB
//        D1 database:   vereinsverwaltung
//   3. Settings -> Bindings -> Service binding
//        Variable name: LANDINGPAGE
//        Service:       landingpage
//      Ein normaler fetch() auf die landingpage-URL wird von Cloudflare
//      mit Error 1042 geblockt (gleiche workers.dev-Subdomain). Ohne das
//      Binding antwortet dieser Worker bewusst mit 500 statt jemanden
//      ungeprueft durchzulassen.
//   4. Schema einspielen: Inhalt von schema.sql in der D1-Konsole
//      des Dashboards ausfuehren (Dashboard -> D1 -> vereinsverwaltung
//      -> Console).
//   5. Settings -> Variables and Secrets, drei Secrets fuer die
//      naechtliche Sicherung: NEXTCLOUD_BACKUP_URL, NEXTCLOUD_USERNAME,
//      NEXTCLOUD_PASSWORD. Fehlen sie, laeuft alles weiter -- nur
//      gesichert wird nichts. Einzelheiten weiter unten bei
//      "SICHERUNG NACH NEXTCLOUD".
//   6. Settings -> Triggers -> Cron Triggers: "20 2 * * *" (UTC).
//      deploy-worker.ps1 deployt den Cron NICHT mit.
//
// Deploy danach ueber E:\ToolsUebersicht\deploy-worker.ps1
// (Eintrag in $REGISTRY ergaenzen). NIE per PUT ohne keep_bindings --
// das loescht Secrets UND die beiden Bindings oben.
//
// ---------------------------------------------------------------------
// AUTORISIERUNG -- zwei Quellen, bewusst getrennt:
//
//   Gateway (landingpage)  beantwortet "darf diese Person ueberhaupt
//                          rein" und liefert username/isAdmin/canEdit/
//                          canAdmin. Einzige Identitaetsquelle.
//   D1 (benutzer_rolle)    beantwortet "was darf sie hier" -- also
//                          Geschaeftsstelle / Schatzmeister /
//                          Abteilungsleiter (mit Sparte) / Vorstand.
//
// In D1 stehen NIE Passwoerter und NIE Gruppen, nur der username als
// Verweis. Sonst laufen die beiden Quellen auseinander, sobald ein Konto
// im Gateway geloescht wird -- und ein neu angelegter gleichnamiger
// Nutzer wuerde die alte Rolle erben. Der Abgleich steckt in
// vv-rollen: die Antwort enthaelt "verwaist", also die Rollen ohne
// Gateway-Konto. (Frueher stand hier eine eigene Aktion
// vv-rollen-abgleich -- die gibt es nicht, der Name war ein Ueberbleibsel
// aus dem Plan.)
// =====================================================================

const ALLOWED_ORIGINS = [
  "http://localhost:8810",
  "https://sc1911heiligenstadt.github.io",
  "https://tecko1985.github.io" // alte Adresse bis 2026-08: PWAs mit eigenem SW-Cache laufen dort noch
];

// Muss dem Tool-Id im TOOLS-Array von ToolsUebersicht entsprechen --
// daran haengt die Aufloesung von canEdit/canAdmin im Gateway.
const TOOL_ID = "vereinsverwaltung";

const ROLLEN = new Set([
  "geschaeftsstelle",
  "schatzmeister",
  "abteilungsleiter",
  "vorstand",
  // Spielerlaubnis beim Verband. Bewusst eine EIGENE Rolle statt eines
  // zweiten Kontos in der Geschaeftsstelle: wer die Spielerpaesse macht,
  // braucht die Nachwuchs-Anmeldungen und ihre Nachweise -- aber weder den
  // Mitgliederbestand noch eine einzige IBAN, und beschliessen darf er
  // nach § 4 ohnehin nichts.
  "passstelle"
]);

function json(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders }
  });
}

// ---------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------

// Der Token wird NICHT selbst geprueft. Eine eigene HMAC-Pruefung waere
// zwar moeglich (SESSION_SECRET teilen), wuerde aber nur Signatur und
// Ablauf sehen. Der landingpage-Worker prueft zusaetzlich den globalen
// Rauswurf-Stichtag SESSIONS_INVALID_BEFORE, ob das Konto noch existiert
// und ob der Token aelter ist als der letzte Passwortwechsel. Eine
// Kopie dieser Logik wuerde unweigerlich driften.
async function verifySession(env, authHeader) {
  if (!authHeader) return null;
  try {
    const res = await env.LANDINGPAGE.fetch("https://landingpage/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ action: "me", app: TOOL_ID })
    });
    if (!res.ok) return null;
    const me = await res.json();
    if (!me || !me.username) return null;
    return me;
  } catch {
    return null;
  }
}

// Fachrolle aus D1 nachladen. Ein globaler Gateway-Admin bekommt immer
// die volle Sicht -- sonst sperrt eine fehlende Zeile in benutzer_rolle
// die Verwaltung komplett aus, und niemand koennte sie wieder eintragen.
async function ladeRolle(env, me) {
  const zeilen = await env.VV_DB
    .prepare("SELECT rolle, sparte_id FROM benutzer_rolle WHERE username = ?")
    .bind(me.username)
    .all();

  const rollen = (zeilen.results || []).filter((z) => ROLLEN.has(z.rolle));
  const istAdmin = !!me.isAdmin || !!me.canAdmin;

  return {
    username: me.username,
    istAdmin,
    rollen: rollen.map((z) => z.rolle),
    // Nur fuer Abteilungsleiter belegt. Mehrere Sparten sind moeglich
    // (jemand leitet Dart UND Wandern).
    sparten: rollen.filter((z) => z.rolle === "abteilungsleiter" && z.sparte_id)
                   .map((z) => z.sparte_id),
    // Wer Personendaten sehen darf. Vorstand ausdruecklich NICHT.
    darfPersonenSehen: istAdmin
      || rollen.some((z) => z.rolle === "geschaeftsstelle"
                         || z.rolle === "schatzmeister"
                         || z.rolle === "abteilungsleiter"),
    // Wer Bankdaten sehen darf. Abteilungsleiter ausdruecklich NICHT --
    // deshalb tauchen diese Felder in ihren Abfragen gar nicht erst im
    // SQL auf, statt sie nachtraeglich herauszufiltern.
    darfBankSehen: istAdmin
      || rollen.some((z) => z.rolle === "geschaeftsstelle" || z.rolle === "schatzmeister"),
    darfBuchen: istAdmin || rollen.some((z) => z.rolle === "schatzmeister"),
    darfSchreiben: istAdmin
      || rollen.some((z) => z.rolle === "geschaeftsstelle" || z.rolle === "schatzmeister"),
    // Wer die Nachwuchs-Anmeldungen sehen und daraus den Verbandsantrag
    // erzeugen darf. ⚠️ Das ist KEIN Schreibrecht: die Passstelle kommt
    // ueber dieses Feld an die Liste und an den einzelnen Antrag, aber
    // jeder Statuswechsel und die Annahme nach § 4 haengen unveraendert an
    // darfSchreiben. Wer nur diese Rolle hat, bekommt vom Server
    // ausschliesslich Antraege mit quelle='nachwuchs' und darin keine
    // Bankdaten -- gefiltert wird im Handler, nicht im Browser.
    darfNachwuchs: istAdmin
      || rollen.some((z) => z.rolle === "geschaeftsstelle" || z.rolle === "schatzmeister"
                         || z.rolle === "passstelle"),
    // Kennzahlen sind Summen ohne Personenbezug. Sie stehen JEDER
    // hinterlegten Rolle offen -- der Vorstand hat genau dafuer eine:
    // er soll den Verein steuern koennen, ohne Mitgliederdaten zu sehen.
    // Ein angemeldetes Konto ohne Rolle bekommt weiterhin nichts.
    darfKennzahlenSehen: istAdmin || rollen.length > 0
  };
}

// ---------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------

async function handleMe(env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  return json({
    username: me.username,
    vorname: me.vorname || null,
    nachname: me.nachname || null,
    isAdmin: !!me.isAdmin,
    canEdit: !!me.canEdit,
    canAdmin: !!me.canAdmin,
    rollen: rolle.rollen,
    sparten: rolle.sparten,
    darfPersonenSehen: rolle.darfPersonenSehen,
    darfBankSehen: rolle.darfBankSehen,
    darfBuchen: rolle.darfBuchen,
    darfSchreiben: rolle.darfSchreiben,
    darfNachwuchs: rolle.darfNachwuchs
  }, 200, corsHeaders);
}

// ---------------------------------------------------------------------
// Rollenverwaltung
// ---------------------------------------------------------------------
//
// Diese Aktionen entscheiden, wer Personendaten sieht. Sie haengen
// deshalb am globalen Admin, nicht an einer Fachrolle -- sonst koennte
// sich die Geschaeftsstelle selbst zum Schatzmeister machen und damit
// an die Bankdaten kommen.

// Das Nutzerverzeichnis kommt aus dem Gateway und braucht den Token des
// Aufrufers: list-directory prueft die Sitzung selbst. Ohne den Header
// antwortet es 401 -- der Aufrufer wird deshalb bis hierher durchgereicht.
async function ladeGatewayNutzer(env, authHeader) {
  try {
    const res = await env.LANDINGPAGE.fetch("https://landingpage/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader || "" },
      body: JSON.stringify({ action: "list-directory" })
    });
    if (!res.ok) return null;
    const dir = await res.json();
    return Array.isArray(dir.users) ? dir.users : null;
  } catch {
    return null;
  }
}

// Alles fuer die Rollen-Oberflaeche in einem Aufruf: vergebene Rollen,
// waehlbare Konten und die verwaisten Eintraege. Drei Aufrufe waeren drei
// Sitzungspruefungen fuer einen Seitenaufbau.
async function handleRollenListe(env, me, authHeader, corsHeaders) {
  if (!me.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const zeilen = await env.VV_DB.prepare(
    "SELECT r.id, r.username, r.rolle, r.sparte_id, s.name AS sparte_name, r.erstellt_am, r.erstellt_von " +
    "FROM benutzer_rolle r LEFT JOIN sparte s ON s.id = r.sparte_id " +
    "ORDER BY r.username, r.rolle"
  ).all();
  const rollen = zeilen.results || [];

  const nutzer = await ladeGatewayNutzer(env, authHeader);

  // Verwaiste Rollen nur melden, wenn das Verzeichnis wirklich gelesen
  // werden konnte. Sonst waere bei einer Stoerung des Gateways ploetzlich
  // JEDE Rolle als verwaist markiert -- und jemand loescht sie.
  const verwaist = nutzer
    ? rollen.filter((r) => !nutzer.some((u) => u.username === r.username)).map((r) => r.username)
    : [];

  return json({
    rollen,
    nutzer: nutzer || [],
    verzeichnisLesbar: !!nutzer,
    verwaist: Array.from(new Set(verwaist))
  }, 200, corsHeaders);
}

async function handleRolleSetzen(body, env, me, corsHeaders) {
  if (!me.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const username = String(body.username || "").trim();
  const rolle = String(body.rolle || "").trim();
  const sparteId = String(body.sparte_id || "").trim() || null;

  if (!username) return json({ error: "Kein Konto angegeben" }, 400, corsHeaders);
  if (!ROLLEN.has(rolle)) return json({ error: "Unbekannte Rolle" }, 400, corsHeaders);

  // Eine Abteilungsleitung ohne Sparte saehe niemanden -- das ist keine
  // Rolle, sondern ein stiller Fehler. Umgekehrt hat eine Sparte bei den
  // anderen Rollen keine Bedeutung und wird verworfen.
  if (rolle === "abteilungsleiter" && !sparteId) {
    return json({ error: "Für eine Abteilungsleitung muss eine Sparte angegeben werden" }, 400, corsHeaders);
  }
  const wirklicheSparte = rolle === "abteilungsleiter" ? sparteId : null;

  if (wirklicheSparte) {
    const da = await env.VV_DB.prepare("SELECT id FROM sparte WHERE id = ?").bind(wirklicheSparte).first();
    if (!da) return json({ error: "Sparte nicht gefunden" }, 400, corsHeaders);
  }

  // Die Tabelle hat keinen Eindeutigkeitsschluessel (eine Person kann
  // mehrere Sparten leiten). Doppelte Zeilen waeren trotzdem sinnlos,
  // deshalb hier die Pruefung.
  const doppelt = await env.VV_DB.prepare(
    "SELECT id FROM benutzer_rolle WHERE username = ? AND rolle = ? AND " +
    (wirklicheSparte ? "sparte_id = ?" : "sparte_id IS NULL")
  ).bind(...(wirklicheSparte ? [username, rolle, wirklicheSparte] : [username, rolle])).first();
  if (doppelt) return json({ error: "Diese Rolle ist bereits vergeben" }, 409, corsHeaders);

  const id = uuid();
  await env.VV_DB.prepare(
    "INSERT INTO benutzer_rolle (id, username, rolle, sparte_id, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?)"
  ).bind(id, username, rolle, wirklicheSparte, new Date().toISOString(), me.username).run();

  await protokolliere(env, me.username, "rolle-vergeben", "benutzer_rolle", id,
                      { username, rolle, sparte_id: wirklicheSparte });

  return json({ ok: true, id }, 200, corsHeaders);
}

async function handleRolleLoeschen(body, env, me, corsHeaders) {
  if (!me.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const id = String(body.id || "");
  if (!id) return json({ error: "Keine Rolle angegeben" }, 400, corsHeaders);

  const zeile = await env.VV_DB.prepare(
    "SELECT username, rolle, sparte_id FROM benutzer_rolle WHERE id = ?"
  ).bind(id).first();
  if (!zeile) return json({ error: "Nicht gefunden" }, 404, corsHeaders);

  await env.VV_DB.prepare("DELETE FROM benutzer_rolle WHERE id = ?").bind(id).run();
  await protokolliere(env, me.username, "rolle-entzogen", "benutzer_rolle", id, zeile);

  return json({ ok: true }, 200, corsHeaders);
}

// ---------------------------------------------------------------------
// STUFE 1 -- Mitglieder lesen
// ---------------------------------------------------------------------

// Liste mit Suche, Filter und Seitenweise. Die Rechte werden HIER
// durchgesetzt, nicht im Client:
//   - Ein Abteilungsleiter bekommt nur Mitgliedschaften seiner Sparten,
//     und in der Spalte "sparten" auch nur SEINE Sparten -- er soll nicht
//     sehen, wo dieselbe Person sonst noch aktiv ist.
//   - Bankdaten kommen in dieser Abfrage ueberhaupt nicht vor. Sie stehen
//     in sepa_mandat und werden hier nicht gejoint. Was nie ausgeliefert
//     wird, steht auch nicht im Netzwerk-Tab.
//   - Vorstand bekommt 403: die Rolle ist fuer Kennzahlen gedacht, nicht
//     fuer Personendaten.
// Sortierung als WEISSLISTE. Eine Spaltenangabe aus dem Browser darf nie
// in ein ORDER BY wandern -- das waere eine offene SQL-Einschleusung.
// Hier steht deshalb der fertige Ausdruck, nicht der Feldname.
//
// Zwei Feinheiten, die sonst falsch aussehen:
//   - Die Mitgliedsnummer ist TEXT. Ohne CAST kaeme 1, 10, 100, 2.
//   - Leere Werte gehoeren ans Ende, nicht an den Anfang. SQLite sortiert
//     NULL sonst zuerst.
// leer: Ausdruck, der leere Werte erkennt. Er wird IMMER aufsteigend
// sortiert, damit sie in beiden Richtungen hinten stehen -- wer nach
// Geburtsdatum absteigend sortiert, will die Aeltesten sehen und nicht
// zuerst die 40 Saetze ohne Datum.
// spalten: die eigentlichen Sortierfelder, sie folgen der Richtung.
const SORTIERUNGEN = {
  name:         { spalten: ["p.nachname COLLATE NOCASE", "p.vorname COLLATE NOCASE"] },
  nummer:       { spalten: ["CASE WHEN m.mitgliedsnummer GLOB '[0-9]*' THEN CAST(m.mitgliedsnummer AS INTEGER) ELSE 2147483647 END",
                            "m.mitgliedsnummer"] },
  geburtsdatum: { leer: "p.geburtsdatum IS NULL OR p.geburtsdatum = ''", spalten: ["p.geburtsdatum"] },
  sparten:      { leer: "sparten IS NULL", spalten: ["sparten COLLATE NOCASE"] },
  ort:          { leer: "p.ort IS NULL OR p.ort = ''", spalten: ["p.ort COLLATE NOCASE"] },
  eintritt:     { leer: "m.eintritt IS NULL OR m.eintritt = ''", spalten: ["m.eintritt"] },
  status:       { spalten: ["m.status"] }
};

function baueSortierung(schluessel, absteigend) {
  const s = SORTIERUNGEN[schluessel] || SORTIERUNGEN.name;
  const richtung = absteigend ? " DESC" : " ASC";
  const teile = [];
  if (s.leer) teile.push("(" + s.leer + ") ASC");
  s.spalten.forEach((sp) => teile.push(sp + richtung));
  // Der Name als letzte Stufe macht die Reihenfolge eindeutig. Ohne das
  // liefert dieselbe Abfrage beim Blaettern Zeilen doppelt und laesst
  // andere aus -- SQLite darf gleichrangige Zeilen frei anordnen.
  if (schluessel !== "name") {
    teile.push("p.nachname COLLATE NOCASE ASC", "p.vorname COLLATE NOCASE ASC");
  }
  return teile.join(", ");
}

async function handleMitgliederListe(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfPersonenSehen) {
    return json({ error: "Nicht berechtigt fuer Personendaten" }, 403, corsHeaders);
  }

  const suche = String(body.suche || "").trim().slice(0, 100);
  const status = String(body.status || "").trim();
  const sparteFilter = String(body.sparte || "").trim();
  const limit = Math.min(Math.max(parseInt(body.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(body.offset, 10) || 0, 0);

  // hasOwnProperty statt eines nackten Lookups: SORTIERUNGEN["constructor"]
  // liefert die geerbte Object-Funktion und ist damit truthy — baueSortierung
  // liefe dann auf s.spalten.forEach() eines Objekts ohne spalten und die
  // Mitgliederliste antwortete mit 500 statt mit Zeilen.
  const sortSchluessel = Object.prototype.hasOwnProperty.call(SORTIERUNGEN, body.sortierung)
    ? body.sortierung : "name";
  const absteigend = body.richtung === "ab";
  const sortSql = baueSortierung(sortSchluessel, absteigend);

  const nurEigene = !rolle.istAdmin
    && rolle.rollen.includes("abteilungsleiter")
    && !rolle.rollen.includes("geschaeftsstelle")
    && !rolle.rollen.includes("schatzmeister");

  if (nurEigene && !rolle.sparten.length) {
    return json({ gesamt: 0, zeilen: [], hinweis: "Keine Sparte zugewiesen" }, 200, corsHeaders);
  }

  const wo = [];
  const werte = [];

  if (suche) {
    wo.push("(p.nachname LIKE ? OR p.vorname LIKE ? OR m.mitgliedsnummer LIKE ?)");
    werte.push("%" + suche + "%", "%" + suche + "%", suche + "%");
  }
  if (status) { wo.push("m.status = ?"); werte.push(status); }

  // Sichtbarkeitsgrenze des Abteilungsleiters. Zusaetzlich zu einem
  // eventuellen Sparten-Filter aus der Oberflaeche, nicht statt ihm --
  // sonst koennte er sich per Filter aus seiner Sparte herausfragen.
  if (nurEigene) {
    wo.push("EXISTS (SELECT 1 FROM mitgliedschaft_sparte x WHERE x.mitgliedschaft_id = m.id AND x.austritt IS NULL AND x.sparte_id IN (" + rolle.sparten.map(() => "?").join(",") + "))");
    werte.push(...rolle.sparten);
  }
  if (sparteFilter) {
    wo.push("EXISTS (SELECT 1 FROM mitgliedschaft_sparte y WHERE y.mitgliedschaft_id = m.id AND y.austritt IS NULL AND y.sparte_id = ?)");
    werte.push(sparteFilter);
  }

  const woSql = wo.length ? " WHERE " + wo.join(" AND ") : "";

  // Die angezeigten Sparten werden fuer Abteilungsleiter mitgefiltert.
  const spartenBedingung = nurEigene
    ? " AND ms.sparte_id IN (" + rolle.sparten.map(() => "?").join(",") + ")"
    : "";

  const zaehler = await env.VV_DB.prepare(
    "SELECT COUNT(*) AS n FROM mitgliedschaft m JOIN person p ON p.id = m.person_id" + woSql
  ).bind(...werte).first();

  const zeilen = await env.VV_DB.prepare(
    "SELECT m.id AS mitgliedschaft_id, m.mitgliedsnummer, m.art, m.eintritt, m.austritt, m.status, " +
    "       p.id AS person_id, p.vorname, p.nachname, p.geburtsdatum, p.plz, p.ort, p.email, " +
    "       GROUP_CONCAT(s.name, ', ') AS sparten " +
    "FROM mitgliedschaft m " +
    "JOIN person p ON p.id = m.person_id " +
    "LEFT JOIN mitgliedschaft_sparte ms ON ms.mitgliedschaft_id = m.id AND ms.austritt IS NULL" + spartenBedingung + " " +
    "LEFT JOIN sparte s ON s.id = ms.sparte_id" +
    woSql + " " +
    "GROUP BY m.id ORDER BY " + sortSql + " LIMIT ? OFFSET ?"
  ).bind(...(nurEigene ? rolle.sparten : []), ...werte, limit, offset).all();

  return json({
    gesamt: zaehler ? zaehler.n : 0,
    limit, offset,
    sortierung: sortSchluessel,
    richtung: absteigend ? "ab" : "auf",
    eingeschraenkt: nurEigene,
    zeilen: zeilen.results || []
  }, 200, corsHeaders);
}

// Darf diese Person diese eine Mitgliedschaft sehen? Fuer Detailaufrufe,
// wo die Filterung der Liste nicht greift. Ohne diese Pruefung koennte
// ein Abteilungsleiter mit einer geratenen ID an fremde Daten kommen.
async function darfMitgliedschaftSehen(env, rolle, mitgliedschaftId) {
  if (rolle.istAdmin
      || rolle.rollen.includes("geschaeftsstelle")
      || rolle.rollen.includes("schatzmeister")) {
    return true;
  }
  if (!rolle.rollen.includes("abteilungsleiter") || !rolle.sparten.length) return false;

  const treffer = await env.VV_DB.prepare(
    "SELECT 1 AS x FROM mitgliedschaft_sparte WHERE mitgliedschaft_id = ? AND austritt IS NULL " +
    "AND sparte_id IN (" + rolle.sparten.map(() => "?").join(",") + ") LIMIT 1"
  ).bind(mitgliedschaftId, ...rolle.sparten).first();
  return !!treffer;
}

// Satzung § 5 Abs. 2: Austritt ist nur zum 30.06. oder 31.12. moeglich,
// mit vier Wochen Frist. Aus dem Eingang der Kuendigung ergibt sich damit
// genau ein naechstmoeglicher Termin -- er ist nicht frei waehlbar.
// Datumsrechnung bewusst ueber Date.UTC auf reinen Datumsanteilen: die
// Sommerzeit-Umstellung darf keine Frist um einen Tag verschieben.
function naechsterAustrittstermin(kuendigungIso) {
  const t = String(kuendigungIso || "").slice(0, 10).split("-").map(Number);
  if (t.length !== 3 || !t[0]) return null;

  const eingang = Date.UTC(t[0], t[1] - 1, t[2]);
  const FRIST_MS = 28 * 24 * 60 * 60 * 1000;

  const kandidaten = [
    { jahr: t[0], iso: t[0] + "-06-30", ms: Date.UTC(t[0], 5, 30) },
    { jahr: t[0], iso: t[0] + "-12-31", ms: Date.UTC(t[0], 11, 31) },
    { jahr: t[0] + 1, iso: (t[0] + 1) + "-06-30", ms: Date.UTC(t[0] + 1, 5, 30) },
    { jahr: t[0] + 1, iso: (t[0] + 1) + "-12-31", ms: Date.UTC(t[0] + 1, 11, 31) }
  ];
  for (const k of kandidaten) {
    if (k.ms - eingang >= FRIST_MS) return k.iso;
  }
  return null;
}

// Sparten fuer Filter und Auswahllisten. Ein Abteilungsleiter sieht nur
// seine eigenen -- sonst verriete die Filterliste die Vereinsstruktur.
async function handleSpartenListe(env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  const nurEigene = !rolle.istAdmin
    && rolle.rollen.includes("abteilungsleiter")
    && !rolle.rollen.includes("geschaeftsstelle")
    && !rolle.rollen.includes("schatzmeister");

  // Die Mitgliederzahl kommt additiv mit, in derselben Abfrage. Ohne sie
  // liesse sich eine Sparte stilllegen, ohne zu sehen, wie viele Leute
  // daran haengen.
  // Die Sportartennummer wird nur benannt, wenn es sie gibt. Diese Aktion
  // ruft auch der Abteilungsleiter, und der kommt an handleMigration
  // heran, aber sie kann in einem ANDEREN Isolate gelaufen sein -- deshalb
  // dieselbe Vorsicht wie bei den Antragsspalten. Gemerkt wird nur das Ja
  // (siehe hatGesetzl2Spalte): ein gemerktes Nein wuerde ein Isolate
  // dauerhaft auf dem alten Stand festhalten.
  const nrDa = await hatSportartSpalte(env);
  const felder = "id, name, kurz, zuschlag_cent, aktiv, " +
    (nrDa ? "dosb_sportart_nr, " : "NULL AS dosb_sportart_nr, ") +
    "(SELECT COUNT(*) FROM mitgliedschaft_sparte ms JOIN mitgliedschaft m ON m.id = ms.mitgliedschaft_id " +
    " WHERE ms.sparte_id = sparte.id AND ms.austritt IS NULL AND m.status IN ('aktiv','ruhend')) AS mitglieder";
  const sql = "SELECT " + felder + " FROM sparte"
    + (nurEigene ? " WHERE id IN (" + rolle.sparten.map(() => "?").join(",") + ")" : "")
    + " ORDER BY sortierung, name";
  const st = nurEigene && rolle.sparten.length
    ? env.VV_DB.prepare(sql).bind(...rolle.sparten)
    : env.VV_DB.prepare(nurEigene ? "SELECT " + felder + " FROM sparte WHERE 1=0" : sql);

  const r = await st.all();
  return json({ sparten: r.results || [] }, 200, corsHeaders);
}

// ---------------------------------------------------------------------
// STUFE 1 -- Mitglieder bearbeiten
// ---------------------------------------------------------------------

// Felder, die geaendert werden duerfen -- als Weissliste, nicht als
// Sperrliste. Was hier nicht steht, kommt auch dann nicht in die
// Datenbank, wenn es im Body mitgeschickt wird.
const PERSON_FELDER = ["vorname", "nachname", "geburtsdatum", "geburtsort", "geschlecht",
                       "strasse", "plz", "ort", "email", "telefon", "mobil", "bemerkung"];

// Diese Felder darf ein Abteilungsleiter NICHT anfassen. Kontaktdaten
// seiner Spartenmitglieder zu pflegen ist sein Auftrag; ob jemand
// Ehrenmitglied wird oder wann er eingetreten ist, entscheidet der
// Verein und nicht die Abteilung.
const MITGLIEDSCHAFT_FELDER = ["art", "eintritt", "status", "ermaessigt",
                               "ermaessigt_grund", "nachweis_geprueft_am",
                               "nachweis_gueltig_bis",
                               "beitragsklasse_id", "familienbeitrag"];

// familienbeitrag ist NOT NULL. Die allgemeine Regel "leerer Text wird
// NULL" wuerde die Spalte verletzen, deshalb hier eine eigene Umsetzung.
function feldWert(feld, wert) {
  if (feld === "familienbeitrag") return (wert === 1 || wert === "1" || wert === true) ? 1 : 0;
  if (feld === "ermaessigt") return (wert === 1 || wert === "1" || wert === true) ? 1 : 0;
  return wert === "" ? null : wert;
}

async function protokolliere(env, username, aktion, typ, id, detail) {
  try {
    await env.VV_DB.prepare(
      "INSERT INTO protokoll (id, zeit, username, aktion, objekt_typ, objekt_id, detail_json) VALUES (?,?,?,?,?,?,?)"
    ).bind(uuid(), new Date().toISOString(), username, aktion, typ, id,
           detail ? JSON.stringify(detail) : null).run();
  } catch {
    // Ein fehlgeschlagener Protokolleintrag darf den fachlichen Vorgang
    // nicht zurueckrollen -- der ist zu dem Zeitpunkt bereits gespeichert.
  }
}

async function handleMitgliedDetail(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfPersonenSehen) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const id = String(body.id || "");
  if (!id) return json({ error: "Keine Mitgliedschaft angegeben" }, 400, corsHeaders);
  if (!(await darfMitgliedschaftSehen(env, rolle, id))) {
    return json({ error: "Nicht berechtigt fuer diese Mitgliedschaft" }, 403, corsHeaders);
  }

  const zeile = await env.VV_DB.prepare(
    "SELECT m.id, m.mitgliedsnummer, m.art, m.eintritt, m.austritt, m.austritt_grund, " +
    "       m.kuendigung_am, m.status, m.beschluss_am, m.beschluss_von, " +
    "       m.ermaessigt, m.ermaessigt_grund, m.nachweis_geprueft_am, m.nachweis_gueltig_bis, " +
    "       m.beitragsklasse_id, m.familienbeitrag, " +
    "       p.id AS person_id, p.vorname, p.nachname, p.geburtsdatum, p.geburtsort, " +
    "       p.geschlecht, " +
    "       p.strasse, p.plz, p.ort, p.email, p.telefon, p.mobil, p.bemerkung, " +
    "       p.zusatz_json, p.haushalt_id " +
    "FROM mitgliedschaft m JOIN person p ON p.id = m.person_id WHERE m.id = ?"
  ).bind(id).first();
  if (!zeile) return json({ error: "Nicht gefunden" }, 404, corsHeaders);

  // Sparten: fuer Abteilungsleiter nur die eigenen.
  const nurEigene = !rolle.istAdmin
    && rolle.rollen.includes("abteilungsleiter")
    && !rolle.rollen.includes("geschaeftsstelle")
    && !rolle.rollen.includes("schatzmeister");
  const spSql = "SELECT ms.id, ms.sparte_id, s.name, ms.eintritt, ms.austritt, " +
                "COALESCE(ms.zuschlag_cent, s.zuschlag_cent) AS zuschlag_cent " +
                "FROM mitgliedschaft_sparte ms JOIN sparte s ON s.id = ms.sparte_id " +
                "WHERE ms.mitgliedschaft_id = ?" +
                (nurEigene ? " AND ms.sparte_id IN (" + rolle.sparten.map(() => "?").join(",") + ")" : "") +
                " ORDER BY s.sortierung";
  const sp = await env.VV_DB.prepare(spSql)
    .bind(id, ...(nurEigene ? rolle.sparten : [])).all();

  // Beitragsklassen nur fuer die, die sie auch aendern duerfen. Ein
  // Abteilungsleiter bekommt die Liste gar nicht erst geliefert.
  const klassen = rolle.darfSchreiben
    ? await ladeKlassenMitSatz(env, new Date().getUTCFullYear() + "-01-01")
    : [];

  // Die Beitragsart aus dem Altbestand mitgeben: sie erklaert, warum ein
  // Mitglied in seiner Klasse steht, und ist die einzige Quelle fuer die
  // Faelle, in denen Klasse und Alter auseinandergehen.
  let altBeitragsart = null;
  try {
    const z = JSON.parse(zeile.zusatz_json || "{}");
    altBeitragsart = z.Beitragsart || null;
  } catch { altBeitragsart = null; }
  delete zeile.zusatz_json;

  return json({
    mitglied: zeile,
    sparten: sp.results || [],
    beitragsklassen: klassen,
    altBeitragsart,
    darfMitgliedschaftAendern: rolle.darfSchreiben,
    darfKontaktAendern: rolle.darfSchreiben || rolle.rollen.includes("abteilungsleiter"),
    eingeschraenkt: nurEigene
  }, 200, corsHeaders);
}

async function handleMitgliedSpeichern(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  const istAbtLeiter = rolle.rollen.includes("abteilungsleiter");
  if (!rolle.darfSchreiben && !istAbtLeiter) {
    return json({ error: "Nicht berechtigt zum Bearbeiten" }, 403, corsHeaders);
  }

  const id = String(body.id || "");
  if (!id) return json({ error: "Keine Mitgliedschaft angegeben" }, 400, corsHeaders);
  if (!(await darfMitgliedschaftSehen(env, rolle, id))) {
    return json({ error: "Nicht berechtigt fuer diese Mitgliedschaft" }, 403, corsHeaders);
  }

  const vorher = await env.VV_DB.prepare(
    "SELECT m.id, m.person_id FROM mitgliedschaft m WHERE m.id = ?"
  ).bind(id).first();
  if (!vorher) return json({ error: "Nicht gefunden" }, 404, corsHeaders);

  const jetzt = new Date().toISOString();
  const anweisungen = [];
  const geaendert = [];

  const pSetz = [], pWerte = [];
  PERSON_FELDER.forEach((f) => {
    if (Object.prototype.hasOwnProperty.call(body, f)) {
      pSetz.push(f + " = ?");
      pWerte.push(body[f] === "" ? null : body[f]);
      geaendert.push("person." + f);
    }
  });
  if (pSetz.length) {
    anweisungen.push(env.VV_DB.prepare(
      "UPDATE person SET " + pSetz.join(", ") + ", geaendert_am = ?, geaendert_von = ? WHERE id = ?"
    ).bind(...pWerte, jetzt, me.username, vorher.person_id));
  }

  // Mitgliedschaftsdaten bleiben der Geschaeftsstelle vorbehalten. Ein
  // Abteilungsleiter, der sie mitschickt, bekommt sie serverseitig
  // verworfen -- nicht nur ein ausgegrautes Feld im Formular.
  const mSetz = [], mWerte = [];
  if (rolle.darfSchreiben) {
    MITGLIEDSCHAFT_FELDER.forEach((f) => {
      if (Object.prototype.hasOwnProperty.call(body, f)) {
        mSetz.push(f + " = ?");
        mWerte.push(feldWert(f, body[f]));
        geaendert.push("mitgliedschaft." + f);
      }
    });
  }
  if (mSetz.length) {
    anweisungen.push(env.VV_DB.prepare(
      "UPDATE mitgliedschaft SET " + mSetz.join(", ") + ", geaendert_am = ?, geaendert_von = ? WHERE id = ?"
    ).bind(...mWerte, jetzt, me.username, id));
  }

  if (!anweisungen.length) {
    return json({ ok: true, geaendert: [], hinweis: "Nichts zu speichern" }, 200, corsHeaders);
  }

  await env.VV_DB.batch(anweisungen);
  await protokolliere(env, me.username, "mitglied-geaendert", "mitgliedschaft", id, { felder: geaendert });

  return json({ ok: true, geaendert }, 200, corsHeaders);
}

// Austritt nach Satzung § 5 Abs. 2. Der Termin wird NICHT uebernommen,
// sondern aus dem Eingang der Kuendigung berechnet -- er ist durch die
// Satzung festgelegt und nicht verhandelbar.
async function handleAustritt(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfSchreiben) {
    return json({ error: "Nur die Geschaeftsstelle kann einen Austritt erfassen" }, 403, corsHeaders);
  }

  const id = String(body.id || "");
  const kuendigung = String(body.kuendigung_am || "").slice(0, 10);
  const grund = ["austritt", "ausschluss", "tod", "streichung"].includes(body.grund)
    ? body.grund : "austritt";

  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(kuendigung)) {
    return json({ error: "Mitgliedschaft und Eingangsdatum der Kuendigung erforderlich" }, 400, corsHeaders);
  }

  // Tod und Ausschluss enden sofort -- die Kuendigungsfrist des § 5 Abs. 2
  // gilt nur fuer den Austritt auf eigenen Wunsch.
  const termin = (grund === "tod" || grund === "ausschluss")
    ? kuendigung
    : naechsterAustrittstermin(kuendigung);
  if (!termin) return json({ error: "Kein gueltiger Austrittstermin ermittelbar" }, 400, corsHeaders);

  const jetzt = new Date().toISOString();
  await env.VV_DB.batch([
    env.VV_DB.prepare(
      "UPDATE mitgliedschaft SET austritt = ?, austritt_grund = ?, kuendigung_am = ?, " +
      "status = ?, geaendert_am = ?, geaendert_von = ? WHERE id = ?"
    ).bind(termin, grund, kuendigung,
           (grund === "tod" || grund === "ausschluss") ? "beendet" : "gekuendigt",
           jetzt, me.username, id),
    // Spartenzugehoerigkeiten enden mit der Mitgliedschaft, sonst taucht
    // die Person weiter in den Abteilungslisten auf.
    env.VV_DB.prepare(
      "UPDATE mitgliedschaft_sparte SET austritt = ?, geaendert_am = ?, geaendert_von = ? " +
      "WHERE mitgliedschaft_id = ? AND austritt IS NULL"
    ).bind(termin, jetzt, me.username, id)
  ]);

  await protokolliere(env, me.username, "austritt-erfasst", "mitgliedschaft", id,
                      { kuendigung, termin, grund });

  return json({ ok: true, austritt: termin, grund }, 200, corsHeaders);
}

// Vorschau fuer die Oberflaeche: welcher Termin ergibt sich aus einem
// Eingangsdatum? Reine Rechnung, kein Schreibzugriff.
async function handleAustrittVorschau(body, env, me, corsHeaders) {
  const kuendigung = String(body.kuendigung_am || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(kuendigung)) {
    return json({ error: "Datum erforderlich" }, 400, corsHeaders);
  }
  return json({ kuendigung_am: kuendigung, austritt: naechsterAustrittstermin(kuendigung) }, 200, corsHeaders);
}

// ---------------------------------------------------------------------
// STUFE 1 -- Mitglied anlegen, Sparten zuordnen, Bestand importieren
// ---------------------------------------------------------------------

const ARTEN = new Set(["ordentlich", "ausserordentlich", "ehrenmitglied"]);
const STATUS_WERTE = new Set(["antrag", "aktiv", "ruhend", "gekuendigt", "beendet"]);

function istIsoDatum(wert) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(wert || ""));
}

function sauber(wert, max) {
  const t = String(wert === null || wert === undefined ? "" : wert).trim();
  if (!t) return null;
  return t.slice(0, max || 200);
}

// Naechste freie rein numerische Mitgliedsnummer. Der GLOB-Filter haelt
// die Nummern des Belastungstests ("T417293841") heraus -- sonst haenge
// die Vergabe fuer immer an einer neunstelligen Zufallszahl fest.
async function naechsteMitgliedsnummer(env) {
  const r = await env.VV_DB.prepare(
    "SELECT MAX(CAST(mitgliedsnummer AS INTEGER)) AS hoechste FROM mitgliedschaft " +
    "WHERE mitgliedsnummer GLOB '[0-9]*'"
  ).first();
  const hoechste = r && r.hoechste ? Number(r.hoechste) : 0;
  return String(Math.max(hoechste, 999) + 1);
}

// Legt Haushalt, Person und Mitgliedschaft an. Die Reihenfolge ist
// zwingend, weil person.haushalt_id und haushalt.zahler_person_id
// aufeinander zeigen: Haushalt OHNE Zahler, dann Person, dann den Zahler
// per UPDATE nachtragen. Andersherum schlaegt die Fremdschluesselpruefung
// zu -- D1 hat sie standardmaessig an.
function anweisungenFuerNeuesMitglied(env, satz, jetzt, username) {
  const haushaltId = satz.haushalt_id || uuid();
  const personId = uuid();
  const mgsId = uuid();
  const an = [];

  if (!satz.haushalt_id) {
    an.push(env.VV_DB.prepare(
      "INSERT INTO haushalt (id, bezeichnung, zahlungsweise, zahlungsart, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?)"
    ).bind(haushaltId, satz.haushalt_schluessel || null, "jaehrlich", "lastschrift", jetzt, username));
  }

  an.push(env.VV_DB.prepare(
    "INSERT INTO person (id, haushalt_id, vorname, nachname, geburtsdatum, geburtsort, " +
    "geschlecht, strasse, plz, ort, email, telefon, mobil, bemerkung, zusatz_json, " +
    "erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(personId, haushaltId, satz.vorname, satz.nachname, satz.geburtsdatum,
         satz.geburtsort || null, satz.geschlecht,
         satz.strasse, satz.plz, satz.ort, satz.email, satz.telefon, satz.mobil,
         satz.bemerkung, satz.zusatz_json, jetzt, username));

  // Nur wenn der Haushalt neu ist. Bei einem bestehenden bleibt der
  // bereits eingetragene Zahler stehen -- sonst wandert die Zahlerrolle
  // beim Import mit jedem weiteren Familienmitglied weiter.
  if (!satz.haushalt_id) {
    an.push(env.VV_DB.prepare(
      "UPDATE haushalt SET zahler_person_id = ? WHERE id = ?"
    ).bind(personId, haushaltId));
  }

  an.push(env.VV_DB.prepare(
    "INSERT INTO mitgliedschaft (id, person_id, mitgliedsnummer, art, eintritt, austritt, " +
    "status, beschluss_am, ermaessigt, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(mgsId, personId, satz.mitgliedsnummer, satz.art, satz.eintritt, satz.austritt,
         satz.status, satz.beschluss_am, satz.ermaessigt ? 1 : 0, jetzt, username));

  for (const sparteId of satz.sparten || []) {
    an.push(env.VV_DB.prepare(
      "INSERT INTO mitgliedschaft_sparte (id, mitgliedschaft_id, sparte_id, eintritt, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?)"
    ).bind(uuid(), mgsId, sparteId, satz.eintritt, jetzt, username));
  }

  // Die Mandatsreferenz ist der kritischste Posten der ganzen Migration:
  // geht sie verloren, braucht es von jedem Mitglied ein neues SEPA-Mandat
  // auf Papier. Sie wird deshalb unveraendert uebernommen, nie neu vergeben.
  if (!satz.haushalt_id && satz.iban) {
    an.push(env.VV_DB.prepare(
      "INSERT INTO sepa_mandat (id, haushalt_id, referenz, kontoinhaber, iban, bic, erteilt_am, quelle, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).bind(uuid(), haushaltId, satz.mandatsreferenz || ("M-" + satz.mitgliedsnummer),
           satz.kontoinhaber || (satz.vorname + " " + satz.nachname),
           satz.iban, satz.bic, satz.mandat_erteilt_am || satz.eintritt,
           "import", jetzt, username));
  }

  return { anweisungen: an, mgsId, personId, haushaltId };
}

// Baut aus einem Rohsatz des Clients einen geprueften Datensatz. Gibt
// entweder { satz } oder { fehler } zurueck -- nie halb geprueftes.
function pruefeMitgliedssatz(roh) {
  const vorname = sauber(roh.vorname, 80);
  const nachname = sauber(roh.nachname, 80);
  if (!vorname || !nachname) return { fehler: "Vorname und Nachname sind erforderlich" };

  const eintritt = sauber(roh.eintritt, 10);
  if (eintritt && !istIsoDatum(eintritt)) return { fehler: "Eintritt ist kein gueltiges Datum: " + eintritt };

  const geburtsdatum = sauber(roh.geburtsdatum, 10);
  if (geburtsdatum && !istIsoDatum(geburtsdatum)) return { fehler: "Geburtsdatum ist kein gueltiges Datum: " + geburtsdatum };

  const austritt = sauber(roh.austritt, 10);
  if (austritt && !istIsoDatum(austritt)) return { fehler: "Austritt ist kein gueltiges Datum: " + austritt };

  const geschlecht = ["w", "m", "d"].includes(roh.geschlecht) ? roh.geschlecht : null;

  return {
    satz: {
      vorname, nachname, geburtsdatum, geschlecht,
      geburtsort: sauber(roh.geburtsort, 80),
      strasse: sauber(roh.strasse, 120),
      plz: sauber(roh.plz, 10),
      ort: sauber(roh.ort, 80),
      email: sauber(roh.email, 120),
      telefon: sauber(roh.telefon, 40),
      mobil: sauber(roh.mobil, 40),
      bemerkung: sauber(roh.bemerkung, 500),
      zusatz_json: roh.zusatz && Object.keys(roh.zusatz).length ? JSON.stringify(roh.zusatz) : null,
      mitgliedsnummer: sauber(roh.mitgliedsnummer, 30),
      art: ARTEN.has(roh.art) ? roh.art : "ordentlich",
      // Ohne Eintrittsdatum waere die Spalte NOT NULL verletzt. Statt den
      // ganzen Satz abzulehnen faellt er auf den Jahresanfang zurueck --
      // das ist beim Altbestand haeufig und in der Sache richtiger als
      // ein abgebrochener Import.
      eintritt: eintritt || (new Date().getFullYear() + "-01-01"),
      austritt,
      status: STATUS_WERTE.has(roh.status) ? roh.status : (austritt ? "beendet" : "aktiv"),
      beschluss_am: istIsoDatum(roh.beschluss_am) ? roh.beschluss_am : null,
      ermaessigt: !!roh.ermaessigt,
      iban: sauber(roh.iban, 40),
      bic: sauber(roh.bic, 20),
      kontoinhaber: sauber(roh.kontoinhaber, 120),
      mandatsreferenz: sauber(roh.mandatsreferenz, 35),
      mandat_erteilt_am: istIsoDatum(roh.mandat_erteilt_am) ? roh.mandat_erteilt_am : null,
      sparten_namen: Array.isArray(roh.sparten) ? roh.sparten.map((x) => String(x).trim()).filter(Boolean) : []
    }
  };
}

async function handleMitgliedAnlegen(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfSchreiben) {
    return json({ error: "Nur die Geschaeftsstelle kann Mitglieder anlegen" }, 403, corsHeaders);
  }

  const geprueft = pruefeMitgliedssatz(body);
  if (geprueft.fehler) return json({ error: geprueft.fehler }, 400, corsHeaders);
  const satz = geprueft.satz;

  if (!satz.mitgliedsnummer) satz.mitgliedsnummer = await naechsteMitgliedsnummer(env);

  const vorhanden = await env.VV_DB
    .prepare("SELECT id FROM mitgliedschaft WHERE mitgliedsnummer = ?")
    .bind(satz.mitgliedsnummer).first();
  if (vorhanden) {
    return json({ error: "Mitgliedsnummer " + satz.mitgliedsnummer + " ist bereits vergeben" }, 409, corsHeaders);
  }

  // Sparten kommen hier als IDs aus der Auswahlliste, nicht als Namen.
  satz.sparten = Array.isArray(body.sparte_ids) ? body.sparte_ids.map(String).filter(Boolean) : [];

  const jetzt = new Date().toISOString();
  const gebaut = anweisungenFuerNeuesMitglied(env, satz, jetzt, me.username);
  await env.VV_DB.batch(gebaut.anweisungen);
  await protokolliere(env, me.username, "mitglied-angelegt", "mitgliedschaft", gebaut.mgsId,
                      { mitgliedsnummer: satz.mitgliedsnummer });

  return json({ ok: true, id: gebaut.mgsId, mitgliedsnummer: satz.mitgliedsnummer }, 200, corsHeaders);
}

// Sparte zuordnen oder beenden. Bewusst der Geschaeftsstelle vorbehalten:
// ein Abteilungsleiter darf die Kontaktdaten seiner Leute pflegen, aber
// nicht bestimmen, wer zu seiner Abteilung gehoert -- und erst recht nicht
// jemanden in eine fremde Sparte schreiben.
async function handleSparteZuordnen(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfSchreiben) {
    return json({ error: "Nur die Geschaeftsstelle kann Sparten zuordnen" }, 403, corsHeaders);
  }

  const id = String(body.id || "");
  const sparteId = String(body.sparte_id || "");
  const beenden = body.aktion === "beenden";
  if (!id || !sparteId) return json({ error: "Mitgliedschaft und Sparte erforderlich" }, 400, corsHeaders);

  const datum = istIsoDatum(body.datum) ? body.datum : null;
  const jetzt = new Date().toISOString();

  if (beenden) {
    const stichtag = datum || jetzt.slice(0, 10);
    await env.VV_DB.prepare(
      "UPDATE mitgliedschaft_sparte SET austritt = ?, geaendert_am = ?, geaendert_von = ? " +
      "WHERE mitgliedschaft_id = ? AND sparte_id = ? AND austritt IS NULL"
    ).bind(stichtag, jetzt, me.username, id, sparteId).run();
    await protokolliere(env, me.username, "sparte-beendet", "mitgliedschaft", id, { sparteId, stichtag });
    return json({ ok: true, beendet: stichtag }, 200, corsHeaders);
  }

  // Der Eindeutigkeitsindex idx_mgspa_aktiv verhindert eine zweite offene
  // Zeile ohnehin. Die Vorabpruefung ist nur da, um statt eines rohen
  // Datenbankfehlers einen verstaendlichen Satz zu liefern.
  const offen = await env.VV_DB.prepare(
    "SELECT 1 AS x FROM mitgliedschaft_sparte WHERE mitgliedschaft_id = ? AND sparte_id = ? AND austritt IS NULL"
  ).bind(id, sparteId).first();
  if (offen) return json({ error: "Diese Sparte ist bereits zugeordnet" }, 409, corsHeaders);

  const eintritt = datum || jetzt.slice(0, 10);
  await env.VV_DB.prepare(
    "INSERT INTO mitgliedschaft_sparte (id, mitgliedschaft_id, sparte_id, eintritt, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?)"
  ).bind(uuid(), id, sparteId, eintritt, jetzt, me.username).run();
  await protokolliere(env, me.username, "sparte-zugeordnet", "mitgliedschaft", id, { sparteId, eintritt });

  return json({ ok: true, eintritt }, 200, corsHeaders);
}

// ---------------------------------------------------------------------
// Import -- MENGENBASIERT
// ---------------------------------------------------------------------
//
// Die erste Fassung dieses Imports fragte je Zeile nach: vorhandene
// Mitgliedsnummer, Haushalt, Person, offene Sparten, Mandat. Bei 40
// Zeilen je Aufruf waren das rund 200 Datenbankrundlaeufe nacheinander,
// und der Worker starb an der reinen Wartezeit -- ohne CORS-Kopfzeilen,
// weshalb im Browser nur "Server nicht erreichbar" ankam.
//
// Es ist derselbe Fehler, den der Belastungstest weiter unten am
// Beitragslauf gemessen hat. Deshalb gilt hier dieselbe Regel:
// **eine feste Zahl Abfragen je BLOCK, nie eine je Zeile.**
//
//   1 Abfrage  Sparten
//   1 Abfrage  vorhandene Mitgliedsnummern des Blocks
//   1 Abfrage  Haushalte des Blocks           (nur mit Haushaltsbildung)
//   3 Abfragen Personen / Sparten / Mandate   (nur beim Ergaenzen)
//   1 batch    alle Schreibvorgaenge zusammen
//
// Macht hoechstens sieben Rundlaeufe fuer 40 Mitglieder statt 200.

const IMPORT_BLOCK = 40;

// Nur Felder, die beim Import ueberhaupt nachtragbar sind.
const ERGAENZBAR_PERSON = ["geburtsdatum", "geschlecht", "strasse", "plz", "ort",
                           "email", "telefon", "mobil"];

// Hilfe fuer IN-Listen. Der Block ist auf IMPORT_BLOCK begrenzt, damit
// die Parametergrenze von SQLite nicht in Sicht kommt.
function platzhalter(n) {
  return new Array(n).fill("?").join(",");
}

// Traegt in einen vorhandenen Datensatz nach, was dort noch leer ist.
// Ueberschreibt NIE einen vorhandenen Wert: die Vereinsmeister-Listen
// kommen in mehreren Fassungen, und die aeltere darf die neuere nicht
// verdraengen.
//
// Bekommt alles Gelesene als Parameter -- diese Funktion fragt selbst
// nichts mehr ab. Genau daran ist die erste Fassung gescheitert.
function ergaenzungsAnweisungen(env, satz, vorhanden, person, offeneSparten, hatMandat, jetzt, username) {
  const geaendert = [];
  const anweisungen = [];

  const setz = [], werte = [];
  ERGAENZBAR_PERSON.forEach((f) => {
    if (satz[f] && person && !person[f]) {
      setz.push(f + " = ?");
      werte.push(satz[f]);
      geaendert.push(f);
    }
  });

  // Auffangfeld zusammenfuehren statt ersetzen -- sonst verliert die
  // zweite Datei die Zusatzangaben der ersten.
  if (satz.zusatz_json) {
    let zusammen = {};
    try { zusammen = JSON.parse((person && person.zusatz_json) || "{}"); } catch { zusammen = {}; }
    const neu = JSON.parse(satz.zusatz_json);
    let dazu = 0;
    Object.keys(neu).forEach((k) => { if (zusammen[k] === undefined) { zusammen[k] = neu[k]; dazu++; } });
    if (dazu) {
      setz.push("zusatz_json = ?");
      werte.push(JSON.stringify(zusammen));
      geaendert.push(dazu + " Zusatzangaben");
    }
  }

  if (setz.length) {
    anweisungen.push(env.VV_DB.prepare(
      "UPDATE person SET " + setz.join(", ") + ", geaendert_am = ?, geaendert_von = ? WHERE id = ?"
    ).bind(...werte, jetzt, username, vorhanden.person_id));
  }

  // Sparten: nur die hinzufuegen, die noch nicht offen zugeordnet sind.
  let neueSparten = 0;
  (satz.sparten || []).forEach((sparteId) => {
    if (offeneSparten.has(sparteId)) return;
    offeneSparten.add(sparteId);   // schuetzt vor Dubletten im selben Block
    neueSparten++;
    anweisungen.push(env.VV_DB.prepare(
      "INSERT INTO mitgliedschaft_sparte (id, mitgliedschaft_id, sparte_id, eintritt, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?)"
    ).bind(uuid(), vorhanden.id, sparteId, satz.eintritt, jetzt, username));
  });
  if (neueSparten) geaendert.push(neueSparten + (neueSparten === 1 ? " Sparte" : " Sparten"));

  // Bankverbindung nur anlegen, wenn der Haushalt noch kein gueltiges
  // Mandat hat. Ein bestehendes wird nie angefasst -- daran haengt der
  // Einzug, und ein Import ist kein Grund, es zu ersetzen.
  if (satz.iban && vorhanden.haushalt_id && !hatMandat) {
    anweisungen.push(env.VV_DB.prepare(
      "INSERT INTO sepa_mandat (id, haushalt_id, referenz, kontoinhaber, iban, bic, erteilt_am, quelle, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).bind(uuid(), vorhanden.haushalt_id, satz.mandatsreferenz || ("M-" + satz.mitgliedsnummer),
           satz.kontoinhaber || (satz.vorname + " " + satz.nachname),
           satz.iban, satz.bic, satz.mandat_erteilt_am || satz.eintritt,
           "import", jetzt, username));
    geaendert.push("Bankverbindung");
  }

  return { geaendert, anweisungen };
}

async function handleImport(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfSchreiben) {
    return json({ error: "Nur die Geschaeftsstelle kann Daten importieren" }, 403, corsHeaders);
  }

  const roh = Array.isArray(body.saetze) ? body.saetze : [];
  if (!roh.length) return json({ error: "Keine Datensaetze uebergeben" }, 400, corsHeaders);
  if (roh.length > IMPORT_BLOCK) {
    return json({ error: "Hoechstens " + IMPORT_BLOCK + " Saetze je Aufruf" }, 400, corsHeaders);
  }

  const nurPruefen = !!body.pruefen;
  const haushalteBilden = !!body.haushalte_bilden;
  const ergaenzen = !!body.ergaenzen;
  const spartenAnlegen = !!body.sparten_anlegen;

  const jetzt = new Date().toISOString();
  const ergebnisse = [];
  const anweisungen = [];
  const angelegteSparten = [];
  let angelegt = 0, uebersprungen = 0, fehlerhaft = 0;

  // ---- Schritt 1: alles pruefen, ohne einen einzigen Datenbankzugriff
  const gute = [];
  roh.forEach((r, i) => {
    const zeile = r.zeile || (i + 1);
    const geprueft = pruefeMitgliedssatz(r);
    if (geprueft.fehler) {
      ergebnisse.push({ zeile, status: "fehler", text: geprueft.fehler });
      fehlerhaft++;
      return;
    }
    if (!geprueft.satz.mitgliedsnummer) {
      ergebnisse.push({ zeile, status: "fehler",
                        text: "Ohne Mitgliedsnummer ist ein wiederholbarer Import nicht moeglich" });
      fehlerhaft++;
      return;
    }
    gute.push({ zeile, satz: geprueft.satz });
  });

  if (!gute.length) {
    return json({ ok: true, pruefung: nurPruefen, angelegt, uebersprungen, fehlerhaft,
                  neueSparten: [], ergebnisse }, 200, corsHeaders);
  }

  // ---- Schritt 2: Sparten (1 Abfrage)
  const sp = await env.VV_DB.prepare("SELECT id, name FROM sparte").all();
  const nachName = new Map();
  for (const s of sp.results || []) nachName.set(s.name.toLowerCase(), s.id);

  gute.forEach((g) => {
    const unbekannt = [];
    g.satz.sparten = [];
    for (const name of g.satz.sparten_namen) {
      let id = nachName.get(name.toLowerCase());
      if (!id && spartenAnlegen) {
        id = uuid();
        nachName.set(name.toLowerCase(), id);
        angelegteSparten.push(name);
        // Ganz vorn im batch: die Zuordnungen weiter unten verweisen
        // darauf, und die Fremdschluesselpruefung ist aktiv.
        anweisungen.push(env.VV_DB.prepare(
          "INSERT INTO sparte (id, name, sortierung, aktiv, zuschlag_cent, erstellt_am, erstellt_von) VALUES (?,?,?,1,0,?,?)"
        ).bind(id, name, 500 + angelegteSparten.length, jetzt, me.username));
      }
      if (id) g.satz.sparten.push(id); else unbekannt.push(name);
    }
    g.hinweis = unbekannt.length ? " — unbekannte Sparte: " + unbekannt.join(", ") : "";
  });

  // ---- Schritt 3: vorhandene Mitgliedsnummern (1 Abfrage)
  const nummern = gute.map((g) => g.satz.mitgliedsnummer);
  const vorhandeneAbfrage = await env.VV_DB.prepare(
    "SELECT m.id, m.person_id, m.mitgliedsnummer, p.haushalt_id FROM mitgliedschaft m " +
    "JOIN person p ON p.id = m.person_id WHERE m.mitgliedsnummer IN (" + platzhalter(nummern.length) + ")"
  ).bind(...nummern).all();

  const vorhandene = new Map();
  for (const z of vorhandeneAbfrage.results || []) vorhandene.set(z.mitgliedsnummer, z);

  const neue = [], zuErgaenzen = [];
  gute.forEach((g) => {
    const da = vorhandene.get(g.satz.mitgliedsnummer);
    if (!da) { neue.push(g); return; }
    if (!ergaenzen) {
      ergebnisse.push({ zeile: g.zeile, status: "uebersprungen",
                        text: "Mitgliedsnummer " + g.satz.mitgliedsnummer + " ist bereits vorhanden" });
      uebersprungen++;
      return;
    }
    g.vorhanden = da;
    zuErgaenzen.push(g);
  });

  // ---- Schritt 4: Ergaenzen -- drei Abfragen fuer den ganzen Block
  if (zuErgaenzen.length) {
    const personIds = zuErgaenzen.map((g) => g.vorhanden.person_id);
    const mgsIds = zuErgaenzen.map((g) => g.vorhanden.id);
    const haushaltIds = Array.from(new Set(
      zuErgaenzen.map((g) => g.vorhanden.haushalt_id).filter(Boolean)));

    const personenAbfrage = await env.VV_DB.prepare(
      "SELECT id, geburtsdatum, geschlecht, strasse, plz, ort, email, telefon, mobil, zusatz_json " +
      "FROM person WHERE id IN (" + platzhalter(personIds.length) + ")"
    ).bind(...personIds).all();
    const personen = new Map();
    for (const p of personenAbfrage.results || []) personen.set(p.id, p);

    const spartenAbfrage = await env.VV_DB.prepare(
      "SELECT mitgliedschaft_id, sparte_id FROM mitgliedschaft_sparte " +
      "WHERE austritt IS NULL AND mitgliedschaft_id IN (" + platzhalter(mgsIds.length) + ")"
    ).bind(...mgsIds).all();
    const offeneSparten = new Map();
    for (const z of spartenAbfrage.results || []) {
      if (!offeneSparten.has(z.mitgliedschaft_id)) offeneSparten.set(z.mitgliedschaft_id, new Set());
      offeneSparten.get(z.mitgliedschaft_id).add(z.sparte_id);
    }

    const mitMandat = new Set();
    if (haushaltIds.length) {
      const mandatAbfrage = await env.VV_DB.prepare(
        "SELECT haushalt_id FROM sepa_mandat WHERE widerrufen_am IS NULL " +
        "AND haushalt_id IN (" + platzhalter(haushaltIds.length) + ")"
      ).bind(...haushaltIds).all();
      for (const z of mandatAbfrage.results || []) mitMandat.add(z.haushalt_id);
    }

    zuErgaenzen.forEach((g) => {
      const offen = offeneSparten.get(g.vorhanden.id) || new Set();
      offeneSparten.set(g.vorhanden.id, offen);
      const hatMandat = mitMandat.has(g.vorhanden.haushalt_id);
      const e = ergaenzungsAnweisungen(env, g.satz, g.vorhanden,
        personen.get(g.vorhanden.person_id), offen, hatMandat, jetzt, me.username);

      // Ein Haushalt bekommt genau EIN Mandat -- auch wenn zwei
      // Familienmitglieder im selben Block mit IBAN ankommen.
      if (e.geaendert.indexOf("Bankverbindung") > -1) mitMandat.add(g.vorhanden.haushalt_id);

      anweisungen.push(...e.anweisungen);
      ergebnisse.push({
        zeile: g.zeile,
        status: e.geaendert.length ? "ergaenzt" : "unveraendert",
        text: g.satz.vorname + " " + g.satz.nachname + ", Nr. " + g.satz.mitgliedsnummer +
              (e.geaendert.length ? " — " + e.geaendert.join(", ") : " — nichts zu ergänzen") + g.hinweis
      });
      if (e.geaendert.length) angelegt++; else uebersprungen++;
    });
  }

  // ---- Schritt 5: Haushalte der neuen Saetze (1 Abfrage)
  const haushaltImBlock = new Map();
  if (haushalteBilden && neue.length) {
    neue.forEach((g) => {
      const s = g.satz;
      if (s.nachname && s.strasse && s.plz) {
        s.haushalt_schluessel = (s.nachname + "|" + s.strasse + "|" + s.plz).toLowerCase();
      }
    });
    const schluessel = Array.from(new Set(neue.map((g) => g.satz.haushalt_schluessel).filter(Boolean)));
    if (schluessel.length) {
      const hAbfrage = await env.VV_DB.prepare(
        "SELECT id, bezeichnung FROM haushalt WHERE bezeichnung IN (" + platzhalter(schluessel.length) + ")"
      ).bind(...schluessel).all();
      for (const h of hAbfrage.results || []) haushaltImBlock.set(h.bezeichnung, h.id);
    }
  }

  // ---- Schritt 6: neue Mitglieder aufbauen (kein Datenbankzugriff)
  neue.forEach((g) => {
    const satz = g.satz;
    if (satz.haushalt_schluessel && haushaltImBlock.has(satz.haushalt_schluessel)) {
      satz.haushalt_id = haushaltImBlock.get(satz.haushalt_schluessel);
    }

    const gebaut = anweisungenFuerNeuesMitglied(env, satz, jetzt, me.username);
    anweisungen.push(...gebaut.anweisungen);

    // Erst nach dem Bauen merken: das naechste Geschwisterkind im selben
    // Block soll denselben Haushalt bekommen, obwohl er noch gar nicht
    // geschrieben ist.
    if (satz.haushalt_schluessel && !satz.haushalt_id) {
      haushaltImBlock.set(satz.haushalt_schluessel, gebaut.haushaltId);
    }

    ergebnisse.push({
      zeile: g.zeile,
      status: nurPruefen ? "bereit" : "angelegt",
      text: satz.vorname + " " + satz.nachname + ", Nr. " + satz.mitgliedsnummer + g.hinweis
    });
    angelegt++;
  });

  // ---- Schritt 7: EIN Schreibvorgang fuer den ganzen Block
  if (!nurPruefen && anweisungen.length) {
    await env.VV_DB.batch(anweisungen);
    await protokolliere(env, me.username, "import", "mitgliedschaft", null,
                        { angelegt, uebersprungen, fehlerhaft, sparten: angelegteSparten });
  }

  // Die Meldungen entstehen in der Reihenfolge der Verarbeitung, nicht in
  // der der Datei. Fuer den Bericht zaehlt die Zeilennummer.
  ergebnisse.sort((a, b) => a.zeile - b.zeile);

  return json({
    ok: true, pruefung: nurPruefen,
    angelegt, uebersprungen, fehlerhaft,
    neueSparten: nurPruefen ? angelegteSparten : angelegteSparten,
    abfragen: 2 + (zuErgaenzen.length ? 3 : 0) + (haushalteBilden ? 1 : 0),
    ergebnisse
  }, 200, corsHeaders);
}

// ---------------------------------------------------------------------
// STUFE 2 (Anfang) -- Beitragsklassen
// ---------------------------------------------------------------------
//
// Die Beitragsordnung des Vereins, aus 621 Zeilen des Altbestands
// zurueckgerechnet (die Summen gehen exakt auf 39.972 EUR auf):
//
//   Erwachsener          96,00 EUR    im Familienverbund 48,00 EUR
//   Kinder/Jugendliche   72,00 EUR    im Familienverbund 36,00 EUR
//   Rentner              72,00 EUR    im Familienverbund 36,00 EUR
//
// ZWEI Festlegungen, die aus den echten Daten kommen und nicht aus einer
// Annahme:
//
//   1. Der Beitrag faellt EINMAL JE MITGLIED an, nicht je Sparte.
//      Von Michel am 29.07. bestaetigt. Der Vereinsmeister druckt ihn auf
//      jeder Spartenzeile, aber bei 85 von 86 Mehrfach-Mitgliedern steht
//      dort derselbe Betrag -- es ist eine Wiederholung, keine Addition.
//      Deshalb traegt sparte.zuschlag_cent hier ueberall 0.
//
//   2. Die Klasse haengt NICHT am Alter, sondern ist eine gepflegte
//      Angabe. Im Bestand gibt es einen 75-Jaehrigen mit Kinderbeitrag,
//      Rentner ab 48 Jahren und 71-Jaehrige, die als Erwachsene gefuehrt
//      werden. Wer die Klasse aus dem Geburtsdatum berechnet, wirft ueber
//      hundert Mitglieder in eine andere Klasse als heute -- und stellt
//      damit ungefragt Beitraege um. Die Klasse wird deshalb uebernommen
//      und ist von Hand aenderbar; das Alter liefert beim Neuanlegen nur
//      einen VORSCHLAG.
//
// Der Familienverbund kommt ebenfalls aus der Altdatei und NICHT aus der
// Haushaltsbildung: 87 Mitglieder haben dort einen Familienbeitrag, die
// Adressheuristik findet aber nur 58 in Mehrpersonenhaushalten. Wer den
// Rabatt aus dem Haushalt ableitet, verteuert 29 Mitgliedschaften.

const BEITRAGSKLASSEN = [
  { schluessel: "erwachsener", name: "Erwachsener",        voll: 9600, familie: 4800, sortierung: 10 },
  { schluessel: "jugend",      name: "Kinder/Jugendliche", voll: 7200, familie: 3600, sortierung: 20 },
  { schluessel: "rentner",     name: "Rentner",            voll: 7200, familie: 3600, sortierung: 30 }
];

// Aus dem Freitext der Altsoftware. Der Bestand kennt zehn Schreibweisen
// derselben drei Klassen, darunter "Kinder,Jugendliche",
// "Kinder, Jugendlicher" und den Tippfehler "Famileinbeitrag" -- beide
// Familien-Schreibweisen enthalten "famil", das reicht als Test.
//
// ⚠️ Bei Mitgliedern in zwei Sparten steht im Auffangfeld unter Umstaenden
// mehr als eine Art, durch Semikolon getrennt: "Erwachsener;Rentner".
// Es wird deshalb NUR der erste Eintrag ausgewertet -- so, wie der
// Vereinsmeister ihn auch zuerst druckt. Eine Suche ueber den ganzen
// Text haette hier stillschweigend "Rentner" gewonnen, weil die Pruefung
// darauf zuerst kommt: 24 EUR Abweichung in der Jahressumme, entstanden
// aus einer Reihenfolge im Code statt aus den Daten.
function klasseAusText(text) {
  const roh = String(text || "").trim();
  if (!roh) return null;

  const teile = roh.split(";").map((x) => x.trim()).filter(Boolean);
  const t = (teile[0] || "").toLowerCase();
  if (!t) return null;

  const familie = t.indexOf("famil") > -1;
  let schluessel = "erwachsener";
  if (t.indexOf("rentner") > -1) schluessel = "rentner";
  else if (t.indexOf("kind") > -1 || t.indexOf("jugend") > -1) schluessel = "jugend";

  // Uneinheitlich heisst: die Sparten des Mitglieds nennen verschiedene
  // Beitragsarten. Das ist kein Fehler dieser Funktion, sondern eine
  // Rueckfrage an die Geschaeftsstelle -- und wird deshalb gemeldet.
  const eindeutig = teile.length < 2
    || teile.every((x) => x.toLowerCase() === t);

  return { schluessel, familie, eindeutig, alleArten: teile };
}

// Altersvorschlag fuer NEUE Mitglieder. Ausdruecklich nur ein Vorschlag:
// die Grenze 19/20 ist aus dem Bestand abgelesen und dort selbst nicht
// sauber (es gibt 20- bis 22-Jaehrige in beiden Klassen).
function klassenVorschlag(geburtsdatum) {
  const g = String(geburtsdatum || "").slice(0, 10).split("-").map(Number);
  if (g.length !== 3 || !g[0]) return "erwachsener";
  const heute = new Date();
  let alter = heute.getUTCFullYear() - g[0];
  const monat = heute.getUTCMonth() + 1;
  if (monat < g[1] || (monat === g[1] && heute.getUTCDate() < g[2])) alter--;
  return alter < 20 ? "jugend" : "erwachsener";
}

// Fehlende Spalten nachziehen. D1 ist SQLite, ALTER TABLE ADD COLUMN
// geht -- aber nicht zweimal. Deshalb erst nachsehen, was schon da ist:
// die Aktion muss beliebig oft aufrufbar sein, sonst traut sich niemand,
// sie zu druecken.
// Absichtlich nicht admin-only: die Aktion fuehrt ausschliesslich fest
// verdrahtetes ADD COLUMN und CREATE TABLE IF NOT EXISTS aus, nimmt keine
// Eingabe entgegen, loescht nichts und ist beliebig oft aufrufbar. Am
// Admin haengend wuerde der Beitragslauf-Reiter fuer den Schatzmeister
// nur dann funktionieren, wenn vorher zufaellig ein Administrator die
// Seite geoeffnet hat.
async function handleMigration(env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  // Wer die Spalte braucht, muss an die Migration kommen -- dieselbe
  // Ueberlegung, die sie schon vom globalen Admin auf Schatzmeister und
  // Geschaeftsstelle geoeffnet hat. Seit person.geburtsort dazugehoert,
  // braucht sie auch der Abteilungsleiter: die Mitglieder-Einzelansicht
  // liest die Spalte, und ohne sie saehe er einen nackten SQL-Fehler.
  // Vertretbar bleibt es aus demselben Grund wie vorher: die Aktion
  // fuehrt ausschliesslich fest verdrahtetes ADD COLUMN und
  // CREATE TABLE IF NOT EXISTS aus, nimmt keine Eingabe entgegen und
  // loescht nichts.
  if (!rolle.istAdmin && !rolle.darfBuchen && !rolle.darfSchreiben
      && !rolle.darfPersonenSehen) {
    return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  }

  const spalten = await env.VV_DB.prepare("PRAGMA table_info(mitgliedschaft)").all();
  const da = new Set((spalten.results || []).map((s) => s.name));

  const fehlend = [];
  if (!da.has("beitragsklasse_id")) {
    fehlend.push("ALTER TABLE mitgliedschaft ADD COLUMN beitragsklasse_id TEXT REFERENCES beitragsklasse(id)");
  }
  if (!da.has("familienbeitrag")) {
    fehlend.push("ALTER TABLE mitgliedschaft ADD COLUMN familienbeitrag INTEGER NOT NULL DEFAULT 0");
  }

  // Die Optionen eines Beitragslaufs (anteilig ja/nein, Ehrenmitglieder,
  // ruhende Mitgliedschaften) gehoeren zum Lauf und nicht in den Code:
  // sonst rechnet ein Wiederaufsetzen nach anderen Regeln als der erste
  // Block -- und niemand kann spaeter belegen, wonach gerechnet wurde.
  const laufSpalten = await env.VV_DB.prepare("PRAGMA table_info(beitragslauf)").all();
  const laufDa = new Set((laufSpalten.results || []).map((s) => s.name));
  if (!laufDa.has("optionen_json")) {
    fehlend.push("ALTER TABLE beitragslauf ADD COLUMN optionen_json TEXT");
  }

  // Welche Forderungen in einer SEPA-Datei standen, muss festgehalten
  // werden: die Datei ist ein Schnappschuss. Wird spaeter eine Forderung
  // storniert, wuerde eine nachgerechnete Liste andere Posten liefern als
  // die, die tatsaechlich bei der Bank eingereicht wurden -- und die
  // Sammelbuchung buchte dann das Falsche als bezahlt.
  const dateiSpalten = await env.VV_DB.prepare("PRAGMA table_info(sepa_datei)").all();
  const dateiDa = new Set((dateiSpalten.results || []).map((s) => s.name));
  if (!dateiDa.has("forderungen_json")) {
    fehlend.push("ALTER TABLE sepa_datei ADD COLUMN forderungen_json TEXT");
  }
  if (!dateiDa.has("gebucht_am")) {
    fehlend.push("ALTER TABLE sepa_datei ADD COLUMN gebucht_am TEXT");
  }

  // Felder des Papier-Aufnahmeantrags (Stand 2026-08). Das gedruckte
  // Formular fragt sie ab, das Online-Formular tat es nicht -- und wer
  // beide nebeneinander legt, muss dasselbe Blatt sehen.
  //
  // geburtsort ist kein Beiwerk: bei zwei gleichnamigen Mitgliedern mit
  // demselben Geburtsdatum ist er das einzige unterscheidende Merkmal,
  // das der Verein hat.
  const personSpalten = await env.VV_DB.prepare("PRAGMA table_info(person)").all();
  const personDa = new Set((personSpalten.results || []).map((s) => s.name));
  const personFehlend = [];
  if (!personDa.has("geburtsort")) {
    personFehlend.push("ALTER TABLE person ADD COLUMN geburtsort TEXT");
  }
  // Die Staatsangehoerigkeit verlangt der Spielerlaubnisantrag des
  // Verbandes. Sie gehoert an die PERSON, nicht in den Antrag: beim
  // naechsten Antrag desselben Kindes -- Vereinswechsel, Namensaenderung --
  // muss sie schon dastehen, statt erneut erfragt zu werden.
  if (!personDa.has("nationalitaet")) {
    personFehlend.push("ALTER TABLE person ADD COLUMN nationalitaet TEXT");
  }

  // Das Mandat ist das rechtlich massgebliche Papier, nicht der Antrag.
  // Wer der Zahler ist, wo er wohnt und wo er unterschrieben hat, gehoert
  // deshalb an das Mandat -- ein Antrag von vor sieben Jahren ist kein
  // Ort, an dem man das nachschlaegt.
  const mandatSpalten = await env.VV_DB.prepare("PRAGMA table_info(sepa_mandat)").all();
  const mandatDa = new Set((mandatSpalten.results || []).map((s) => s.name));
  const mandatFehlend = [];
  if (!mandatDa.has("bank_name")) {
    mandatFehlend.push("ALTER TABLE sepa_mandat ADD COLUMN bank_name TEXT");
  }
  if (!mandatDa.has("kontoinhaber_anschrift")) {
    mandatFehlend.push("ALTER TABLE sepa_mandat ADD COLUMN kontoinhaber_anschrift TEXT");
  }
  if (!mandatDa.has("erteilt_ort")) {
    mandatFehlend.push("ALTER TABLE sepa_mandat ADD COLUMN erteilt_ort TEXT");
  }

  // Das Papierformular verlangt die Unterschrift ALLER Erziehungs-
  // berechtigten. Ohne eine zweite Spalte kaeme die zweite Unterschrift
  // beim Absenden an und fiele danach lautlos weg.
  const antragSpalten = await env.VV_DB.prepare("PRAGMA table_info(aufnahmeantrag)").all();
  const antragDa = new Set((antragSpalten.results || []).map((s) => s.name));
  const antragFehlend = [];
  if (!antragDa.has("unterschrift_gesetzl2_datei")) {
    antragFehlend.push("ALTER TABLE aufnahmeantrag ADD COLUMN unterschrift_gesetzl2_datei TEXT");
  }
  // Woher der Antrag kam. Eine SPALTE, nicht ein Feld im JSON: die Liste
  // im Reiter filtert und zaehlt danach, und dafuer muesste sie sonst
  // jedes einzelne JSON entpacken.
  if (!antragDa.has("quelle")) {
    antragFehlend.push("ALTER TABLE aufnahmeantrag ADD COLUMN quelle TEXT NOT NULL DEFAULT 'antrag'");
  }
  // Schluessel des abgeschotteten Bereichs, in dem die Nachweise liegen
  // (Geburtsurkunde, Spielerpass, Abmeldung). Die Dateien selbst liegen
  // in Nextcloud beim admin-worker -- hier steht nur, wo.
  if (!antragDa.has("nachweis_owner")) {
    antragFehlend.push("ALTER TABLE aufnahmeantrag ADD COLUMN nachweis_owner TEXT");
  }

  // Die Sportartennummer des DOSB, fuer die Bestandsmeldung an den
  // Landessportbund. Sie gehoert an die SPARTE und nicht in eine Tabelle
  // im Code: welche Sportart eine Abteilung meldet, ist eine Entscheidung
  // des Vereins (Turnen wird als Gymnastik gemeldet, weil es die Sportart
  // "Turnen" in der Thueringer Liste gar nicht gibt) -- und sie aendert
  // sich, ohne dass jemand deployen koennen muss.
  const sparteSpalten = await env.VV_DB.prepare("PRAGMA table_info(sparte)").all();
  const sparteDa = new Set((sparteSpalten.results || []).map((s) => s.name));
  const sparteFehlend = [];
  if (!sparteDa.has("dosb_sportart_nr")) {
    sparteFehlend.push("ALTER TABLE sparte ADD COLUMN dosb_sportart_nr INTEGER");
  }

  fehlend.push(...personFehlend, ...mandatFehlend, ...antragFehlend, ...sparteFehlend);
  for (const sql of fehlend) await env.VV_DB.prepare(sql).run();

  // Vereinsstammdaten fuer die SEPA-Datei. Eigene Tabelle statt Konstanten
  // im Code: Glaeubiger-ID und Vereins-IBAN gehoeren nicht in ein
  // oeffentliches Repository.
  await env.VV_DB.prepare(
    "CREATE TABLE IF NOT EXISTS einstellung (schluessel TEXT PRIMARY KEY, wert TEXT, " +
    "geaendert_am TEXT, geaendert_von TEXT)"
  ).run();

  // Buchhaltung (Stufe 4). Die Tabellen standen im Plan, aber nie im
  // eingespielten Schema -- die Datenbank laeuft seit Juli produktiv, ein
  // zweites Einspielen gibt es nicht. Sie entstehen deshalb hier.
  // Identisch zu Abschnitt 9 in schema.sql; bei Aenderungen BEIDE Dateien
  // und schema-kompakt.sql nachziehen.
  for (const sql of BUCHHALTUNG_SCHEMA) await env.VV_DB.prepare(sql).run();

  // ⚠️ Die Klammer gegen die doppelte Sammelbuchung. Zwei gleichzeitig
  // laufende Buchungen derselben SEPA-Datei erzeugen sonst zwei Zahlungen
  // ueber dieselbe Forderung -- und nach einer Ruecklastschrift auf eine
  // der beiden steht die Forderung auf 'bezahlt', obwohl nie Geld
  // eingegangen ist. Sie faellt damit aus den offenen Posten heraus.
  // D1 kennt kein BEGIN; die Pruefung im Code ist nicht Teil der
  // Schreibeinheit, also muss die Datenbank es entscheiden.
  //
  // ⚠️ "storniert_am IS NULL" ist zwingend, nicht Beiwerk. Ohne die
  // Bedingung blockierte der Index den legitimen Weg, eine Zahlung zu
  // stornieren und neu zu buchen -- vv-sammel-zurueck storniert, statt zu
  // loeschen (GoBD), und die stornierte Zeile bleibt stehen.
  //
  // Eigenes try/catch: stehen in einer Datenbank schon Dubletten, wirft
  // das CREATE. Ohne die Klammer risse es die ganze Migration mit -- und
  // die wird beim Oeffnen der App angestossen, die App kaeme nicht hoch.
  let zahlungIndex = "angelegt";
  try {
    await env.VV_DB.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_zahlung_sepa_eindeutig " +
      "ON zahlung(sepa_datei_id, forderung_id) " +
      "WHERE sepa_datei_id IS NOT NULL AND storniert_am IS NULL"
    ).run();
  } catch (e) {
    zahlungIndex = "nicht angelegt (vorhandene Dubletten?): " + String(e && e.message || e);
  }

  return json({ ok: true, ergaenzt: fehlend.length, zahlungIndex,
                spalten: Array.from(da) }, 200, corsHeaders);
}

const BUCHHALTUNG_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS geschaeftsjahr (id TEXT PRIMARY KEY, jahr INTEGER NOT NULL UNIQUE, " +
  "beginn TEXT NOT NULL, ende TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'offen', " +
  "abgeschlossen_am TEXT, abgeschlossen_von TEXT, ergebnis_json TEXT, " +
  "erstellt_am TEXT NOT NULL, erstellt_von TEXT NOT NULL)",

  "CREATE TABLE IF NOT EXISTS konto (id TEXT PRIMARY KEY, nummer TEXT NOT NULL UNIQUE, " +
  "name TEXT NOT NULL, art TEXT NOT NULL, sphaere TEXT, gruppe TEXT, " +
  "aktiv INTEGER NOT NULL DEFAULT 1, sortierung INTEGER NOT NULL DEFAULT 100, " +
  "erstellt_am TEXT NOT NULL, erstellt_von TEXT NOT NULL)",

  "CREATE TABLE IF NOT EXISTS geschaeftsvorfall_vorlage (id TEXT PRIMARY KEY, name TEXT NOT NULL, " +
  "erklaerung TEXT NOT NULL, soll_nummer TEXT NOT NULL, haben_nummer TEXT NOT NULL, sphaere TEXT, " +
  "sortierung INTEGER NOT NULL DEFAULT 100, aktiv INTEGER NOT NULL DEFAULT 1, " +
  "erstellt_am TEXT NOT NULL, erstellt_von TEXT NOT NULL)",

  "CREATE TABLE IF NOT EXISTS buchung (id TEXT PRIMARY KEY, " +
  "geschaeftsjahr_id TEXT NOT NULL REFERENCES geschaeftsjahr(id), belegnummer INTEGER NOT NULL, " +
  "belegdatum TEXT NOT NULL, buchungsdatum TEXT NOT NULL, text TEXT NOT NULL, " +
  "vorlage_id TEXT REFERENCES geschaeftsvorfall_vorlage(id), summe_cent INTEGER NOT NULL, " +
  "art TEXT NOT NULL DEFAULT 'normal', quelle_typ TEXT, quelle_id TEXT, " +
  "storniert_am TEXT, storniert_von TEXT, storno_von_id TEXT REFERENCES buchung(id), " +
  "storno_grund TEXT, erstellt_am TEXT NOT NULL, erstellt_von TEXT NOT NULL)",

  "CREATE TABLE IF NOT EXISTS buchungszeile (id TEXT PRIMARY KEY, " +
  "buchung_id TEXT NOT NULL REFERENCES buchung(id), konto_id TEXT NOT NULL REFERENCES konto(id), " +
  "soll_cent INTEGER NOT NULL DEFAULT 0, haben_cent INTEGER NOT NULL DEFAULT 0, " +
  "sphaere TEXT, sparte_id TEXT REFERENCES sparte(id), text TEXT)",

  "CREATE UNIQUE INDEX IF NOT EXISTS idx_buchung_beleg ON buchung(geschaeftsjahr_id, belegnummer)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_buchung_quelle ON buchung(quelle_typ, quelle_id) " +
  "WHERE quelle_typ IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_buchung_jahr ON buchung(geschaeftsjahr_id, belegdatum)",
  "CREATE INDEX IF NOT EXISTS idx_bzeile_buchung ON buchungszeile(buchung_id)",
  "CREATE INDEX IF NOT EXISTS idx_bzeile_konto ON buchungszeile(konto_id)"
];

// ---------------------------------------------------------------------
// Vereinsstammdaten
// ---------------------------------------------------------------------

const EINSTELLUNGEN = {
  verein_name:      { gruppe: "sepa", label: "Name des Vereins (Glaeubiger)", max: 70, pflicht: true },
  verein_iban:      { gruppe: "sepa", label: "IBAN des Vereinskontos", max: 34, pflicht: true, iban: true },
  verein_bic:       { gruppe: "sepa", label: "BIC des Vereinskontos", max: 11 },
  glaeubiger_id:    { gruppe: "sepa", label: "Glaeubiger-Identifikationsnummer", max: 35, pflicht: true },
  // {jahr} und {periode} werden beim Erzeugen der SEPA-Datei ersetzt.
  // Steht {periode} nicht im Muster, haengt die Rate hinten an -- ein
  // Jahreslauf setzt gar nichts ein und sieht aus wie bisher.
  verwendungszweck: { gruppe: "sepa", label: "Verwendungszweck (Platzhalter {jahr} und {periode})",
                      max: 140 },

  // Vereinsnummer beim Landesverband, fuer den Spielerlaubnisantrag.
  // ⚠️ LEER LASSEN, solange der Bogen sie vorgedruckt traegt -- ein
  // gesetzter Wert schreibt sich sonst ueber den Aufdruck. Sie steht hier
  // fuer den Fall, dass der Verband ein neutrales Formular ausgibt.
  tfv_vereinsnummer: { gruppe: "antrag", label: "Vereinsnummer beim Landesverband " +
                       "(nur setzen, wenn der Bogen sie NICHT vorgedruckt traegt)", max: 8 },

  // ⚠️ Die Gruppe "mahnung" (Karenz, Zahlungsfrist, Mindestbetrag, die
  // beiden Gebuehren, Anhoerungsfrist) ist am 10.08.2026 auf Michels
  // Wunsch entfernt worden -- zusammen mit dem gesamten Mahnwesen. Wer
  // sie wieder einfuehrt, braucht auch handleEinstellungSetzen zurueck:
  // dort haengt das Recht an der Gruppe, und "mahnung" fiel unter
  // darfBuchen (Schatzmeister).

  // Der Aufnahmeantrag ist der einzige Schreibpunkt der App, den jemand
  // ohne Anmeldung erreicht. Ein offener Endpunkt, den man nicht wieder
  // zudrehen kann, ist eine Zusage, die man spaeter bereut -- deshalb
  // ein Schalter, kein Deploy.
  antrag_offen:     { gruppe: "antrag", label: "Online-Aufnahmeantrag ist geoeffnet (1 = ja, 0 = nein)",
                      zahl: true, vorgabe: 1, min: 0, max_wert: 1 },

  // Eigener Schalter, NICHT antrag_offen mitbenutzen: sonst dreht man mit
  // der Nachwuchs-Anmeldung den allgemeinen Aufnahmeantrag mit zu. Die
  // beiden Wege richten sich an verschiedene Leute und werden zu
  // verschiedenen Zeiten gebraucht -- die Nachwuchsanmeldung vor allem zum
  // Saisonwechsel.
  nachwuchs_offen:  { gruppe: "antrag", label: "Nachwuchs-Anmeldung ist geoeffnet (1 = ja, 0 = nein)",
                      zahl: true, vorgabe: 1, min: 0, max_wert: 1 }
};

// Wert einer Einstellung als Zahl, mit der hinterlegten Vorgabe.
function einstellungZahl(cfg, schluessel) {
  const regel = EINSTELLUNGEN[schluessel];
  const roh = cfg ? cfg[schluessel] : null;
  const n = parseInt(roh, 10);
  return Number.isFinite(n) ? n : regel.vorgabe;
}

// IBAN-Pruefziffer nach ISO 13616 (Modulo 97). Ohne diese Pruefung faellt
// ein Zahlendreher erst der Bank auf -- und weist dann die komplette
// Einreichung ab, nicht nur die eine Zeile.
function ibanGueltig(roh) {
  const s = String(roh || "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const um = s.slice(4) + s.slice(0, 4);
  let rest = 0;
  for (const zeichen of um) {
    const wert = zeichen >= "0" && zeichen <= "9"
      ? zeichen
      : String(zeichen.charCodeAt(0) - 55);
    for (const ziffer of wert) rest = (rest * 10 + Number(ziffer)) % 97;
  }
  return rest === 1;
}

// Gibt null zurueck, wenn die Tabelle noch nicht existiert -- das ist
// kein Serverfehler, sondern eine noch nicht gelaufene Einrichtung.
// handleMigration legt sie an; der Reiter stoesst das beim Oeffnen an.
async function ladeEinstellungen(env) {
  let r;
  try {
    r = await env.VV_DB.prepare("SELECT schluessel, wert FROM einstellung").all();
  } catch (e) {
    if (/no such table/i.test(e && e.message ? e.message : "")) return null;
    throw e;
  }
  const werte = {};
  for (const z of r.results || []) werte[z.schluessel] = z.wert;
  return werte;
}

const EINRICHTUNG_FEHLT =
  "Die Einrichtung ist noch nicht gelaufen. Ein Administrator muss die Seite einmal oeffnen.";

async function handleEinstellungen(env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBankSehen) {
    return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  }
  const werte = await ladeEinstellungen(env);
  if (!werte) return json({ error: EINRICHTUNG_FEHLT, code: "einrichtung" }, 409, corsHeaders);
  const felder = Object.keys(EINSTELLUNGEN).map((s) => {
    const r = EINSTELLUNGEN[s];
    return {
      schluessel: s,
      gruppe: r.gruppe || "sepa",
      label: r.label,
      pflicht: !!r.pflicht,
      zahl: !!r.zahl,
      // Bei Zahlen immer einen Wert liefern: ein leeres Feld waere die
      // Behauptung, es gaebe keine Frist -- es gibt aber eine, nur eben
      // die Vorgabe.
      wert: r.zahl ? String(einstellungZahl(werte, s)) : (werte[s] || "")
    };
  });
  const fehlend = felder.filter((f) => f.pflicht && !f.wert).map((f) => f.label);
  return json({ ok: true, felder, vollstaendig: !fehlend.length, fehlend }, 200, corsHeaders);
}

async function handleEinstellungSetzen(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  const schluessel = String(body.schluessel || "");
  const regel = EINSTELLUNGEN[schluessel];
  if (!regel) return json({ error: "Unbekannte Einstellung" }, 400, corsHeaders);

  // Das Recht haengt an der Gruppe, nicht an der Tabelle. Vereins-IBAN
  // und Glaeubiger-ID sind Sache des Schatzmeisters; ob das oeffentliche
  // Antragsformular offen ist, entscheidet die Geschaeftsstelle -- die
  // nimmt die Antraege entgegen.
  const darf = regel.gruppe === "antrag"
    ? (rolle.istAdmin || rolle.darfSchreiben)
    : (rolle.istAdmin || rolle.darfBuchen);
  if (!darf) {
    return json({ error: regel.gruppe === "antrag"
      ? "Nur die Geschaeftsstelle kann das Antragsformular oeffnen und schliessen"
      : "Nur der Schatzmeister kann die Vereinsstammdaten aendern" }, 403, corsHeaders);
  }

  let wert = String(body.wert === null || body.wert === undefined ? "" : body.wert)
    .trim().slice(0, regel.max || 40);

  if (regel.iban && wert && !ibanGueltig(wert)) {
    return json({ error: "Die IBAN ist nicht gueltig (Pruefziffer stimmt nicht)" }, 400, corsHeaders);
  }
  if (regel.zahl) {
    const n = parseInt(wert, 10);
    if (!Number.isFinite(n)) {
      return json({ error: regel.label + ": bitte eine Zahl eintragen" }, 400, corsHeaders);
    }
    if (n < regel.min || n > regel.max_wert) {
      return json({ error: regel.label + ": zulaessig sind " + regel.min + " bis " +
                    regel.max_wert }, 400, corsHeaders);
    }
    wert = String(n);
  }

  const jetzt = new Date().toISOString();
  await env.VV_DB.prepare(
    "INSERT INTO einstellung (schluessel, wert, geaendert_am, geaendert_von) VALUES (?,?,?,?) " +
    "ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert, " +
    "geaendert_am = excluded.geaendert_am, geaendert_von = excluded.geaendert_von"
  ).bind(schluessel, wert, jetzt, me.username).run();

  await protokolliere(env, me.username, "einstellung-geaendert", "einstellung", schluessel, null);
  return json({ ok: true }, 200, corsHeaders);
}

// Klassen und Saetze anlegen. Ebenfalls beliebig oft aufrufbar: bereits
// vorhandene Klassen werden nicht angefasst, damit ein spaeter von Hand
// geaenderter Satz nicht durch einen zweiten Klick zurueckfaellt.
async function handleBeitragInit(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen && !rolle.darfSchreiben) {
    return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  }

  const gueltigAb = istIsoDatum(body.gueltig_ab) ? body.gueltig_ab
                                                 : (new Date().getUTCFullYear() + "-01-01");
  const jetzt = new Date().toISOString();

  const vorhanden = await env.VV_DB.prepare("SELECT id, name FROM beitragsklasse").all();
  const nachName = new Map();
  for (const k of vorhanden.results || []) nachName.set(k.name, k.id);

  const anweisungen = [];
  const angelegt = [];

  BEITRAGSKLASSEN.forEach((k) => {
    // Zwei Klassen je Stufe: der Familienverbund ist ein eigener Satz,
    // kein Rabatt-Prozentwert. So steht in der Datenbank genau das, was
    // die Mitgliederversammlung beschlossen hat.
    [{ suffix: "", betrag: k.voll }, { suffix: " (Familie)", betrag: k.familie }].forEach((v, i) => {
      const name = k.name + v.suffix;
      if (nachName.has(name)) return;
      const id = uuid();
      nachName.set(name, id);
      angelegt.push(name);
      anweisungen.push(env.VV_DB.prepare(
        "INSERT INTO beitragsklasse (id, name, sortierung, aktiv, erstellt_am, erstellt_von) VALUES (?,?,?,1,?,?)"
      ).bind(id, name, k.sortierung + i, jetzt, me.username));
      anweisungen.push(env.VV_DB.prepare(
        "INSERT INTO beitragssatz (id, beitragsklasse_id, gueltig_ab, betrag_cent, beschluss_notiz, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,?)"
      ).bind(uuid(), id, gueltigAb, v.betrag,
             "Uebernommen aus GLS Vereinsmeister, Stand 29.07.2026", jetzt, me.username));
    });
  });

  if (anweisungen.length) await env.VV_DB.batch(anweisungen);
  return json({ ok: true, angelegt, vorhanden: nachName.size }, 200, corsHeaders);
}

// Klassen mit dem aktuell gueltigen Satz. Eine Abfrage, kein N+1:
// der gueltige Satz ist der mit dem juengsten gueltig_ab, das nicht in
// der Zukunft liegt.
async function ladeKlassenMitSatz(env, stichtag) {
  const r = await env.VV_DB.prepare(
    "SELECT k.id, k.name, k.sortierung, k.aktiv, " +
    "  (SELECT s.betrag_cent FROM beitragssatz s WHERE s.beitragsklasse_id = k.id " +
    "     AND s.gueltig_ab <= ? AND (s.gueltig_bis IS NULL OR s.gueltig_bis >= ?) " +
    "   ORDER BY s.gueltig_ab DESC LIMIT 1) AS betrag_cent " +
    "FROM beitragsklasse k ORDER BY k.sortierung, k.name"
  ).bind(stichtag, stichtag).all();
  return r.results || [];
}

// Ordnet jedem Mitglied die Klasse zu, die im Altbestand hinterlegt war.
// Mengenbasiert: EINE Leseabfrage, dann ein UPDATE je Klasse mit einer
// IN-Liste, alles in einem batch. Bei 540 Mitgliedern sind das drei
// Rundlaeufe statt 540.
async function handleBeitragZuordnen(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfSchreiben) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const nurPruefen = !!body.pruefen;
  // Ohne dieses Kennzeichen wird eine bereits gesetzte Klasse NICHT
  // angefasst. Ein zweiter Lauf darf keine von Hand korrigierte
  // Zuordnung zurueckdrehen.
  const auchVorhandene = !!body.ueberschreiben;

  const stichtag = istIsoDatum(body.stichtag) ? body.stichtag
                                              : (new Date().getUTCFullYear() + "-01-01");
  const klassen = await ladeKlassenMitSatz(env, stichtag);
  if (!klassen.length) {
    return json({ error: "Es sind noch keine Beitragsklassen angelegt" }, 400, corsHeaders);
  }
  const nachName = new Map();
  for (const k of klassen) nachName.set(k.name, k);

  function findeKlasse(schluessel, familie) {
    const b = BEITRAGSKLASSEN.find((x) => x.schluessel === schluessel);
    if (!b) return null;
    return nachName.get(b.name + (familie ? " (Familie)" : "")) || null;
  }

  const zeilen = await env.VV_DB.prepare(
    "SELECT m.id, m.beitragsklasse_id, m.familienbeitrag, p.zusatz_json " +
    "FROM mitgliedschaft m JOIN person p ON p.id = m.person_id " +
    "WHERE m.status IN ('aktiv','ruhend','antrag')"
  ).all();

  // Eine Sammelliste je Zielklasse -- daraus wird je ein UPDATE.
  const nachKlasse = new Map();
  let ohneAngabe = 0, schonGesetzt = 0;
  const uneindeutig = [];

  for (const z of zeilen.results || []) {
    if (z.beitragsklasse_id && !auchVorhandene) { schonGesetzt++; continue; }

    let art = null;
    try {
      const zusatz = JSON.parse(z.zusatz_json || "{}");
      art = zusatz.Beitragsart || zusatz.beitragsart || null;
    } catch { art = null; }

    const erkannt = klasseAusText(art);
    if (!erkannt) { ohneAngabe++; continue; }

    const klasse = findeKlasse(erkannt.schluessel, erkannt.familie);
    if (!klasse) { ohneAngabe++; continue; }

    if (!erkannt.eindeutig) {
      uneindeutig.push({ id: z.id, arten: erkannt.alleArten, genommen: klasse.name });
    }

    const schluessel = klasse.id + "|" + (erkannt.familie ? 1 : 0);
    if (!nachKlasse.has(schluessel)) {
      nachKlasse.set(schluessel, { klasse, familie: erkannt.familie, ids: [] });
    }
    nachKlasse.get(schluessel).ids.push(z.id);
  }

  const jetzt = new Date().toISOString();
  const anweisungen = [];
  const verteilung = [];
  let summeCent = 0, zugeordnet = 0;

  for (const eintrag of nachKlasse.values()) {
    verteilung.push({
      klasse: eintrag.klasse.name,
      anzahl: eintrag.ids.length,
      betrag_cent: eintrag.klasse.betrag_cent,
      summe_cent: (eintrag.klasse.betrag_cent || 0) * eintrag.ids.length
    });
    summeCent += (eintrag.klasse.betrag_cent || 0) * eintrag.ids.length;
    zugeordnet += eintrag.ids.length;

    // Bloecke zu 50 wegen der Parametergrenze. Alle Anweisungen gehen
    // trotzdem in EINEN batch, das bleibt ein Rundlauf.
    for (let i = 0; i < eintrag.ids.length; i += 50) {
      const block = eintrag.ids.slice(i, i + 50);
      anweisungen.push(env.VV_DB.prepare(
        "UPDATE mitgliedschaft SET beitragsklasse_id = ?, familienbeitrag = ?, " +
        "geaendert_am = ?, geaendert_von = ? WHERE id IN (" + block.map(() => "?").join(",") + ")"
      ).bind(eintrag.klasse.id, eintrag.familie ? 1 : 0, jetzt, me.username, ...block));
    }
  }

  if (!nurPruefen && anweisungen.length) {
    await env.VV_DB.batch(anweisungen);
    await protokolliere(env, me.username, "beitragsklassen-zugeordnet", "mitgliedschaft", null,
                        { zugeordnet, summeCent });
  }

  verteilung.sort((a, b) => b.anzahl - a.anzahl);
  return json({
    ok: true, pruefung: nurPruefen,
    zugeordnet, ohneAngabe, schonGesetzt,
    summeCent, verteilung,
    // Mitglieder, deren Sparten verschiedene Beitragsarten nennen.
    // Genommen wurde die erste; die Entscheidung gehoert der
    // Geschaeftsstelle, deshalb stehen sie im Bericht.
    uneindeutig: uneindeutig.slice(0, 50),
    uneindeutigGesamt: uneindeutig.length
  }, 200, corsHeaders);
}

// Uebersicht fuer den Beitrags-Reiter: Klassen mit Satz, wie viele
// Mitglieder darin stehen, die Jahressumme -- und die Faelle, die eine
// Rueckfrage verdienen.
async function handleBeitragUebersicht(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfSchreiben && !rolle.darfBuchen) {
    return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  }

  const stichtag = istIsoDatum(body.stichtag) ? body.stichtag
                                              : (new Date().getUTCFullYear() + "-01-01");
  const klassen = await ladeKlassenMitSatz(env, stichtag);

  const zaehlung = await env.VV_DB.prepare(
    "SELECT beitragsklasse_id, COUNT(*) AS n FROM mitgliedschaft " +
    "WHERE status IN ('aktiv','ruhend') GROUP BY beitragsklasse_id"
  ).all();
  const anzahlNach = new Map();
  let ohneKlasse = 0;
  for (const z of zaehlung.results || []) {
    if (!z.beitragsklasse_id) { ohneKlasse = z.n; continue; }
    anzahlNach.set(z.beitragsklasse_id, z.n);
  }

  let summeCent = 0;
  const zeilen = klassen.map((k) => {
    const anzahl = anzahlNach.get(k.id) || 0;
    const summe = (k.betrag_cent || 0) * anzahl;
    summeCent += summe;
    return { id: k.id, name: k.name, betrag_cent: k.betrag_cent, anzahl, summe_cent: summe };
  });

  // Auffaellige Zuordnungen. Bewusst als HINWEIS, nicht als Korrektur:
  // im Altbestand ist ein 75-Jaehriger mit Kinderbeitrag gefuehrt, und
  // ob das ein Pflegefehler oder eine Sonderregelung ist, entscheidet
  // die Geschaeftsstelle -- nicht dieser Code.
  const auffaellig = await env.VV_DB.prepare(
    "SELECT m.id, m.mitgliedsnummer, p.vorname, p.nachname, p.geburtsdatum, k.name AS klasse, " +
    "       CAST((julianday(?) - julianday(p.geburtsdatum)) / 365.25 AS INTEGER) AS alter_jahre " +
    "FROM mitgliedschaft m JOIN person p ON p.id = m.person_id " +
    "JOIN beitragsklasse k ON k.id = m.beitragsklasse_id " +
    "WHERE m.status IN ('aktiv','ruhend') AND p.geburtsdatum IS NOT NULL AND ( " +
    "   (k.name LIKE 'Kinder%' AND (julianday(?) - julianday(p.geburtsdatum)) / 365.25 >= 20) " +
    "OR (k.name LIKE 'Erwachsener%' AND (julianday(?) - julianday(p.geburtsdatum)) / 365.25 < 18) ) " +
    "ORDER BY alter_jahre DESC LIMIT 50"
  ).bind(stichtag, stichtag, stichtag).all();

  return json({
    ok: true, stichtag,
    klassen: zeilen,
    ohneKlasse,
    summeCent,
    auffaellig: auffaellig.results || []
  }, 200, corsHeaders);
}

// Beitragssatz aendern. Nie den bestehenden Satz ueberschreiben: ein
// Beschluss der Mitgliederversammlung gilt ab einem Datum, und was
// davor gerechnet wurde, muss nachvollziehbar bleiben. Deshalb wird der
// alte Satz beendet und ein neuer angelegt.
async function handleBeitragssatzSetzen(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen) {
    return json({ error: "Nur der Schatzmeister kann Beitragssaetze aendern" }, 403, corsHeaders);
  }

  const klasseId = String(body.beitragsklasse_id || "");
  const betrag = parseInt(body.betrag_cent, 10);
  const gueltigAb = String(body.gueltig_ab || "").slice(0, 10);

  if (!klasseId) return json({ error: "Keine Beitragsklasse angegeben" }, 400, corsHeaders);
  if (!Number.isFinite(betrag) || betrag < 0 || betrag > 100000000) {
    return json({ error: "Betrag nicht plausibel" }, 400, corsHeaders);
  }
  if (!istIsoDatum(gueltigAb)) return json({ error: "Gueltig-ab-Datum erforderlich" }, 400, corsHeaders);

  const klasse = await env.VV_DB.prepare("SELECT id, name FROM beitragsklasse WHERE id = ?")
    .bind(klasseId).first();
  if (!klasse) return json({ error: "Beitragsklasse nicht gefunden" }, 404, corsHeaders);

  const jetzt = new Date().toISOString();
  // Vortag als Ende des alten Satzes -- ueber Date.UTC, damit die
  // Sommerzeit die Grenze nicht um einen Tag verschiebt.
  const t = gueltigAb.split("-").map(Number);
  const vortag = new Date(Date.UTC(t[0], t[1] - 1, t[2] - 1));
  const vortagIso = vortag.getUTCFullYear() + "-" +
    String(vortag.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(vortag.getUTCDate()).padStart(2, "0");

  await env.VV_DB.batch([
    env.VV_DB.prepare(
      "UPDATE beitragssatz SET gueltig_bis = ? WHERE beitragsklasse_id = ? AND gueltig_bis IS NULL AND gueltig_ab < ?"
    ).bind(vortagIso, klasseId, gueltigAb),
    env.VV_DB.prepare(
      "INSERT INTO beitragssatz (id, beitragsklasse_id, gueltig_ab, betrag_cent, beschluss_am, beschluss_notiz, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(uuid(), klasseId, gueltigAb, betrag,
           istIsoDatum(body.beschluss_am) ? body.beschluss_am : null,
           sauber(body.beschluss_notiz, 300), jetzt, me.username)
  ]);

  await protokolliere(env, me.username, "beitragssatz-geaendert", "beitragsklasse", klasseId,
                      { betrag, gueltigAb });

  return json({ ok: true }, 200, corsHeaders);
}

// ---------------------------------------------------------------------
// STUFE 2 -- Beitragslauf
// ---------------------------------------------------------------------
//
// Der Lauf erzeugt je Mitgliedschaft EINE Forderung. Er ist wiederauf-
// setzbar: jeder Aufruf verarbeitet einen Block und merkt sich in
// beitragslauf.fortschritt_ab die zuletzt bearbeitete Mitgliedschaft.
// Bricht ein Aufruf ab, macht der naechste dort weiter, statt von vorn
// zu beginnen -- und der eindeutige Index idx_ford_lauf_eindeutig sorgt
// dafuer, dass ein doppelt gestarteter Block keine zweite Forderung
// anlegt. Das ist die Stelle, an der ein Fehler beim Mitglied als
// doppelte Abbuchung ankaeme; D1 kennt kein BEGIN, der Index ist die
// einzige Klammer, die es hier gibt.

const LAUF_BLOCK = 150;

// Ohne Beitragsangabe gaebe es sonst eine Forderung ueber 0,00 EUR --
// die schlimmste aller Varianten, weil sie echt aussieht.
const AUSSCHLUSS_TEXT = {
  keine_klasse:   "keine Beitragsklasse hinterlegt",
  kein_satz:      "Beitragsklasse hat zum Stichtag keinen Satz",
  kein_haushalt:  "keinem Haushalt zugeordnet",
  ehrenmitglied:  "Ehrenmitglied (beitragsfrei)",
  ruhend:         "Mitgliedschaft ruht",
  // ⚠️ Nicht "im Beitragsjahr": bei einem Ratenlauf waere das falsch.
  // Wer im August eintritt, IST im Beitragsjahr Mitglied -- nur im
  // ersten Quartal eben nicht.
  ausserhalb:     "im Zeitraum des Laufs nicht Mitglied"
};

// ---------------------------------------------------------------------
// Zahlungsrhythmus: jaehrlich, halbjaehrlich, vierteljaehrlich
// ---------------------------------------------------------------------
//
// ⚠️ Ein Rhythmus erzeugt EINEN LAUF JE RATE, nicht einen Lauf mit
// mehreren Raten. Zwei Gruende, beide hart:
//
// 1. Der eindeutige Index idx_ford_lauf_eindeutig laesst je Lauf und
//    Mitgliedschaft genau EINE Forderung derselben Art zu. Er ist die
//    einzige Klammer gegen doppelte Abbuchungen, die es hier gibt (D1
//    kennt kein BEGIN) -- er wird nicht aufgeweicht, um vier Raten in
//    einen Lauf zu pressen.
// 2. Es entspricht dem echten Ablauf. Das zweite Quartal wird im April
//    eingereicht, nicht im Januar zusammen mit dem ersten. Jede Rate
//    braucht ihre eigene SEPA-Datei, ihre eigene Sammelbuchung und ihre
//    eigene Uebernahme in die Buchhaltung -- als eigener Lauf hat sie das
//    alles, ohne dass an einer dieser Stellen etwas geaendert werden muss.
//
// Die Spalte beitragslauf.periode gab es von Anfang an, sie stand bisher
// nur fest auf "jaehrlich". Deshalb kostet das hier KEINE Schemaaenderung.
// ⚠️ Altbestand: bereits angelegte Laeufe tragen "jaehrlich", das Schema
// nennt "jahr" -- periodeInfo() nimmt beides.

const RHYTHMEN = {
  jaehrlich: [
    { periode: "jahr", text: "Jahresbeitrag", kurz: "",   vonMonat: 1,  bisMonat: 12 }
  ],
  halbjaehrlich: [
    { periode: "h1",   text: "1. Halbjahr",   kurz: "H1", vonMonat: 1,  bisMonat: 6 },
    { periode: "h2",   text: "2. Halbjahr",   kurz: "H2", vonMonat: 7,  bisMonat: 12 }
  ],
  vierteljaehrlich: [
    { periode: "q1",   text: "1. Quartal",    kurz: "Q1", vonMonat: 1,  bisMonat: 3 },
    { periode: "q2",   text: "2. Quartal",    kurz: "Q2", vonMonat: 4,  bisMonat: 6 },
    { periode: "q3",   text: "3. Quartal",    kurz: "Q3", vonMonat: 7,  bisMonat: 9 },
    { periode: "q4",   text: "4. Quartal",    kurz: "Q4", vonMonat: 10, bisMonat: 12 }
  ]
};

function periodeInfo(periode) {
  const p = String(periode || "").toLowerCase();
  for (const raten of Object.values(RHYTHMEN)) {
    for (const r of raten) if (r.periode === p) return r;
  }
  // Alles Unbekannte -- darunter der Altbestand mit "jaehrlich" -- ist ein
  // Jahreslauf. Fail-safe in die Richtung, die schon immer galt.
  return RHYTHMEN.jaehrlich[0];
}

function zweiStellig(n) { return n < 10 ? "0" + n : String(n); }

// Tag 0 des Folgemonats = letzter Tag dieses Monats. Ueber UTC gerechnet,
// damit die Sommerzeitfalle von toISOString() gar nicht erst auftritt.
function monatsEnde(jahr, monat) {
  return new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
}

function periodeGrenzen(jahr, periode) {
  const p = periodeInfo(periode);
  return {
    von: jahr + "-" + zweiStellig(p.vonMonat) + "-01",
    bis: jahr + "-" + zweiStellig(p.bisMonat) + "-" + zweiStellig(monatsEnde(jahr, p.bisMonat)),
    monate: p.bisMonat - p.vonMonat + 1,
    text: p.text,
    periode: p.periode
  };
}

// Ein Datum um n Monate schieben, der Tag wird auf das Monatsende
// begrenzt. Ohne die Begrenzung wuerde aus dem 31.01. plus einem Monat
// der 03.03. -- ein Faelligkeitsdatum, das niemand eingegeben hat.
function verschiebeMonate(iso, n) {
  const j = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const t = Number(iso.slice(8, 10));
  const lfd = (j * 12 + (m - 1)) + n;
  const jahr = Math.floor(lfd / 12);
  const monat = (lfd % 12) + 1;
  return jahr + "-" + zweiStellig(monat) + "-" + zweiStellig(Math.min(t, monatsEnde(jahr, monat)));
}

// ⚠️ Der Jahressatz wird auf die Raten VERTEILT, nicht je Rate neu
// festgesetzt: die Summe aller Raten muss auf den Cent genau der
// Jahresbeitrag sein, sonst weicht die Kontrollzahl 39.972 EUR ab,
// sobald jemand von jaehrlich auf vierteljaehrlich umstellt. Ein
// Restcent geht auf die ERSTE Rate -- so steht die krumme Zahl am
// Jahresanfang und nicht im vierten Quartal, wo sie beim Abgleich mit
// der Beitragsordnung als Rechenfehler gelesen wuerde.
function rateAusJahressatz(satzCent, periode) {
  const p = periodeInfo(periode);
  const monate = p.bisMonat - p.vonMonat + 1;
  const raten = Math.round(12 / monate);
  if (raten <= 1) return satzCent;
  const grund = Math.floor(satzCent / raten);
  const rest = satzCent - grund * raten;
  return p.vonMonat === 1 ? grund + rest : grund;
}

// Aus Eintritt, Austritt und Periode den Betrag. Bewusst ohne
// Datenbankzugriff, damit die Regel einzeln nachrechenbar bleibt.
//
// Vorgabe ist der VOLLE Beitrag der Periode, auch bei unterjaehrigem
// Eintritt -- so rechnet der Vereinsmeister, und die Kontrollzahl
// 39.972 EUR haengt daran. Anteilig ist eine bewusste Entscheidung je
// Lauf, keine stillschweigende Voreinstellung.
//
// ⚠️ Bei einem Jahreslauf ist das Ergebnis bitgleich mit dem Stand vor
// dem Rhythmus: Grenzen = Jahresgrenzen, Rate = ganzer Satz, 12 Monate.
function berechneBetrag(satzCent, jahr, periode, eintritt, austritt, anteilig) {
  const g = periodeGrenzen(jahr, periode);
  const ein = String(eintritt || "").slice(0, 10);
  const aus = String(austritt || "").slice(0, 10);

  if (ein && ein > g.bis) return null;
  if (aus && aus < g.von) return null;

  const von = ein && ein > g.von ? ein : g.von;
  const bis = aus && aus < g.bis ? aus : g.bis;
  if (von > bis) return null;

  const rateCent = rateAusJahressatz(satzCent, periode);

  if (!anteilig) {
    return { betrag_cent: rateCent, monate: g.monate, von: g.von, bis: g.bis,
             anteilig: false, periode: g.periode, periodeText: g.text,
             satz_jahr_cent: satzCent };
  }

  // Angefangene Monate zaehlen voll. Wer am 20.03. eintritt, zahlt ab
  // Maerz -- alles andere waere auf den Tag genau und damit eine
  // Rechenart, die dem Mitglied niemand erklaeren kann.
  const monate = (Number(bis.slice(5, 7)) - Number(von.slice(5, 7))) + 1;
  if (monate <= 0) return null;
  return {
    betrag_cent: Math.round(rateCent * monate / g.monate),
    monate, von, bis, anteilig: true, periode: g.periode, periodeText: g.text,
    satz_jahr_cent: satzCent
  };
}

function laufOptionen(lauf) {
  let o = {};
  try { o = JSON.parse(lauf.optionen_json || "{}"); } catch { o = {}; }
  return {
    anteilig: !!o.anteilig,
    ehrenmitglieder: !!o.ehrenmitglieder,
    ruhende: !!o.ruhende
  };
}

// Liest einen Ausschnitt des Bestands und wendet die Beitragsregel an.
// EINE Abfrage, danach nur noch Rechnen -- der Beitragslauf darf keine
// Abfrage je Mitglied absetzen (Messung Stufe 0: 250 Mitglieder im
// N+1-Muster = 21,7 Sekunden und Absturz bei 500).
async function sammleLaufZeilen(env, lauf, klassen, abId, grenze) {
  const opt = laufOptionen(lauf);
  // ⚠️ Der Bestandsfilter richtet sich nach der PERIODE, nicht nach dem
  // Kalenderjahr. Ein Lauf fuer das dritte Quartal erfasst, wer im
  // dritten Quartal Mitglied war -- sonst bekaeme ein Eintritt im
  // Oktober rueckwirkend eine Forderung fuer Juli bis September, und die
  // Rate haette einen Zeitraum berechnet, den es beim Mitglied nie gab.
  const g = periodeGrenzen(lauf.jahr, lauf.periode);

  const bedingungen = [
    "m.status <> 'antrag'",
    "m.eintritt <= ?",
    "(m.austritt IS NULL OR m.austritt >= ?)"
  ];
  const werte = [g.bis, g.von];
  if (abId) { bedingungen.push("m.id > ?"); werte.push(abId); }

  let sql =
    "SELECT m.id, m.mitgliedsnummer, m.art, m.status, m.eintritt, m.austritt, " +
    "       m.beitragsklasse_id, p.haushalt_id, p.vorname, p.nachname " +
    "FROM mitgliedschaft m JOIN person p ON p.id = m.person_id " +
    "WHERE " + bedingungen.join(" AND ") + " ORDER BY m.id";
  if (grenze) { sql += " LIMIT ?"; werte.push(grenze); }

  const r = await env.VV_DB.prepare(sql).bind(...werte).all();
  const zeilen = [];
  const ausschluesse = [];
  let letzteId = abId || null;
  let gelesen = 0;

  for (const z of r.results || []) {
    gelesen++;
    letzteId = z.id;

    const name = (z.vorname + " " + z.nachname).trim();
    function raus(grund) {
      ausschluesse.push({ id: z.id, mitgliedsnummer: z.mitgliedsnummer, name, grund });
    }

    if (z.art === "ehrenmitglied" && !opt.ehrenmitglieder) { raus("ehrenmitglied"); continue; }
    if (z.status === "ruhend" && !opt.ruhende) { raus("ruhend"); continue; }
    if (!z.haushalt_id) { raus("kein_haushalt"); continue; }
    if (!z.beitragsklasse_id) { raus("keine_klasse"); continue; }

    const klasse = klassen.get(z.beitragsklasse_id);
    if (!klasse || klasse.betrag_cent === null || klasse.betrag_cent === undefined) {
      raus("kein_satz"); continue;
    }

    const rechnung = berechneBetrag(klasse.betrag_cent, lauf.jahr, lauf.periode,
                                    z.eintritt, z.austritt, opt.anteilig);
    if (!rechnung) { raus("ausserhalb"); continue; }

    zeilen.push({
      mitgliedschaft_id: z.id,
      mitgliedsnummer: z.mitgliedsnummer,
      haushalt_id: z.haushalt_id,
      name,
      klasse: klasse.name,
      betrag_cent: rechnung.betrag_cent,
      rechnung
    });
  }

  return { zeilen, ausschluesse, letzteId, gelesen };
}

async function ladeKlassenMap(env, stichtag) {
  const liste = await ladeKlassenMitSatz(env, stichtag);
  const map = new Map();
  for (const k of liste) map.set(k.id, k);
  return map;
}

async function handleLaufListe(env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen && !rolle.darfSchreiben) {
    return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  }
  const r = await env.VV_DB.prepare(
    "SELECT l.*, (SELECT COUNT(*) FROM sepa_datei d WHERE d.beitragslauf_id = l.id) AS sepa_dateien " +
    "FROM beitragslauf l ORDER BY l.jahr DESC, l.erstellt_am DESC LIMIT 50"
  ).all();
  return json({ ok: true, laeufe: r.results || [], darfBuchen: rolle.istAdmin || rolle.darfBuchen },
              200, corsHeaders);
}

async function handleLaufAnlegen(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen) {
    return json({ error: "Nur der Schatzmeister kann einen Beitragslauf anlegen" }, 403, corsHeaders);
  }

  const jahr = parseInt(body.jahr, 10);
  if (!Number.isFinite(jahr) || jahr < 2000 || jahr > 2100) {
    return json({ error: "Beitragsjahr nicht plausibel" }, 400, corsHeaders);
  }
  const faelligkeit = String(body.faelligkeit || "").slice(0, 10);
  if (!istIsoDatum(faelligkeit)) {
    return json({ error: "Faelligkeitsdatum erforderlich" }, 400, corsHeaders);
  }
  const stichtag = istIsoDatum(body.stichtag) ? body.stichtag : (jahr + "-01-01");

  // Unbekannter Rhythmus faellt auf jaehrlich zurueck, statt 400 zu
  // werfen: das ist der Stand von vor dieser Aenderung und damit die
  // Richtung, in der niemand ueberrascht wird.
  const rhythmus = RHYTHMEN[String(body.rhythmus || "")] ? String(body.rhythmus) : "jaehrlich";
  const raten = RHYTHMEN[rhythmus];

  // Je Rate ein Faelligkeitsdatum. Der Client schickt sie mit -- fehlt
  // eines, wird es aus dem ersten um den Abstand der Perioden
  // verschoben. ⚠️ Abgeleitet wird nur, was nicht dasteht: ein vom
  // Nutzer bewusst gesetzter Termin darf nie ueberschrieben werden.
  const rohTermine = Array.isArray(body.termine) ? body.termine : [];
  const termine = raten.map((r, i) => {
    const t = String(rohTermine[i] || "").slice(0, 10);
    if (istIsoDatum(t)) return t;
    return verschiebeMonate(faelligkeit, r.vonMonat - raten[0].vonMonat);
  });

  // Ein zweiter Lauf fuer dasselbe Jahr ist kein Fehler (Nachzuegler,
  // Umlage), aber fast immer ein Versehen -- deshalb muss er ausdruecklich
  // gewollt sein. ⚠️ Die Pruefung laeuft EINMAL fuer die ganze Serie:
  // sonst legte der Rhythmus den ersten Lauf an und stolperte danach
  // ueber seinen eigenen.
  const schon = await env.VV_DB.prepare(
    "SELECT COUNT(*) AS n FROM beitragslauf WHERE jahr = ? AND status <> 'verworfen'"
  ).bind(jahr).first();
  if (schon && schon.n > 0 && !body.trotzdem) {
    return json({
      error: "Fuer " + jahr + " gibt es bereits einen Beitragslauf",
      code: "schon_vorhanden", vorhanden: schon.n
    }, 409, corsHeaders);
  }

  const optionen = {
    anteilig: !!body.anteilig,
    ehrenmitglieder: !!body.ehrenmitglieder,
    ruhende: !!body.ruhende
  };
  const jetzt = new Date().toISOString();
  const eigene = sauber(body.bezeichnung, 100);

  // Alle Raten in EINEM batch: entweder steht die ganze Serie oder
  // keine. Ein halb angelegter Rhythmus waere das Schlimmste -- er sieht
  // vollstaendig aus, und die fehlende Rate faellt erst im Herbst auf.
  const anweisungen = [];
  const angelegt = [];
  for (let i = 0; i < raten.length; i++) {
    const r = raten[i];
    const id = uuid();
    const bezeichnung = raten.length === 1
      ? (eigene || ("Jahresbeitrag " + jahr))
      : ((eigene || ("Mitgliedsbeitrag " + jahr)) + " - " + r.text);
    angelegt.push({ id, periode: r.periode, text: r.text, bezeichnung, faelligkeit: termine[i] });
    anweisungen.push(env.VV_DB.prepare(
      "INSERT INTO beitragslauf (id, bezeichnung, jahr, periode, stichtag, faelligkeit, status, " +
      "optionen_json, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,'entwurf',?,?,?)"
    ).bind(id, bezeichnung, jahr, r.periode, stichtag, termine[i],
           JSON.stringify(optionen), jetzt, me.username));
  }
  await env.VV_DB.batch(anweisungen);

  for (const a of angelegt) {
    await protokolliere(env, me.username, "beitragslauf-angelegt", "beitragslauf", a.id,
                        { jahr, periode: a.periode, faelligkeit: a.faelligkeit, rhythmus });
  }
  return json({ ok: true, id: angelegt[0].id, ids: angelegt.map((a) => a.id),
                rhythmus, angelegt }, 200, corsHeaders);
}

async function ladeLauf(env, id) {
  return env.VV_DB.prepare("SELECT * FROM beitragslauf WHERE id = ?").bind(String(id || "")).first();
}

// Was wuerde der Lauf erzeugen? Rechnet ueber den GESAMTEN Bestand und
// schreibt nichts. Der Schatzmeister sieht die Summe, bevor irgendetwas
// entsteht -- und vor allem sieht er namentlich, wer NICHT dabei ist.
async function handleLaufVorschau(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen && !rolle.darfSchreiben) {
    return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  }

  const lauf = await ladeLauf(env, body.lauf_id);
  if (!lauf) return json({ error: "Beitragslauf nicht gefunden" }, 404, corsHeaders);

  const klassen = await ladeKlassenMap(env, lauf.stichtag);
  const { zeilen, ausschluesse } = await sammleLaufZeilen(env, lauf, klassen, null, null);

  let summeCent = 0;
  const nachKlasse = new Map();
  for (const z of zeilen) {
    summeCent += z.betrag_cent;
    if (!nachKlasse.has(z.klasse)) nachKlasse.set(z.klasse, { klasse: z.klasse, anzahl: 0, summe_cent: 0 });
    const e = nachKlasse.get(z.klasse);
    e.anzahl++; e.summe_cent += z.betrag_cent;
  }

  const nachGrund = new Map();
  for (const a of ausschluesse) {
    if (!nachGrund.has(a.grund)) {
      nachGrund.set(a.grund, { grund: a.grund, text: AUSSCHLUSS_TEXT[a.grund] || a.grund, anzahl: 0, beispiele: [] });
    }
    const e = nachGrund.get(a.grund);
    e.anzahl++;
    if (e.beispiele.length < 25) e.beispiele.push({ mitgliedsnummer: a.mitgliedsnummer, name: a.name });
  }

  return json({
    ok: true,
    lauf: { id: lauf.id, bezeichnung: lauf.bezeichnung, jahr: lauf.jahr, stichtag: lauf.stichtag,
            faelligkeit: lauf.faelligkeit, status: lauf.status, optionen: laufOptionen(lauf),
            periode: periodeInfo(lauf.periode).periode,
            periodeText: periodeInfo(lauf.periode).text },
    anzahl: zeilen.length,
    summeCent,
    verteilung: Array.from(nachKlasse.values()).sort((a, b) => b.anzahl - a.anzahl),
    ausschluesse: Array.from(nachGrund.values()).sort((a, b) => b.anzahl - a.anzahl),
    ausschlussGesamt: ausschluesse.length
  }, 200, corsHeaders);
}

// Ein Block. Der Client ruft so lange auf, bis fertig true kommt.
async function handleLaufAusfuehren(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen) {
    return json({ error: "Nur der Schatzmeister kann einen Beitragslauf ausfuehren" }, 403, corsHeaders);
  }

  const lauf = await ladeLauf(env, body.lauf_id);
  if (!lauf) return json({ error: "Beitragslauf nicht gefunden" }, 404, corsHeaders);
  if (lauf.status === "festgeschrieben") {
    return json({ error: "Der Lauf ist festgeschrieben und kann nicht mehr geaendert werden" }, 409, corsHeaders);
  }

  const klassen = await ladeKlassenMap(env, lauf.stichtag);
  if (!klassen.size) {
    return json({ error: "Es sind keine Beitragsklassen angelegt" }, 400, corsHeaders);
  }

  const block = Math.min(Math.max(parseInt(body.block, 10) || LAUF_BLOCK, 10), 400);
  const { zeilen, ausschluesse, letzteId, gelesen } =
    await sammleLaufZeilen(env, lauf, klassen, lauf.fortschritt_ab || null, block);

  // Nur beim allerersten Block: wie viele Mitgliedschaften kommen
  // ueberhaupt in Frage? Ohne diese Zahl kann der Fortschrittsbalken nur
  // wackeln statt zu zaehlen -- und ein Balken, der nichts misst, ist
  // schlimmer als keiner.
  let erwartet = lauf.anzahl_erwartet;
  if (!lauf.fortschritt_ab && !erwartet) {
    // Dieselben Grenzen wie in sammleLaufZeilen -- ein Balken, der eine
    // andere Menge misst als der Lauf verarbeitet, zaehlt nicht, er
    // wackelt.
    const gz = periodeGrenzen(lauf.jahr, lauf.periode);
    const z = await env.VV_DB.prepare(
      "SELECT COUNT(*) AS n FROM mitgliedschaft m WHERE m.status <> 'antrag' " +
      "AND m.eintritt <= ? AND (m.austritt IS NULL OR m.austritt >= ?)"
    ).bind(gz.bis, gz.von).first();
    erwartet = z ? z.n : null;
  }

  const jetzt = new Date().toISOString();
  const anweisungen = [];
  let summeBlock = 0;

  for (const z of zeilen) {
    summeBlock += z.betrag_cent;
    // INSERT OR IGNORE gegen idx_ford_lauf_eindeutig: ein wiederholter
    // Block legt nichts doppelt an.
    anweisungen.push(env.VV_DB.prepare(
      "INSERT OR IGNORE INTO forderung (id, beitragslauf_id, mitgliedschaft_id, haushalt_id, art, " +
      "bezeichnung, jahr, periode, betrag_cent, faellig_am, berechnung_json, status, erstellt_am, erstellt_von) " +
      "VALUES (?,?,?,?,'beitrag',?,?,?,?,?,?,'offen',?,?)"
    ).bind(uuid(), lauf.id, z.mitgliedschaft_id, z.haushalt_id,
           lauf.bezeichnung, lauf.jahr, z.rechnung.periode, z.betrag_cent, lauf.faelligkeit,
           JSON.stringify({ klasse: z.klasse, satz_cent: z.rechnung.betrag_cent,
                            satz_jahr_cent: z.rechnung.satz_jahr_cent,
                            periode: z.rechnung.periode, periodeText: z.rechnung.periodeText,
                            monate: z.rechnung.monate, von: z.rechnung.von, bis: z.rechnung.bis,
                            anteilig: z.rechnung.anteilig, stichtag: lauf.stichtag }),
           jetzt, me.username));
  }

  const fertig = gelesen < block;

  // Die Zaehler werden aus der Forderungstabelle neu ermittelt statt
  // hochgezaehlt: nach einem Wiederaufsetzen stimmt eine mitlaufende
  // Summe sonst nicht mehr mit dem ueberein, was wirklich in der
  // Datenbank steht.
  anweisungen.push(env.VV_DB.prepare(
    "UPDATE beitragslauf SET fortschritt_ab = ?, status = ?, anzahl_erwartet = ?, " +
    "  anzahl_erzeugt = (SELECT COUNT(*) FROM forderung WHERE beitragslauf_id = ? AND storniert_am IS NULL), " +
    "  summe_cent = (SELECT COALESCE(SUM(betrag_cent),0) FROM forderung WHERE beitragslauf_id = ? AND storniert_am IS NULL) " +
    "WHERE id = ?"
  ).bind(fertig ? null : letzteId, fertig ? "fertig" : "laeuft", erwartet === undefined ? null : erwartet,
         lauf.id, lauf.id, lauf.id));

  await env.VV_DB.batch(anweisungen);

  const stand = await ladeLauf(env, lauf.id);
  if (fertig) {
    await protokolliere(env, me.username, "beitragslauf-ausgefuehrt", "beitragslauf", lauf.id,
                        { anzahl: stand.anzahl_erzeugt, summeCent: stand.summe_cent });
  }

  return json({
    ok: true, fertig,
    erzeugtBlock: zeilen.length,
    uebersprungenBlock: ausschluesse.length,
    gesamt: stand ? stand.anzahl_erzeugt : 0,
    summeCent: stand ? stand.summe_cent : 0,
    erwartet: erwartet || null,
    summeBlock
  }, 200, corsHeaders);
}

async function handleLaufDetail(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen && !rolle.darfSchreiben) {
    return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  }
  const lauf = await ladeLauf(env, body.lauf_id);
  if (!lauf) return json({ error: "Beitragslauf nicht gefunden" }, 404, corsHeaders);

  const nachStatus = await env.VV_DB.prepare(
    "SELECT status, COUNT(*) AS n, SUM(betrag_cent) AS summe FROM forderung " +
    "WHERE beitragslauf_id = ? GROUP BY status"
  ).bind(lauf.id).all();

  const dateien = await env.VV_DB.prepare(
    "SELECT id, msg_id, erstellt_datum, ausfuehrung_am, seq_typ, anzahl_posten, summe_cent, eingereicht_am " +
    "FROM sepa_datei WHERE beitragslauf_id = ? ORDER BY erstellt_am DESC"
  ).bind(lauf.id).all();

  // Zehn Stichproben mit voller Herleitung. Wer eine Forderung erklaeren
  // muss, braucht nicht die Summe, sondern diese eine Zeile.
  const proben = await env.VV_DB.prepare(
    "SELECT f.betrag_cent, f.berechnung_json, m.mitgliedsnummer, p.vorname, p.nachname " +
    "FROM forderung f JOIN mitgliedschaft m ON m.id = f.mitgliedschaft_id " +
    "JOIN person p ON p.id = m.person_id WHERE f.beitragslauf_id = ? " +
    "ORDER BY f.betrag_cent DESC LIMIT 10"
  ).bind(lauf.id).all();

  return json({
    ok: true,
    lauf: Object.assign({}, lauf, { optionen: laufOptionen(lauf),
                                    periode: periodeInfo(lauf.periode).periode,
                                    periodeText: periodeInfo(lauf.periode).text }),
    nachStatus: nachStatus.results || [],
    dateien: dateien.results || [],
    proben: (proben.results || []).map((p) => {
      let b = {};
      try { b = JSON.parse(p.berechnung_json || "{}"); } catch { b = {}; }
      return { mitgliedsnummer: p.mitgliedsnummer, name: (p.vorname + " " + p.nachname).trim(),
               betrag_cent: p.betrag_cent, berechnung: b };
    }),
    darfBuchen: rolle.istAdmin || rolle.darfBuchen
  }, 200, corsHeaders);
}

async function handleLaufFestschreiben(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen) {
    return json({ error: "Nur der Schatzmeister kann einen Lauf festschreiben" }, 403, corsHeaders);
  }
  const lauf = await ladeLauf(env, body.lauf_id);
  if (!lauf) return json({ error: "Beitragslauf nicht gefunden" }, 404, corsHeaders);
  if (lauf.status === "festgeschrieben") return json({ ok: true, schon: true }, 200, corsHeaders);
  if (lauf.status !== "fertig") {
    return json({ error: "Der Lauf ist noch nicht vollstaendig durchgelaufen" }, 409, corsHeaders);
  }

  const jetzt = new Date().toISOString();
  await env.VV_DB.prepare(
    "UPDATE beitragslauf SET status = 'festgeschrieben', festgeschrieben_am = ?, festgeschrieben_von = ? WHERE id = ?"
  ).bind(jetzt, me.username, lauf.id).run();
  await protokolliere(env, me.username, "beitragslauf-festgeschrieben", "beitragslauf", lauf.id,
                      { anzahl: lauf.anzahl_erzeugt, summeCent: lauf.summe_cent });
  return json({ ok: true }, 200, corsHeaders);
}

// Nur ein Entwurf darf verschwinden. Sobald etwas festgeschrieben oder
// eine SEPA-Datei erzeugt ist, bleibt der Lauf stehen -- dann geht nur
// noch Stornieren, nie Loeschen.
// Einen Lauf samt allem, was an ihm haengt, wieder entfernen -- fuer
// Probelaeufe und fuer den Fall, dass beim Anlegen etwas schiefgegangen
// ist (am 10.08.2026 standen zwei Laeufe fuer 2027 nebeneinander).
//
// ⚠️ Ein Vermerk in `sepa_datei` sperrt das seit dem 10.08.2026 NICHT
// mehr hart. Die Datei selbst wird nirgends gespeichert -- ein Vermerk
// ist kein Beleg dafuer, dass etwas bei der Bank liegt; genau daran ist
// der erste echte Lauf haengengeblieben. Gesperrt wird stattdessen an
// dem, was wirklich Geld bedeutet: einer nicht stornierten Zahlung und
// einer nicht stornierten Buchung. Beides wird benannt statt nur
// abgelehnt, damit der Weg dorthin erkennbar bleibt.
//
// Zweistufig wie handleSparteLoeschen: `pruefen: true` zaehlt nur.
//
// ⚠️ Die Zahlungssperre allein war eine SACKGASSE -- am 10.08.2026 bei
// Michel eingetreten. Sie verweist auf `vv-sammel-zurueck`, und der
// greift ausschliesslich ueber eine als eingegangen gebuchte SEPA-Datei.
// Haengt eine Zahlung an keiner (mehr) -- weil die Datei nie gebucht,
// die Zahlung von Hand erfasst oder ein frueherer Lauf samt seiner Datei
// geloescht wurde --, gibt es den Knopf gar nicht, und der Lauf waere
// fuer immer unloeschbar. Deshalb `mit_zahlungen: true`: derselbe zweite,
// ausdrueckliche Aufruf wie `mit_zuordnungen` bei handleSparteLoeschen.
// Der erste Aufruf sperrt weiterhin und nennt die Zahlen -- niemand
// loescht 36.876 Euro Zahlungseingaenge aus Versehen.
async function handleLaufVerwerfen(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen) {
    return json({ error: "Nur der Schatzmeister kann einen Lauf loeschen" }, 403, corsHeaders);
  }
  const lauf = await ladeLauf(env, body.lauf_id);
  if (!lauf) return json({ error: "Beitragslauf nicht gefunden" }, 404, corsHeaders);
  if (lauf.status === "festgeschrieben") {
    return json({ error: "Ein festgeschriebener Lauf kann nicht geloescht werden. Das ist der " +
                         "Sinn des Festschreibens -- einzelne Forderungen lassen sich noch " +
                         "stornieren.", code: "festgeschrieben" }, 409, corsHeaders);
  }

  // ⚠️ `buchung` entsteht erst in handleBuchInit -- in einer Datenbank
  // ohne eingerichtete Buchhaltung gibt es die Tabelle nicht, und ein
  // SELECT darauf wuerde die ganze Aktion werfen (gleiches Muster wie in
  // handleSammelZurueck, handleSparteLoeschen und der Sicherung).
  const buchTab = await env.VV_DB
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'buchung'")
    .first();
  if (buchTab) {
    const b = await env.VV_DB.prepare(
      "SELECT belegnummer FROM buchung WHERE storniert_am IS NULL AND (" +
      "  (quelle_typ = 'beitragslauf' AND quelle_id = ?) OR " +
      "  (quelle_typ = 'sepa_datei' AND quelle_id IN " +
      "     (SELECT id FROM sepa_datei WHERE beitragslauf_id = ?))" +
      ") LIMIT 1").bind(lauf.id, lauf.id).first();
    if (b) {
      return json({ error: "Dieser Lauf ist bereits in die Buchhaltung uebernommen (Beleg " +
                           b.belegnummer + "). Dort zuerst stornieren, dann hier loeschen.",
                    code: "in_buchhaltung" }, 409, corsHeaders);
    }
  }

  // Zwei getrennte Zaehlungen, weil zwei verschiedene Dinge passieren:
  // Zahlungen AN einer Forderung dieses Laufs gehen mit, Zahlungen an
  // einer FREMDEN Forderung werden nur von der Datei geloest und bleiben
  // stehen. Eine Summe daraus zu melden waere die Ankuendigung, mehr zu
  // loeschen als geloescht wird -- vom Pruefstand gefunden (G12).
  //
  // Beide Wege muessen gezaehlt werden: ueber die Forderung UND ueber die
  // SEPA-Datei. Ein Ruecklastschriftentgelt haengt an einer eigenen
  // Forderung ohne beitragslauf_id, gehoert aber zum Einzug dieses Laufs.
  const zSpalten =
    "SELECT COUNT(*) AS n, " +
    "  SUM(CASE WHEN storniert_am IS NULL THEN 1 ELSE 0 END) AS aktiv, " +
    "  COALESCE(SUM(CASE WHEN storniert_am IS NULL THEN betrag_cent ELSE 0 END),0) AS aktiv_cent, " +
    "  SUM(CASE WHEN storniert_am IS NOT NULL THEN 1 ELSE 0 END) AS storniert ";
  const eigen = await env.VV_DB.prepare(
    zSpalten + "FROM zahlung WHERE forderung_id IN " +
    "(SELECT id FROM forderung WHERE beitragslauf_id = ?)").bind(lauf.id).first();
  const fremd = await env.VV_DB.prepare(
    zSpalten + "FROM zahlung WHERE sepa_datei_id IN " +
    "  (SELECT id FROM sepa_datei WHERE beitragslauf_id = ?) AND " +
    "(forderung_id IS NULL OR forderung_id NOT IN " +
    "  (SELECT id FROM forderung WHERE beitragslauf_id = ?))")
    .bind(lauf.id, lauf.id).first();
  const dateien = await env.VV_DB.prepare(
    "SELECT COUNT(*) AS n FROM sepa_datei WHERE beitragslauf_id = ?").bind(lauf.id).first();

  const aktivEigen = (eigen && eigen.aktiv) || 0;
  const aktivEigenCent = (eigen && eigen.aktiv_cent) || 0;
  const aktivFremd = (fremd && fremd.aktiv) || 0;
  const aktivFremdCent = (fremd && fremd.aktiv_cent) || 0;
  const aktivGesamt = aktivEigen + aktivFremd;
  const aktivCent = aktivEigenCent + aktivFremdCent;

  // Ohne die ausdrueckliche Flagge bleibt es bei der Sperre -- der erste
  // Aufruf soll die Zahlen nennen, nicht loeschen. Mit ihr geht der Lauf
  // samt Zahlungen weg; die Entscheidung faellt beim Menschen, nicht hier.
  const mitZahlungen = body.mit_zahlungen === true;
  if (!mitZahlungen && aktivGesamt > 0) {
    return json({ error: aktivGesamt + " Zahlungen ueber " + (aktivCent / 100).toFixed(2) +
                         " EUR sind zu diesem Lauf verbucht. Entweder die Sammelbuchung " +
                         "zuruecknehmen -- oder den Lauf ausdruecklich mitsamt den Zahlungen " +
                         "loeschen.",
                  code: "zahlungen", anzahl: aktivGesamt, summeCent: aktivCent }, 409, corsHeaders);
  }

  if (body.pruefen) {
    return json({ ok: true, pruefung: true,
                  bezeichnung: lauf.bezeichnung, jahr: lauf.jahr, status: lauf.status,
                  forderungen: lauf.anzahl_erzeugt || 0, summeCent: lauf.summe_cent || 0,
                  sepaDateien: (dateien && dateien.n) || 0,
                  mitZahlungen: mitZahlungen,
                  // Was wirklich geloescht wird: alles an eigenen Forderungen.
                  // Aktive und Summe eigens, denn nur die bedeuten Geld.
                  zahlungenAktiv: aktivEigen,
                  zahlungenAktivCent: aktivEigenCent,
                  zahlungenStorniert: (eigen && eigen.storniert) || 0,
                  // Was nur den Verweis auf die Datei verliert und stehen bleibt.
                  zahlungenGeloest: (fremd && fremd.n) || 0,
                  zahlungenGeloestAktiv: aktivFremd }, 200, corsHeaders);
  }

  // Reihenfolge wegen der Fremdschluessel: zahlung -> forderung ->
  // sepa_datei -> beitragslauf. Der UPDATE dazwischen entkoppelt die
  // stornierten Zahlungen fremder Forderungen, die nur ueber die Datei
  // an diesem Lauf haengen -- die bleiben stehen, sie gehoeren woanders
  // hin.
  await env.VV_DB.batch([
    env.VV_DB.prepare("DELETE FROM zahlung WHERE forderung_id IN " +
      "(SELECT id FROM forderung WHERE beitragslauf_id = ?)").bind(lauf.id),
    env.VV_DB.prepare("UPDATE zahlung SET sepa_datei_id = NULL WHERE sepa_datei_id IN " +
      "(SELECT id FROM sepa_datei WHERE beitragslauf_id = ?)").bind(lauf.id),
    env.VV_DB.prepare("DELETE FROM forderung WHERE beitragslauf_id = ?").bind(lauf.id),
    env.VV_DB.prepare("DELETE FROM sepa_datei WHERE beitragslauf_id = ?").bind(lauf.id),
    env.VV_DB.prepare("DELETE FROM beitragslauf WHERE id = ?").bind(lauf.id)
  ]);
  // ⚠️ Geloescht wird ALLES an eigenen Forderungen, nicht nur das
  // Stornierte -- seit `mit_zahlungen` koennen aktive dabei sein. Stuende
  // hier weiter nur die Zahl der stornierten, wuerde das Protokoll den
  // Vorgang kleiner ausweisen, als er war.
  await protokolliere(env, me.username, "beitragslauf-geloescht", "beitragslauf", lauf.id,
                      { jahr: lauf.jahr, bezeichnung: lauf.bezeichnung, status: lauf.status,
                        anzahl: lauf.anzahl_erzeugt, summeCent: lauf.summe_cent,
                        sepaDateien: (dateien && dateien.n) || 0,
                        mitZahlungen: mitZahlungen,
                        zahlungenGeloescht: (eigen && eigen.n) || 0,
                        zahlungenAktivGeloescht: aktivEigen,
                        zahlungenAktivCent: aktivEigenCent,
                        zahlungenGeloest: (fremd && fremd.n) || 0 });
  return json({ ok: true, bezeichnung: lauf.bezeichnung,
                forderungen: lauf.anzahl_erzeugt || 0,
                sepaDateien: (dateien && dateien.n) || 0,
                zahlungenGeloescht: (eigen && eigen.n) || 0,
                zahlungenAktivGeloescht: aktivEigen,
                zahlungenAktivCent: aktivEigenCent }, 200, corsHeaders);
}

// ---------------------------------------------------------------------
// SEPA-Lastschrift, pain.008.001.02
// ---------------------------------------------------------------------
//
// Der SEPA-Zeichensatz kennt keine Umlaute. Ein "ue" im Namen des
// Kontoinhabers weist die KOMPLETTE Einreichung ab, nicht die eine
// Zeile -- deshalb erst lesbar transliterieren, dann alles Verbliebene
// auf ein Leerzeichen. Uebernommen aus Trainerdaten, wo derselbe
// Zeichensatz fuer pain.001 gilt.
const SEPA_UMLAUTE = {
  "ä": "ae", "ö": "oe", "ü": "ue",
  "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss",
  "á": "a", "à": "a", "â": "a", "é": "e", "è": "e", "ê": "e",
  "í": "i", "ì": "i", "ó": "o", "ò": "o", "ô": "o",
  "ú": "u", "ù": "u", "û": "u", "ç": "c", "ñ": "n",
  "ł": "l", "ś": "s", "ź": "z", "ż": "z", "ć": "c",
  "&": "+", "–": "-", "—": "-", "…": "."
};

function sepaText(roh, maxLaenge) {
  const s = String(roh === null || roh === undefined ? "" : roh)
    .split("")
    .map((z) => (Object.prototype.hasOwnProperty.call(SEPA_UMLAUTE, z) ? SEPA_UMLAUTE[z] : z))
    .join("")
    .replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return maxLaenge ? s.slice(0, maxLaenge) : s;
}

function xmlEsc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function centAlsBetrag(cent) {
  return (cent / 100).toFixed(2);
}

// Grobe Vorlaufzeit in Bankarbeitstagen -- Feiertage kennt diese
// Rechnung nicht. Sie blockiert deshalb nichts, sie warnt nur: die
// letzte Entscheidung darueber trifft ohnehin die Bank.
function bankarbeitstage(vonIso, bisIso) {
  const a = vonIso.split("-").map(Number);
  const b = bisIso.split("-").map(Number);
  let t = Date.UTC(a[0], a[1] - 1, a[2]);
  const ziel = Date.UTC(b[0], b[1] - 1, b[2]);
  let tage = 0;
  while (t < ziel) {
    t += 86400000;
    const wt = new Date(t).getUTCDay();
    if (wt !== 0 && wt !== 6) tage++;
  }
  return tage;
}

// Ein Einzug je HAUSHALT, nicht je Forderung: eine Familie mit drei
// Kindern sieht eine Abbuchung auf dem Kontoauszug, nicht drei. Die
// Mitgliedsnummern stehen im Verwendungszweck, damit die Zuordnung
// trotzdem eindeutig bleibt.
async function handleSepaErzeugen(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen) {
    return json({ error: "Nur der Schatzmeister kann eine SEPA-Datei erzeugen" }, 403, corsHeaders);
  }

  const lauf = await ladeLauf(env, body.lauf_id);
  if (!lauf) return json({ error: "Beitragslauf nicht gefunden" }, 404, corsHeaders);
  if (lauf.status !== "fertig" && lauf.status !== "festgeschrieben") {
    return json({ error: "Der Beitragslauf ist noch nicht vollstaendig durchgelaufen" }, 409, corsHeaders);
  }

  const cfg = await ladeEinstellungen(env);
  if (!cfg) return json({ error: EINRICHTUNG_FEHLT, code: "einrichtung" }, 409, corsHeaders);
  const fehlend = Object.keys(EINSTELLUNGEN)
    .filter((s) => EINSTELLUNGEN[s].pflicht && !cfg[s])
    .map((s) => EINSTELLUNGEN[s].label);
  if (fehlend.length) {
    return json({ error: "Vereinsstammdaten unvollstaendig: " + fehlend.join(", "),
                  code: "stammdaten" }, 400, corsHeaders);
  }
  if (!ibanGueltig(cfg.verein_iban)) {
    return json({ error: "Die hinterlegte Vereins-IBAN ist ungueltig" }, 400, corsHeaders);
  }

  const nurPruefen = !!body.pruefen;
  const ausfuehrung = istIsoDatum(body.ausfuehrung_am) ? body.ausfuehrung_am : lauf.faelligkeit;

  const schon = await env.VV_DB.prepare(
    "SELECT COUNT(*) AS n FROM sepa_datei WHERE beitragslauf_id = ?").bind(lauf.id).first();
  if (!nurPruefen && schon && schon.n > 0 && !body.trotzdem) {
    return json({ error: "Zu diesem Lauf wurde bereits eine SEPA-Datei erzeugt",
                  code: "schon_erzeugt", vorhanden: schon.n }, 409, corsHeaders);
  }

  const r = await env.VV_DB.prepare(
    "SELECT f.id AS forderung_id, f.betrag_cent, f.haushalt_id, " +
    "       m.mitgliedsnummer, p.vorname, p.nachname, " +
    "       h.zahlungsart, " +
    "       md.id AS mandat_id, md.referenz, md.kontoinhaber, md.iban, md.bic, " +
    "       md.erteilt_am, md.erste_nutzung_am " +
    "FROM forderung f " +
    "JOIN mitgliedschaft m ON m.id = f.mitgliedschaft_id " +
    "JOIN person p ON p.id = m.person_id " +
    "JOIN haushalt h ON h.id = f.haushalt_id " +
    "LEFT JOIN sepa_mandat md ON md.haushalt_id = h.id AND md.widerrufen_am IS NULL " +
    "WHERE f.beitragslauf_id = ? AND f.status = 'offen' AND f.storniert_am IS NULL " +
    "ORDER BY f.haushalt_id, m.mitgliedsnummer"
  ).bind(lauf.id).all();

  const haushalte = new Map();
  for (const z of r.results || []) {
    if (!haushalte.has(z.haushalt_id)) {
      haushalte.set(z.haushalt_id, {
        haushalt_id: z.haushalt_id, zahlungsart: z.zahlungsart,
        mandat_id: z.mandat_id, referenz: z.referenz, kontoinhaber: z.kontoinhaber,
        iban: z.iban, bic: z.bic, erteilt_am: z.erteilt_am, erste_nutzung_am: z.erste_nutzung_am,
        betrag_cent: 0, nummern: [], namen: [], forderungen: []
      });
    }
    const h = haushalte.get(z.haushalt_id);
    h.betrag_cent += z.betrag_cent;
    h.nummern.push(z.mitgliedsnummer);
    h.namen.push((z.vorname + " " + z.nachname).trim());
    h.forderungen.push(z.forderung_id);
  }

  const posten = [];
  const uebersprungen = [];
  for (const h of haushalte.values()) {
    const wer = h.namen[0] + (h.namen.length > 1 ? " (+" + (h.namen.length - 1) + ")" : "");
    if (h.zahlungsart && h.zahlungsart !== "lastschrift") {
      uebersprungen.push({ name: wer, grund: "zahlt nicht per Lastschrift", betrag_cent: h.betrag_cent }); continue;
    }
    if (!h.mandat_id) {
      uebersprungen.push({ name: wer, grund: "kein SEPA-Mandat", betrag_cent: h.betrag_cent }); continue;
    }
    if (!h.iban) {
      uebersprungen.push({ name: wer, grund: "keine IBAN im Mandat", betrag_cent: h.betrag_cent }); continue;
    }
    if (!ibanGueltig(h.iban)) {
      uebersprungen.push({ name: wer, grund: "IBAN ungueltig (Pruefziffer)", betrag_cent: h.betrag_cent }); continue;
    }
    if (h.betrag_cent <= 0) {
      uebersprungen.push({ name: wer, grund: "Betrag 0,00", betrag_cent: h.betrag_cent }); continue;
    }
    posten.push(h);
  }

  const summeCent = posten.reduce((s, p) => s + p.betrag_cent, 0);
  const heute = new Date();
  const heuteIso = heute.getUTCFullYear() + "-" +
    String(heute.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(heute.getUTCDate()).padStart(2, "0");

  const warnungen = [];
  const frstAnzahl = posten.filter((p) => !p.erste_nutzung_am).length;
  const tage = bankarbeitstage(heuteIso, ausfuehrung);
  if (ausfuehrung <= heuteIso) {
    warnungen.push("Das Ausfuehrungsdatum liegt nicht in der Zukunft.");
  } else if (frstAnzahl && tage < 5) {
    warnungen.push("Erstlastschriften brauchen ueblicherweise 5 Bankarbeitstage Vorlauf, hier sind es " + tage + ".");
  } else if (tage < 2) {
    warnungen.push("Folgelastschriften brauchen ueblicherweise 2 Bankarbeitstage Vorlauf, hier sind es " + tage + ".");
  }

  if (nurPruefen) {
    return json({
      ok: true, pruefung: true, anzahl: posten.length, summeCent,
      erstlastschriften: frstAnzahl, folgelastschriften: posten.length - frstAnzahl,
      uebersprungen: uebersprungen.slice(0, 50), uebersprungenGesamt: uebersprungen.length,
      uebersprungenSumme: uebersprungen.reduce((s, u) => s + u.betrag_cent, 0),
      ausfuehrung, warnungen
    }, 200, corsHeaders);
  }

  if (!posten.length) {
    return json({ error: "Kein einziger Posten einziehbar -- siehe Probelauf" }, 400, corsHeaders);
  }

  // ⚠️ Bei einem Rhythmus stehen vier Dateien desselben Jahres beim
  // Mitglied auf dem Kontoauszug. Ohne die Rate im Verwendungszweck
  // waeren sie nicht auseinanderzuhalten -- und genau daran haengt die
  // Rueckfrage "wofuer war die zweite Abbuchung?". Die Kennungen tragen
  // sie aus demselben Grund mit.
  const pInfo = periodeInfo(lauf.periode);
  const pTeil = pInfo.kurz ? pInfo.kurz : "";
  const pText = pInfo.periode === "jahr" ? "" : pInfo.text;

  const msgId = sepaText("VV" + lauf.jahr + pTeil + "-" + heute.getTime().toString(36).toUpperCase(), 35);
  const zweckMuster = cfg.verwendungszweck || "Mitgliedsbeitrag {jahr}";
  // Wer {periode} selbst ins Muster setzt, bestimmt die Stelle; sonst
  // haengt sie hinten an. Ein Jahreslauf setzt an beiden Wegen nichts
  // ein und sieht damit aus wie bisher.
  let zweckBasis = zweckMuster.replace(/\{jahr\}/g, String(lauf.jahr));
  if (/\{periode\}/.test(zweckMuster)) {
    zweckBasis = zweckBasis.replace(/\{periode\}/g, pText).replace(/\s{2,}/g, " ").trim();
  } else if (pText) {
    zweckBasis += " " + pText;
  }

  // FRST und RCUR duerfen nicht im selben Zahlungsblock stehen. Getrennte
  // PmtInf-Bloecke, aber EINE Datei -- so erwartet es das Regelwerk.
  const gruppen = [
    { seq: "FRST", liste: posten.filter((p) => !p.erste_nutzung_am) },
    { seq: "RCUR", liste: posten.filter((p) => p.erste_nutzung_am) }
  ].filter((g) => g.liste.length);

  let lfd = 0;
  const bloecke = gruppen.map((g) => {
    const gSumme = g.liste.reduce((s, p) => s + p.betrag_cent, 0);
    const txe = g.liste.map((p) => {
      lfd++;
      const zweck = sepaText(zweckBasis + " Nr. " + p.nummern.join(", "), 140);
      const e2e = sepaText("B" + lauf.jahr + pTeil + "-" + p.nummern[0] + "-" + lfd, 35);
      const bic = sepaText(p.bic, 11).replace(/[^A-Z0-9]/gi, "").toUpperCase();
      const agent = bic
        ? "<FinInstnId><BIC>" + xmlEsc(bic) + "</BIC></FinInstnId>"
        : "<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>";
      return "" +
        "      <DrctDbtTxInf>\n" +
        "        <PmtId><EndToEndId>" + xmlEsc(e2e) + "</EndToEndId></PmtId>\n" +
        "        <InstdAmt Ccy=\"EUR\">" + centAlsBetrag(p.betrag_cent) + "</InstdAmt>\n" +
        "        <DrctDbtTx><MndtRltdInf><MndtId>" + xmlEsc(sepaText(p.referenz, 35)) + "</MndtId>" +
        "<DtOfSgntr>" + xmlEsc(String(p.erteilt_am || "").slice(0, 10)) + "</DtOfSgntr>" +
        "<AmdmntInd>false</AmdmntInd></MndtRltdInf></DrctDbtTx>\n" +
        "        <DbtrAgt>" + agent + "</DbtrAgt>\n" +
        "        <Dbtr><Nm>" + xmlEsc(sepaText(p.kontoinhaber || p.namen[0], 70)) + "</Nm></Dbtr>\n" +
        "        <DbtrAcct><Id><IBAN>" +
        xmlEsc(String(p.iban).replace(/\s+/g, "").toUpperCase()) + "</IBAN></Id></DbtrAcct>\n" +
        "        <RmtInf><Ustrd>" + xmlEsc(zweck) + "</Ustrd></RmtInf>\n" +
        "      </DrctDbtTxInf>";
    }).join("\n");

    const cdtrBic = sepaText(cfg.verein_bic, 11).replace(/[^A-Z0-9]/gi, "").toUpperCase();
    return "" +
      "    <PmtInf>\n" +
      "      <PmtInfId>" + xmlEsc(msgId + "-" + g.seq) + "</PmtInfId>\n" +
      "      <PmtMtd>DD</PmtMtd>\n" +
      "      <BtchBookg>true</BtchBookg>\n" +
      "      <NbOfTxs>" + g.liste.length + "</NbOfTxs>\n" +
      "      <CtrlSum>" + centAlsBetrag(gSumme) + "</CtrlSum>\n" +
      "      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Cd>CORE</Cd></LclInstrm>" +
      "<SeqTp>" + g.seq + "</SeqTp></PmtTpInf>\n" +
      "      <ReqdColltnDt>" + xmlEsc(ausfuehrung) + "</ReqdColltnDt>\n" +
      "      <Cdtr><Nm>" + xmlEsc(sepaText(cfg.verein_name, 70)) + "</Nm></Cdtr>\n" +
      "      <CdtrAcct><Id><IBAN>" +
      xmlEsc(String(cfg.verein_iban).replace(/\s+/g, "").toUpperCase()) + "</IBAN></Id></CdtrAcct>\n" +
      "      <CdtrAgt>" + (cdtrBic
        ? "<FinInstnId><BIC>" + xmlEsc(cdtrBic) + "</BIC></FinInstnId>"
        : "<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>") + "</CdtrAgt>\n" +
      "      <ChrgBr>SLEV</ChrgBr>\n" +
      "      <CdtrSchmeId><Id><PrvtId><Othr><Id>" +
      xmlEsc(sepaText(cfg.glaeubiger_id, 35).replace(/\s+/g, "")) +
      "</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>\n" +
      txe + "\n" +
      "    </PmtInf>";
  });

  const xml = "" +
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
    "<Document xmlns=\"urn:iso:std:iso:20022:tech:xsd:pain.008.001.02\" " +
    "xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\n" +
    "  <CstmrDrctDbtInitn>\n" +
    "    <GrpHdr>\n" +
    "      <MsgId>" + xmlEsc(msgId) + "</MsgId>\n" +
    "      <CreDtTm>" + heute.toISOString().slice(0, 19) + "</CreDtTm>\n" +
    "      <NbOfTxs>" + posten.length + "</NbOfTxs>\n" +
    "      <CtrlSum>" + centAlsBetrag(summeCent) + "</CtrlSum>\n" +
    "      <InitgPty><Nm>" + xmlEsc(sepaText(cfg.verein_name, 70)) + "</Nm></InitgPty>\n" +
    "    </GrpHdr>\n" +
    bloecke.join("\n") + "\n" +
    "  </CstmrDrctDbtInitn>\n" +
    "</Document>\n";

  const jetzt = new Date().toISOString();
  const dateiId = uuid();
  // Die Forderungs-Ids mit ablegen: nur so kann die Sammelbuchung spaeter
  // genau die Posten als bezahlt buchen, die wirklich in dieser Datei
  // standen -- und nicht das, was zum Buchungszeitpunkt offen aussieht.
  const enthaltene = posten.reduce((a, p) => a.concat(p.forderungen), []);
  const anweisungen = [env.VV_DB.prepare(
    "INSERT INTO sepa_datei (id, beitragslauf_id, msg_id, erstellt_datum, ausfuehrung_am, seq_typ, " +
    "anzahl_posten, summe_cent, forderungen_json, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(dateiId, lauf.id, msgId, heuteIso, ausfuehrung,
         gruppen.map((g) => g.seq).join("+"), posten.length, summeCent,
         JSON.stringify(enthaltene), jetzt, me.username)];

  // Erste Nutzung nur setzen, wo sie noch fehlt -- ab dann ist es eine
  // Folgelastschrift. Bloecke zu 50 wegen der Parametergrenze.
  const frstIds = posten.filter((p) => !p.erste_nutzung_am).map((p) => p.mandat_id);
  const alleIds = posten.map((p) => p.mandat_id);
  for (let i = 0; i < frstIds.length; i += 50) {
    const b = frstIds.slice(i, i + 50);
    anweisungen.push(env.VV_DB.prepare(
      "UPDATE sepa_mandat SET erste_nutzung_am = ? WHERE erste_nutzung_am IS NULL AND id IN (" +
      b.map(() => "?").join(",") + ")").bind(ausfuehrung, ...b));
  }
  for (let i = 0; i < alleIds.length; i += 50) {
    const b = alleIds.slice(i, i + 50);
    anweisungen.push(env.VV_DB.prepare(
      "UPDATE sepa_mandat SET letzte_nutzung_am = ? WHERE id IN (" +
      b.map(() => "?").join(",") + ")").bind(ausfuehrung, ...b));
  }

  await env.VV_DB.batch(anweisungen);
  await protokolliere(env, me.username, "sepa-datei-erzeugt", "sepa_datei", dateiId,
                      { lauf: lauf.id, anzahl: posten.length, summeCent, msgId });

  return json({
    ok: true, msgId, dateiId,
    anzahl: posten.length, summeCent, ausfuehrung,
    erstlastschriften: frstAnzahl, folgelastschriften: posten.length - frstAnzahl,
    uebersprungen: uebersprungen.slice(0, 50), uebersprungenGesamt: uebersprungen.length,
    warnungen,
    dateiname: "SEPA-Beitrag-" + lauf.jahr + "-" + heuteIso + ".xml",
    xml
  }, 200, corsHeaders);
}

// ---------------------------------------------------------------------
// Zahlungseingaenge, Ruecklastschriften, offene Posten
// ---------------------------------------------------------------------
//
// forderung.status wird NIE von Hand gesetzt, sondern immer aus den
// Zahlungen abgeleitet. Sonst laufen die beiden auseinander, und dann
// steht in der offenen-Posten-Liste etwas anderes als auf dem Konto.
// Diese eine Anweisung rechnet den Status fuer beliebig viele
// Forderungen neu -- mengenbasiert, nicht je Zeile.
function statusNeuBerechnen(env, ids) {
  const p = ids.map(() => "?").join(",");
  return env.VV_DB.prepare(
    "UPDATE forderung SET status = CASE " +
    "  WHEN storniert_am IS NOT NULL THEN 'storniert' " +
    "  WHEN (SELECT COALESCE(SUM(z.betrag_cent),0) FROM zahlung z " +
    "        WHERE z.forderung_id = forderung.id AND z.storniert_am IS NULL) >= betrag_cent THEN 'bezahlt' " +
    "  WHEN (SELECT COALESCE(SUM(z.betrag_cent),0) FROM zahlung z " +
    "        WHERE z.forderung_id = forderung.id AND z.storniert_am IS NULL) > 0 THEN 'teilbezahlt' " +
    "  ELSE 'offen' END " +
    "WHERE id IN (" + p + ")"
  ).bind(...ids);
}

// Bucht eine ganze SEPA-Datei als eingegangen. Das ist der Normalfall:
// von 441 Einzuegen kommen 435 durch, und die sechs Ruecklaeufer werden
// danach einzeln erfasst. Andersherum -- 441 Zahlungen von Hand -- macht
// das niemand.
async function handleZahlungSammel(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen) {
    return json({ error: "Nur der Schatzmeister kann Zahlungen verbuchen" }, 403, corsHeaders);
  }

  const datei = await env.VV_DB.prepare("SELECT * FROM sepa_datei WHERE id = ?")
    .bind(String(body.sepa_datei_id || "")).first();
  if (!datei) return json({ error: "SEPA-Datei nicht gefunden" }, 404, corsHeaders);
  if (datei.gebucht_am && !body.trotzdem) {
    return json({ error: "Diese Datei wurde am " + datei.gebucht_am.slice(0, 10) + " bereits gebucht",
                  code: "schon_gebucht" }, 409, corsHeaders);
  }

  let ids = [];
  try { ids = JSON.parse(datei.forderungen_json || "[]"); } catch { ids = []; }
  if (!ids.length) {
    return json({ error: "Zu dieser Datei sind keine Forderungen vermerkt. Sie stammt aus einer " +
                         "Fassung vor dieser Funktion und muss einzeln gebucht werden." }, 409, corsHeaders);
  }

  const eingang = istIsoDatum(body.eingang_am) ? body.eingang_am : datei.ausfuehrung_am;

  // Nur was noch nicht bezahlt ist. Ein zweiter Klick darf nicht doppelt
  // buchen -- und eine zwischenzeitlich stornierte Forderung nicht wieder
  // aufleben lassen.
  const offen = [];
  for (let i = 0; i < ids.length; i += 50) {
    const b = ids.slice(i, i + 50);
    const r = await env.VV_DB.prepare(
      "SELECT f.id, f.haushalt_id, f.betrag_cent, f.status, " +
      "  (SELECT COALESCE(SUM(z.betrag_cent),0) FROM zahlung z " +
      "   WHERE z.forderung_id = f.id AND z.storniert_am IS NULL) AS bezahlt " +
      "FROM forderung f WHERE f.storniert_am IS NULL AND f.id IN (" + b.map(() => "?").join(",") + ")"
    ).bind(...b).all();
    for (const z of r.results || []) if (z.bezahlt < z.betrag_cent) offen.push(z);
  }

  const summe = offen.reduce((s, z) => s + (z.betrag_cent - z.bezahlt), 0);
  if (body.pruefen) {
    return json({ ok: true, pruefung: true, anzahl: offen.length, summeCent: summe,
                  inDatei: ids.length, eingang }, 200, corsHeaders);
  }
  if (!offen.length) {
    return json({ error: "Alle Posten dieser Datei sind bereits verbucht" }, 409, corsHeaders);
  }

  const jetzt = new Date().toISOString();
  const anweisungen = [];
  for (const z of offen) {
    anweisungen.push(env.VV_DB.prepare(
      "INSERT INTO zahlung (id, forderung_id, haushalt_id, sepa_datei_id, betrag_cent, eingang_am, " +
      "art, verwendungszweck, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,'lastschrift',?,?,?)"
    ).bind(uuid(), z.id, z.haushalt_id, datei.id, z.betrag_cent - z.bezahlt, eingang,
           "SEPA-Einzug " + datei.msg_id, jetzt, me.username));
  }
  const alleIds = offen.map((z) => z.id);
  for (let i = 0; i < alleIds.length; i += 50) {
    anweisungen.push(statusNeuBerechnen(env, alleIds.slice(i, i + 50)));
  }
  anweisungen.push(env.VV_DB.prepare("UPDATE sepa_datei SET gebucht_am = ? WHERE id = ?")
    .bind(jetzt, datei.id));

  await env.VV_DB.batch(anweisungen);
  await protokolliere(env, me.username, "sepa-datei-gebucht", "sepa_datei", datei.id,
                      { anzahl: offen.length, summeCent: summe });
  return json({ ok: true, anzahl: offen.length, summeCent: summe, eingang }, 200, corsHeaders);
}

// Nimmt eine Sammelbuchung zurueck, die es nie gegeben hat. Anlass am
// 10.08.2026: der Download der SEPA-Datei ging verloren, die Datei wurde
// nie bei der Bank eingereicht -- gebucht war sie trotzdem. Damit stand
// der ganze Lauf auf 'bezahlt', obwohl kein Cent geflossen war, und es
// liess sich keine neue Datei erzeugen (kein Posten mehr offen).
//
// Storniert wird, nicht geloescht (GoBD, gleiche Regel wie bei der
// Ruecklastschrift) -- der Vorgang bleibt mit Grund und Urheber sichtbar.
// Der Forderungsstatus wird auch hier nur abgeleitet, nie gesetzt.
async function handleSammelZurueck(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen) {
    return json({ error: "Nur der Schatzmeister kann eine Sammelbuchung zuruecknehmen" }, 403, corsHeaders);
  }

  const datei = await env.VV_DB.prepare("SELECT * FROM sepa_datei WHERE id = ?")
    .bind(String(body.sepa_datei_id || "")).first();
  if (!datei) return json({ error: "SEPA-Datei nicht gefunden" }, 404, corsHeaders);
  if (!datei.gebucht_am) {
    return json({ error: "Diese Datei ist gar nicht als eingegangen gebucht",
                  code: "nicht_gebucht" }, 409, corsHeaders);
  }

  // Ist der Vorgang schon in der Buchhaltung, endet der Weg hier: dort
  // wird storniert, sonst zeigt das Forderungskonto etwas anderes als die
  // Beitragsverwaltung. ⚠️ `buchung` entsteht erst in handleBuchInit --
  // in einer Datenbank ohne Buchhaltung gibt es die Tabelle nicht, und
  // ein SELECT darauf wuerde die ganze Aktion werfen (gleiches Muster wie
  // bei handleSparteLoeschen und der Sicherung).
  const buchTab = await env.VV_DB
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'buchung'")
    .first();
  if (buchTab) {
    const b = await env.VV_DB.prepare(
      "SELECT belegnummer FROM buchung WHERE quelle_typ = 'sepa_datei' AND quelle_id = ? " +
      "AND storniert_am IS NULL LIMIT 1").bind(datei.id).first();
    if (b) {
      return json({ error: "Dieser Einzug ist bereits in die Buchhaltung uebernommen (Beleg " +
                           b.belegnummer + "). Dort zuerst stornieren, dann hier zuruecknehmen.",
                    code: "in_buchhaltung" }, 409, corsHeaders);
    }
  }

  const r = await env.VV_DB.prepare(
    "SELECT id, forderung_id, haushalt_id, betrag_cent FROM zahlung " +
    "WHERE sepa_datei_id = ? AND storniert_am IS NULL").bind(datei.id).all();
  const zahlungen = r.results || [];
  const summe = zahlungen.reduce((s, z) => s + z.betrag_cent, 0);

  if (body.pruefen) {
    return json({ ok: true, pruefung: true, anzahl: zahlungen.length, summeCent: summe,
                  gebuchtAm: datei.gebucht_am, msgId: datei.msg_id }, 200, corsHeaders);
  }
  if (!zahlungen.length) {
    return json({ error: "Zu dieser Datei steht keine Zahlung mehr, die zurueckgenommen werden " +
                         "koennte -- alle sind bereits storniert. Einzelne Zahlungen werden unter " +
                         "Zahlungen erfasst." }, 409, corsHeaders);
  }

  const jetzt = new Date().toISOString();
  const grund = String(body.grund || "").trim().slice(0, 200) ||
                "Sammelbuchung zurueckgenommen -- Einzug hat nicht stattgefunden";

  // Ein UPDATE ueber die Dateikennung statt 441 Einzelanweisungen: keine
  // Parametergrenze, kein Block, und es kann keine Zahlung uebersehen.
  const anweisungen = [env.VV_DB.prepare(
    "UPDATE zahlung SET storniert_am = ?, storniert_von = ?, storno_grund = ? " +
    "WHERE sepa_datei_id = ? AND storniert_am IS NULL"
  ).bind(jetzt, me.username, grund, datei.id)];

  const fIds = Array.from(new Set(zahlungen.map((z) => z.forderung_id).filter(Boolean)));
  for (let i = 0; i < fIds.length; i += 50) {
    anweisungen.push(statusNeuBerechnen(env, fIds.slice(i, i + 50)));
  }
  anweisungen.push(env.VV_DB.prepare("UPDATE sepa_datei SET gebucht_am = NULL WHERE id = ?")
    .bind(datei.id));

  await env.VV_DB.batch(anweisungen);

  await protokolliere(env, me.username, "sepa-buchung-zurueckgenommen", "sepa_datei", datei.id,
                      { anzahl: zahlungen.length, summeCent: summe, grund,
                        warGebuchtAm: datei.gebucht_am });
  return json({ ok: true, anzahl: zahlungen.length, summeCent: summe,
                msgId: datei.msg_id }, 200, corsHeaders);
}

// Einzelzahlung. Ohne forderung_id wird auf die offenen Forderungen des
// Haushalts verteilt, aelteste zuerst -- so, wie es jede Buchhaltung
// macht, wenn der Zahler keinen Verwendungszweck angibt.
async function handleZahlungErfassen(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen) {
    return json({ error: "Nur der Schatzmeister kann Zahlungen verbuchen" }, 403, corsHeaders);
  }

  let betrag = parseInt(body.betrag_cent, 10);
  if (!Number.isFinite(betrag) || betrag <= 0) {
    return json({ error: "Betrag fehlt oder ist nicht plausibel" }, 400, corsHeaders);
  }
  const eingang = istIsoDatum(body.eingang_am) ? body.eingang_am
                                               : new Date().toISOString().slice(0, 10);
  const art = ["ueberweisung", "bar", "lastschrift", "verrechnung"].indexOf(String(body.art)) > -1
    ? String(body.art) : "ueberweisung";

  let zeilen;
  if (body.forderung_id) {
    const f = await env.VV_DB.prepare(
      "SELECT f.id, f.haushalt_id, f.betrag_cent, " +
      "  (SELECT COALESCE(SUM(z.betrag_cent),0) FROM zahlung z " +
      "   WHERE z.forderung_id = f.id AND z.storniert_am IS NULL) AS bezahlt " +
      "FROM forderung f WHERE f.id = ? AND f.storniert_am IS NULL"
    ).bind(String(body.forderung_id)).first();
    if (!f) return json({ error: "Forderung nicht gefunden oder storniert" }, 404, corsHeaders);
    zeilen = [f];
  } else if (body.haushalt_id) {
    const r = await env.VV_DB.prepare(
      "SELECT f.id, f.haushalt_id, f.betrag_cent, " +
      "  (SELECT COALESCE(SUM(z.betrag_cent),0) FROM zahlung z " +
      "   WHERE z.forderung_id = f.id AND z.storniert_am IS NULL) AS bezahlt " +
      "FROM forderung f WHERE f.haushalt_id = ? AND f.storniert_am IS NULL " +
      "  AND f.status <> 'bezahlt' ORDER BY f.faellig_am, f.erstellt_am"
    ).bind(String(body.haushalt_id)).all();
    zeilen = (r.results || []).filter((f) => f.bezahlt < f.betrag_cent);
    if (!zeilen.length) {
      return json({ error: "Dieser Haushalt hat keine offene Forderung" }, 409, corsHeaders);
    }
  } else {
    return json({ error: "Weder Forderung noch Haushalt angegeben" }, 400, corsHeaders);
  }

  const jetzt = new Date().toISOString();
  const anweisungen = [];
  const verteilt = [];
  let rest = betrag;

  for (const f of zeilen) {
    if (rest <= 0) break;
    const noetig = f.betrag_cent - f.bezahlt;
    const teil = Math.min(rest, noetig);
    rest -= teil;
    verteilt.push({ forderung_id: f.id, betrag_cent: teil });
    anweisungen.push(env.VV_DB.prepare(
      "INSERT INTO zahlung (id, forderung_id, haushalt_id, betrag_cent, eingang_am, art, " +
      "verwendungszweck, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind(uuid(), f.id, f.haushalt_id, teil, eingang, art,
           sauber(body.verwendungszweck, 200), jetzt, me.username));
  }

  anweisungen.push(statusNeuBerechnen(env, verteilt.map((v) => v.forderung_id)));
  await env.VV_DB.batch(anweisungen);
  await protokolliere(env, me.username, "zahlung-erfasst", "haushalt",
                      zeilen[0].haushalt_id, { betrag, art, verteilt: verteilt.length });

  // Ueberzahlung wird gemeldet, nicht verrechnet. Ein Guthaben zu fuehren
  // ist Buchhaltung, nicht Beitragsverwaltung -- und still einzubehalten
  // waere das Schlechteste von beidem.
  return json({ ok: true, verteilt, ueberzahlung_cent: rest }, 200, corsHeaders);
}

// Ruecklastschrift. Die urspruengliche Zahlung wird storniert, nicht
// geloescht (GoBD), die Forderung lebt wieder auf. Das Entgelt der Bank
// wird als EIGENE Forderung angelegt, wenn es weiterberechnet wird --
// nicht auf den Beitrag aufgeschlagen, sonst laesst sich spaeter nicht
// mehr erklaeren, woraus die Summe besteht.
async function handleRuecklastschrift(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen) {
    return json({ error: "Nur der Schatzmeister kann eine Ruecklastschrift buchen" }, 403, corsHeaders);
  }

  const z = await env.VV_DB.prepare(
    "SELECT z.*, f.mitgliedschaft_id, f.jahr FROM zahlung z " +
    "JOIN forderung f ON f.id = z.forderung_id WHERE z.id = ?"
  ).bind(String(body.zahlung_id || "")).first();
  if (!z) return json({ error: "Zahlung nicht gefunden" }, 404, corsHeaders);
  if (z.storniert_am) return json({ error: "Diese Zahlung ist bereits storniert" }, 409, corsHeaders);

  const grund = sauber(body.grund, 200) || "Ruecklastschrift";
  const entgelt = parseInt(body.entgelt_cent, 10);
  const mitEntgelt = Number.isFinite(entgelt) && entgelt > 0;
  const jetzt = new Date().toISOString();
  const heute = jetzt.slice(0, 10);

  const anweisungen = [
    env.VV_DB.prepare(
      "UPDATE zahlung SET storniert_am = ?, storniert_von = ?, storno_grund = ?, " +
      "ruecklauf_grund = ?, ruecklauf_entgelt_cent = ? WHERE id = ?"
    ).bind(jetzt, me.username, grund, grund, mitEntgelt ? entgelt : null, z.id),
    statusNeuBerechnen(env, [z.forderung_id])
  ];

  let entgeltId = null;
  if (mitEntgelt && body.weiterberechnen) {
    entgeltId = uuid();
    anweisungen.push(env.VV_DB.prepare(
      "INSERT INTO forderung (id, mitgliedschaft_id, haushalt_id, art, bezeichnung, jahr, " +
      "betrag_cent, faellig_am, status, erstellt_am, erstellt_von) " +
      "VALUES (?,?,?,'ruecklastschrift',?,?,?,?,'offen',?,?)"
    ).bind(entgeltId, z.mitgliedschaft_id, z.haushalt_id,
           "Entgelt Ruecklastschrift (" + grund + ")", z.jahr, entgelt, heute, jetzt, me.username));
  }

  await env.VV_DB.batch(anweisungen);
  await protokolliere(env, me.username, "ruecklastschrift", "zahlung", z.id,
                      { grund, betrag: z.betrag_cent, entgelt: mitEntgelt ? entgelt : 0 });
  return json({ ok: true, forderungWiederOffen: z.forderung_id, entgeltForderung: entgeltId },
              200, corsHeaders);
}

// GoBD: eine Forderung wird nie geloescht, nur storniert -- mit Grund und
// Zeitstempel. Sie bleibt in jeder Auswertung sichtbar.
async function handleForderungStornieren(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen) {
    return json({ error: "Nur der Schatzmeister kann eine Forderung stornieren" }, 403, corsHeaders);
  }
  const id = String(body.forderung_id || "");
  const f = await env.VV_DB.prepare("SELECT * FROM forderung WHERE id = ?").bind(id).first();
  if (!f) return json({ error: "Forderung nicht gefunden" }, 404, corsHeaders);
  if (f.storniert_am) return json({ ok: true, schon: true }, 200, corsHeaders);

  const grund = sauber(body.grund, 200);
  if (!grund) return json({ error: "Ein Stornogrund ist erforderlich" }, 400, corsHeaders);

  const jetzt = new Date().toISOString();
  await env.VV_DB.batch([
    env.VV_DB.prepare(
      "UPDATE forderung SET storniert_am = ?, storniert_von = ?, storno_grund = ? WHERE id = ?"
    ).bind(jetzt, me.username, grund, id),
    statusNeuBerechnen(env, [id])
  ]);
  await protokolliere(env, me.username, "forderung-storniert", "forderung", id,
                      { grund, betrag: f.betrag_cent });
  return json({ ok: true }, 200, corsHeaders);
}

// Offene Posten je Haushalt. Eine Abfrage fuer den gesamten Bestand --
// bei 540 Mitgliedern und mehreren Jahren waere eine Schleife hier der
// sichere Tod des Workers.
async function handleOffenePosten(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen && !rolle.darfSchreiben) {
    return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  }

  const heute = new Date().toISOString().slice(0, 10);
  const bedingungen = ["f.storniert_am IS NULL", "f.status <> 'bezahlt'"];
  const werte = [];
  if (body.jahr) { bedingungen.push("f.jahr = ?"); werte.push(parseInt(body.jahr, 10)); }
  if (body.nur_faellig) { bedingungen.push("f.faellig_am <= ?"); werte.push(heute); }

  const r = await env.VV_DB.prepare(
    "SELECT f.id, f.bezeichnung, f.art, f.jahr, f.betrag_cent, f.faellig_am, f.status, " +
    "       f.haushalt_id, m.mitgliedsnummer, p.vorname, p.nachname, " +
    "       (SELECT COALESCE(SUM(z.betrag_cent),0) FROM zahlung z " +
    "        WHERE z.forderung_id = f.id AND z.storniert_am IS NULL) AS bezahlt_cent " +
    "FROM forderung f " +
    "JOIN mitgliedschaft m ON m.id = f.mitgliedschaft_id " +
    "JOIN person p ON p.id = m.person_id " +
    "WHERE " + bedingungen.join(" AND ") +
    " ORDER BY f.faellig_am, p.nachname COLLATE NOCASE, p.vorname COLLATE NOCASE LIMIT 500"
  ).bind(...werte).all();

  const zeilen = (r.results || []).map((f) => ({
    id: f.id, bezeichnung: f.bezeichnung, art: f.art, jahr: f.jahr,
    mitgliedsnummer: f.mitgliedsnummer, name: (f.vorname + " " + f.nachname).trim(),
    haushalt_id: f.haushalt_id, faellig_am: f.faellig_am, status: f.status,
    betrag_cent: f.betrag_cent, bezahlt_cent: f.bezahlt_cent,
    rest_cent: f.betrag_cent - f.bezahlt_cent,
    ueberfaellig: f.faellig_am < heute
  }));

  const gesamt = await env.VV_DB.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(f.betrag_cent),0) AS soll, " +
    "  COALESCE(SUM((SELECT COALESCE(SUM(z.betrag_cent),0) FROM zahlung z " +
    "   WHERE z.forderung_id = f.id AND z.storniert_am IS NULL)),0) AS ist " +
    "FROM forderung f WHERE " + bedingungen.join(" AND ")
  ).bind(...werte).first();

  return json({
    ok: true, heute,
    zeilen,
    abgeschnitten: zeilen.length >= 500,
    anzahl: gesamt ? gesamt.n : 0,
    summeCent: gesamt ? (gesamt.soll - gesamt.ist) : 0,
    darfBuchen: rolle.istAdmin || rolle.darfBuchen
  }, 200, corsHeaders);
}

// Alle Zahlungen eines Haushalts, auch die stornierten -- gerade die
// Ruecklastschriften sind das, wonach jemand sucht.
async function handleZahlungenListe(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen && !rolle.darfSchreiben) {
    return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  }
  const haushalt = String(body.haushalt_id || "");
  if (!haushalt) return json({ error: "Kein Haushalt angegeben" }, 400, corsHeaders);

  const r = await env.VV_DB.prepare(
    "SELECT z.id, z.betrag_cent, z.eingang_am, z.art, z.verwendungszweck, " +
    "       z.storniert_am, z.storno_grund, z.ruecklauf_grund, z.ruecklauf_entgelt_cent, " +
    "       f.bezeichnung, f.jahr, m.mitgliedsnummer " +
    "FROM zahlung z LEFT JOIN forderung f ON f.id = z.forderung_id " +
    "LEFT JOIN mitgliedschaft m ON m.id = f.mitgliedschaft_id " +
    "WHERE z.haushalt_id = ? ORDER BY z.eingang_am DESC, z.erstellt_am DESC LIMIT 200"
  ).bind(haushalt).all();

  const forderungen = await env.VV_DB.prepare(
    "SELECT f.id, f.bezeichnung, f.jahr, f.art, f.betrag_cent, f.faellig_am, f.status, " +
    "       f.storniert_am, f.storno_grund, m.mitgliedsnummer, p.vorname, p.nachname, " +
    "       (SELECT COALESCE(SUM(z.betrag_cent),0) FROM zahlung z " +
    "        WHERE z.forderung_id = f.id AND z.storniert_am IS NULL) AS bezahlt_cent " +
    "FROM forderung f JOIN mitgliedschaft m ON m.id = f.mitgliedschaft_id " +
    "JOIN person p ON p.id = m.person_id " +
    "WHERE f.haushalt_id = ? ORDER BY f.jahr DESC, f.faellig_am DESC LIMIT 100"
  ).bind(haushalt).all();

  return json({
    ok: true,
    zahlungen: r.results || [],
    forderungen: (forderungen.results || []).map((f) =>
      Object.assign({}, f, { name: (f.vorname + " " + f.nachname).trim(),
                             rest_cent: f.betrag_cent - f.bezahlt_cent })),
    darfBuchen: rolle.istAdmin || rolle.darfBuchen
  }, 200, corsHeaders);
}

// ---------------------------------------------------------------------
// Mahnwesen: am 10.08.2026 auf Michels Wunsch vollstaendig entfernt
// ---------------------------------------------------------------------
//
// Hier standen MAHN_STUFE_TEXT, mahnungenErledigen, sammleMahnfaelle und
// die sechs Aktionen vv-mahnlauf / vv-mahnungen / vv-mahnung-brief /
// vv-mahnung-versendet / vv-mahnung-erledigt / vv-ausschluss-kandidaten,
// dazu die Tabelle `mahnung` und die Forderungsart 'mahngebuehr'.
//
// ⚠️ Der Ausschluss nach § 5 Abs. 3 SETZT ZWEI SCHRIFTLICHE MAHNUNGEN
// VORAUS. Die App unterstuetzt diesen Weg seitdem nicht mehr -- der
// Austrittsgrund 'ausschluss' in handleAustritt ist geblieben und
// vollzieht weiterhin einen Vorstandsbeschluss, aber die Vorstufen
// dazu muessen ausserhalb der App dokumentiert werden. Wer das
// Mahnwesen zurueckholt, findet es im Commit davor.

// Die uebernommenen Mandate wurden vom Vereinsmeister bereits genutzt --
// aus Sicht der Bank sind es Folgelastschriften, keine Erstlastschriften.
// Das kann diese App nicht wissen: im Altbestand steht kein Nutzungsdatum.
// Deshalb eine ausdrueckliche, protokollierte Handlung statt einer
// Vermutung. Sie gehoert genau hinter das Gespraech mit der Bank -- laufen
// die Altreferenzen dort weiter, ist dies der Knopf dazu; wenn nicht,
// bleibt es bei Erstlastschriften mit fuenf Tagen Vorlauf.
async function handleMandateUebernommen(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen) {
    return json({ error: "Nur der Schatzmeister kann Mandate als uebernommen kennzeichnen" }, 403, corsHeaders);
  }
  const stichtag = String(body.stichtag || "").slice(0, 10);
  if (!istIsoDatum(stichtag)) {
    return json({ error: "Datum der letzten Nutzung durch das Altsystem erforderlich" }, 400, corsHeaders);
  }

  const offen = await env.VV_DB.prepare(
    "SELECT COUNT(*) AS n FROM sepa_mandat WHERE erste_nutzung_am IS NULL AND widerrufen_am IS NULL"
  ).first();

  if (body.pruefen) {
    return json({ ok: true, pruefung: true, betroffen: offen ? offen.n : 0 }, 200, corsHeaders);
  }

  await env.VV_DB.prepare(
    "UPDATE sepa_mandat SET erste_nutzung_am = ?, geaendert_am = ?, geaendert_von = ? " +
    "WHERE erste_nutzung_am IS NULL AND widerrufen_am IS NULL"
  ).bind(stichtag, new Date().toISOString(), me.username).run();

  await protokolliere(env, me.username, "mandate-als-uebernommen", "sepa_mandat", null,
                      { stichtag, anzahl: offen ? offen.n : 0 });
  return json({ ok: true, betroffen: offen ? offen.n : 0 }, 200, corsHeaders);
}

// Vorabankuendigung (Pre-Notification). Pflicht vor jedem Einzug, und
// juristisch nur erfuellt, wenn sie ANKOMMT -- deshalb erzeugt diese
// Aktion die Liste, nicht den Versand: solange DKIM/DMARC fuer die
// Vereinsdomain fehlen, landet eine Sammelmail bei Gmail im Spam, und
// eine ungelesene Ankuendigung ist keine.
// Betrag, Faelligkeit, Mandatsreferenz und Glaeubiger-ID muessen darin
// stehen; genau diese Felder liefert sie je Zahler.
async function handleVorabankuendigung(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen) {
    return json({ error: "Nur der Schatzmeister kann die Vorabankuendigung erzeugen" }, 403, corsHeaders);
  }
  const lauf = await ladeLauf(env, body.lauf_id);
  if (!lauf) return json({ error: "Beitragslauf nicht gefunden" }, 404, corsHeaders);

  const cfg = (await ladeEinstellungen(env)) || {};
  const datei = await env.VV_DB.prepare(
    "SELECT ausfuehrung_am FROM sepa_datei WHERE beitragslauf_id = ? ORDER BY erstellt_am DESC LIMIT 1"
  ).bind(lauf.id).first();
  const faellig = datei ? datei.ausfuehrung_am : lauf.faelligkeit;

  const r = await env.VV_DB.prepare(
    "SELECT f.betrag_cent, f.haushalt_id, m.mitgliedsnummer, p.vorname, p.nachname, " +
    "       h.abw_empfaenger, h.abw_strasse, h.abw_plz, h.abw_ort, " +
    "       zp.vorname AS z_vorname, zp.nachname AS z_nachname, zp.email AS z_email, " +
    "       zp.strasse AS z_strasse, zp.plz AS z_plz, zp.ort AS z_ort, " +
    "       md.referenz, md.iban " +
    "FROM forderung f " +
    "JOIN mitgliedschaft m ON m.id = f.mitgliedschaft_id " +
    "JOIN person p ON p.id = m.person_id " +
    "JOIN haushalt h ON h.id = f.haushalt_id " +
    "LEFT JOIN person zp ON zp.id = h.zahler_person_id " +
    "LEFT JOIN sepa_mandat md ON md.haushalt_id = h.id AND md.widerrufen_am IS NULL " +
    "WHERE f.beitragslauf_id = ? AND f.status = 'offen' AND f.storniert_am IS NULL " +
    "ORDER BY f.haushalt_id, m.mitgliedsnummer"
  ).bind(lauf.id).all();

  const nach = new Map();
  for (const z of r.results || []) {
    if (!nach.has(z.haushalt_id)) {
      nach.set(z.haushalt_id, {
        empfaenger: z.abw_empfaenger || ((z.z_vorname || "") + " " + (z.z_nachname || "")).trim(),
        email: z.z_email || "",
        strasse: z.abw_strasse || z.z_strasse || "",
        plz: z.abw_plz || z.z_plz || "",
        ort: z.abw_ort || z.z_ort || "",
        mandat: z.referenz || "",
        iban: z.iban ? String(z.iban).slice(0, 4) + "…" + String(z.iban).slice(-4) : "",
        betrag_cent: 0, mitglieder: []
      });
    }
    const e = nach.get(z.haushalt_id);
    e.betrag_cent += z.betrag_cent;
    e.mitglieder.push({ nr: z.mitgliedsnummer, name: (z.vorname + " " + z.nachname).trim() });
  }

  const liste = Array.from(nach.values()).filter((e) => e.mandat);
  // Die Rate gehoert in die Ankuendigung: bei vier Einzuegen im Jahr muss
  // das Mitglied dem Schreiben entnehmen koennen, welcher davon gemeint ist.
  const pInfo = periodeInfo(lauf.periode);
  return json({
    ok: true,
    faellig, jahr: lauf.jahr,
    periode: pInfo.periode,
    periodeText: pInfo.periode === "jahr" ? "" : pInfo.text,
    bezeichnung: lauf.bezeichnung,
    glaeubiger_id: cfg.glaeubiger_id || "",
    verein_name: cfg.verein_name || "",
    anzahl: liste.length,
    mitEmail: liste.filter((e) => e.email).length,
    summeCent: liste.reduce((s, e) => s + e.betrag_cent, 0),
    empfaenger: liste
  }, 200, corsHeaders);
}

// ---------------------------------------------------------------------
// STUFE 3 -- AUFNAHMEANTRAG NACH § 4
// ---------------------------------------------------------------------
//
// Satzung § 4: ueber die Aufnahme entscheidet der Gesamtvorstand. Ein
// Antrag ist deshalb NIE eine Mitgliedschaft, und diese Tabelle ist die
// einzige, in die von aussen geschrieben wird. Entsprechend eng:
//
//   * Der Server baut den Datensatz aus einer WEISSLISTE selbst. Was in
//     pruefeAntrag nicht steht, kommt nicht in die Datenbank, auch wenn
//     es mitgeschickt wird.
//   * Jede oeffentliche Aktion prueft selbst, ob das Formular offen ist,
//     und zaehlt selbst mit, wie viele Antraege von diesem Absender schon
//     kamen. Kein gemeinsamer Vorab-Aufruf, der sich umgehen liesse
//     (Muster fahrtenbuch-extern-*).
//   * Person, Mitgliedschaft und SEPA-Mandat entstehen erst bei der
//     ANNAHME -- also nach dem Beschluss, durch eine angemeldete Person.
//     Der offene Endpunkt kann keine Mitgliedschaft erzeugen.
//
// Absichtlich KEIN Zugriffscode wie beim Fahrtenbuch: dort schreiben
// bekannte Eltern, hier soll jeder Interessierte einen Antrag stellen
// koennen. Die Bremse ist stattdessen die Unterschrift (die zeichnet kein
// Skript), das Zaehlwerk je Absender und der Schalter antrag_offen.

const ANTRAG_STATUS = new Set(["neu", "geprueft", "angenommen", "abgelehnt", "zurueckgezogen"]);

// Satzung § 4 Abs. 5: die Ehrenmitgliedschaft wird VERLIEHEN, nicht
// beantragt. Sie steht deshalb im Formular gar nicht zur Wahl.
const ANTRAG_ARTEN = new Set(["ordentlich", "ausserordentlich"]);

// Nur ein Wunsch. Die Beitragsklasse setzt die Geschaeftsstelle bei der
// Annahme -- im Bestand haengt sie nachweislich nicht am Alter.
const ANTRAG_BEITRAGSWUNSCH = new Set(["erwachsener", "jugend", "rentner"]);

// Eine Unterschrift aus dem Canvas liegt bei 5-20 KB. 150.000 Zeichen
// sind grosszuegig und halten die Zeile weit unter dem 2-MB-Limit von D1.
const UNTERSCHRIFT_MAX = 150000;

const ANTRAG_JE_IP_STUNDE = 5;
const ANTRAG_JE_IP_TAG = 20;

// Nur fuer den Mandatstext des oeffentlichen Formulars. Sind die
// Vereinsstammdaten noch nicht eingetragen, soll das Formular trotzdem
// benutzbar sein -- ein Antragsteller kann nichts dafuer.
const VEREIN_FALLBACK = "1. SC 1911 Heiligenstadt e.V.";

const EMAIL_MUSTER = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

// Alter zu einem Stichtag. Rein und einzeln testbar -- daran haengt, ob
// eine zweite Unterschrift verlangt wird.
function alterAm(geburtsdatum, stichtag) {
  const g = String(geburtsdatum || "").slice(0, 10).split("-").map(Number);
  const s = String(stichtag || "").slice(0, 10).split("-").map(Number);
  if (g.length !== 3 || !g[0] || s.length !== 3 || !s[0]) return null;
  let a = s[0] - g[0];
  if (s[1] < g[1] || (s[1] === g[1] && s[2] < g[2])) a--;
  return a;
}

// Gibt { wert } oder { fehler } zurueck. Ein zu grosses oder falsch
// gebautes Bild darf nicht als "fehlt" durchgehen -- sonst sucht jemand
// den Fehler am Zeichenfeld statt an der Dateigroesse.
function pruefeUnterschrift(roh, was) {
  const s = String(roh || "");
  if (!s) return { fehler: was + " fehlt" };
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s)) {
    return { fehler: was + ": unerwartetes Format" };
  }
  if (s.length > UNTERSCHRIFT_MAX) return { fehler: was + ": das Bild ist zu gross" };
  return { wert: s };
}

// ---------------------------------------------------------------------
// Spielerlaubnis (Nachwuchs-Anmeldung)
// ---------------------------------------------------------------------
//
// Der Antrag auf Spielerlaubnis geht an den Landesverband, nicht an den
// Verein -- der Verein fuellt ihn nur aus, stempelt und traegt ihn in
// DFBnet Pass-Online ein. Hier wird deshalb nur ERFASST, was auf dem Bogen
// stehen muss; entschieden wird nichts.
//
// Der Block ist optional: der allgemeine Aufnahmeantrag schickt ihn nicht.
// Kommt er, wird er vollstaendig geprueft -- ein halb ausgefuellter Bogen
// faellt erst beim Verband auf, und dann ist die Familie schon weg.

const SPIELERLAUBNIS_ARTEN = new Set([
  "erstausstellung", "vereinswechsel", "rueckkehrer", "namensaenderung"
]);

// (1) bereits abgemeldet, Nachweis liegt bei -- (2) noch nicht abgemeldet,
// der aufnehmende Verein wird beauftragt. Die Nummern sind die des Bogens.
const ABMELDEWEGE = new Set(["1", "2"]);

// Schluessel des abgeschotteten Nachweis-Bereichs. Der admin-worker
// vergibt ihn selbst (crypto.randomUUID ohne Bindestriche); vom Client
// kommt er nur zurueck. Ohne strenge Pruefung stuende hier irgendwann ein
// Pfad.
const NACHWEIS_OWNER_MUSTER = /^[0-9a-f]{32}$/;

// Gibt { wert } oder { fehler }. Der Aufrufer entscheidet, ob der Block
// ueberhaupt verlangt ist.
function pruefeSpielerlaubnis(roh) {
  const art = String(roh.art || "");
  if (!SPIELERLAUBNIS_ARTEN.has(art)) {
    return { fehler: "Bitte die Art der Passausstellung auswaehlen" };
  }

  const letzterVerein = sauber(roh.letzter_verein, 120);
  const landesverband = sauber(roh.landesverband, 120);
  const passNr = (sauber(roh.pass_nr, 20) || "").replace(/\s+/g, "");
  let abmeldeweg = null;

  if (art === "vereinswechsel") {
    if (!letzterVerein) {
      return { fehler: "Beim Vereinswechsel wird der abgebende Verein gebraucht" };
    }
    abmeldeweg = String(roh.abmeldeweg || "");
    if (!ABMELDEWEGE.has(abmeldeweg)) {
      // Der Bogen laesst genau diese beiden Wege zu. Bleibt das Feld leer,
      // weiss der Verband nicht, ob er auf einen Abmeldenachweis wartet
      // oder ob der aufnehmende Verein die Abmeldung uebernimmt -- und der
      // Antrag bleibt liegen.
      return { fehler: "Bitte angeben, ob die Abmeldung beim bisherigen Verein " +
                       "bereits erfolgt ist oder der Verein sie uebernehmen soll" };
    }
  }

  return {
    wert: {
      art,
      pass_nr: passNr || null,
      // Nur beim Wechsel erhoben und nur dann gespeichert -- bei einer
      // Erstausstellung gibt es keinen vorherigen Verein, und ein stehen-
      // gebliebener Wert aus einem abgebrochenen Formularweg landete sonst
      // auf dem Bogen.
      letzter_verein: art === "vereinswechsel" ? letzterVerein : null,
      landesverband: art === "vereinswechsel" ? landesverband : null,
      abmeldeweg,
      // Die Einwilligung fuer Werbung des DFB und seiner Partner ist
      // FREIWILLIG und eine eigene Erklaerung -- anderer Empfaenger,
      // anderer Zweck als die drei des Vereins. Sie darf den Antrag nicht
      // aufhalten; erteilt sie niemand, bleibt das Kaestchen auf dem Bogen
      // leer.
      einwilligung_dfb_marketing: roh.einwilligung_dfb_marketing === true
    }
  };
}

// Baut aus dem Rohkoerper einen geprueften Antrag oder gibt genau einen
// Fehlersatz zurueck. Nie halb geprueftes.
function pruefeAntrag(roh, erlaubteSparten, heute, quelle) {
  // Der vierte Parameter ist neu und bleibt optional: der allgemeine
  // Aufnahmeantrag ruft unveraendert mit dreien auf.
  const istNachwuchs = quelle === "nachwuchs";

  const vorname = sauber(roh.vorname, 80);
  const nachname = sauber(roh.nachname, 80);
  if (!vorname || !nachname) return { fehler: "Vorname und Nachname sind erforderlich" };

  const geburtsdatum = sauber(roh.geburtsdatum, 10);
  if (!geburtsdatum || !istIsoDatum(geburtsdatum)) {
    return { fehler: "Das Geburtsdatum fehlt oder ist kein gueltiges Datum" };
  }
  if (geburtsdatum > heute) return { fehler: "Das Geburtsdatum liegt in der Zukunft" };
  if (geburtsdatum < "1900-01-01") return { fehler: "Das Geburtsdatum ist nicht plausibel" };

  // Ohne vollstaendige Anschrift kann der Verein dem Mitglied nichts
  // zustellen -- weder eine Rechnung noch eine Beitragsankuendigung.
  const strasse = sauber(roh.strasse, 120);
  const plz = sauber(roh.plz, 10);
  const ort = sauber(roh.ort, 80);
  if (!strasse || !plz || !ort) return { fehler: "Bitte die vollstaendige Anschrift angeben" };

  const email = sauber(roh.email, 120);
  if (!email || !EMAIL_MUSTER.test(email)) {
    return { fehler: "Bitte eine gueltige E-Mail-Adresse angeben" };
  }

  const art = ANTRAG_ARTEN.has(roh.art) ? roh.art : "ordentlich";
  const eintrittWunsch = sauber(roh.eintritt_wunsch, 10);
  if (eintrittWunsch && !istIsoDatum(eintrittWunsch)) {
    return { fehler: "Der Eintrittswunsch ist kein gueltiges Datum" };
  }

  const sparten = Array.isArray(roh.sparten) ? roh.sparten.map(String) : [];
  if (sparten.length > 5) return { fehler: "Bitte hoechstens fuenf Abteilungen auswaehlen" };
  for (const s of sparten) {
    if (!erlaubteSparten.has(s)) return { fehler: "Unbekannte Abteilung" };
  }

  const zahlungsart = roh.zahlungsart === "ueberweisung" ? "ueberweisung" : "lastschrift";
  const iban = (sauber(roh.iban, 40) || "").replace(/\s+/g, "").toUpperCase() || null;
  const kontoinhaber = sauber(roh.kontoinhaber, 120);
  if (zahlungsart === "lastschrift") {
    if (!iban) return { fehler: "Fuer das Lastschriftmandat wird eine IBAN gebraucht" };
    if (!ibanGueltig(iban)) return { fehler: "Die IBAN ist nicht gueltig (Pruefziffer stimmt nicht)" };
    if (!kontoinhaber) return { fehler: "Bitte den Kontoinhaber angeben" };
  }

  // Satzung: die Aufnahme setzt die Anerkennung der Satzung voraus. Die
  // Foto-Einwilligung steht daneben und ist FREIWILLIG -- sie darf nicht
  // an die Aufnahme gekoppelt werden.
  if (roh.einwilligung_satzung !== true) {
    return { fehler: "Die Satzung und die Beitragsordnung muessen anerkannt werden" };
  }
  if (roh.einwilligung_datenschutz !== true) {
    return { fehler: "Bitte die Datenschutzhinweise bestaetigen" };
  }

  const unterschrift = pruefeUnterschrift(roh.unterschrift, "Die Unterschrift");
  if (unterschrift.fehler) return { fehler: unterschrift.fehler };

  // Ein Minderjaehriger kann weder wirksam beitreten noch ein Mandat
  // erteilen. Ohne die zweite Unterschrift ist der Antrag unvollstaendig.
  const alter = alterAm(geburtsdatum, heute);
  const minderjaehrig = alter !== null && alter < 18;
  let gesetzl = null;
  let gesetzlName = null;
  let gesetzl2 = null;
  let gesetzl2Name = null;
  let alleinSorge = false;
  if (minderjaehrig) {
    gesetzlName = sauber(roh.gesetzl_name, 120);
    if (!gesetzlName) {
      return { fehler: "Bei Minderjaehrigen wird der gesetzliche Vertreter gebraucht" };
    }
    gesetzl = pruefeUnterschrift(roh.unterschrift_gesetzl, "Die Unterschrift des gesetzlichen Vertreters");
    if (gesetzl.fehler) return { fehler: gesetzl.fehler };

    // Das Papierformular verlangt die Unterschrift ALLER Erziehungs-
    // berechtigten (§ 1629 BGB: die Sorge steht beiden Eltern gemeinsam
    // zu). Der Regelfall sind zwei; der Ausweg fuer Alleinsorgeberechtigte
    // ist eine ausdrueckliche Erklaerung, kein stilles Weglassen -- sonst
    // liesse sich hinterher nicht unterscheiden, ob nur einer sorge-
    // berechtigt war oder ob der zweite schlicht nicht gefragt wurde.
    alleinSorge = roh.allein_sorgeberechtigt === true;
    if (!alleinSorge) {
      gesetzl2Name = sauber(roh.gesetzl2_name, 120);
      if (!gesetzl2Name) {
        return { fehler: "Es wird die Unterschrift beider Erziehungsberechtigter gebraucht. " +
                         "Wer allein sorgeberechtigt ist, kreuzt das bitte an" };
      }
      gesetzl2 = pruefeUnterschrift(roh.unterschrift_gesetzl2,
                                    "Die Unterschrift des zweiten Erziehungsberechtigten");
      if (gesetzl2.fehler) return { fehler: gesetzl2.fehler };
    }
  }

  // Der Spielerlaubnisantrag. Nur bei der Nachwuchs-Anmeldung verlangt --
  // und dort vollstaendig, sonst faellt der halbe Bogen erst beim Verband
  // auf.
  const nationalitaet = sauber(roh.nationalitaet, 60);
  let spielerlaubnis = null;
  let nachweisOwner = null;
  if (istNachwuchs) {
    if (!nationalitaet) {
      return { fehler: "Der Verband verlangt die Staatsangehoerigkeit" };
    }
    const sp = pruefeSpielerlaubnis(roh.spielerlaubnis || {});
    if (sp.fehler) return { fehler: sp.fehler };
    spielerlaubnis = sp.wert;

    // Der Schluessel kommt vom Client zurueck, weil die Nachweise VOR dem
    // Absenden hochgeladen werden. Vergeben hat ihn der Server des
    // admin-workers; erratbar ist er nicht. Geprueft wird trotzdem: ohne
    // das Muster stuende hier irgendwann ein Pfad, und den bekaeme die
    // Geschaeftsstelle spaeter unbesehen in eine Dateiabfrage gereicht.
    const owner = String(roh.nachweis_owner || "");
    if (owner) {
      if (!NACHWEIS_OWNER_MUSTER.test(owner)) {
        return { fehler: "Der Verweis auf die hochgeladenen Nachweise ist unbrauchbar" };
      }
      nachweisOwner = owner;
    }
    // Fehlt er ganz, geht der Antrag TROTZDEM durch. Ein vollstaendig
    // ausgefuellter, unterschriebener Antrag darf nicht daran scheitern,
    // dass ein Foto zu gross war -- die Geschaeftsstelle sieht am Eintrag,
    // dass der Nachweis fehlt, und fordert ihn nach.
  }

  return {
    satz: {
      quelle: istNachwuchs ? "nachwuchs" : "antrag",
      nachweis_owner: nachweisOwner,
      inhalt: {
        anrede: sauber(roh.anrede, 20),
        vorname, nachname, geburtsdatum,
        geburtsort: sauber(roh.geburtsort, 80),
        geschlecht: ["w", "m", "d"].includes(roh.geschlecht) ? roh.geschlecht : null,
        strasse, plz, ort, email,
        telefon: sauber(roh.telefon, 40),
        mobil: sauber(roh.mobil, 40),
        art,
        eintritt_wunsch: eintrittWunsch,
        beitragsart_wunsch: ANTRAG_BEITRAGSWUNSCH.has(roh.beitragsart_wunsch)
          ? roh.beitragsart_wunsch : null,
        familie_hinweis: sauber(roh.familie_hinweis, 200),
        zahlungsart, kontoinhaber, iban,
        bic: (sauber(roh.bic, 20) || "").replace(/\s+/g, "").toUpperCase() || null,
        // Nur bei Lastschrift erhoben und nur dann gespeichert: bei
        // Ueberweisung gibt es kein Mandat, an dem sie haengen wuerden.
        bank_name: zahlungsart === "lastschrift" ? sauber(roh.bank_name, 80) : null,
        kontoinhaber_anschrift: zahlungsart === "lastschrift"
          ? sauber(roh.kontoinhaber_anschrift, 200) : null,
        // "Ort, Datum" steht auf dem Papierformular ueber beiden
        // Unterschriften. Das Datum ist der Zeitstempel; der Ort faellt
        // auf den Wohnort zurueck, statt leer zu bleiben.
        unterschrift_ort: sauber(roh.unterschrift_ort, 80) || ort,
        minderjaehrig,
        gesetzl_name: gesetzlName,
        gesetzl_verhaeltnis: minderjaehrig ? sauber(roh.gesetzl_verhaeltnis, 40) : null,
        gesetzl2_name: gesetzl2Name,
        gesetzl2_verhaeltnis: gesetzl2Name ? sauber(roh.gesetzl2_verhaeltnis, 40) : null,
        allein_sorgeberechtigt: minderjaehrig ? alleinSorge : false,
        einwilligung_satzung: true,
        einwilligung_datenschutz: true,
        einwilligung_fotos: roh.einwilligung_fotos === true,
        bemerkung: sauber(roh.bemerkung, 500),
        // Staatsangehoerigkeit und Spielerlaubnis stehen nur im
        // Nachwuchsantrag. Beim allgemeinen Aufnahmeantrag bleiben beide
        // null -- ein leerer Block im JSON saehe aus wie ein vergessenes
        // Formular.
        nationalitaet: istNachwuchs ? nationalitaet : null,
        spielerlaubnis
      },
      sparten,
      unterschrift: unterschrift.wert,
      unterschrift_gesetzl: gesetzl ? gesetzl.wert : null,
      unterschrift_gesetzl2: gesetzl2 ? gesetzl2.wert : null
    }
  };
}

// Eine Sparte stilllegen oder wieder aufnehmen. Anlass war das
// oeffentliche Formular: im Bestand stehen die neun Sammelposten des
// Vereinsmeisters NEBEN acht von Hand angelegten Abteilungen, und der
// Antragsteller sah dadurch "Dart" und "Darts" untereinander.
//
// Stilllegen ist der schonende Weg: aktiv = 0 heisst laut Schema
// "aufgeloest, Historie bleibt" -- die Zeile und jede Zuordnung bleiben
// stehen, an ihnen haengt die Beitragsgeschichte. Wer die Zeile wirklich
// loswerden will, nimmt vv-sparte-loeschen; das geht nur, wenn nichts
// mehr daran haengt.
async function handleSparteAktiv(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfSchreiben) {
    return json({ error: "Abteilungen pflegen duerfen nur Geschaeftsstelle und Schatzmeister" },
                403, corsHeaders);
  }
  const id = String(body.sparte_id || "");
  const sparte = await env.VV_DB.prepare("SELECT id, name FROM sparte WHERE id = ?").bind(id).first();
  if (!sparte) return json({ error: "Abteilung nicht gefunden" }, 404, corsHeaders);

  const aktiv = body.aktiv === true || body.aktiv === 1 || body.aktiv === "1" ? 1 : 0;
  await env.VV_DB.prepare(
    "UPDATE sparte SET aktiv = ?, geaendert_am = ?, geaendert_von = ? WHERE id = ?"
  ).bind(aktiv, new Date().toISOString(), me.username, id).run();

  await protokolliere(env, me.username, aktiv ? "sparte-aktiviert" : "sparte-stillgelegt",
                      "sparte", id, { name: sparte.name });
  return json({ ok: true, aktiv }, 200, corsHeaders);
}

// Eine Sparte wirklich loeschen -- die Zeile verschwindet, nicht nur der
// Haken. Anlass: acht der siebzehn Abteilungen waren von Hand angelegt
// worden und haben nie ein Mitglied gesehen. Stillgelegt stuenden sie
// weiter in jeder Auswahlliste der Verwaltung, nur nicht mehr im
// oeffentlichen Antragsformular.
//
// Der Server zaehlt selbst, statt der Anzeige zu glauben: die
// Mitgliederzahl aus vv-sparten zaehlt nur LAUFENDE Zuordnungen
// (austritt IS NULL, Status aktiv oder ruhend). Eine "(0)" in der
// Oberflaeche kann also beendete Zuordnungen verdecken -- die
// Fremdschluesselpruefung von D1 laesst sich davon nicht taeuschen, sie
// wirft, und der Nutzer saehe einen nackten SQL-Fehler.
//
// Drei Verweise sind harte Sperren, in keinem Fall ueberschreibbar:
//   Abteilungsleiter-Rolle -- der Nutzer haette sonst eine Rolle auf
//     eine Sparte, die es nicht mehr gibt, und faellt in ladeRolle auf
//     eine leere Spartenliste zurueck: er saehe gar kein Mitglied mehr.
//   Buchungszeile -- an einer gebuchten Kostenstelle wird nichts mehr
//     geaendert, dieselbe Regel wie beim Storno (GoBD).
//   offener Aufnahmeantrag -- die Sparte steht dort als Wunsch im JSON
//     und fiele bei der Annahme still heraus.
//
// Nur die Zuordnungen selbst lassen sich mitnehmen, und erst auf einen
// ausdruecklichen zweiten Aufruf mit mit_zuordnungen: true. Der erste
// antwortet 409 und nennt namentlich, wer noch drinsteht -- "1
// Zuordnung" allein sagt niemandem, wen er umtragen soll.
async function handleSparteLoeschen(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfSchreiben) {
    // Dieselbe Grenze wie beim Stilllegen: darfSchreiben, also
    // Geschaeftsstelle ODER Schatzmeister. Eine eigene, engere Grenze nur
    // fuers Loeschen waere eine zweite Wahrheit darueber, wer Stammdaten
    // pflegt. Abteilungsleiter und Vorstand kommen hier nicht durch.
    return json({ error: "Abteilungen pflegen duerfen nur Geschaeftsstelle und Schatzmeister" },
                403, corsHeaders);
  }
  const id = String(body.sparte_id || "");
  const sparte = await env.VV_DB.prepare("SELECT id, name FROM sparte WHERE id = ?").bind(id).first();
  if (!sparte) return json({ error: "Abteilung nicht gefunden" }, 404, corsHeaders);

  // buchungszeile entsteht erst in handleMigration/handleBuchInit. In
  // einer Datenbank ohne eingerichtete Buchhaltung gibt es die Tabelle
  // nicht, und ein SELECT darauf wuerde die ganze Zaehlung werfen.
  const buchTab = await env.VV_DB
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'buchungszeile'")
    .first();

  const zaehlSql =
    "SELECT (SELECT COUNT(*) FROM mitgliedschaft_sparte WHERE sparte_id = ?) AS zuordnungen," +
    " (SELECT COUNT(*) FROM benutzer_rolle WHERE sparte_id = ?) AS rollen," +
    " (SELECT COUNT(*) FROM aufnahmeantrag WHERE status IN ('neu','geprueft')" +
    "   AND sparten_json LIKE ?) AS antraege," +
    (buchTab ? " (SELECT COUNT(*) FROM buchungszeile WHERE sparte_id = ?) AS buchungen"
             : " 0 AS buchungen");
  const werte = buchTab ? [id, id, "%" + id + "%", id] : [id, id, "%" + id + "%"];
  const zaehler = await env.VV_DB.prepare(zaehlSql).bind(...werte).first();

  const sperren = [];
  if (zaehler.rollen > 0) sperren.push({ was: "rolle", anzahl: zaehler.rollen });
  if (zaehler.buchungen > 0) sperren.push({ was: "buchung", anzahl: zaehler.buchungen });
  if (zaehler.antraege > 0) sperren.push({ was: "antrag", anzahl: zaehler.antraege });
  if (sperren.length) {
    return json({ error: "Abteilung wird noch verwendet", code: "gesperrt",
                  name: sparte.name, sperren }, 409, corsHeaders);
  }

  if (zaehler.zuordnungen > 0 && body.mit_zuordnungen !== true) {
    const wer = await env.VV_DB.prepare(
      "SELECT p.vorname, p.nachname, m.mitgliedsnummer FROM mitgliedschaft_sparte ms" +
      " JOIN mitgliedschaft m ON m.id = ms.mitgliedschaft_id" +
      " JOIN person p ON p.id = m.person_id" +
      " WHERE ms.sparte_id = ? ORDER BY p.nachname, p.vorname LIMIT 5"
    ).bind(id).all();
    return json({ error: "Abteilung hat noch Zuordnungen", code: "zuordnungen",
                  name: sparte.name, zuordnungen: zaehler.zuordnungen,
                  mitglieder: wer.results || [] }, 409, corsHeaders);
  }

  await env.VV_DB.batch([
    env.VV_DB.prepare("DELETE FROM mitgliedschaft_sparte WHERE sparte_id = ?").bind(id),
    env.VV_DB.prepare("DELETE FROM sparte WHERE id = ?").bind(id)
  ]);

  // Das Protokoll ist die einzige Spur, die von der Abteilung bleibt --
  // deshalb Name und Anzahl hinein, beide VOR dem Loeschen gelesen.
  await protokolliere(env, me.username, "sparte-geloescht", "sparte", id,
                      { name: sparte.name, zuordnungen: zaehler.zuordnungen });
  return json({ ok: true, name: sparte.name, zuordnungen: zaehler.zuordnungen }, 200, corsHeaders);
}

// Oeffentlich. Liefert nur, was auf dem Formular stehen muss: die
// Abteilungen, die Beitragssaetze zur Information und den Vereinsnamen
// fuer den Mandatstext. Keine Personendaten, keine Zahlen aus dem
// Bestand.
async function handleAntragInfo(env, corsHeaders) {
  const cfg = await ladeEinstellungen(env);
  const offen = einstellungZahl(cfg, "antrag_offen") === 1;
  // Beide Schalter in EINER Antwort: die Nachwuchsseite braucht dieselben
  // Abteilungen, Beitragssaetze und denselben Vereinsnamen. Ein zweiter
  // Info-Endpunkt waere derselbe Inhalt unter anderem Namen -- und liefe
  // beim naechsten Feld auseinander.
  const nachwuchsOffen = einstellungZahl(cfg, "nachwuchs_offen") === 1;

  const sparten = await env.VV_DB
    .prepare("SELECT id, name FROM sparte WHERE aktiv = 1 ORDER BY sortierung, name").all();

  const heute = new Date().toISOString().slice(0, 10);
  let klassen = [];
  try {
    klassen = (await ladeKlassenMitSatz(env, heute))
      .filter((k) => k.aktiv && k.betrag_cent !== null)
      .map((k) => ({ name: k.name, betrag_cent: k.betrag_cent }));
  } catch {
    // Die Beitragsordnung ist eine Information, keine Voraussetzung.
    // Fehlt sie, wird der Antrag trotzdem entgegengenommen.
  }

  return json({
    offen,
    nachwuchs_offen: nachwuchsOffen,
    verein: (cfg && cfg.verein_name) || VEREIN_FALLBACK,
    glaeubiger_id: (cfg && cfg.glaeubiger_id) || null,
    sparten: sparten.results || [],
    beitraege: klassen
  }, 200, corsHeaders);
}

// Die Spalte fuer die zweite Unterschrift entsteht in handleMigration --
// und der oeffentliche Endpunkt kann die nicht anstossen, sie verlangt
// eine Rolle. Faende er die Spalte nicht und benannte sie trotzdem im
// INSERT, wuerde JEDER Antrag scheitern, auch der eines Erwachsenen.
//
// ⚠️ Gemerkt wird NUR das Ja. Ein Nein zu merken war der erste Entwurf
// und vom Pruefstand als Fehler entlarvt: die Migration laeuft in einem
// ANDEREN Isolate als der oeffentliche Antrag, das Zuruecksetzen dort
// erreicht dieses hier also nie -- und der Worker wiese noch stundenlang
// mit 503 ab, obwohl die Spalte laengst da ist. Die zusaetzliche Abfrage
// kostet nur, solange die Spalte wirklich fehlt.
let gesetzl2SpalteDa = false;
async function hatGesetzl2Spalte(env) {
  if (gesetzl2SpalteDa) return true;
  try {
    const r = await env.VV_DB.prepare("PRAGMA table_info(aufnahmeantrag)").all();
    gesetzl2SpalteDa = (r.results || [])
      .some((s) => s.name === "unterschrift_gesetzl2_datei");
  } catch {
    return false;
  }
  return gesetzl2SpalteDa;
}

// Die Staatsangehoerigkeit haengt an person, nicht an aufnahmeantrag --
// eigene Probe. Auch hier nur das Ja gemerkt.
let nationalitaetSpalteDa = false;
async function hatNationalitaetSpalte(env) {
  if (nationalitaetSpalteDa) return true;
  try {
    const r = await env.VV_DB.prepare("PRAGMA table_info(person)").all();
    nationalitaetSpalteDa = (r.results || []).some((s) => s.name === "nationalitaet");
  } catch {
    return false;
  }
  return nationalitaetSpalteDa;
}

// Dieselbe Ueberlegung fuer die Spalten der Nachwuchs-Anmeldung, und aus
// demselben Grund NUR das Ja gemerkt.
let nachwuchsSpaltenDa = false;
async function hatNachwuchsSpalten(env) {
  if (nachwuchsSpaltenDa) return true;
  try {
    const r = await env.VV_DB.prepare("PRAGMA table_info(aufnahmeantrag)").all();
    const da = new Set((r.results || []).map((s) => s.name));
    nachwuchsSpaltenDa = da.has("quelle") && da.has("nachweis_owner");
  } catch {
    return false;
  }
  return nachwuchsSpaltenDa;
}

// Beide oeffentlichen Wege laufen hier zusammen. Die QUELLE kommt vom
// Aufrufer, nie aus dem Koerper: sie haengt am Endpunkt, den jemand
// aufgerufen hat, und ist damit nichts, was der Client behaupten kann.
// Ein Feld "quelle" im Body wird ignoriert -- wie status, person_id,
// eingang_am und id auch.
async function handleAntragSenden(body, env, request, corsHeaders, quelle) {
  const istNachwuchs = quelle === "nachwuchs";
  const cfg = await ladeEinstellungen(env);
  const schalter = istNachwuchs ? "nachwuchs_offen" : "antrag_offen";
  if (einstellungZahl(cfg, schalter) !== 1) {
    return json({ error: istNachwuchs
      ? "Die Nachwuchs-Anmeldung ist zurzeit geschlossen. " +
        "Bitte wenden Sie sich an die Geschaeftsstelle."
      : "Der Online-Aufnahmeantrag ist zurzeit geschlossen. " +
        "Bitte wenden Sie sich an die Geschaeftsstelle." }, 403, corsHeaders);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unbekannt";
  const agent = String(request.headers.get("User-Agent") || "").slice(0, 200);

  // Eine Abfrage fuer beide Grenzen. Ohne sie waere das Formular ein
  // Weg, die Tabelle in Minuten vollzuschreiben.
  const jetztMs = Date.now();
  const seitStunde = new Date(jetztMs - 3600000).toISOString();
  const seitTag = new Date(jetztMs - 86400000).toISOString();
  const zaehler = await env.VV_DB.prepare(
    "SELECT COUNT(*) AS tag, SUM(CASE WHEN eingang_am >= ? THEN 1 ELSE 0 END) AS stunde " +
    "FROM aufnahmeantrag WHERE signatur_ip = ? AND eingang_am >= ?"
  ).bind(seitStunde, ip, seitTag).first();
  if (zaehler && (Number(zaehler.stunde || 0) >= ANTRAG_JE_IP_STUNDE ||
                  Number(zaehler.tag || 0) >= ANTRAG_JE_IP_TAG)) {
    return json({ error: "Von diesem Anschluss sind gerade sehr viele Antraege gekommen. " +
                         "Bitte spaeter noch einmal versuchen oder die Geschaeftsstelle anrufen." },
                429, corsHeaders);
  }

  const spartenR = await env.VV_DB.prepare("SELECT id FROM sparte WHERE aktiv = 1").all();
  const erlaubt = new Set((spartenR.results || []).map((z) => z.id));

  const jetzt = new Date().toISOString();
  const geprueft = pruefeAntrag(body, erlaubt, jetzt.slice(0, 10), quelle);
  if (geprueft.fehler) return json({ error: geprueft.fehler }, 400, corsHeaders);
  const satz = geprueft.satz;

  // Ohne die beiden Spalten liesse sich ein Nachwuchsantrag zwar
  // speichern, aber nicht mehr als solcher erkennen -- er fiele in der
  // Liste unter die allgemeinen Antraege, und der Verweis auf die
  // Nachweise ginge verloren. Sichtbar abweisen statt still verstuemmeln;
  // das Fenster dauert Minuten.
  if (istNachwuchs && !(await hatNachwuchsSpalten(env))) {
    return json({ error: "Das Formular wird gerade umgestellt. Bitte in wenigen Minuten " +
                         "noch einmal absenden oder die Geschaeftsstelle anrufen." },
                503, corsHeaders);
  }

  const zweiteSpalte = await hatGesetzl2Spalte(env);
  if (satz.unterschrift_gesetzl2 && !zweiteSpalte) {
    // Lieber sichtbar abweisen als still verlieren: die Unterschrift des
    // zweiten Erziehungsberechtigten ist der Grund, warum der Antrag
    // wirksam ist. Das Fenster dauert Minuten -- bis jemand mit einer
    // Rolle die App oeffnet und damit die Migration anstoesst.
    return json({ error: "Das Formular wird gerade umgestellt. Bitte in wenigen Minuten " +
                         "noch einmal absenden oder die Geschaeftsstelle anrufen." },
                503, corsHeaders);
  }

  const id = uuid();
  await env.VV_DB.prepare(
    "INSERT INTO aufnahmeantrag (id, eingang_am, antrag_json, sparten_json, " +
    "unterschrift_datei, unterschrift_gesetzl_datei, " +
    (zweiteSpalte ? "unterschrift_gesetzl2_datei, " : "") +
    (istNachwuchs ? "quelle, nachweis_owner, " : "") +
    "signatur_ip, signatur_agent, signatur_zeit, status) " +
    "VALUES (?,?,?,?,?,?," + (zweiteSpalte ? "?," : "") +
    (istNachwuchs ? "?,?," : "") + "?,?,?,'neu')"
  ).bind(...[id, jetzt, JSON.stringify(satz.inhalt), JSON.stringify(satz.sparten),
             satz.unterschrift, satz.unterschrift_gesetzl]
           .concat(zweiteSpalte ? [satz.unterschrift_gesetzl2] : [])
           // Beim allgemeinen Antrag gar nicht erst benennen: die Spalte
           // hat die Vorgabe 'antrag', und ein Deploy vor der Migration
           // laesst ihn so unveraendert durchlaufen.
           .concat(istNachwuchs ? [satz.quelle, satz.nachweis_owner] : [])
           .concat([ip, agent, jetzt])).run();

  await protokolliere(env, null,
                      istNachwuchs ? "nachwuchsantrag-eingegangen" : "antrag-eingegangen",
                      "aufnahmeantrag", id, { nachname: satz.inhalt.nachname });

  return json({ ok: true, id, eingang_am: jetzt }, 200, corsHeaders);
}

// ---------------------------------------------------------------------
// Antraege pruefen (angemeldet)
// ---------------------------------------------------------------------

// Kurzform fuer die Liste. Bankdaten stehen hier bewusst NICHT drin --
// wer eine Liste ueberfliegt, braucht keine IBAN, und was nicht
// ausgeliefert wird, steht auch nicht im Netzwerk-Tab.
function antragKurz(zeile) {
  let a = {};
  try { a = JSON.parse(zeile.antrag_json || "{}"); } catch { a = {}; }
  let sparten = [];
  try { sparten = JSON.parse(zeile.sparten_json || "[]"); } catch { sparten = []; }
  return {
    id: zeile.id,
    eingang_am: zeile.eingang_am,
    status: zeile.status,
    vorname: a.vorname || "",
    nachname: a.nachname || "",
    geburtsdatum: a.geburtsdatum || null,
    ort: a.ort || "",
    art: a.art || "ordentlich",
    zahlungsart: a.zahlungsart || null,
    minderjaehrig: !!a.minderjaehrig,
    // Aus der SPALTE, nicht aus dem JSON: aeltere Antraege haben sie noch
    // gar nicht, und die Vorgabe der Spalte faengt genau das ab.
    quelle: zeile.quelle || "antrag",
    // Ob ein Nachweis da ist, entscheidet in der Liste ueber eine
    // Nachfrage bei der Familie -- die Datei selbst holt erst das Detail.
    nachweis_da: !!zeile.nachweis_owner,
    anzahl_sparten: sparten.length,
    beschluss_am: zeile.beschluss_am || null,
    geprueft_von: zeile.geprueft_von || null,
    mitgliedschaft_id: zeile.mitgliedschaft_id || null
  };
}

async function handleAntraegeListe(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfSchreiben && !rolle.darfNachwuchs) {
    return json({ error: "Nur die Geschaeftsstelle kann Aufnahmeantraege bearbeiten" }, 403, corsHeaders);
  }
  // Wer hierher kommt, ohne schreiben zu duerfen, ist die Passstelle. Ihr
  // Ausschnitt wird HIER bestimmt und nicht im Browser.
  const nurNachwuchs = !rolle.darfSchreiben;

  const status = ANTRAG_STATUS.has(body.status) ? body.status : "neu";

  // ⚠️ Die beiden neuen Spalten nur benennen, wenn es sie gibt. Kein
  // SELECT * als Ausweg: das zoege die Unterschriften mit -- drei
  // Data-URLs zu je rund 19 KB, mal 200 Zeilen, fuer eine Liste, die
  // keine davon anzeigt.
  const neueSpalten = await hatNachwuchsSpalten(env);

  // ⚠️ Fail-closed: ohne die Spalte quelle laesst sich der Ausschnitt der
  // Passstelle nicht bilden. Dann lieber gar nichts liefern als versehent-
  // lich alle Aufnahmeantraege -- der Fall tritt nur zwischen Deploy und
  // Migration auf und dauert Minuten.
  if (nurNachwuchs && !neueSpalten) {
    return json({ error: "Die Antragsliste wird gerade umgestellt. Bitte in wenigen " +
                         "Minuten noch einmal aufrufen." }, 503, corsHeaders);
  }

  const zahlen = await env.VV_DB.prepare(
    "SELECT status, COUNT(*) AS n FROM aufnahmeantrag" +
    (nurNachwuchs ? " WHERE quelle = 'nachwuchs'" : "") +
    " GROUP BY status"
  ).all();
  const nach = {};
  for (const z of zahlen.results || []) nach[z.status] = z.n;

  const r = await env.VV_DB.prepare(
    "SELECT id, eingang_am, status, antrag_json, sparten_json, beschluss_am, " +
    "geprueft_von, mitgliedschaft_id" +
    (neueSpalten ? ", quelle, nachweis_owner" : "") +
    " FROM aufnahmeantrag WHERE status = ?" +
    (nurNachwuchs ? " AND quelle = 'nachwuchs'" : "") +
    " ORDER BY eingang_am DESC LIMIT 200"
  ).bind(status).all();

  const antraege = (r.results || []).map(antragKurz).map((a) =>
    // Die Zahlungsart gehoert zur Beitragsseite und hat in der Passstelle
    // nichts zu suchen -- sie faellt hier weg, nicht in der Tabelle.
    nurNachwuchs ? { ...a, zahlungsart: null } : a);

  return json({ ok: true, status, nach, nur_nachwuchs: nurNachwuchs, antraege }, 200, corsHeaders);
}

// Sucht Personen, die derselbe Mensch sein koennten oder zur selben
// Familie gehoeren. EINE Abfrage, danach im Speicher getrennt:
//   dublette  -- gleicher Nachname UND gleiches Geburtsdatum
//   haushalt  -- gleicher Nachname unter derselben Anschrift
// Die zweite Regel ist dieselbe, nach der der Import Haushalte gebildet
// hat (Nachname + Strasse + PLZ) -- sonst faende die Pruefung eine
// Familie, die es im Bestand gar nicht als Haushalt gibt.
async function sucheAehnliche(env, a) {
  const r = await env.VV_DB.prepare(
    "SELECT p.id, p.vorname, p.nachname, p.geburtsdatum, p.strasse, p.plz, p.ort, " +
    "       p.haushalt_id, h.bezeichnung, " +
    "       (SELECT COUNT(*) FROM person q WHERE q.haushalt_id = p.haushalt_id) AS im_haushalt, " +
    "       (SELECT m.mitgliedsnummer FROM mitgliedschaft m WHERE m.person_id = p.id " +
    "        ORDER BY m.eintritt DESC LIMIT 1) AS mitgliedsnummer, " +
    "       (SELECT m.status FROM mitgliedschaft m WHERE m.person_id = p.id " +
    "        ORDER BY m.eintritt DESC LIMIT 1) AS mgs_status " +
    "FROM person p LEFT JOIN haushalt h ON h.id = p.haushalt_id " +
    "WHERE lower(p.nachname) = lower(?) " +
    "  AND (p.geburtsdatum = ? OR (lower(p.plz) = lower(?) AND lower(p.strasse) = lower(?))) " +
    "LIMIT 25"
  ).bind(a.nachname || "", a.geburtsdatum || "", a.plz || "", a.strasse || "").all();

  const dubletten = [], haushalte = [];
  for (const z of r.results || []) {
    if (a.geburtsdatum && z.geburtsdatum === a.geburtsdatum) dubletten.push(z);
    else if (z.haushalt_id) haushalte.push(z);
  }
  return { dubletten, haushalte };
}

async function handleAntragDetail(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfSchreiben && !rolle.darfNachwuchs) {
    return json({ error: "Nur die Geschaeftsstelle kann Aufnahmeantraege bearbeiten" }, 403, corsHeaders);
  }
  const nurNachwuchs = !rolle.darfSchreiben;

  const zeile = await env.VV_DB
    .prepare("SELECT * FROM aufnahmeantrag WHERE id = ?").bind(String(body.id || "")).first();
  if (!zeile) return json({ error: "Antrag nicht gefunden" }, 404, corsHeaders);

  // Die Passstelle kommt an genau die Antraege, fuer die sie zustaendig
  // ist. Eine geratene Id fuehrt sonst am Listenfilter vorbei -- das ist
  // der uebliche Weg, an dem eine gefilterte Sicht auffliegt.
  if (nurNachwuchs && (zeile.quelle || "antrag") !== "nachwuchs") {
    return json({ error: "Dieser Antrag gehoert nicht zur Nachwuchs-Anmeldung" }, 403, corsHeaders);
  }

  let inhalt = {};
  try { inhalt = JSON.parse(zeile.antrag_json || "{}"); } catch { inhalt = {}; }
  let sparten = [];
  try { sparten = JSON.parse(zeile.sparten_json || "[]"); } catch { sparten = []; }

  // ⚠️ Die Bankdaten verlassen den Worker fuer die Passstelle nicht. Sie
  // stehen im selben JSON wie Name und Anschrift; ein Ausblenden in der
  // Oberflaeche waere kein Zurueckhalten (die Antwort steht im Netzwerk-
  // Reiter). Der Verbandsantrag braucht keines dieser Felder.
  if (nurNachwuchs) {
    inhalt = { ...inhalt };
    for (const feld of ["zahlungsart", "kontoinhaber", "iban", "bic",
                        "bank_name", "kontoinhaber_anschrift", "beitragsart_wunsch",
                        "familie_hinweis"]) {
      delete inhalt[feld];
    }
  }

  // Ohne Schreibrecht wird weder ein Haushalt gewaehlt noch eine Klasse
  // vorgeschlagen -- und die Dublettensuche ist eine Abfrage AUF DEN
  // BESTAND, den die Passstelle nicht sehen soll. Sie laeuft deshalb gar
  // nicht erst.
  const aehnlich = nurNachwuchs
    ? { dubletten: [], haushalte: [] }
    : await sucheAehnliche(env, inhalt);
  const heute = new Date().toISOString().slice(0, 10);
  const klassen = nurNachwuchs
    ? []
    : (await ladeKlassenMitSatz(env, heute)).filter((k) => k.aktiv);

  // Vorschlag fuer die Beitragsklasse: der WUNSCH des Antragstellers geht
  // vor, das Alter ist nur die Rueckfallebene. Der Bestand zeigt, warum:
  // ein 75-Jaehriger mit Kinderbeitrag, der juengste Rentner 48. Wer die
  // Klasse aus dem Geburtsdatum ableitet, stellt ungefragt Beitraege um.
  //
  // Wird eine Familie erkannt, ist die Familienklasse gemeint -- sonst
  // muesste die Geschaeftsstelle die Zeile gleich wieder korrigieren.
  const wunsch = ANTRAG_BEITRAGSWUNSCH.has(inhalt.beitragsart_wunsch)
    ? inhalt.beitragsart_wunsch
    : klassenVorschlag(inhalt.geburtsdatum);
  const regel = BEITRAGSKLASSEN.find((k) => k.schluessel === wunsch);
  const familie = aehnlich.haushalte.length > 0;
  const vorschlagKlasse = regel
    ? (klassen.find((k) => k.name === regel.name + (familie ? " (Familie)" : ""))
       || klassen.find((k) => k.name === regel.name))
    : null;

  // Vereinsname und Verbandsnummer fuer den Bogen AO21 -- die beiden
  // einzigen Stammdaten, die der Verbandsantrag braucht. Sie kommen hier
  // mit, statt den Client auf vv-einstellungen zu schicken: dort stehen
  // Vereins-IBAN und Glaeubiger-Id daneben, und die haben in der
  // Passstelle nichts zu suchen. Spart zugleich einen zweiten Aufruf.
  const cfg = (await ladeEinstellungen(env)) || {};

  return json({
    ok: true,
    antrag: {
      id: zeile.id,
      eingang_am: zeile.eingang_am,
      status: zeile.status,
      inhalt,
      sparten,
      unterschrift: zeile.unterschrift_datei || null,
      unterschrift_gesetzl: zeile.unterschrift_gesetzl_datei || null,
      unterschrift_gesetzl2: zeile.unterschrift_gesetzl2_datei || null,
      signatur_ip: zeile.signatur_ip || null,
      signatur_agent: zeile.signatur_agent || null,
      signatur_zeit: zeile.signatur_zeit || null,
      geprueft_am: zeile.geprueft_am || null,
      geprueft_von: zeile.geprueft_von || null,
      beschluss_am: zeile.beschluss_am || null,
      ablehnung_grund: zeile.ablehnung_grund || null,
      mitgliedschaft_id: zeile.mitgliedschaft_id || null,
      quelle: zeile.quelle || "antrag",
      // Nur der Schluessel. Die Dateien liegen beim admin-worker im
      // abgeschotteten Bereich und werden von dort einzeln geholt -- durch
      // diesen Worker laeuft keine einzige Ausweiskopie.
      nachweis_owner: zeile.nachweis_owner || null
    },
    // Sagt dem Client, welchen Ausschnitt er in der Hand hat. Er richtet
    // seine Oberflaeche danach aus -- die Schranke ist aber diese Antwort,
    // nicht das Feld.
    nur_nachwuchs: nurNachwuchs,
    verein: { name: cfg.verein_name || "", tfv_nr: cfg.tfv_vereinsnummer || "" },
    dubletten: aehnlich.dubletten,
    haushalte: aehnlich.haushalte,
    // Die naechste freie Mitgliedsnummer ist eine Angabe ueber den
    // Bestand. Ohne Beschlussrecht wird sie nicht gebraucht.
    vorschlag: nurNachwuchs ? null : {
      mitgliedsnummer: await naechsteMitgliedsnummer(env),
      beitragsklasse_id: vorschlagKlasse ? vorschlagKlasse.id : null,
      beitragsklasse_grund: ANTRAG_BEITRAGSWUNSCH.has(inhalt.beitragsart_wunsch)
        ? "wunsch" : "alter",
      eintritt: inhalt.eintritt_wunsch && inhalt.eintritt_wunsch > heute
        ? inhalt.eintritt_wunsch : heute
    },
    beitragsklassen: klassen,
    alle_sparten: ((await env.VV_DB
      .prepare("SELECT id, name FROM sparte WHERE aktiv = 1 ORDER BY sortierung, name").all()
    ).results) || []
  }, 200, corsHeaders);
}

// Vormerken, ablehnen, zurueckziehen. Eine Aktion fuer alle drei, weil
// alle drei nur eine Zeile umschreiben.
async function handleAntragStatus(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfSchreiben) {
    return json({ error: "Nur die Geschaeftsstelle kann Aufnahmeantraege bearbeiten" }, 403, corsHeaders);
  }

  const neu = String(body.status || "");
  if (!["geprueft", "abgelehnt", "zurueckgezogen"].includes(neu)) {
    return json({ error: "Unzulaessiger Status" }, 400, corsHeaders);
  }

  const zeile = await env.VV_DB
    .prepare("SELECT id, status FROM aufnahmeantrag WHERE id = ?")
    .bind(String(body.id || "")).first();
  if (!zeile) return json({ error: "Antrag nicht gefunden" }, 404, corsHeaders);

  // Ein angenommener Antrag hat eine Mitgliedschaft erzeugt. Die wieder
  // aufzuloesen ist ein Austritt, kein Zuruecknehmen eines Formulars.
  if (zeile.status === "angenommen") {
    return json({ error: "Der Antrag ist bereits angenommen. Die Mitgliedschaft endet " +
                         "ueber den Austritt, nicht ueber den Antrag." }, 409, corsHeaders);
  }

  const jetzt = new Date().toISOString();
  await env.VV_DB.prepare(
    "UPDATE aufnahmeantrag SET status = ?, geprueft_am = ?, geprueft_von = ?, " +
    "ablehnung_grund = ? WHERE id = ?"
  ).bind(neu, jetzt, me.username, sauber(body.vermerk, 300), zeile.id).run();

  await protokolliere(env, me.username, "antrag-" + neu, "aufnahmeantrag", zeile.id, null);
  return json({ ok: true, status: neu }, 200, corsHeaders);
}

// Die Annahme ist der Beschluss nach § 4 -- und der einzige Weg, auf dem
// aus einem Antrag eine Mitgliedschaft wird.
//
// Eigene Bau-Funktion statt anweisungenFuerNeuesMitglied: die legt ein
// Mandat nur bei einem NEUEN Haushalt an und immer mit quelle "import".
// Hier haengt am Mandat eine digitale Unterschrift mitsamt Beweismitteln,
// und ein Antragsteller kann einem bestehenden Haushalt beitreten, der
// noch kein Mandat hat.
function anweisungenFuerAnnahme(env, plan, jetzt, username) {
  const an = [];
  const personId = uuid();
  const mgsId = uuid();
  const haushaltId = plan.haushalt_id || uuid();

  if (!plan.haushalt_id) {
    an.push(env.VV_DB.prepare(
      "INSERT INTO haushalt (id, bezeichnung, zahlungsweise, zahlungsart, erstellt_am, erstellt_von) " +
      "VALUES (?,?,?,?,?,?)"
    ).bind(haushaltId, "Familie " + plan.inhalt.nachname, "jaehrlich",
           plan.inhalt.zahlungsart === "ueberweisung" ? "ueberweisung" : "lastschrift",
           jetzt, username));
  }

  // Die Staatsangehoerigkeit steht nur im Nachwuchsantrag, und ihre Spalte
  // entsteht erst in der Migration. Sie wird deshalb nur benannt, wenn
  // beides zutrifft -- ein INSERT auf eine fehlende Spalte wuerfe den
  // ganzen Batch, und die Annahme bliebe mitten im Fremdschluessel-Zirkel
  // stehen.
  const mitNat = plan.hat_nationalitaet_spalte && plan.inhalt.nationalitaet;
  an.push(env.VV_DB.prepare(
    "INSERT INTO person (id, haushalt_id, vorname, nachname, geburtsdatum, geburtsort, " +
    (mitNat ? "nationalitaet, " : "") +
    "geschlecht, strasse, plz, ort, email, telefon, mobil, bemerkung, " +
    "erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?," + (mitNat ? "?," : "") +
    "?,?,?,?,?,?,?,?,?,?)"
  ).bind(...[personId, haushaltId, plan.inhalt.vorname, plan.inhalt.nachname,
             plan.inhalt.geburtsdatum, plan.inhalt.geburtsort || null]
           .concat(mitNat ? [plan.inhalt.nationalitaet] : [])
           .concat([plan.inhalt.geschlecht, plan.inhalt.strasse,
                    plan.inhalt.plz, plan.inhalt.ort, plan.inhalt.email, plan.inhalt.telefon,
                    plan.inhalt.mobil, plan.bemerkung, jetzt, username])));

  // Fremdschluessel-Zirkel: erst Haushalt ohne Zahler, dann Person, dann
  // den Zahler nachtragen. Bei einem bestehenden Haushalt bleibt der
  // eingetragene Zahler stehen.
  if (!plan.haushalt_id) {
    an.push(env.VV_DB.prepare("UPDATE haushalt SET zahler_person_id = ? WHERE id = ?")
      .bind(personId, haushaltId));
  }

  an.push(env.VV_DB.prepare(
    "INSERT INTO mitgliedschaft (id, person_id, mitgliedsnummer, art, eintritt, status, " +
    "beschluss_am, beschluss_von, ermaessigt, beitragsklasse_id, familienbeitrag, " +
    "erstellt_am, erstellt_von) VALUES (?,?,?,?,?,'aktiv',?,?,0,?,?,?,?)"
  ).bind(mgsId, personId, plan.mitgliedsnummer, plan.art, plan.eintritt,
         plan.beschluss_am, username, plan.beitragsklasse_id,
         plan.familienbeitrag ? 1 : 0, jetzt, username));

  for (const sparteId of plan.sparten) {
    an.push(env.VV_DB.prepare(
      "INSERT INTO mitgliedschaft_sparte (id, mitgliedschaft_id, sparte_id, eintritt, " +
      "erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?)"
    ).bind(uuid(), mgsId, sparteId, plan.eintritt, jetzt, username));
  }

  if (plan.mandat) {
    an.push(env.VV_DB.prepare(
      "INSERT INTO sepa_mandat (id, haushalt_id, referenz, kontoinhaber, iban, bic, " +
      "bank_name, kontoinhaber_anschrift, erteilt_am, erteilt_ort, quelle, " +
      "unterschrift_datei, signatur_ip, signatur_agent, " +
      "erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,?,?,?,?,'digital',?,?,?,?,?)"
    ).bind(uuid(), haushaltId, plan.mandat.referenz, plan.mandat.kontoinhaber,
           plan.mandat.iban, plan.mandat.bic, plan.mandat.bank_name,
           plan.mandat.kontoinhaber_anschrift, plan.mandat.erteilt_am,
           plan.mandat.erteilt_ort,
           plan.mandat.unterschrift, plan.mandat.ip, plan.mandat.agent, jetzt, username));
  }

  an.push(env.VV_DB.prepare(
    "UPDATE aufnahmeantrag SET status = 'angenommen', geprueft_am = ?, geprueft_von = ?, " +
    "beschluss_am = ?, person_id = ?, mitgliedschaft_id = ? WHERE id = ?"
  ).bind(jetzt, username, plan.beschluss_am, personId, mgsId, plan.antrag_id));

  return { anweisungen: an, personId, mgsId, haushaltId };
}

async function handleAntragAnnehmen(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfSchreiben) {
    return json({ error: "Nur die Geschaeftsstelle kann Aufnahmeantraege bearbeiten" }, 403, corsHeaders);
  }

  const zeile = await env.VV_DB
    .prepare("SELECT * FROM aufnahmeantrag WHERE id = ?").bind(String(body.id || "")).first();
  if (!zeile) return json({ error: "Antrag nicht gefunden" }, 404, corsHeaders);
  if (zeile.status === "angenommen") {
    return json({ error: "Dieser Antrag ist bereits angenommen" }, 409, corsHeaders);
  }
  if (zeile.status === "abgelehnt" || zeile.status === "zurueckgezogen") {
    return json({ error: "Der Antrag steht auf " + zeile.status +
                         " und muss erst wieder vorgemerkt werden" }, 409, corsHeaders);
  }

  // Satzung § 4: ohne Beschluss des Gesamtvorstands keine Mitgliedschaft.
  // Das Datum ist deshalb Pflichtfeld und nicht vorbelegt -- wer es
  // eintraegt, bestaetigt, dass der Beschluss wirklich gefasst wurde.
  const beschlussAm = sauber(body.beschluss_am, 10);
  if (!beschlussAm || !istIsoDatum(beschlussAm)) {
    return json({ error: "Ohne das Datum des Vorstandsbeschlusses kann der Antrag nicht " +
                         "angenommen werden (§ 4 der Satzung)" }, 400, corsHeaders);
  }
  const heute = new Date().toISOString().slice(0, 10);
  if (beschlussAm > heute) {
    return json({ error: "Das Beschlussdatum liegt in der Zukunft" }, 400, corsHeaders);
  }

  let inhalt = {};
  try { inhalt = JSON.parse(zeile.antrag_json || "{}"); } catch { inhalt = {}; }

  const eintritt = sauber(body.eintritt, 10);
  if (!eintritt || !istIsoDatum(eintritt)) {
    return json({ error: "Das Eintrittsdatum fehlt oder ist kein gueltiges Datum" }, 400, corsHeaders);
  }

  const art = ANTRAG_ARTEN.has(body.art) ? body.art
            : (ANTRAG_ARTEN.has(inhalt.art) ? inhalt.art : "ordentlich");

  let nummer = sauber(body.mitgliedsnummer, 30);
  if (!nummer) nummer = await naechsteMitgliedsnummer(env);
  const belegt = await env.VV_DB.prepare("SELECT id FROM mitgliedschaft WHERE mitgliedsnummer = ?")
    .bind(nummer).first();
  if (belegt) {
    return json({ error: "Mitgliedsnummer " + nummer + " ist bereits vergeben" }, 409, corsHeaders);
  }

  const haushaltId = sauber(body.haushalt_id, 40);
  let mandatVorhanden = false;
  if (haushaltId) {
    const h = await env.VV_DB.prepare(
      "SELECT h.id, (SELECT COUNT(*) FROM sepa_mandat m WHERE m.haushalt_id = h.id " +
      "  AND m.widerrufen_am IS NULL) AS mandate FROM haushalt h WHERE h.id = ?"
    ).bind(haushaltId).first();
    if (!h) return json({ error: "Der gewaehlte Haushalt existiert nicht" }, 400, corsHeaders);
    mandatVorhanden = Number(h.mandate || 0) > 0;
  }

  const klasseId = sauber(body.beitragsklasse_id, 40);
  let familienbeitrag = false;
  if (klasseId) {
    const k = await env.VV_DB.prepare("SELECT id, name FROM beitragsklasse WHERE id = ?")
      .bind(klasseId).first();
    if (!k) return json({ error: "Die gewaehlte Beitragsklasse existiert nicht" }, 400, corsHeaders);
    // Der Familienverbund ist eine eigene KLASSE ("Erwachsener (Familie)").
    // Das Kennzeichen daneben waere eine zweite Wahrheit -- es wird
    // deshalb aus dem Namen abgeleitet und nicht getrennt entgegen-
    // genommen. Sonst steht am Mitglied irgendwann die Familienklasse
    // mit familienbeitrag = 0, und keine Auswertung stimmt mehr.
    familienbeitrag = / \(Familie\)$/.test(k.name);
  }

  const gewuenscht = Array.isArray(body.sparte_ids) ? body.sparte_ids.map(String) : [];
  let sparten = [];
  if (gewuenscht.length) {
    const p = gewuenscht.map(() => "?").join(",");
    const r = await env.VV_DB
      .prepare("SELECT id FROM sparte WHERE id IN (" + p + ")").bind(...gewuenscht).all();
    sparten = (r.results || []).map((z) => z.id);
  }

  // Das Mandat traegt bei Minderjaehrigen die Unterschrift des
  // gesetzlichen Vertreters -- ein Minderjaehriger kann keines erteilen.
  const mandatUnterschrift = inhalt.minderjaehrig
    ? zeile.unterschrift_gesetzl_datei
    : zeile.unterschrift_datei;
  const mandat = (inhalt.zahlungsart === "lastschrift" && inhalt.iban && !mandatVorhanden
                  && mandatUnterschrift)
    ? {
        referenz: "M-" + nummer,
        kontoinhaber: inhalt.kontoinhaber || (inhalt.vorname + " " + inhalt.nachname),
        iban: inhalt.iban,
        bic: inhalt.bic || null,
        bank_name: inhalt.bank_name || null,
        kontoinhaber_anschrift: inhalt.kontoinhaber_anschrift || null,
        erteilt_am: String(zeile.signatur_zeit || zeile.eingang_am).slice(0, 10),
        erteilt_ort: inhalt.unterschrift_ort || inhalt.ort || null,
        unterschrift: mandatUnterschrift,
        ip: zeile.signatur_ip || null,
        agent: zeile.signatur_agent || null
      }
    : null;

  const bemerkungTeile = [];
  if (inhalt.familie_hinweis) bemerkungTeile.push("Familienhinweis: " + inhalt.familie_hinweis);
  if (inhalt.beitragsart_wunsch) bemerkungTeile.push("Beitragswunsch: " + inhalt.beitragsart_wunsch);
  if (inhalt.gesetzl_name) {
    bemerkungTeile.push("Gesetzlicher Vertreter: " + inhalt.gesetzl_name +
                        (inhalt.gesetzl_verhaeltnis ? " (" + inhalt.gesetzl_verhaeltnis + ")" : ""));
  }
  if (inhalt.gesetzl2_name) {
    bemerkungTeile.push("Zweiter Erziehungsberechtigter: " + inhalt.gesetzl2_name +
                        (inhalt.gesetzl2_verhaeltnis ? " (" + inhalt.gesetzl2_verhaeltnis + ")" : ""));
  } else if (inhalt.allein_sorgeberechtigt) {
    // Die Erklaerung muss am Mitglied stehen bleiben: sie ist der Grund,
    // warum nur eine Unterschrift vorliegt.
    bemerkungTeile.push("Alleiniges Sorgerecht erklaert");
  }
  // Die Foto-Einwilligung ist freiwillig und muss belegbar bleiben --
  // auch die Verweigerung, sonst weiss spaeter niemand, ob nur nicht
  // gefragt wurde.
  bemerkungTeile.push("Fotoeinwilligung: " + (inhalt.einwilligung_fotos ? "ja" : "nein"));
  if (inhalt.bemerkung) bemerkungTeile.push("Anmerkung: " + inhalt.bemerkung);

  const jetzt = new Date().toISOString();
  const gebaut = anweisungenFuerAnnahme(env, {
    antrag_id: zeile.id,
    inhalt,
    haushalt_id: haushaltId,
    mitgliedsnummer: nummer,
    art, eintritt,
    beschluss_am: beschlussAm,
    beitragsklasse_id: klasseId || null,
    familienbeitrag,
    sparten,
    mandat,
    hat_nationalitaet_spalte: await hatNationalitaetSpalte(env),
    bemerkung: bemerkungTeile.join(" | ").slice(0, 500)
  }, jetzt, me.username);

  await env.VV_DB.batch(gebaut.anweisungen);
  await protokolliere(env, me.username, "antrag-angenommen", "aufnahmeantrag", zeile.id,
                      { mitgliedsnummer: nummer, beschluss_am: beschlussAm, mandat: !!mandat });

  return json({
    ok: true,
    mitgliedschaft_id: gebaut.mgsId,
    mitgliedsnummer: nummer,
    mandat_angelegt: !!mandat,
    // Wer per Lastschrift zahlen wollte, aber keines bekommen hat, muss
    // das erfahren -- sonst faellt es erst beim Beitragslauf auf.
    mandat_hinweis: (inhalt.zahlungsart === "lastschrift" && !mandat)
      ? (mandatVorhanden
          ? "Der Haushalt hat bereits ein Mandat; es wurde keines zweites angelegt."
          : "Es wurde kein Mandat angelegt (keine IBAN oder keine Unterschrift im Antrag).")
      : null
  }, 200, corsHeaders);
}

// ---------------------------------------------------------------------
// STUFE 4 -- BUCHHALTUNG
// ---------------------------------------------------------------------
//
// Doppelte Buchfuehrung mit den vier Sphaeren des
// Gemeinnuetzigkeitsrechts. Drei Festlegungen tragen alles Weitere:
//
//   1. Die SPHAERE HAENGT AM KONTO, nicht an der Buchung. Sonst gaebe es
//      zwei Wahrheiten darueber, ob eine Einnahme steuerpflichtig ist.
//      Wer dieselbe Art Einnahme in zwei Sphaeren braucht, legt zwei
//      Konten an -- genau so ist SKR49 gebaut. Die Buchungszeile
//      speichert die Sphaere trotzdem MIT: eine spaetere Aenderung am
//      Konto darf die Vergangenheit nicht umschreiben.
//   2. GELOESCHT WIRD NIE. Ein Storno ist eine eigene Buchung, die die
//      urspruengliche spiegelt. Beide bleiben im Journal, und die Salden
//      gehen von selbst auf -- deshalb rechnet die Saldenliste
//      ausdruecklich OHNE Filter auf storniert_am.
//   3. BELEGNUMMERN SIND LUECKENLOS je Jahr. D1 kennt keine Transaktion
//      ueber mehrere Anweisungen; die Nummer wird deshalb als
//      Unterabfrage IM INSERT gezogen und der eindeutige Index faengt den
//      Gleichstand ab. Der Handler wiederholt dann.

const SPHAEREN = {
  ideell: "Ideeller Bereich",
  vermoegen: "Vermoegensverwaltung",
  zweckbetrieb: "Zweckbetrieb",
  wirtschaft: "Wirtschaftlicher Geschaeftsbetrieb"
};

const KONTOARTEN = new Set(["aktiv", "passiv", "ertrag", "aufwand"]);

// Startbestand, an SKR49 angelehnt. AUSDRUECKLICH ein Vorschlag: ein
// Kontenrahmen ist eine Absprache mit dem Steuerberater, kein
// Programmzustand. Die Konten liegen in der Datenbank und sind aenderbar,
// eine Korrektur kostet keinen Deploy.
const KONTENRAHMEN = [
  { nummer: "0620", name: "Betriebs- und Geschaeftsausstattung", art: "aktiv", gruppe: "Anlagevermoegen", sortierung: 10 },
  { nummer: "1000", name: "Kasse", art: "aktiv", gruppe: "Umlaufvermoegen", sortierung: 20 },
  { nummer: "1200", name: "Bank", art: "aktiv", gruppe: "Umlaufvermoegen", sortierung: 21 },
  { nummer: "1400", name: "Forderungen aus Beitraegen", art: "aktiv", gruppe: "Umlaufvermoegen", sortierung: 22 },
  { nummer: "1600", name: "Verbindlichkeiten", art: "passiv", gruppe: "Verbindlichkeiten", sortierung: 30 },
  { nummer: "2000", name: "Vereinsvermoegen", art: "passiv", gruppe: "Eigenkapital", sortierung: 40 },
  { nummer: "2900", name: "Ruecklagen nach § 62 AO", art: "passiv", gruppe: "Eigenkapital", sortierung: 41 },
  // Technisches Gegenkonto der Eroeffnungsbuchung. Es steht am Jahresende
  // wieder auf null; taucht es in der Bilanz auf, ist eine Eroeffnung
  // schiefgegangen.
  { nummer: "9000", name: "Saldenvortraege", art: "passiv", gruppe: "Technisch", sortierung: 90 },

  { nummer: "4100", name: "Mitgliedsbeitraege", art: "ertrag", sphaere: "ideell", sortierung: 100 },
  { nummer: "4110", name: "Aufnahmegebuehren", art: "ertrag", sphaere: "ideell", sortierung: 101 },
  { nummer: "4120", name: "Umlagen", art: "ertrag", sphaere: "ideell", sortierung: 102 },
  { nummer: "4200", name: "Spenden", art: "ertrag", sphaere: "ideell", sortierung: 110 },
  { nummer: "4300", name: "Oeffentliche Zuschuesse", art: "ertrag", sphaere: "ideell", sortierung: 120 },
  { nummer: "4400", name: "Zinsertraege", art: "ertrag", sphaere: "vermoegen", sortierung: 130 },
  { nummer: "4450", name: "Mietertraege (langfristig)", art: "ertrag", sphaere: "vermoegen", sortierung: 131 },
  { nummer: "4500", name: "Sportveranstaltungen", art: "ertrag", sphaere: "zweckbetrieb", sortierung: 140 },
  { nummer: "4550", name: "Kurs- und Lehrgangsgebuehren", art: "ertrag", sphaere: "zweckbetrieb", sortierung: 141 },
  { nummer: "4600", name: "Werbung und Sponsoring", art: "ertrag", sphaere: "wirtschaft", sortierung: 150 },
  { nummer: "4650", name: "Bewirtung und Verkauf", art: "ertrag", sphaere: "wirtschaft", sortierung: 151 },

  { nummer: "5100", name: "Uebungsleiter- und Trainerverguetung", art: "aufwand", sphaere: "zweckbetrieb", sortierung: 200 },
  { nummer: "5200", name: "Sportmaterial und Ausruestung", art: "aufwand", sphaere: "zweckbetrieb", sortierung: 201 },
  { nummer: "5300", name: "Verbandsabgaben und Meldegelder", art: "aufwand", sphaere: "zweckbetrieb", sortierung: 202 },
  { nummer: "5400", name: "Schiedsrichter und Wettkampfkosten", art: "aufwand", sphaere: "zweckbetrieb", sortierung: 203 },
  { nummer: "6300", name: "Raum- und Hallenkosten", art: "aufwand", sphaere: "zweckbetrieb", sortierung: 210 },
  { nummer: "6400", name: "Versicherungen", art: "aufwand", sphaere: "ideell", sortierung: 220 },
  { nummer: "6800", name: "Buerobedarf, Porto, Telefon", art: "aufwand", sphaere: "ideell", sortierung: 230 },
  { nummer: "6805", name: "Vereinsveranstaltungen und Ehrungen", art: "aufwand", sphaere: "ideell", sortierung: 231 },
  { nummer: "6855", name: "Nebenkosten des Geldverkehrs", art: "aufwand", sphaere: "ideell", sortierung: 240 },
  { nummer: "6900", name: "Sonstiger Aufwand", art: "aufwand", sphaere: "ideell", sortierung: 250 },
  { nummer: "6950", name: "Wareneinsatz Bewirtung", art: "aufwand", sphaere: "wirtschaft", sortierung: 260 }
];

// Gefuehrte Geschaeftsvorfaelle. Der Erklaerungstext ist kein Beiwerk:
// eine falsche Sphaere trifft die Gemeinnuetzigkeit, und eine Vorlage
// verteilt so einen Fehler flaechiger, als ihn jemand von Hand machen
// wuerde. Deshalb steht bei jeder dabei, WARUM sie dort hingehoert.
const VORLAGEN = [
  { name: "Beitragsforderungen aus einem Beitragslauf", soll: "1400", haben: "4100",
    sphaere: "ideell", sortierung: 10,
    erklaerung: "Die Sollstellung. Der Ertrag entsteht mit der Forderung, nicht erst mit dem " +
      "Geldeingang -- deshalb steht hier noch keine Bank. Mitgliedsbeitraege sind ideeller " +
      "Bereich und damit nicht steuerbar." },
  { name: "Lastschrifteinzug eingegangen", soll: "1200", haben: "1400",
    sphaere: null, sortierung: 11,
    erklaerung: "Reiner Tausch: aus einer Forderung wird Geld. Kein neuer Ertrag, deshalb auch " +
      "keine Sphaere. Wer hier ein Ertragskonto nimmt, bucht den Beitrag zweimal." },
  { name: "Beitrag ohne vorherige Sollstellung", soll: "1200", haben: "4100",
    sphaere: "ideell", sortierung: 12,
    erklaerung: "Nur wenn zu diesem Beitrag KEINE Forderung gebucht wurde -- sonst die Vorlage " +
      "darueber nehmen." },
  { name: "Ruecklastschrift", soll: "1400", haben: "1200", sphaere: null, sortierung: 13,
    erklaerung: "Der Einzug ist zurueckgegangen, die Forderung lebt wieder auf. Das Entgelt der " +
      "Bank ist eine EIGENE Buchung auf 6855, kein Aufschlag auf den Beitrag." },
  { name: "Spende erhalten", soll: "1200", haben: "4200", sphaere: "ideell", sortierung: 20,
    erklaerung: "Eine Spende ist eine Zuwendung OHNE Gegenleistung. Gibt es eine Gegenleistung " +
      "-- Bandenwerbung, Logo auf dem Trikot, Anzeige im Heft --, ist es Sponsoring und gehoert " +
      "in den wirtschaftlichen Geschaeftsbetrieb." },
  { name: "Sponsoring mit Gegenleistung", soll: "1200", haben: "4600", sphaere: "wirtschaft",
    sortierung: 21,
    erklaerung: "Wer Werbung bekommt, spendet nicht, sondern kauft. Das ist steuerpflichtig und " +
      "darf keine Zuwendungsbestaetigung bekommen." },
  { name: "Oeffentlicher Zuschuss", soll: "1200", haben: "4300", sphaere: "ideell", sortierung: 22,
    erklaerung: "Zuschuesse der Kommune, des Kreises oder des Landessportbunds fuer die " +
      "satzungsgemaesse Arbeit gehoeren in den ideellen Bereich." },
  { name: "Einnahmen aus einer Sportveranstaltung", soll: "1200", haben: "4500",
    sphaere: "zweckbetrieb", sortierung: 23,
    erklaerung: "Eintrittsgelder bei unbezahlten Sportlern sind Zweckbetrieb. Die BEWIRTUNG " +
      "derselben Veranstaltung ist es nicht -- die wird getrennt gebucht." },
  { name: "Bewirtung und Verkauf bei einer Veranstaltung", soll: "1200", haben: "4650",
    sphaere: "wirtschaft", sortierung: 24,
    erklaerung: "Wurst und Bier sind wirtschaftlicher Geschaeftsbetrieb, auch wenn der Anlass " +
      "sportlich ist. Getrennt vom Eintritt buchen, sonst faerbt das eine auf das andere ab." },
  { name: "Zinsertrag", soll: "1200", haben: "4400", sphaere: "vermoegen", sortierung: 25,
    erklaerung: "Ertraege aus angelegtem Vermoegen sind Vermoegensverwaltung -- weder ideell " +
      "noch steuerpflichtig." },

  { name: "Uebungsleiter- oder Trainerverguetung gezahlt", soll: "5100", haben: "1200",
    sphaere: "zweckbetrieb", sortierung: 30,
    erklaerung: "Der Sportbetrieb ist Zweckbetrieb, und die Verguetung haengt unmittelbar daran " +
      "-- nicht am ideellen Bereich." },
  { name: "Sportmaterial gekauft", soll: "5200", haben: "1200", sphaere: "zweckbetrieb", sortierung: 31,
    erklaerung: "Baelle, Trikots, Geraete: unmittelbar fuer den Sportbetrieb." },
  { name: "Verbandsabgabe oder Meldegeld", soll: "5300", haben: "1200", sphaere: "zweckbetrieb",
    sortierung: 32,
    erklaerung: "Abgaben an Fachverbaende und Meldegelder fuer den Spielbetrieb." },
  { name: "Hallen- oder Platzmiete", soll: "6300", haben: "1200", sphaere: "zweckbetrieb", sortierung: 33,
    erklaerung: "Raumkosten des Sportbetriebs. Wird eine Flaeche dauerhaft vermietet, ist der " +
      "ERTRAG daraus dagegen Vermoegensverwaltung." },
  { name: "Versicherungsbeitrag", soll: "6400", haben: "1200", sphaere: "ideell", sortierung: 34,
    erklaerung: "Vereinshaftpflicht und aehnliches gehoeren zum Vereinsbetrieb als solchem." },
  { name: "Buerobedarf, Porto, Telefon", soll: "6800", haben: "1200", sphaere: "ideell", sortierung: 35,
    erklaerung: "Verwaltungskosten des Vereins als solchem. Laesst sich ein Posten eindeutig " +
      "einer Abteilung zuordnen, gehoert er stattdessen in den Zweckbetrieb." },
  { name: "Kontofuehrung oder Ruecklastschriftentgelt", soll: "6855", haben: "1200",
    sphaere: "ideell", sortierung: 36,
    erklaerung: "Bankgebuehren. Das Entgelt einer Ruecklastschrift gehoert hierher und nicht auf " +
      "den Beitrag des Mitglieds -- sonst laesst sich spaeter nicht mehr erklaeren, woraus " +
      "seine Schuld besteht." },
  { name: "Bareinzahlung auf das Bankkonto", soll: "1200", haben: "1000", sphaere: null, sortierung: 40,
    erklaerung: "Geldtransit zwischen zwei eigenen Konten. Kein Ertrag, keine Sphaere." }
];

// Altersgruppen der Bestandsmeldung an den Landessportbund. Als
// SQL-Ausdruck, damit die Auszaehlung ueber 540 Mitglieder in EINER
// Abfrage laeuft statt in einer Schleife.
function altersGruppeSql(alterAusdruck) {
  return "CASE" +
    " WHEN " + alterAusdruck + " IS NULL THEN 'unbekannt'" +
    " WHEN " + alterAusdruck + " <= 6 THEN 'bis 6'" +
    " WHEN " + alterAusdruck + " <= 14 THEN '7 bis 14'" +
    " WHEN " + alterAusdruck + " <= 18 THEN '15 bis 18'" +
    " WHEN " + alterAusdruck + " <= 26 THEN '19 bis 26'" +
    " WHEN " + alterAusdruck + " <= 40 THEN '27 bis 40'" +
    " WHEN " + alterAusdruck + " <= 60 THEN '41 bis 60'" +
    " ELSE 'ueber 60' END";
}

const ALTERSGRUPPEN = ["bis 6", "7 bis 14", "15 bis 18", "19 bis 26",
                       "27 bis 40", "41 bis 60", "ueber 60", "unbekannt"];

// Satzung § 8 Abs. 2.
const STIMMRECHT_ALTER = 16;

// Alter zum Stichtag, in SQL. Der Geburtstag im laufenden Jahr zaehlt nur,
// wenn er schon war -- ohne die zweite CASE-Zeile waere rund die Haelfte
// aller Mitglieder ein Jahr zu alt.
//
// Der Stichtag wird als LITERAL eingesetzt, nicht als Platzhalter. Grund:
// altersGruppeSql() wiederholt diesen Ausdruck siebenmal, und jede
// Wiederholung braeuchte zwei weitere gebundene Werte in exakt der
// richtigen Reihenfolge. Diese Zaehlerei geht irgendwann daneben, ohne
// dass es auffaellt. Sicher ist das Einsetzen nur, weil istIsoDatum()
// den Wert vorher auf ^\d{4}-\d{2}-\d{2}$ festnagelt -- ein Datum in
// diesem Format kann kein Anfuehrungszeichen enthalten.
// ⚠️ Diese Funktion NIE mit einem ungeprueften Wert aufrufen.
function alterSql(stichtag) {
  if (!istIsoDatum(stichtag)) throw new Error("alterSql: ungeprueftes Datum");
  const d = "'" + stichtag + "'";
  return "(CASE WHEN p.geburtsdatum IS NULL OR length(p.geburtsdatum) < 10 THEN NULL ELSE " +
    " CAST(substr(" + d + ", 1, 4) AS INTEGER) - CAST(substr(p.geburtsdatum, 1, 4) AS INTEGER) - " +
    " (CASE WHEN substr(" + d + ", 6, 5) < substr(p.geburtsdatum, 6, 5) THEN 1 ELSE 0 END) END)";
}

// Bestandsfilter zum Stichtag, aus demselben Grund ebenfalls mit
// eingesetztem Datum.
function bestandSql(stichtag) {
  if (!istIsoDatum(stichtag)) throw new Error("bestandSql: ungeprueftes Datum");
  const d = "'" + stichtag + "'";
  return "m.status IN ('aktiv','ruhend') AND m.eintritt <= " + d +
         " AND (m.austritt IS NULL OR m.austritt >= " + d + ")";
}

async function handleBuchInit(env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfBuchen) {
    return json({ error: "Nur der Schatzmeister kann die Buchhaltung einrichten" }, 403, corsHeaders);
  }
  for (const sql of BUCHHALTUNG_SCHEMA) await env.VV_DB.prepare(sql).run();

  const jetzt = new Date().toISOString();
  const daKonten = await env.VV_DB.prepare("SELECT nummer FROM konto").all();
  const hatKonto = new Set((daKonten.results || []).map((z) => z.nummer));
  const daVorlagen = await env.VV_DB.prepare("SELECT name FROM geschaeftsvorfall_vorlage").all();
  const hatVorlage = new Set((daVorlagen.results || []).map((z) => z.name));

  // Vorhandenes wird nicht angefasst: ein von Hand geaendertes Konto darf
  // ein zweiter Klick nicht zurueckdrehen.
  const an = [];
  for (const k of KONTENRAHMEN) {
    if (hatKonto.has(k.nummer)) continue;
    an.push(env.VV_DB.prepare(
      "INSERT INTO konto (id, nummer, name, art, sphaere, gruppe, sortierung, erstellt_am, erstellt_von) " +
      "VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind(uuid(), k.nummer, k.name, k.art, k.sphaere || null, k.gruppe || null,
           k.sortierung, jetzt, me.username));
  }
  for (const v of VORLAGEN) {
    if (hatVorlage.has(v.name)) continue;
    an.push(env.VV_DB.prepare(
      "INSERT INTO geschaeftsvorfall_vorlage (id, name, erklaerung, soll_nummer, haben_nummer, " +
      "sphaere, sortierung, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind(uuid(), v.name, v.erklaerung, v.soll, v.haben, v.sphaere || null,
           v.sortierung, jetzt, me.username));
  }
  if (an.length) await env.VV_DB.batch(an);

  return json({ ok: true, konten_angelegt: an.length ? KONTENRAHMEN.filter((k) => !hatKonto.has(k.nummer)).length : 0,
                vorlagen_angelegt: VORLAGEN.filter((v) => !hatVorlage.has(v.name)).length }, 200, corsHeaders);
}

async function handleBuchStammdaten(env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfBuchen) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  let jahre = [], konten = [], vorlagen = [];
  try {
    jahre = ((await env.VV_DB.prepare(
      "SELECT * FROM geschaeftsjahr ORDER BY jahr DESC").all()).results) || [];
    konten = ((await env.VV_DB.prepare(
      "SELECT id, nummer, name, art, sphaere, gruppe, aktiv FROM konto ORDER BY sortierung, nummer").all()).results) || [];
    vorlagen = ((await env.VV_DB.prepare(
      "SELECT id, name, erklaerung, soll_nummer, haben_nummer, sphaere FROM geschaeftsvorfall_vorlage " +
      "WHERE aktiv = 1 ORDER BY sortierung, name").all()).results) || [];
  } catch (e) {
    if (/no such table/i.test(e && e.message ? e.message : "")) {
      return json({ ok: true, eingerichtet: false, jahre: [], konten: [], vorlagen: [],
                    sphaeren: SPHAEREN }, 200, corsHeaders);
    }
    throw e;
  }

  return json({
    ok: true,
    eingerichtet: konten.length > 0,
    jahre, konten, vorlagen,
    sphaeren: SPHAEREN
  }, 200, corsHeaders);
}

async function handleJahrAnlegen(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfBuchen) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const jahr = parseInt(body.jahr, 10);
  if (!Number.isFinite(jahr) || jahr < 2000 || jahr > 2100) {
    return json({ error: "Bitte ein Jahr zwischen 2000 und 2100 angeben" }, 400, corsHeaders);
  }
  const da = await env.VV_DB.prepare("SELECT id FROM geschaeftsjahr WHERE jahr = ?").bind(jahr).first();
  if (da) return json({ error: "Das Geschaeftsjahr " + jahr + " gibt es schon" }, 409, corsHeaders);

  const jetzt = new Date().toISOString();
  const id = uuid();
  await env.VV_DB.prepare(
    "INSERT INTO geschaeftsjahr (id, jahr, beginn, ende, status, erstellt_am, erstellt_von) " +
    "VALUES (?,?,?,?,'offen',?,?)"
  ).bind(id, jahr, jahr + "-01-01", jahr + "-12-31", jetzt, me.username).run();

  await protokolliere(env, me.username, "geschaeftsjahr-angelegt", "geschaeftsjahr", id, { jahr });
  return json({ ok: true, id, jahr }, 200, corsHeaders);
}

async function handleKontoSpeichern(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfBuchen) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const nummer = sauber(body.nummer, 10);
  const name = sauber(body.name, 120);
  if (!nummer || !name) return json({ error: "Nummer und Bezeichnung sind erforderlich" }, 400, corsHeaders);
  if (!KONTOARTEN.has(body.art)) return json({ error: "Unbekannte Kontoart" }, 400, corsHeaders);

  // Ertrag und Aufwand OHNE Sphaere gaebe es nicht: dann liesse sich am
  // Jahresende nicht sagen, was steuerpflichtig war.
  const sphaere = (body.art === "ertrag" || body.art === "aufwand")
    ? (SPHAEREN[body.sphaere] ? body.sphaere : null) : null;
  if ((body.art === "ertrag" || body.art === "aufwand") && !sphaere) {
    return json({ error: "Ertrags- und Aufwandskonten brauchen eine Sphaere" }, 400, corsHeaders);
  }

  const jetzt = new Date().toISOString();
  const id = sauber(body.id, 40);
  if (id) {
    const vorhanden = await env.VV_DB.prepare("SELECT id FROM konto WHERE id = ?").bind(id).first();
    if (!vorhanden) return json({ error: "Konto nicht gefunden" }, 404, corsHeaders);
    // ⚠️ Die Sphaere darf sich aendern -- gebuchte Zeilen behalten aber
    // ihre eigene. Die Vergangenheit wird nicht umgeschrieben.
    await env.VV_DB.prepare(
      "UPDATE konto SET nummer = ?, name = ?, art = ?, sphaere = ?, gruppe = ?, aktiv = ? WHERE id = ?"
    ).bind(nummer, name, body.art, sphaere, sauber(body.gruppe, 60),
           body.aktiv === false ? 0 : 1, id).run();
    await protokolliere(env, me.username, "konto-geaendert", "konto", id, { nummer, name });
    return json({ ok: true, id }, 200, corsHeaders);
  }

  const belegt = await env.VV_DB.prepare("SELECT id FROM konto WHERE nummer = ?").bind(nummer).first();
  if (belegt) return json({ error: "Die Kontonummer " + nummer + " ist schon vergeben" }, 409, corsHeaders);
  const neu = uuid();
  await env.VV_DB.prepare(
    "INSERT INTO konto (id, nummer, name, art, sphaere, gruppe, sortierung, erstellt_am, erstellt_von) " +
    "VALUES (?,?,?,?,?,?,?,?,?)"
  ).bind(neu, nummer, name, body.art, sphaere, sauber(body.gruppe, 60),
         parseInt(body.sortierung, 10) || 500, jetzt, me.username).run();
  await protokolliere(env, me.username, "konto-angelegt", "konto", neu, { nummer, name });
  return json({ ok: true, id: neu }, 200, corsHeaders);
}

// Prueft die Zeilen einer Buchung und baut sie fertig. Gibt { fehler }
// oder { zeilen, summe } zurueck.
function pruefeBuchungszeilen(roh, kontenNachId) {
  if (!Array.isArray(roh) || roh.length < 2) {
    return { fehler: "Eine Buchung braucht mindestens zwei Zeilen" };
  }
  if (roh.length > 60) return { fehler: "Zu viele Zeilen fuer eine Buchung" };

  let soll = 0, haben = 0;
  const zeilen = [];
  for (const z of roh) {
    const konto = kontenNachId.get(String(z.konto_id || ""));
    if (!konto) return { fehler: "Unbekanntes Konto in einer Zeile" };
    if (!konto.aktiv) return { fehler: "Konto " + konto.nummer + " ist stillgelegt" };

    const s = Math.round(Number(z.soll_cent) || 0);
    const h = Math.round(Number(z.haben_cent) || 0);
    if (s < 0 || h < 0) return { fehler: "Negative Betraege gibt es nicht -- dafuer ist die andere Spalte da" };
    if (s > 0 && h > 0) return { fehler: "Eine Zeile steht im Soll ODER im Haben, nie in beidem" };
    if (s === 0 && h === 0) continue;

    soll += s; haben += h;
    zeilen.push({
      konto_id: konto.id, soll_cent: s, haben_cent: h,
      // Abzug der Konto-Sphaere. Nicht vom Client entgegennehmen -- sonst
      // liesse sich eine steuerpflichtige Einnahme als ideell buchen.
      sphaere: konto.sphaere || null,
      sparte_id: z.sparte_id ? String(z.sparte_id) : null,
      text: z.text ? String(z.text).slice(0, 200) : null
    });
  }

  if (zeilen.length < 2) return { fehler: "Mindestens zwei Zeilen muessen einen Betrag tragen" };
  if (soll === 0) return { fehler: "Die Buchung hat keinen Betrag" };
  if (soll !== haben) {
    return { fehler: "Soll und Haben gehen nicht auf: " + (soll / 100).toFixed(2) +
                     " gegen " + (haben / 100).toFixed(2) };
  }
  return { zeilen, summe: soll };
}

// Legt eine Buchung an. Wiederholt bei einem Gleichstand auf der
// Belegnummer -- die Nummer wird als Unterabfrage im INSERT gezogen, der
// eindeutige Index entscheidet, wer sie bekommt.
async function schreibeBuchung(env, plan, username) {
  const jetzt = new Date().toISOString();
  for (let versuch = 0; versuch < 4; versuch++) {
    const buchungId = uuid();
    const an = [];
    an.push(env.VV_DB.prepare(
      "INSERT INTO buchung (id, geschaeftsjahr_id, belegnummer, belegdatum, buchungsdatum, text, " +
      "vorlage_id, summe_cent, art, quelle_typ, quelle_id, storno_von_id, storno_grund, " +
      "erstellt_am, erstellt_von) VALUES (?,?," +
      "(SELECT COALESCE(MAX(belegnummer),0)+1 FROM buchung WHERE geschaeftsjahr_id = ?)," +
      "?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(buchungId, plan.jahr_id, plan.jahr_id, plan.belegdatum, jetzt.slice(0, 10),
           plan.text, plan.vorlage_id || null, plan.summe, plan.art || "normal",
           plan.quelle_typ || null, plan.quelle_id || null, plan.storno_von_id || null,
           plan.storno_grund || null, jetzt, username));

    for (const z of plan.zeilen) {
      an.push(env.VV_DB.prepare(
        "INSERT INTO buchungszeile (id, buchung_id, konto_id, soll_cent, haben_cent, sphaere, sparte_id, text) " +
        "VALUES (?,?,?,?,?,?,?,?)"
      ).bind(uuid(), buchungId, z.konto_id, z.soll_cent, z.haben_cent,
             z.sphaere, z.sparte_id, z.text));
    }
    if (plan.zusatz) for (const st of plan.zusatz(buchungId)) an.push(st);

    try {
      await env.VV_DB.batch(an);
      const r = await env.VV_DB.prepare("SELECT belegnummer FROM buchung WHERE id = ?")
        .bind(buchungId).first();
      return { id: buchungId, belegnummer: r ? r.belegnummer : null };
    } catch (e) {
      const txt = e && e.message ? e.message : String(e);
      // ⚠️ SQLite nennt in der Meldung die SPALTEN, nicht den Indexnamen:
      // "UNIQUE constraint failed: buchung.quelle_typ, buchung.quelle_id".
      // Wer nur auf den Indexnamen prueft, faengt gar nichts.
      //
      // Nur der Gleichstand auf der Belegnummer wird wiederholt -- zwei
      // Leute koennen gleichzeitig buchen. Ein zweiter Buchungsversuch
      // derselben Quelle ist dagegen ein echter Fehler und wird gemeldet,
      // nicht wegretryt.
      if (/quelle_typ|quelle_id|idx_buchung_quelle/i.test(txt)) {
        return { fehler: "Dieser Vorgang ist bereits gebucht" };
      }
      if (!/belegnummer|idx_buchung_beleg/i.test(txt) || versuch === 3) throw e;
    }
  }
  return { fehler: "Belegnummer konnte nicht vergeben werden" };
}

async function ladeJahrFuer(env, datum, jahrId) {
  if (jahrId) {
    return env.VV_DB.prepare("SELECT * FROM geschaeftsjahr WHERE id = ?").bind(jahrId).first();
  }
  return env.VV_DB.prepare(
    "SELECT * FROM geschaeftsjahr WHERE beginn <= ? AND ende >= ?").bind(datum, datum).first();
}

async function handleBuchen(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfBuchen) return json({ error: "Nur der Schatzmeister kann buchen" }, 403, corsHeaders);

  const belegdatum = sauber(body.belegdatum, 10);
  if (!belegdatum || !istIsoDatum(belegdatum)) {
    return json({ error: "Das Belegdatum fehlt oder ist kein gueltiges Datum" }, 400, corsHeaders);
  }
  const text = sauber(body.text, 200);
  if (!text) return json({ error: "Ohne Buchungstext ist ein Beleg nicht nachvollziehbar" }, 400, corsHeaders);

  const jahr = await ladeJahrFuer(env, belegdatum, sauber(body.geschaeftsjahr_id, 40));
  if (!jahr) {
    return json({ error: "Fuer den " + belegdatum + " gibt es kein Geschaeftsjahr. " +
                         "Bitte zuerst anlegen." }, 400, corsHeaders);
  }
  if (jahr.status !== "offen") {
    return json({ error: "Das Geschaeftsjahr " + jahr.jahr + " ist abgeschlossen. " +
                         "Korrekturen laufen ueber eine Buchung im Folgejahr." }, 409, corsHeaders);
  }
  if (belegdatum < jahr.beginn || belegdatum > jahr.ende) {
    return json({ error: "Das Belegdatum liegt ausserhalb des Geschaeftsjahrs " + jahr.jahr }, 400, corsHeaders);
  }

  const konten = await env.VV_DB.prepare("SELECT id, nummer, sphaere, aktiv FROM konto").all();
  const nachId = new Map((konten.results || []).map((k) => [k.id, k]));
  const geprueft = pruefeBuchungszeilen(body.zeilen, nachId);
  if (geprueft.fehler) return json({ error: geprueft.fehler }, 400, corsHeaders);

  // Die Vorlage traegt ihre Sphaere doppelt -- als Pruefung, nicht als
  // zweite Wahrheit. Weicht sie von der des Kontos ab, ist eines von
  // beiden falsch gepflegt, und das soll auffallen statt still zu wirken.
  let vorlageId = sauber(body.vorlage_id, 40);
  if (vorlageId) {
    const v = await env.VV_DB.prepare(
      "SELECT id, name, sphaere FROM geschaeftsvorfall_vorlage WHERE id = ?").bind(vorlageId).first();
    if (!v) return json({ error: "Vorlage nicht gefunden" }, 400, corsHeaders);
    if (v.sphaere) {
      const passt = geprueft.zeilen.some((z) => z.sphaere === v.sphaere);
      if (!passt) {
        return json({ error: "Die Vorlage \"" + v.name + "\" gehoert in die Sphaere " +
          (SPHAEREN[v.sphaere] || v.sphaere) + ", die gewaehlten Konten aber nicht. " +
          "Bitte Kontenrahmen und Vorlage abgleichen." }, 400, corsHeaders);
      }
    }
  }

  const ergebnis = await schreibeBuchung(env, {
    jahr_id: jahr.id, belegdatum, text, vorlage_id: vorlageId,
    summe: geprueft.summe, zeilen: geprueft.zeilen
  }, me.username);
  if (ergebnis.fehler) return json({ error: ergebnis.fehler }, 409, corsHeaders);

  await protokolliere(env, me.username, "gebucht", "buchung", ergebnis.id,
                      { belegnummer: ergebnis.belegnummer, summe_cent: geprueft.summe });
  return json({ ok: true, id: ergebnis.id, belegnummer: ergebnis.belegnummer,
                jahr: jahr.jahr }, 200, corsHeaders);
}

async function handleJournal(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfBuchen) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const jahrId = sauber(body.geschaeftsjahr_id, 40);
  if (!jahrId) return json({ error: "Kein Geschaeftsjahr gewaehlt" }, 400, corsHeaders);

  const suche = sauber(body.suche, 60);
  const bedingungen = ["b.geschaeftsjahr_id = ?"];
  const werte = [jahrId];
  if (suche) {
    bedingungen.push("(b.text LIKE ? OR CAST(b.belegnummer AS TEXT) = ?)");
    werte.push("%" + suche + "%", suche);
  }

  // Kopf und Zeilen in ZWEI Abfragen, nicht in einer je Buchung. Bei 800
  // Belegen waere das N+1-Muster wieder da, an dem der Worker in Stufe 0
  // gestorben ist.
  const kopf = await env.VV_DB.prepare(
    "SELECT b.*, v.name AS vorlage FROM buchung b " +
    "LEFT JOIN geschaeftsvorfall_vorlage v ON v.id = b.vorlage_id " +
    "WHERE " + bedingungen.join(" AND ") +
    " ORDER BY b.belegnummer DESC LIMIT 300"
  ).bind(...werte).all();

  const ids = (kopf.results || []).map((b) => b.id);
  let zeilen = [];
  if (ids.length) {
    const p = ids.map(() => "?").join(",");
    zeilen = ((await env.VV_DB.prepare(
      "SELECT z.buchung_id, z.soll_cent, z.haben_cent, z.sphaere, z.text, " +
      "k.nummer, k.name FROM buchungszeile z JOIN konto k ON k.id = z.konto_id " +
      "WHERE z.buchung_id IN (" + p + ") ORDER BY z.soll_cent DESC"
    ).bind(...ids).all()).results) || [];
  }
  const nachBuchung = new Map();
  for (const z of zeilen) {
    if (!nachBuchung.has(z.buchung_id)) nachBuchung.set(z.buchung_id, []);
    nachBuchung.get(z.buchung_id).push(z);
  }

  return json({
    ok: true,
    buchungen: (kopf.results || []).map((b) => Object.assign({}, b, {
      zeilen: nachBuchung.get(b.id) || []
    }))
  }, 200, corsHeaders);
}

async function handleBuchungStornieren(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfBuchen) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const original = await env.VV_DB.prepare("SELECT * FROM buchung WHERE id = ?")
    .bind(sauber(body.id, 40)).first();
  if (!original) return json({ error: "Buchung nicht gefunden" }, 404, corsHeaders);
  if (original.storniert_am) return json({ error: "Diese Buchung ist bereits storniert" }, 409, corsHeaders);
  if (original.storno_von_id) {
    return json({ error: "Eine Stornobuchung wird nicht noch einmal storniert. " +
                         "Buchen Sie den Vorgang bei Bedarf neu." }, 409, corsHeaders);
  }

  const jahr = await env.VV_DB.prepare("SELECT * FROM geschaeftsjahr WHERE id = ?")
    .bind(original.geschaeftsjahr_id).first();
  if (jahr && jahr.status !== "offen") {
    return json({ error: "Das Geschaeftsjahr " + jahr.jahr + " ist abgeschlossen" }, 409, corsHeaders);
  }

  const zeilen = ((await env.VV_DB.prepare(
    "SELECT * FROM buchungszeile WHERE buchung_id = ?").bind(original.id).all()).results) || [];
  if (!zeilen.length) return json({ error: "Buchung ohne Zeilen" }, 409, corsHeaders);

  const grund = sauber(body.grund, 200);
  const jetzt = new Date().toISOString();

  // Soll und Haben getauscht. Die Salden gehen dadurch von selbst auf --
  // deshalb rechnet die Saldenliste ohne Filter auf storniert_am.
  const ergebnis = await schreibeBuchung(env, {
    jahr_id: original.geschaeftsjahr_id,
    belegdatum: sauber(body.belegdatum, 10) && istIsoDatum(body.belegdatum)
      ? body.belegdatum : jetzt.slice(0, 10),
    text: "Storno zu Beleg " + original.belegnummer + (grund ? " -- " + grund : ""),
    summe: original.summe_cent,
    art: "storno",
    storno_von_id: original.id,
    storno_grund: grund,
    zeilen: zeilen.map((z) => ({
      konto_id: z.konto_id, soll_cent: z.haben_cent, haben_cent: z.soll_cent,
      sphaere: z.sphaere, sparte_id: z.sparte_id, text: z.text
    })),
    zusatz: () => [env.VV_DB.prepare(
      "UPDATE buchung SET storniert_am = ?, storniert_von = ?, storno_grund = ? WHERE id = ?"
    ).bind(jetzt, me.username, grund, original.id)]
  }, me.username);
  if (ergebnis.fehler) return json({ error: ergebnis.fehler }, 409, corsHeaders);

  await protokolliere(env, me.username, "buchung-storniert", "buchung", original.id,
                      { storno_beleg: ergebnis.belegnummer });
  return json({ ok: true, storno_id: ergebnis.id, belegnummer: ergebnis.belegnummer }, 200, corsHeaders);
}

// Summen- und Saldenliste plus Ergebnis je Sphaere. EINE Abfrage ueber
// alle Zeilen des Jahres.
async function summenJeKonto(env, jahrId) {
  const r = await env.VV_DB.prepare(
    "SELECT k.id, k.nummer, k.name, k.art, k.sphaere, k.gruppe, " +
    "  SUM(z.soll_cent) AS soll, SUM(z.haben_cent) AS haben " +
    "FROM buchungszeile z JOIN buchung b ON b.id = z.buchung_id " +
    "JOIN konto k ON k.id = z.konto_id " +
    "WHERE b.geschaeftsjahr_id = ? " +
    "GROUP BY k.id ORDER BY k.sortierung, k.nummer"
  ).bind(jahrId).all();

  return (r.results || []).map((k) => {
    const soll = k.soll || 0, haben = k.haben || 0;
    // Aktiv und Aufwand haben einen Sollsaldo, Passiv und Ertrag einen
    // Habensaldo. Ohne diese Unterscheidung stimmt kein Vorzeichen.
    const saldo = (k.art === "aktiv" || k.art === "aufwand") ? soll - haben : haben - soll;
    return { id: k.id, nummer: k.nummer, name: k.name, art: k.art, sphaere: k.sphaere,
             gruppe: k.gruppe, soll_cent: soll, haben_cent: haben, saldo_cent: saldo };
  });
}

function ergebnisJeSphaere(konten) {
  const je = {};
  for (const s of Object.keys(SPHAEREN)) {
    je[s] = { ertrag_cent: 0, aufwand_cent: 0, ergebnis_cent: 0 };
  }
  for (const k of konten) {
    if (k.art !== "ertrag" && k.art !== "aufwand") continue;
    const s = k.sphaere && je[k.sphaere] ? k.sphaere : "ideell";
    if (k.art === "ertrag") je[s].ertrag_cent += k.saldo_cent;
    else je[s].aufwand_cent += k.saldo_cent;
  }
  let gesamt = 0;
  for (const s of Object.keys(je)) {
    je[s].ergebnis_cent = je[s].ertrag_cent - je[s].aufwand_cent;
    gesamt += je[s].ergebnis_cent;
  }
  return { je, gesamt_cent: gesamt };
}

async function handleSaldenliste(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfBuchen) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const jahrId = sauber(body.geschaeftsjahr_id, 40);
  const jahr = jahrId
    ? await env.VV_DB.prepare("SELECT * FROM geschaeftsjahr WHERE id = ?").bind(jahrId).first()
    : null;
  if (!jahr) return json({ error: "Kein Geschaeftsjahr gewaehlt" }, 400, corsHeaders);

  const konten = await summenJeKonto(env, jahr.id);
  const erg = ergebnisJeSphaere(konten);

  const bestand = konten.filter((k) => k.art === "aktiv" || k.art === "passiv");
  const aktiva = bestand.filter((k) => k.art === "aktiv").reduce((s, k) => s + k.saldo_cent, 0);
  const passiva = bestand.filter((k) => k.art === "passiv").reduce((s, k) => s + k.saldo_cent, 0);

  const anzahl = await env.VV_DB.prepare(
    "SELECT COUNT(*) AS n, SUM(CASE WHEN storniert_am IS NOT NULL THEN 1 ELSE 0 END) AS storniert " +
    "FROM buchung WHERE geschaeftsjahr_id = ?").bind(jahr.id).first();

  return json({
    ok: true, jahr,
    konten, sphaeren: SPHAEREN,
    ergebnis: erg.je, ergebnis_gesamt_cent: erg.gesamt_cent,
    aktiva_cent: aktiva, passiva_cent: passiva,
    // Aktiva und Passiva gehen erst NACH dem Abschluss auf: bis dahin
    // steht das Ergebnis noch auf den Erfolgskonten und nicht im
    // Vereinsvermoegen. Die Differenz MUSS genau das Ergebnis sein.
    differenz_cent: aktiva - passiva,
    buchungen: anzahl ? anzahl.n : 0,
    stornierte: anzahl ? (anzahl.storniert || 0) : 0
  }, 200, corsHeaders);
}

// Was aus der Beitragsverwaltung noch nicht gebucht ist. Zwei Abfragen,
// beide mengenbasiert.
async function handleUebernahmeVorschau(env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfBuchen) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const laeufe = ((await env.VV_DB.prepare(
    "SELECT l.id, l.bezeichnung, l.jahr, l.summe_cent, l.anzahl_erzeugt, l.festgeschrieben_am " +
    "FROM beitragslauf l WHERE l.status = 'festgeschrieben' AND NOT EXISTS " +
    "(SELECT 1 FROM buchung b WHERE b.quelle_typ = 'beitragslauf' AND b.quelle_id = l.id) " +
    "ORDER BY l.jahr DESC").all()).results) || [];

  const dateien = ((await env.VV_DB.prepare(
    "SELECT d.id, d.ausfuehrung_am, d.summe_cent, d.anzahl_posten, d.gebucht_am " +
    "FROM sepa_datei d WHERE d.gebucht_am IS NOT NULL AND NOT EXISTS " +
    "(SELECT 1 FROM buchung b WHERE b.quelle_typ = 'sepa_datei' AND b.quelle_id = d.id) " +
    "ORDER BY d.ausfuehrung_am DESC").all()).results) || [];

  return json({
    ok: true,
    laeufe: laeufe.map((l) => ({
      quelle_typ: "beitragslauf", quelle_id: l.id,
      bezeichnung: l.bezeichnung, datum: l.festgeschrieben_am ? l.festgeschrieben_am.slice(0, 10) : null,
      summe_cent: l.summe_cent, anzahl: l.anzahl_erzeugt,
      soll: "1400", haben: "4100",
      text: "Beitragsforderungen " + l.bezeichnung
    })),
    dateien: dateien.map((d) => ({
      quelle_typ: "sepa_datei", quelle_id: d.id,
      bezeichnung: "Lastschrifteinzug vom " + d.ausfuehrung_am,
      datum: d.ausfuehrung_am, summe_cent: d.summe_cent, anzahl: d.anzahl_posten,
      soll: "1200", haben: "1400",
      text: "Lastschrifteinzug " + d.ausfuehrung_am
    }))
  }, 200, corsHeaders);
}

async function handleUebernahmeBuchen(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfBuchen) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const typ = String(body.quelle_typ || "");
  if (typ !== "beitragslauf" && typ !== "sepa_datei") {
    return json({ error: "Unbekannte Quelle" }, 400, corsHeaders);
  }
  const quelleId = sauber(body.quelle_id, 40);
  if (!quelleId) return json({ error: "Keine Quelle angegeben" }, 400, corsHeaders);

  let datum, summe, text, sollNr, habenNr;
  if (typ === "beitragslauf") {
    const l = await env.VV_DB.prepare(
      "SELECT * FROM beitragslauf WHERE id = ?").bind(quelleId).first();
    if (!l) return json({ error: "Beitragslauf nicht gefunden" }, 404, corsHeaders);
    if (l.status !== "festgeschrieben") {
      return json({ error: "Nur ein festgeschriebener Lauf wird gebucht. Bis dahin kann er " +
                           "sich noch aendern." }, 409, corsHeaders);
    }
    // ⚠️ Die FAELLIGKEIT bestimmt das Geschaeftsjahr, nicht der Tag, an
    // dem jemand auf "festschreiben" geklickt hat. Ein Lauf fuer 2027
    // wird oft schon im Dezember 2026 vorbereitet -- gebucht ueber das
    // Erstelldatum landete die komplette Jahressollstellung im falschen
    // Jahr und beide Jahresergebnisse waeren falsch.
    datum = l.faelligkeit;
    summe = l.summe_cent; text = "Beitragsforderungen " + l.bezeichnung;
    sollNr = "1400"; habenNr = "4100";
  } else {
    const d = await env.VV_DB.prepare("SELECT * FROM sepa_datei WHERE id = ?").bind(quelleId).first();
    if (!d) return json({ error: "SEPA-Datei nicht gefunden" }, 404, corsHeaders);
    if (!d.gebucht_am) {
      return json({ error: "Diese Einreichung ist in der Beitragsverwaltung noch nicht als " +
                           "eingegangen gebucht" }, 409, corsHeaders);
    }
    datum = d.ausfuehrung_am;
    summe = d.summe_cent; text = "Lastschrifteinzug " + d.ausfuehrung_am;
    sollNr = "1200"; habenNr = "1400";
  }

  if (!summe) return json({ error: "Der Vorgang hat keinen Betrag" }, 400, corsHeaders);

  const jahr = await ladeJahrFuer(env, datum, null);
  if (!jahr) return json({ error: "Fuer den " + datum + " gibt es kein Geschaeftsjahr" }, 400, corsHeaders);
  if (jahr.status !== "offen") {
    return json({ error: "Das Geschaeftsjahr " + jahr.jahr + " ist abgeschlossen" }, 409, corsHeaders);
  }

  const konten = ((await env.VV_DB.prepare(
    "SELECT id, nummer, sphaere, aktiv FROM konto WHERE nummer IN (?,?)").bind(sollNr, habenNr).all()).results) || [];
  const nachNr = new Map(konten.map((k) => [k.nummer, k]));
  if (!nachNr.has(sollNr) || !nachNr.has(habenNr)) {
    return json({ error: "Die Konten " + sollNr + " und " + habenNr + " fehlen im Kontenrahmen" }, 400, corsHeaders);
  }

  const ergebnis = await schreibeBuchung(env, {
    jahr_id: jahr.id, belegdatum: datum, text, summe,
    quelle_typ: typ, quelle_id: quelleId,
    zeilen: [
      { konto_id: nachNr.get(sollNr).id, soll_cent: summe, haben_cent: 0,
        sphaere: nachNr.get(sollNr).sphaere || null, sparte_id: null, text: null },
      { konto_id: nachNr.get(habenNr).id, soll_cent: 0, haben_cent: summe,
        sphaere: nachNr.get(habenNr).sphaere || null, sparte_id: null, text: null }
    ]
  }, me.username);
  if (ergebnis.fehler) return json({ error: ergebnis.fehler }, 409, corsHeaders);

  await protokolliere(env, me.username, "uebernahme-gebucht", "buchung", ergebnis.id,
                      { quelle_typ: typ, quelle_id: quelleId, summe_cent: summe });
  return json({ ok: true, id: ergebnis.id, belegnummer: ergebnis.belegnummer,
                summe_cent: summe, jahr: jahr.jahr }, 200, corsHeaders);
}

// Jahresabschluss: Erfolgskonten gegen das Vereinsvermoegen glattstellen,
// Jahr schliessen, und -- falls das Folgejahr schon angelegt ist -- dessen
// Eroeffnungsbuchung schreiben. In einem Zug, damit kein halber Abschluss
// stehen bleibt.
async function handleJahresabschluss(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfBuchen) return json({ error: "Nur der Schatzmeister kann abschliessen" }, 403, corsHeaders);

  const jahr = await env.VV_DB.prepare("SELECT * FROM geschaeftsjahr WHERE id = ?")
    .bind(sauber(body.geschaeftsjahr_id, 40)).first();
  if (!jahr) return json({ error: "Geschaeftsjahr nicht gefunden" }, 404, corsHeaders);
  if (jahr.status !== "offen") {
    return json({ error: "Das Jahr " + jahr.jahr + " ist bereits abgeschlossen" }, 409, corsHeaders);
  }

  const konten = await summenJeKonto(env, jahr.id);
  const erg = ergebnisJeSphaere(konten);

  const alle = ((await env.VV_DB.prepare(
    "SELECT id, nummer, sphaere FROM konto").all()).results) || [];
  const nachNr = new Map(alle.map((k) => [k.nummer, k]));
  const kapital = nachNr.get("2000");
  const vortrag = nachNr.get("9000");
  if (!kapital || !vortrag) {
    return json({ error: "Die Konten 2000 (Vereinsvermoegen) und 9000 (Saldenvortraege) " +
                         "werden fuer den Abschluss gebraucht" }, 400, corsHeaders);
  }

  // 1) Abschlussbuchung. Jedes Erfolgskonto wird auf null gestellt, die
  //    Summe landet im Vereinsvermoegen.
  const abschlussZeilen = [];
  let ertragSumme = 0, aufwandSumme = 0;
  for (const k of konten) {
    if (k.art !== "ertrag" && k.art !== "aufwand") continue;
    if (!k.saldo_cent) continue;
    if (k.art === "ertrag") {
      abschlussZeilen.push({ konto_id: k.id, soll_cent: k.saldo_cent, haben_cent: 0,
                             sphaere: k.sphaere, sparte_id: null, text: "Abschluss" });
      ertragSumme += k.saldo_cent;
    } else {
      abschlussZeilen.push({ konto_id: k.id, soll_cent: 0, haben_cent: k.saldo_cent,
                             sphaere: k.sphaere, sparte_id: null, text: "Abschluss" });
      aufwandSumme += k.saldo_cent;
    }
  }
  const jahresergebnis = ertragSumme - aufwandSumme;
  let abschluss = null;
  if (abschlussZeilen.length) {
    if (jahresergebnis >= 0) {
      abschlussZeilen.push({ konto_id: kapital.id, soll_cent: 0, haben_cent: jahresergebnis,
                             sphaere: null, sparte_id: null, text: "Jahresergebnis" });
    } else {
      abschlussZeilen.push({ konto_id: kapital.id, soll_cent: -jahresergebnis, haben_cent: 0,
                             sphaere: null, sparte_id: null, text: "Jahresergebnis" });
    }
    const summeSoll = abschlussZeilen.reduce((s, z) => s + z.soll_cent, 0);
    abschluss = await schreibeBuchung(env, {
      jahr_id: jahr.id, belegdatum: jahr.ende,
      text: "Abschluss " + jahr.jahr, summe: summeSoll, art: "abschluss",
      zeilen: abschlussZeilen
    }, me.username);
    if (abschluss.fehler) return json({ error: abschluss.fehler }, 409, corsHeaders);
  }

  // 2) Jahr schliessen -- mit dem Ergebnis je Sphaere als Beleg dafuer,
  //    wonach abgeschlossen wurde.
  const jetzt = new Date().toISOString();
  await env.VV_DB.prepare(
    "UPDATE geschaeftsjahr SET status = 'abgeschlossen', abgeschlossen_am = ?, " +
    "abgeschlossen_von = ?, ergebnis_json = ? WHERE id = ?"
  ).bind(jetzt, me.username, JSON.stringify({
    je_sphaere: erg.je, ergebnis_cent: jahresergebnis
  }), jahr.id).run();

  // 3) Eroeffnung des Folgejahres, falls es schon existiert.
  let eroeffnung = null;
  const folge = await env.VV_DB.prepare(
    "SELECT * FROM geschaeftsjahr WHERE jahr = ?").bind(jahr.jahr + 1).first();
  if (folge && folge.status === "offen") {
    eroeffnung = await eroeffnungSchreiben(env, jahr, folge, vortrag, me.username);
    if (eroeffnung && eroeffnung.fehler) return json({ error: eroeffnung.fehler }, 409, corsHeaders);
  }

  await protokolliere(env, me.username, "jahresabschluss", "geschaeftsjahr", jahr.id,
                      { jahr: jahr.jahr, ergebnis_cent: jahresergebnis });

  return json({
    ok: true, jahr: jahr.jahr,
    ergebnis_cent: jahresergebnis,
    je_sphaere: erg.je,
    abschluss_beleg: abschluss ? abschluss.belegnummer : null,
    eroeffnung_beleg: eroeffnung ? eroeffnung.belegnummer : null,
    folgejahr: folge ? folge.jahr : null,
    // ⚠️ Der Hinweis muss auf etwas zeigen, das es GIBT. Ein zweiter
    // Aufruf des Abschlusses ist gesperrt (409) -- er waere hier also ein
    // Versprechen, das der Code selbst verweigert. Deshalb die eigene
    // Aktion.
    hinweis: folge ? null : "Ein Folgejahr ist noch nicht angelegt. Legen Sie es an und rufen " +
                            "Sie danach \"Eroeffnungsbilanz uebernehmen\" auf -- der Abschluss " +
                            "selbst laesst sich nicht wiederholen."
  }, 200, corsHeaders);
}

// Traegt die Bestandskonten eines abgeschlossenen Jahres ins Folgejahr
// vor. Gegenkonto ist 9000; geht die Bilanz auf, bleibt es auf null.
// Wird vom Abschluss aufgerufen UND von der eigenen Aktion, wenn das
// Folgejahr erst spaeter angelegt wurde.
async function eroeffnungSchreiben(env, vorjahr, folge, vortragKonto, username) {
  const nachSchluss = await summenJeKonto(env, vorjahr.id);
  const zeilen = [];
  let sollSumme = 0, habenSumme = 0;
  for (const k of nachSchluss) {
    if (k.art !== "aktiv" && k.art !== "passiv") continue;
    if (!k.saldo_cent) continue;
    if (k.nummer === "9000") continue;
    if (k.art === "aktiv") {
      zeilen.push({ konto_id: k.id, soll_cent: k.saldo_cent, haben_cent: 0,
                    sphaere: null, sparte_id: null, text: "Vortrag" });
      sollSumme += k.saldo_cent;
    } else {
      zeilen.push({ konto_id: k.id, soll_cent: 0, haben_cent: k.saldo_cent,
                    sphaere: null, sparte_id: null, text: "Vortrag" });
      habenSumme += k.saldo_cent;
    }
  }
  if (!zeilen.length) return null;

  const diff = sollSumme - habenSumme;
  if (diff > 0) {
    zeilen.push({ konto_id: vortragKonto.id, soll_cent: 0, haben_cent: diff,
                  sphaere: null, sparte_id: null, text: "Saldenvortrag" });
  } else if (diff < 0) {
    zeilen.push({ konto_id: vortragKonto.id, soll_cent: -diff, haben_cent: 0,
                  sphaere: null, sparte_id: null, text: "Saldenvortrag" });
    sollSumme += -diff;
  }
  return schreibeBuchung(env, {
    jahr_id: folge.id, belegdatum: folge.beginn,
    text: "Eroeffnungsbilanz " + folge.jahr, summe: sollSumme, art: "eroeffnung",
    zeilen
  }, username);
}

async function handleEroeffnung(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfBuchen) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const folge = await env.VV_DB.prepare("SELECT * FROM geschaeftsjahr WHERE id = ?")
    .bind(sauber(body.geschaeftsjahr_id, 40)).first();
  if (!folge) return json({ error: "Geschaeftsjahr nicht gefunden" }, 404, corsHeaders);
  if (folge.status !== "offen") {
    return json({ error: "Das Jahr " + folge.jahr + " ist bereits abgeschlossen" }, 409, corsHeaders);
  }

  const da = await env.VV_DB.prepare(
    "SELECT id FROM buchung WHERE geschaeftsjahr_id = ? AND art = 'eroeffnung'")
    .bind(folge.id).first();
  if (da) return json({ error: "Das Jahr " + folge.jahr + " hat schon eine Eroeffnungsbilanz" }, 409, corsHeaders);

  const vorjahr = await env.VV_DB.prepare("SELECT * FROM geschaeftsjahr WHERE jahr = ?")
    .bind(folge.jahr - 1).first();
  if (!vorjahr) {
    return json({ error: "Es gibt kein Geschaeftsjahr " + (folge.jahr - 1) + ", aus dem " +
                         "vorgetragen werden koennte" }, 400, corsHeaders);
  }
  if (vorjahr.status !== "abgeschlossen") {
    return json({ error: "Das Jahr " + vorjahr.jahr + " ist noch nicht abgeschlossen. " +
                         "Solange kann sich sein Bestand noch aendern." }, 409, corsHeaders);
  }

  const vortrag = await env.VV_DB.prepare("SELECT id FROM konto WHERE nummer = '9000'").first();
  if (!vortrag) return json({ error: "Das Konto 9000 (Saldenvortraege) fehlt" }, 400, corsHeaders);

  const ergebnis = await eroeffnungSchreiben(env, vorjahr, folge, vortrag, me.username);
  if (!ergebnis) {
    return json({ ok: true, belegnummer: null,
                  hinweis: "Im Jahr " + vorjahr.jahr + " stand nichts auf den Bestandskonten, " +
                           "es gibt nichts vorzutragen." }, 200, corsHeaders);
  }
  if (ergebnis.fehler) return json({ error: ergebnis.fehler }, 409, corsHeaders);

  await protokolliere(env, me.username, "eroeffnungsbilanz", "geschaeftsjahr", folge.id,
                      { jahr: folge.jahr, aus: vorjahr.jahr });
  return json({ ok: true, belegnummer: ergebnis.belegnummer,
                jahr: folge.jahr, aus: vorjahr.jahr }, 200, corsHeaders);
}

// ---------------------------------------------------------------------
// STUFE 5 -- AUSWERTUNGEN
// ---------------------------------------------------------------------
//
// Alles hier sind SUMMEN ohne Personenbezug. Deshalb steht es dem
// Vorstand offen, der bewusst keine Mitgliederdaten sehen darf -- und
// deshalb liefert jede Abfrage Gruppen, nie Zeilen mit Namen.

async function handleKennzahlen(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfKennzahlenSehen) {
    return json({ error: "Fuer diese Auswertung fehlt eine Rolle in der Vereinsverwaltung" },
                403, corsHeaders);
  }

  const stichtag = istIsoDatum(body.stichtag) ? body.stichtag
                                              : new Date().toISOString().slice(0, 10);
  const imBestand = bestandSql(stichtag);
  const alter = alterSql(stichtag);

  const bestand = await env.VV_DB.prepare(
    "SELECT COUNT(*) AS gesamt, " +
    " SUM(CASE WHEN m.status = 'aktiv' THEN 1 ELSE 0 END) AS aktiv, " +
    " SUM(CASE WHEN m.status = 'ruhend' THEN 1 ELSE 0 END) AS ruhend, " +
    " SUM(CASE WHEN m.art = 'ehrenmitglied' THEN 1 ELSE 0 END) AS ehren, " +
    " SUM(CASE WHEN " + alter + " >= " + STIMMRECHT_ALTER + " THEN 1 ELSE 0 END) AS stimmberechtigt " +
    "FROM mitgliedschaft m JOIN person p ON p.id = m.person_id WHERE " + imBestand
  ).bind().first();

  const jeSparte = ((await env.VV_DB.prepare(
    "SELECT s.name, COUNT(*) AS n FROM mitgliedschaft_sparte ms " +
    "JOIN mitgliedschaft m ON m.id = ms.mitgliedschaft_id " +
    "JOIN person p ON p.id = m.person_id JOIN sparte s ON s.id = ms.sparte_id " +
    "WHERE (ms.austritt IS NULL OR ms.austritt >= ?) AND " + imBestand +
    " GROUP BY s.id ORDER BY n DESC"
  ).bind(stichtag).all()).results) || [];

  const jeKlasse = ((await env.VV_DB.prepare(
    "SELECT COALESCE(k.name, 'ohne Klasse') AS name, COUNT(*) AS n, " +
    " SUM(COALESCE((SELECT bs.betrag_cent FROM beitragssatz bs WHERE bs.beitragsklasse_id = k.id " +
    "   AND bs.gueltig_ab <= ? AND (bs.gueltig_bis IS NULL OR bs.gueltig_bis >= ?) " +
    "   ORDER BY bs.gueltig_ab DESC LIMIT 1), 0)) AS summe_cent " +
    "FROM mitgliedschaft m JOIN person p ON p.id = m.person_id " +
    "LEFT JOIN beitragsklasse k ON k.id = m.beitragsklasse_id " +
    "WHERE " + imBestand + " GROUP BY k.id ORDER BY n DESC"
  ).bind(stichtag, stichtag).all()).results) || [];

  const jeAlter = ((await env.VV_DB.prepare(
    "SELECT " + altersGruppeSql(alter) + " AS gruppe, " +
    " COALESCE(p.geschlecht, 'ohne') AS geschlecht, COUNT(*) AS n " +
    "FROM mitgliedschaft m JOIN person p ON p.id = m.person_id " +
    "WHERE " + imBestand + " GROUP BY gruppe, geschlecht"
  ).bind().all()).results) || [];

  // Zu- und Abgaenge der letzten zehn Jahre, in einer Abfrage je Richtung.
  const jahr = Number(stichtag.slice(0, 4));
  const von = String(jahr - 9) + "-01-01";
  const zugaenge = ((await env.VV_DB.prepare(
    "SELECT substr(eintritt, 1, 4) AS jahr, COUNT(*) AS n FROM mitgliedschaft " +
    "WHERE eintritt >= ? AND eintritt <= ? GROUP BY jahr ORDER BY jahr"
  ).bind(von, stichtag).all()).results) || [];
  const abgaenge = ((await env.VV_DB.prepare(
    "SELECT substr(austritt, 1, 4) AS jahr, COUNT(*) AS n FROM mitgliedschaft " +
    "WHERE austritt IS NOT NULL AND austritt >= ? AND austritt <= ? GROUP BY jahr ORDER BY jahr"
  ).bind(von, stichtag).all()).results) || [];

  const finanzen = await env.VV_DB.prepare(
    "SELECT COUNT(*) AS forderungen, SUM(betrag_cent) AS summe_cent, " +
    " SUM(CASE WHEN status = 'offen' OR status = 'teilbezahlt' THEN betrag_cent ELSE 0 END) AS offen_cent, " +
    " SUM(CASE WHEN status = 'bezahlt' THEN betrag_cent ELSE 0 END) AS bezahlt_cent " +
    "FROM forderung WHERE storniert_am IS NULL AND jahr = ?"
  ).bind(jahr).first();

  return json({
    ok: true, stichtag, jahr,
    bestand: bestand || {},
    stimmrecht_ab: STIMMRECHT_ALTER,
    je_sparte: jeSparte,
    je_klasse: jeKlasse,
    je_alter: jeAlter,
    altersgruppen: ALTERSGRUPPEN,
    zugaenge, abgaenge,
    finanzen: finanzen || {}
  }, 200, corsHeaders);
}

// Bestandsmeldung an den Landessportbund: Altersgruppen mal Geschlecht,
// je Abteilung. Eine Abfrage, danach nur noch Umsortieren.
async function handleBestandsmeldung(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfKennzahlenSehen) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const stichtag = istIsoDatum(body.stichtag) ? body.stichtag
                                              : (new Date().getFullYear() + "-01-01");

  const roh = ((await env.VV_DB.prepare(
    "SELECT s.name AS sparte, " + altersGruppeSql(alterSql(stichtag)) + " AS gruppe, " +
    " COALESCE(p.geschlecht, 'ohne') AS geschlecht, COUNT(*) AS n " +
    "FROM mitgliedschaft_sparte ms JOIN mitgliedschaft m ON m.id = ms.mitgliedschaft_id " +
    "JOIN person p ON p.id = m.person_id JOIN sparte s ON s.id = ms.sparte_id " +
    "WHERE (ms.austritt IS NULL OR ms.austritt >= ?) AND " + bestandSql(stichtag) + " " +
    "GROUP BY s.name, gruppe, geschlecht ORDER BY s.name"
  ).bind(stichtag).all()).results) || [];

  const nachSparte = new Map();
  for (const z of roh) {
    if (!nachSparte.has(z.sparte)) nachSparte.set(z.sparte, {});
    const s = nachSparte.get(z.sparte);
    if (!s[z.gruppe]) s[z.gruppe] = { w: 0, m: 0, d: 0, ohne: 0, gesamt: 0 };
    const schluessel = ["w", "m", "d"].includes(z.geschlecht) ? z.geschlecht : "ohne";
    s[z.gruppe][schluessel] += z.n;
    s[z.gruppe].gesamt += z.n;
  }

  const zeilen = [];
  for (const [sparte, gruppen] of nachSparte) {
    for (const g of ALTERSGRUPPEN) {
      if (!gruppen[g]) continue;
      zeilen.push(Object.assign({ sparte, altersgruppe: g }, gruppen[g]));
    }
  }

  return json({
    ok: true, stichtag, altersgruppen: ALTERSGRUPPEN,
    zeilen,
    gesamt: zeilen.reduce((s, z) => s + z.gesamt, 0),
    // ⚠️ Wer in zwei Abteilungen ist, steht in beiden Zeilen. Das ist beim
    // Landessportbund so gewollt (gemeldet werden Mitgliedschaften je
    // Sportart), aber die Summe ist deshalb NICHT die Mitgliederzahl.
    hinweis: "Mehrfachmitgliedschaften stehen in jeder Abteilung. Die Summe ist die Zahl " +
             "der Abteilungsmitgliedschaften, nicht die der Personen."
  }, 200, corsHeaders);
}

// =====================================================================
// DIE DATEI, DIE DER LANDESSPORTBUND EINLIEST
// =====================================================================
//
// Das Portal unser-sportverein.net nimmt in Schritt 3 eine CSV mit
// EINZELPERSONEN entgegen -- Name;Vorname;Geschlecht;Geburtsdatum;
// Abteilungen -- und rechnet daraus selbst die Jahrgangsmatrix der
// A- und B-Meldung. handleBestandsmeldung liefert dagegen Summen je
// DOSB-Altersgruppe: gut zum Nachsehen und zum Gegenrechnen, aber nichts,
// was sich hochladen liesse. Deshalb diese zweite Sicht auf dieselben
// Daten.
//
// ⚠️ Diese Antwort enthaelt KLARNAMEN. Sie haengt deshalb an
// darfSchreiben und ausdruecklich NICHT an darfKennzahlenSehen -- sonst
// koennte vorstand.html sie rufen, und die Rechtegrenze jener Seite
// ("laedt keinen Code, der Personendaten anzeigen kann") waere nur noch
// eine Absicht. Ein Abteilungsleiter bekommt sie ebenfalls nicht: er
// sieht seine Sparte, nicht den Gesamtbestand.

// Gemerkt wird nur das JA -- dieselbe Falle wie bei hatGesetzl2Spalte:
// die Migration laeuft moeglicherweise in einem anderen Isolate, und ein
// gemerktes Nein hielte dieses hier dauerhaft auf dem alten Stand fest.
let sportartSpalteDa = false;
async function hatSportartSpalte(env) {
  if (sportartSpalteDa) return true;
  const r = await env.VV_DB.prepare("PRAGMA table_info(sparte)").all();
  const da = (r.results || []).some((s) => s.name === "dosb_sportart_nr");
  if (da) sportartSpalteDa = true;
  return da;
}

// Die Nummer je Abteilung. Sie steht in der Sportartenliste des LSB und
// ist eine Entscheidung des Vereins, keine Ableitung aus dem Namen:
// "Turnen" gibt es in der Thueringer Liste gar nicht, der Verein meldet
// es als Gymnastik (95). Wer sie aus dem Spartennamen erraten wollte,
// meldete Mitglieder an den falschen Fachverband.
async function handleSparteSportart(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfSchreiben) {
    return json({ error: "Nur die Geschaeftsstelle oder der Schatzmeister kann Abteilungen pflegen" },
                403, corsHeaders);
  }

  const id = String(body.sparte_id || "");
  if (!id) return json({ error: "Keine Abteilung angegeben" }, 400, corsHeaders);

  // Leeren muss moeglich bleiben: eine Abteilung ohne gueltige Sportart
  // soll lieber gar keine Nummer tragen als eine falsche.
  let nr = null;
  if (body.nummer !== null && body.nummer !== undefined && String(body.nummer).trim() !== "") {
    nr = Number(String(body.nummer).trim());
    if (!Number.isInteger(nr) || nr < 1 || nr > 9999) {
      return json({ error: "Die Sportartennummer ist eine ganze Zahl zwischen 1 und 9999" },
                  400, corsHeaders);
    }
  }

  // Der Aufrufer hat darfSchreiben und kaeme damit ohnehin an
  // handleMigration -- die Spalte hier nachzuziehen erspart ihm den
  // Umweg ueber einen anderen Reiter.
  if (!(await hatSportartSpalte(env))) {
    await env.VV_DB.prepare("ALTER TABLE sparte ADD COLUMN dosb_sportart_nr INTEGER").run();
    sportartSpalteDa = true;
  }

  const da = await env.VV_DB.prepare("SELECT id, name FROM sparte WHERE id = ?").bind(id).first();
  if (!da) return json({ error: "Abteilung nicht gefunden" }, 404, corsHeaders);

  await env.VV_DB.prepare(
    "UPDATE sparte SET dosb_sportart_nr = ?, geaendert_am = ?, geaendert_von = ? WHERE id = ?"
  ).bind(nr, new Date().toISOString(), me.username, id).run();

  await protokolliere(env, me.username, "sparte-sportart", "sparte", id, { name: da.name, nummer: nr });
  return json({ ok: true, id, nummer: nr }, 200, corsHeaders);
}

// Zweistelliges Geschlecht des Portals: M, W, D und O fuer "ohne
// Angabe". Ein leeres Feld waere nicht dasselbe -- das Portal fuehrt O
// als eigene Spalte, und wer es weglaesst, riskiert, dass die Zeile beim
// Einlesen liegen bleibt.
function lsbGeschlecht(wert) {
  const t = String(wert || "").trim().toLowerCase();
  if (t === "w" || t === "m" || t === "d") return t;
  return "o";
}

// TT.MM.JJJJ. Das Portal erwartet das deutsche Format; in der Datenbank
// steht ISO.
function lsbDatum(iso) {
  if (!istIsoDatum(String(iso || "").slice(0, 10))) return "";
  const t = String(iso).slice(0, 10).split("-");
  return t[2] + "." + t[1] + "." + t[0];
}

async function handleLsbExport(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfSchreiben) {
    return json({ error: "Diese Liste enthaelt Namen und Geburtsdaten aller Mitglieder und " +
                         "ist der Geschaeftsstelle vorbehalten" }, 403, corsHeaders);
  }

  const stichtag = istIsoDatum(body.stichtag) ? body.stichtag
                                              : (new Date().getFullYear() + "-01-01");
  const nrDa = await hatSportartSpalte(env);

  // LEFT JOIN, nicht JOIN: gemeldet werden ALLE Mitglieder, auch die
  // ohne Abteilung. Im Altbestand sind das fuenf -- mit einem inneren
  // Verbund fielen sie lautlos aus der Meldung, und die A-Meldung waere
  // um fuenf Personen zu klein.
  const roh = ((await env.VV_DB.prepare(
    "SELECT m.id AS mid, m.mitgliedsnummer, p.nachname, p.vorname, p.geschlecht, p.geburtsdatum, " +
    " s.name AS sparte, " + (nrDa ? "s.dosb_sportart_nr" : "NULL") + " AS nr " +
    "FROM mitgliedschaft m JOIN person p ON p.id = m.person_id " +
    "LEFT JOIN mitgliedschaft_sparte ms ON ms.mitgliedschaft_id = m.id " +
    " AND (ms.austritt IS NULL OR ms.austritt >= ?) " +
    "LEFT JOIN sparte s ON s.id = ms.sparte_id " +
    "WHERE " + bestandSql(stichtag) + " " +
    "ORDER BY p.nachname, p.vorname, s.name"
  ).bind(stichtag).all()).results) || [];

  const nachMitglied = new Map();
  for (const z of roh) {
    if (!nachMitglied.has(z.mid)) {
      nachMitglied.set(z.mid, {
        mitgliedsnummer: z.mitgliedsnummer,
        nachname: z.nachname || "", vorname: z.vorname || "",
        geschlecht: lsbGeschlecht(z.geschlecht),
        geburtsdatum: lsbDatum(z.geburtsdatum),
        nummern: [], sparten: []
      });
    }
    const e = nachMitglied.get(z.mid);
    if (!z.sparte) continue;
    e.sparten.push(z.sparte);
    // Dieselbe Nummer zweimal waere beim Verband eine zweite
    // Mitgliedschaft in derselben Sportart. Kann vorkommen, sobald zwei
    // Abteilungen auf dieselbe Sportart gemeldet werden.
    if (z.nr && !e.nummern.includes(z.nr)) e.nummern.push(z.nr);
  }

  const zeilen = Array.from(nachMitglied.values());

  // Was der Datei fehlt, wird NAMENTLICH gemeldet statt gezaehlt: "drei
  // ohne Geburtsdatum" ist nichts, womit die Geschaeftsstelle arbeiten
  // kann.
  const ohneAbteilung = zeilen.filter((z) => !z.sparten.length)
    .map((z) => ({ name: z.vorname + " " + z.nachname, nummer: z.mitgliedsnummer }));
  const ohneDatum = zeilen.filter((z) => !z.geburtsdatum)
    .map((z) => ({ name: z.vorname + " " + z.nachname, nummer: z.mitgliedsnummer }));
  const ohneGeschlecht = zeilen.filter((z) => z.geschlecht === "o").length;

  // Abteilungen, die jemanden tragen, aber keine Nummer haben. Genau die
  // Leute landen sonst beim Verband unter "ohne Landesfachverband" --
  // 2026 kostet das Anstatt-Beitrag, ab 2027 geht es gar nicht mehr.
  const nummerJeSparte = new Map();
  for (const r of roh) {
    if (r.sparte && !nummerJeSparte.has(r.sparte)) nummerJeSparte.set(r.sparte, r.nr || null);
  }
  const ohneNummer = new Map();
  for (const z of zeilen) {
    for (const name of z.sparten) {
      if (!nummerJeSparte.get(name)) ohneNummer.set(name, (ohneNummer.get(name) || 0) + 1);
    }
  }

  return json({
    ok: true, stichtag, zeilen,
    mitglieder: zeilen.length,
    // Die B-Meldung ist hoeher als die A-Meldung, sobald jemand zwei
    // Sportarten betreibt. Das ist so gewollt und keine Doppelzaehlung.
    meldungen: zeilen.reduce((s, z) => s + z.nummern.length, 0),
    ohne_abteilung: ohneAbteilung,
    ohne_geburtsdatum: ohneDatum,
    ohne_geschlecht: ohneGeschlecht,
    ohne_nummer: Array.from(ohneNummer, ([name, anzahl]) => ({ name, anzahl })),
    spalte_fehlt: !nrDa
  }, 200, corsHeaders);
}

// Einen Sammelposten auf zwei echte Abteilungen verteilen.
//
// Anlass: "Breitensport" ist keine Sportart des DOSB und steht in keiner
// Liste -- der Posten stammt aus dem Vereinsmeister, der die realen
// Abteilungen nur zusammengefasst kennt. Solange die 85 Leute dort
// stehen, sind sie beim Verband nicht meldbar.
//
// ⚠️ Die Zuordnung wird UMGEHAENGT, nicht beendet und neu angelegt. Ein
// beendeter Sammelposten-Eintrag traegt sein Austrittsdatum in der
// Zukunft des Stichtags und wuerde in derselben Meldung ein zweites Mal
// mitgezaehlt; ausserdem ginge der Eintrittstag verloren, an dem die
// Beitragsgeschichte haengt. Umhaengen erhaelt beides.
async function handleSparteAufteilen(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.darfSchreiben) {
    return json({ error: "Nur die Geschaeftsstelle oder der Schatzmeister kann Abteilungen pflegen" },
                403, corsHeaders);
  }

  const quelle = String(body.quelle_id || "");
  const zielAlt = String(body.ziel_ab_id || "");
  const zielJung = String(body.ziel_unter_id || "");
  if (!quelle || !zielAlt || !zielJung) {
    return json({ error: "Quelle und beide Ziele muessen angegeben sein" }, 400, corsHeaders);
  }
  if (zielAlt === quelle || zielJung === quelle) {
    return json({ error: "Eine Abteilung kann nicht in sich selbst aufgeteilt werden" }, 400, corsHeaders);
  }

  const grenze = Number(body.grenze);
  if (!Number.isInteger(grenze) || grenze < 1 || grenze > 120) {
    return json({ error: "Die Altersgrenze ist eine ganze Zahl zwischen 1 und 120" }, 400, corsHeaders);
  }
  const stichtag = istIsoDatum(body.stichtag) ? body.stichtag
                                              : (new Date().getFullYear() + "-01-01");

  const namen = ((await env.VV_DB.prepare(
    "SELECT id, name FROM sparte WHERE id IN (?,?,?)"
  ).bind(quelle, zielAlt, zielJung).all()).results) || [];
  if (namen.length < 2) return json({ error: "Abteilung nicht gefunden" }, 404, corsHeaders);
  const nameVon = (id) => (namen.find((n) => n.id === id) || {}).name || "?";

  // Wer schon in der Zielabteilung steht, wird NICHT umgehaengt -- sonst
  // stuenden zwei laufende Zuordnungen zur selben Abteilung da. Diese
  // Faelle werden namentlich gemeldet und bleiben, wie sie sind.
  const bedingung = (jaAlt) =>
    "ms.sparte_id = ? AND ms.austritt IS NULL " +
    "AND EXISTS (SELECT 1 FROM mitgliedschaft m JOIN person p ON p.id = m.person_id " +
    " WHERE m.id = ms.mitgliedschaft_id AND " + bestandSql(stichtag) +
    " AND " + alterSql(stichtag) + (jaAlt ? " >= " : " < ") + grenze + ") " +
    "AND NOT EXISTS (SELECT 1 FROM mitgliedschaft_sparte x " +
    " WHERE x.mitgliedschaft_id = ms.mitgliedschaft_id AND x.sparte_id = ? AND x.austritt IS NULL)";

  const zaehle = async (jaAlt, ziel) => {
    const r = await env.VV_DB.prepare(
      "SELECT COUNT(*) AS n FROM mitgliedschaft_sparte ms WHERE " + bedingung(jaAlt)
    ).bind(quelle, ziel).first();
    return (r && r.n) || 0;
  };

  const nAlt = await zaehle(true, zielAlt);
  const nJung = await zaehle(false, zielJung);

  // Alles, was in keiner der beiden Mengen liegt: schon in der
  // Zielabteilung, oder ohne Geburtsdatum (dann ist das Alter NULL und
  // faellt durch beide Vergleiche).
  const bleibt = ((await env.VV_DB.prepare(
    "SELECT p.vorname, p.nachname, m.mitgliedsnummer, " + alterSql(stichtag) + " AS alter_jahre " +
    "FROM mitgliedschaft_sparte ms JOIN mitgliedschaft m ON m.id = ms.mitgliedschaft_id " +
    "JOIN person p ON p.id = m.person_id " +
    "WHERE ms.sparte_id = ? AND ms.austritt IS NULL AND " + bestandSql(stichtag) + " " +
    " AND (" + alterSql(stichtag) + " IS NULL " +
    "  OR EXISTS (SELECT 1 FROM mitgliedschaft_sparte x WHERE x.mitgliedschaft_id = ms.mitgliedschaft_id " +
    "   AND x.sparte_id IN (?,?) AND x.austritt IS NULL)) " +
    "ORDER BY p.nachname, p.vorname"
  ).bind(quelle, zielAlt, zielJung).all()).results) || [];

  if (!body.ausfuehren) {
    return json({ ok: true, vorschau: true, stichtag, grenze,
                  quelle: nameVon(quelle),
                  ab: { name: nameVon(zielAlt), anzahl: nAlt },
                  unter: { name: nameVon(zielJung), anzahl: nJung },
                  bleibt }, 200, corsHeaders);
  }

  // Zwei mengenbasierte UPDATEs statt einer Schleife ueber 85 Zeilen --
  // dieselbe Regel wie beim Import und beim Beitragslauf.
  const jetzt = new Date().toISOString();
  const umhaengen = (jaAlt, ziel) => env.VV_DB.prepare(
    "UPDATE mitgliedschaft_sparte SET sparte_id = ?, geaendert_am = ?, geaendert_von = ? " +
    "WHERE id IN (SELECT ms.id FROM mitgliedschaft_sparte ms WHERE " + bedingung(jaAlt) + ")"
  ).bind(ziel, jetzt, me.username, quelle, ziel);

  await env.VV_DB.batch([umhaengen(true, zielAlt), umhaengen(false, zielJung)]);

  await protokolliere(env, me.username, "sparte-aufgeteilt", "sparte", quelle, {
    quelle: nameVon(quelle), grenze, stichtag,
    ab: { name: nameVon(zielAlt), anzahl: nAlt },
    unter: { name: nameVon(zielJung), anzahl: nJung },
    bleibt: bleibt.length
  });

  return json({ ok: true, vorschau: false, stichtag, grenze,
                quelle: nameVon(quelle),
                ab: { name: nameVon(zielAlt), anzahl: nAlt },
                unter: { name: nameVon(zielJung), anzahl: nJung },
                bleibt }, 200, corsHeaders);
}

function uuid() {
  return crypto.randomUUID();
}

// Sparten in einer EIGENEN Aktion, nicht im Seed. Zwoelf Sparten plus
// zehn Mitglieder waren zusammen ~75 Datenbankbefehle -- der kostenlose
// Tarif erlaubt 50 je Aufruf, der erste Seed-Aufruf riss die Grenze.
async function handleSpartenInit(env, me, corsHeaders) {
  if (!me.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const da = await env.VV_DB.prepare("SELECT COUNT(*) AS n FROM sparte").first();
  if (da && da.n > 0) {
    return json({ ok: true, angelegt: 0, vorhanden: da.n }, 200, corsHeaders);
  }

  const jetzt = new Date().toISOString();
  // Genau die Bezeichnungen, die in den Vereinsmeister-Listen vom
  // 29.07.2026 stehen -- nicht die Wunschstruktur. Der Import ordnet
  // ueber den Namen zu; jede Abweichung waere eine nicht zugeordnete
  // Sparte. Umbenennen und ergaenzen geht danach jederzeit.
  const namen = ["Fussball", "Breitensport", "Wandern", "Radsport-Mountainbike",
                 "Volleyball", "Turnen", "Darts", "Tischtennis", "Handball"];
  const anweisungen = namen.map((name, i) => env.VV_DB.prepare(
    "INSERT INTO sparte (id, name, sortierung, aktiv, zuschlag_cent, erstellt_am, erstellt_von) VALUES (?,?,?,1,?,?,?)"
  ).bind(uuid(), name, (i + 1) * 10, i === 0 ? 2400 : 1200, jetzt, me.username));

  await env.VV_DB.batch(anweisungen);
  return json({ ok: true, angelegt: namen.length }, 200, corsHeaders);
}

// Zaehlt, was tatsaechlich in der Datenbank steht. Sichtbar fuer die
// Geschaeftsstelle, nicht nur fuer globale Admins: "die Liste ist leer"
// muss ohne Entwicklerkonsole beantwortbar sein -- sonst ist nicht
// unterscheidbar, ob der Filter zu eng steht oder der Bestand fehlt.
async function handleStatus(env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfSchreiben) {
    return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  }
  const tabellen = ["person", "haushalt", "mitgliedschaft", "mitgliedschaft_sparte",
                    "sparte", "sepa_mandat", "forderung"];
  const zahlen = {};
  for (const t of tabellen) {
    const r = await env.VV_DB.prepare("SELECT COUNT(*) AS n FROM " + t).first();
    zahlen[t] = r ? r.n : null;
  }
  return json({ ok: true, bestand: zahlen }, 200, corsHeaders);
}

// ---------------------------------------------------------------------

// =====================================================================
// SICHERUNG NACH NEXTCLOUD
// =====================================================================
//
// WARUM UEBERHAUPT: D1 hat keine Datei, die man wegkopieren koennte, und
// die Flotten-Sicherung greift hier nicht -- die sichert Nextcloud-JSONs,
// und genau die gibt es fuer diese App nicht. In dieser einen Datenbank
// liegen Mitglieder, Mandate, Forderungen und die Buchhaltung.
//
// WARUM EIGENE ZUGANGSDATEN statt ueber das Service Binding: Der Cron hat
// keine Sitzung. Eine Aktion im landingpage-Worker, die ohne Sitzung
// schreibt, waere eine Hintertuer im heikelsten Worker der Flotte --
// dauerhaft offen, damit einmal pro Nacht etwas durchgeht. Eigene
// Zugangsdaten sind die kleinere Angriffsflaeche und lassen sich in
// Nextcloud einzeln widerrufen.
//
// EINRICHTUNG (Dashboard -> Worker -> Settings -> Variables and Secrets):
//
//   NEXTCLOUD_BACKUP_URL   Ordner-URL, OHNE Schraegstrich am Ende
//   NEXTCLOUD_USERNAME     Nextcloud-Konto
//   NEXTCLOUD_PASSWORD     App-Passwort (nicht das Anmeldepasswort).
//                          Eigenes App-Passwort anlegen, nicht das des
//                          admin-workers mitbenutzen -- sonst sperrt ein
//                          Widerruf beide Apps zugleich aus.
//
//   Cron: Settings -> Triggers -> Cron Triggers -> "20 2 * * *"
//   Cron laeuft in UTC. 02:20 UTC = 04:20 Sommerzeit / 03:20 Winterzeit.
//   deploy-worker.ps1 deployt den Trigger NICHT mit; er ueberlebt einen
//   Deploy aber, weil das Skript mit keep_bindings arbeitet.
//
// KEIN AUTOMATISCHES LOESCHEN. Die Wochentagsdateien ueberschreiben sich
// selbst (sieben Tage feinkoernig zurueck), der Monatserste legt eine
// Kopie an, die stehen bleibt. Wachstum dadurch etwa ein Dutzend Dateien
// im Jahr statt 365 -- ohne dass je ein DELETE noetig waere.
// =====================================================================

const SICHERUNG_SECRETS = ["NEXTCLOUD_BACKUP_URL", "NEXTCLOUD_USERNAME", "NEXTCLOUD_PASSWORD"];

// Notbremse, keine stille Kuerzung: reisst eine Tabelle die Grenze, steht
// das in der Datei, in der Statusdatei und in der Antwort. protokoll ist
// die einzige Tabelle, die unbegrenzt waechst.
const SICHERUNG_MAX_ZEILEN = 60000;
const SICHERUNG_BLOCK = 5000;

// Die Zeilengrenze allein traegt nicht: eine Antragszeile mit drei
// Unterschriften wiegt gemessen 452.595 Byte, 190 davon toeten das Isolate
// (128 MB) -- und zwar am try/catch vorbei, also ohne Datei und ohne
// Fehlerzeile. 60.000 Zeilen sind als Grenze damit wirkungslos.
//
// Deshalb ein Byte-Budget ueber den GANZEN Lauf, nicht je Tabelle: die
// Sicherung baut am Ende ein einziges JSON ueber alles. 25 MB Nutzlast
// liegen bei gemessenem Faktor 2,08 (Nutzlast -> Spitzenspeicher) bei
// ~52 MB und damit weit unter der Grenze; der echte Bestand braucht
// derzeit wenige MB, also Faktor 10 Luft.
const SICHERUNG_MAX_BYTES = 25 * 1024 * 1024;

// Der Block wird VOR der Pruefung vollstaendig in den Speicher geladen --
// eine Byte-Pruefung hinter dem Block kaeme also zu spaet. Der erste Block
// je Tabelle ist deshalb klein (Tastblock), danach richtet sich die
// Blockgroesse nach der gemessenen Zeilengroesse. Bei normalen Daten ist
// das genau eine zusaetzliche Abfrage, bei aufgeblaehten Zeilen bleibt
// jeder Block unter SICHERUNG_BLOCK_BYTES.
//
// Tastblock 10, weil D1 eine einzelne Zeile bis 2 MB zulaesst: der erste
// Griff einer noch unbekannten Tabelle kostet damit hoechstens ~20 MB.
// Die tatsaechliche Obergrenze des Laufs ist SICHERUNG_MAX_BYTES plus
// einen angefangenen Block, also ~29 MB -- die Pruefung greift zwangs-
// laeufig erst, wenn der Block gelesen ist.
const SICHERUNG_TASTBLOCK = 10;
const SICHERUNG_BLOCK_BYTES = 4 * 1024 * 1024;

const WOCHENTAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function fehlendeSicherungSecrets(env) {
  return SICHERUNG_SECRETS.filter((n) => !env[n] || !String(env[n]).trim());
}

// Der Worker laeuft in UTC, benannt wird nach deutschem Kalender.
// toISOString() waere hier die bekannte Falle -- es liefert in deutscher
// Sommerzeit vor 02:00 Uhr noch den Vortag, und ein Handstart um
// Mitternacht wuerde die Datei des falschen Wochentags ueberschreiben.
function berlinStempel(d) {
  const teile = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(d);
  const w = {};
  for (const t of teile) w[t.type] = t.value;
  const iso = w.year + "-" + w.month + "-" + w.day;
  return {
    iso,
    uhr: w.hour + ":" + w.minute,
    tagImMonat: Number(w.day),
    monat: w.year + "-" + w.month,
    // Wochentag selbst rechnen statt ueber das Locale: weekday "short"
    // liefert je nach ICU-Version "Do" oder "Do." -- ein Punkt im
    // Dateinamen wuerde die Rotation lautlos verdoppeln.
    wochentag: WOCHENTAGE[new Date(iso + "T12:00:00Z").getUTCDay()]
  };
}

async function davPut(url, auth, inhalt, typ) {
  const headers = { Authorization: auth, "Content-Type": typ };
  let resp = await fetch(url, { method: "PUT", headers, body: inhalt });
  // 409/404 heisst in WebDAV: ein Elternordner fehlt (409 bei einer
  // Ebene, 404 bei mehreren). Gleiche Bauart wie writeJson im
  // admin-worker: anlegen und genau einmal wiederholen.
  if (resp.status === 409 || resp.status === 404) {
    await davOrdner(url.slice(0, url.lastIndexOf("/")), auth, 0);
    resp = await fetch(url, { method: "PUT", headers, body: inhalt });
  }
  if (!resp.ok) {
    throw new Error("Nextcloud PUT " + resp.status + " (" + url.slice(url.lastIndexOf("/") + 1) + ")");
  }
}

async function davOrdner(collUrl, auth, tiefe) {
  if (tiefe > 15) throw new Error("Ordnerpfad zu tief zum Anlegen");
  let resp = await fetch(collUrl, { method: "MKCOL", headers: { Authorization: auth } });
  if (resp.status === 201 || resp.status === 405) return; // neu bzw. vorhanden
  if (resp.status === 409) {
    await davOrdner(collUrl.slice(0, collUrl.lastIndexOf("/")), auth, tiefe + 1);
    resp = await fetch(collUrl, { method: "MKCOL", headers: { Authorization: auth } });
    if (resp.status === 201 || resp.status === 405) return;
  }
  throw new Error("Ordner anlegen fehlgeschlagen (MKCOL " + resp.status + ")");
}

// Blockweise, nicht zeilenweise -- und mit ORDER BY rowid, weil LIMIT/
// OFFSET ohne feste Sortierung in SQLite nicht garantiert ueberschneidungs-
// frei ist. Ohne das koennte eine Sicherung Zeilen doppeln und andere
// auslassen, ohne dass es jemand merkt.
async function tabelleLesen(env, name, budgetBytes) {
  const daten = [];
  let bytes = 0;
  let grenze = SICHERUNG_TASTBLOCK;
  for (;;) {
    const block = await env.VV_DB
      .prepare('SELECT * FROM "' + name + '" ORDER BY rowid LIMIT ? OFFSET ?')
      .bind(grenze, daten.length)
      .all();
    const zeilen = block.results || [];
    let blockBytes = 0;
    for (const z of zeilen) {
      daten.push(z);
      for (const w of Object.values(z)) {
        if (typeof w === "string") blockBytes += w.length;
      }
    }
    bytes += blockBytes;

    if (bytes >= budgetBytes) return { daten, abgeschnitten: true, bytes };
    if (zeilen.length < grenze) return { daten, abgeschnitten: false, bytes };
    if (daten.length >= SICHERUNG_MAX_ZEILEN) return { daten, abgeschnitten: true, bytes };

    // Naechste Blockgroesse aus der gemessenen Zeilengroesse. Aufgeblaehte
    // Zeilen druecken sie bis auf 1 herunter, normale Daten heben sie sofort
    // auf SICHERUNG_BLOCK -- der Tastblock kostet dann eine Abfrage extra.
    const jeZeile = Math.max(1, Math.ceil(blockBytes / zeilen.length));
    grenze = Math.min(SICHERUNG_BLOCK, Math.max(1, Math.floor(SICHERUNG_BLOCK_BYTES / jeZeile)));
  }
}

function csvFeld(wert) {
  const s = wert === null || wert === undefined ? "" : String(wert);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Menschenlesbare Notfallliste. BEWUSST OHNE BANKDATEN: sie soll der
// Geschaeftsstelle helfen, wenn gar nichts mehr laeuft, und dafuer braucht
// niemand eine IBAN. Der vollstaendige Dump daneben hat sie -- aber der
// wird nicht beilaeufig geoeffnet.
async function mitgliederCsv(env) {
  const z = await env.VV_DB.prepare(
    "SELECT m.mitgliedsnummer, p.nachname, p.vorname, p.geburtsdatum, " +
    "  m.art, m.status, m.eintritt, m.austritt, " +
    "  p.strasse, p.plz, p.ort, p.email, p.telefon, p.mobil, " +
    "  (SELECT group_concat(s.name, ', ') FROM mitgliedschaft_sparte ms " +
    "     JOIN sparte s ON s.id = ms.sparte_id " +
    "    WHERE ms.mitgliedschaft_id = m.id AND ms.austritt IS NULL) AS sparten " +
    "FROM mitgliedschaft m JOIN person p ON p.id = m.person_id " +
    "ORDER BY p.nachname, p.vorname"
  ).all();

  const kopf = ["Mitgliedsnummer", "Nachname", "Vorname", "Geburtsdatum", "Art", "Status",
                "Eintritt", "Austritt", "Strasse", "PLZ", "Ort", "E-Mail", "Telefon",
                "Mobil", "Sparten"];
  const zeilen = [kopf.join(";")];
  for (const r of z.results || []) {
    zeilen.push([r.mitgliedsnummer, r.nachname, r.vorname, r.geburtsdatum, r.art, r.status,
                 r.eintritt, r.austritt, r.strasse, r.plz, r.ort, r.email, r.telefon,
                 r.mobil, r.sparten].map(csvFeld).join(";"));
  }
  // BOM, sonst zeigt Excel die Umlaute falsch an.
  return "﻿" + zeilen.join("\r\n") + "\r\n";
}

async function sicherungErstellen(env, ausloeser, wer) {
  const fehlend = fehlendeSicherungSecrets(env);
  if (fehlend.length) {
    return { ok: false, grund: "nicht eingerichtet", fehlendeSecrets: fehlend };
  }

  const start = Date.now();
  const jetzt = new Date();
  const stempel = berlinStempel(jetzt);
  const basis = String(env.NEXTCLOUD_BACKUP_URL).trim().replace(/\/+$/, "");
  const auth = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);

  // Das SCHEMA kommt mit in die Datei. Eine Sicherung, die zum
  // Zurueckspielen eine passende schema.sql braucht, haengt an der
  // Codeversion von damals -- und genau die fehlt im Notfall. Mit den
  // CREATE-Anweisungen traegt sich die Datei selbst.
  const bau = await env.VV_DB.prepare(
    "SELECT type, name, sql FROM sqlite_master " +
    " WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' " +
    "   AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' " +
    " ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 " +
    "                    WHEN 'index' THEN 2 ELSE 3 END, name"
  ).all();
  const objekte = bau.results || [];

  const tabellen = objekte.filter(
    (o) => o.type === "table" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(o.name)
  );

  const inhalt = {};
  const warnungen = [];
  let zeilenGesamt = 0;
  // Das Byte-Budget laeuft ueber alle Tabellen, nicht je Tabelle -- sonst
  // koennten zwanzig Tabellen einzeln unter der Grenze bleiben und die
  // Datei zusammen trotzdem das Isolate sprengen.
  let bytesGesamt = 0;
  for (const t of tabellen) {
    const gelesen = await tabelleLesen(env, t.name, SICHERUNG_MAX_BYTES - bytesGesamt);
    inhalt[t.name] = gelesen.daten;
    zeilenGesamt += gelesen.daten.length;
    bytesGesamt += gelesen.bytes;
    if (gelesen.abgeschnitten) {
      warnungen.push("Tabelle " + t.name + " bei " + gelesen.daten.length + " Zeilen abgeschnitten (" +
                     Math.round(gelesen.bytes / 1024) + " KB, Budget " +
                     Math.round(SICHERUNG_MAX_BYTES / 1024 / 1024) + " MB fuer den ganzen Lauf)");
    }
  }

  const dump = {
    app: "vereinsverwaltung",
    formatVersion: 1,
    erstellt: jetzt.toISOString(),
    erstelltBerlin: stempel.iso + " " + stempel.uhr,
    ausloeser,
    ausgeloestVon: wer || null,
    vollstaendig: warnungen.length === 0,
    warnungen,
    tabellenAnzahl: tabellen.length,
    zeilenGesamt,
    bytesGesamt,
    // Reihenfolge ist die Wiederherstellungsreihenfolge: erst Tabellen,
    // dann Sichten, dann Indizes.
    schema: objekte.map((o) => ({ type: o.type, name: o.name, sql: o.sql })),
    tabellen: inhalt
  };

  // Ohne Einrueckung: bei dieser Groesse verdoppelt Pretty-Print die
  // Datei und kostet CPU, die auf dem kostenlosen Tarif knapp ist.
  const text = JSON.stringify(dump);

  const dateien = [];
  const tagesName = "vereinsverwaltung-" + stempel.wochentag + ".json";
  await davPut(basis + "/taeglich/" + tagesName, auth, text, "application/json; charset=utf-8");
  dateien.push("taeglich/" + tagesName);

  if (stempel.tagImMonat === 1) {
    const monatsName = "vereinsverwaltung-" + stempel.monat + ".json";
    await davPut(basis + "/monatlich/" + monatsName, auth, text, "application/json; charset=utf-8");
    dateien.push("monatlich/" + monatsName);
  }

  const csv = await mitgliederCsv(env);
  const csvName = "mitglieder-" + stempel.wochentag + ".csv";
  await davPut(basis + "/taeglich/" + csvName, auth, csv, "text/csv; charset=utf-8");
  dateien.push("taeglich/" + csvName);

  const ergebnis = {
    ok: true,
    zeitpunkt: jetzt.toISOString(),
    zeitpunktBerlin: stempel.iso + " " + stempel.uhr,
    ausloeser,
    ausgeloestVon: wer || null,
    tabellen: tabellen.length,
    zeilen: zeilenGesamt,
    zeichen: text.length,
    dateien,
    vollstaendig: warnungen.length === 0,
    warnungen,
    dauerMs: Date.now() - start
  };

  // Kleine Statusdatei neben den grossen: sie laesst sich oeffnen, ohne
  // zwei Megabyte zu laden, und beantwortet die einzige Frage, die man an
  // eine Sicherung wirklich hat -- lief sie letzte Nacht durch?
  await davPut(basis + "/letzte-sicherung.json", auth,
               JSON.stringify(ergebnis, null, 2), "application/json; charset=utf-8");

  return ergebnis;
}

// Ein Fehlschlag darf nicht im Cloudflare-Log versanden -- dort sieht ihn
// niemand. Er landet als Protokollzeile in D1, und die App zeigt ihn an.
async function sicherungLaufen(env, ausloeser, wer) {
  try {
    const e = await sicherungErstellen(env, ausloeser, wer);
    await protokolliere(env, wer || "system", e.ok ? "sicherung" : "sicherung-fehler",
                        "sicherung", null, e);
    return e;
  } catch (fehler) {
    const text = fehler && fehler.message ? fehler.message : String(fehler);
    const e = { ok: false, zeitpunkt: new Date().toISOString(), ausloeser, fehler: text };
    await protokolliere(env, wer || "system", "sicherung-fehler", "sicherung", null, e);
    return e;
  }
}

async function handleSicherung(env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const letzte = await env.VV_DB.prepare(
    "SELECT zeit, aktion, detail_json FROM protokoll " +
    " WHERE aktion IN ('sicherung', 'sicherung-fehler') ORDER BY zeit DESC LIMIT 14"
  ).all();

  const laeufe = (letzte.results || []).map((z) => {
    let d = null;
    try { d = z.detail_json ? JSON.parse(z.detail_json) : null; } catch { d = null; }
    return {
      zeit: z.zeit,
      erfolg: z.aktion === "sicherung",
      zeitpunktBerlin: d && d.zeitpunktBerlin ? d.zeitpunktBerlin : null,
      ausloeser: d ? d.ausloeser : null,
      zeilen: d ? d.zeilen : null,
      zeichen: d ? d.zeichen : null,
      dauerMs: d ? d.dauerMs : null,
      vollstaendig: d ? d.vollstaendig !== false : null,
      warnungen: d && d.warnungen ? d.warnungen : [],
      fehler: d ? (d.fehler || d.grund || null) : null
    };
  });

  return json({
    eingerichtet: fehlendeSicherungSecrets(env).length === 0,
    fehlendeSecrets: fehlendeSicherungSecrets(env),
    laeufe
  }, 200, corsHeaders);
}

async function handleSicherungJetzt(env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  const e = await sicherungLaufen(env, "hand", me.username);
  if (e.ok) return json(e, 200, corsHeaders);
  // Der Grund muss als "error" mit: vvRequest im Client liest genau
  // dieses Feld. Ohne das steht beim Nutzer "Fehler 500" und die
  // eigentliche Ursache bliebe im Worker liegen.
  return json({ ...e, error: e.fehler || e.grund || "Sicherung fehlgeschlagen" }, 500, corsHeaders);
}

export default {
  // Naechtliche Sicherung. Bewusster Bruch mit der Flottenentscheidung
  // gegen Cron-Trigger: eine Sicherung, die nur laeuft, wenn jemand die
  // App oeffnet, ist keine.
  async scheduled(event, env, ctx) {
    if (!env.VV_DB) return;
    ctx.waitUntil(sicherungLaufen(env, "cron", null));
  },

  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[1];

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    }

    if (!env.VV_DB) {
      return json({ error: "D1-Binding 'VV_DB' fehlt (siehe Datei-Kopf)" }, 500, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Ungueltiges JSON" }, 400, corsHeaders);
    }

    // Der Aufnahmeantrag ist der einzige Weg von aussen. Er steht VOR der
    // Session-Pruefung, weil es dafuer keine Anmeldung gibt und geben
    // soll: wer Mitglied werden will, hat noch kein Konto.
    //
    // Er steht auch vor der LANDINGPAGE-Pruefung, weil er das Gateway
    // nicht braucht. Ein fehlendes Service Binding darf die
    // Mitgliederverwaltung lahmlegen -- aber nicht das oeffentliche
    // Formular, das mit Anmeldung ohnehin nichts zu tun hat.
    //
    // Jede Aktion prueft selbst, ob ihr Formular offen ist. Kein
    // gemeinsamer Vorab-Aufruf, der sich umgehen liesse.
    //
    // vv-nachwuchs-senden ist ein EIGENER Endpunkt und nicht ein Feld
    // "quelle" im Koerper von vv-antrag-senden: so haengt die Herkunft am
    // aufgerufenen Weg statt an einer Behauptung des Clients, und sie
    // laesst sich nicht umschreiben. Derselbe Grund, aus dem die
    // Weissliste status und person_id ignoriert.
    if (body.action === "vv-antrag-info" || body.action === "vv-antrag-senden" ||
        body.action === "vv-nachwuchs-senden") {
      try {
        if (body.action === "vv-antrag-info") return await handleAntragInfo(env, corsHeaders);
        return await handleAntragSenden(body, env, request, corsHeaders,
          body.action === "vv-nachwuchs-senden" ? "nachwuchs" : "antrag");
      } catch (e) {
        return json({ error: "Serverfehler: " + (e && e.message ? e.message : String(e)) },
                    500, corsHeaders);
      }
    }

    // Fail-closed. Ohne Binding lieber gar nichts als ungeprueft.
    if (!env.LANDINGPAGE) {
      return json({ error: "Service Binding 'LANDINGPAGE' fehlt (siehe Datei-Kopf)" }, 500, corsHeaders);
    }

    // Session vor der Aktionsweiche -- wie submit-worker.js. Folge fuer
    // die Deploy-Probe: eine unauthentifizierte Anfrage liefert IMMER
    // 401, nie 400. Der Gesundheitscheck in deploy-worker.ps1 muss 401
    // erwarten, nicht 400.
    const me = await verifySession(env, request.headers.get("Authorization") || "");
    if (!me) {
      return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
    }

    try {
      switch (body.action) {
        case "vv-me":              return handleMe(env, me, corsHeaders);
        case "vv-mitglieder":      return handleMitgliederListe(body, env, me, corsHeaders);
        case "vv-sparten":         return handleSpartenListe(env, me, corsHeaders);
        case "vv-mitglied":        return handleMitgliedDetail(body, env, me, corsHeaders);
        case "vv-mitglied-speichern": return handleMitgliedSpeichern(body, env, me, corsHeaders);
        case "vv-mitglied-anlegen": return handleMitgliedAnlegen(body, env, me, corsHeaders);
        case "vv-sparte-zuordnen": return handleSparteZuordnen(body, env, me, corsHeaders);
        case "vv-import":          return handleImport(body, env, me, corsHeaders);
        case "vv-austritt":        return handleAustritt(body, env, me, corsHeaders);
        case "vv-austritt-vorschau": return handleAustrittVorschau(body, env, me, corsHeaders);
        case "vv-status":          return handleStatus(env, me, corsHeaders);
        case "vv-rollen":          return handleRollenListe(env, me, request.headers.get("Authorization"), corsHeaders);
        case "vv-rolle-setzen":    return handleRolleSetzen(body, env, me, corsHeaders);
        case "vv-rolle-loeschen":  return handleRolleLoeschen(body, env, me, corsHeaders);
        case "vv-migration":       return handleMigration(env, me, corsHeaders);
        case "vv-beitrag-init":    return handleBeitragInit(body, env, me, corsHeaders);
        case "vv-beitrag-zuordnen": return handleBeitragZuordnen(body, env, me, corsHeaders);
        case "vv-beitrag-uebersicht": return handleBeitragUebersicht(body, env, me, corsHeaders);
        case "vv-beitragssatz-setzen": return handleBeitragssatzSetzen(body, env, me, corsHeaders);
        case "vv-einstellungen":   return handleEinstellungen(env, me, corsHeaders);
        case "vv-einstellung-setzen": return handleEinstellungSetzen(body, env, me, corsHeaders);
        case "vv-lauf-liste":      return handleLaufListe(env, me, corsHeaders);
        case "vv-lauf-anlegen":    return handleLaufAnlegen(body, env, me, corsHeaders);
        case "vv-lauf-vorschau":   return handleLaufVorschau(body, env, me, corsHeaders);
        case "vv-lauf-ausfuehren": return handleLaufAusfuehren(body, env, me, corsHeaders);
        case "vv-lauf-detail":     return handleLaufDetail(body, env, me, corsHeaders);
        case "vv-lauf-festschreiben": return handleLaufFestschreiben(body, env, me, corsHeaders);
        case "vv-lauf-verwerfen":  return handleLaufVerwerfen(body, env, me, corsHeaders);
        case "vv-sepa-erzeugen":   return handleSepaErzeugen(body, env, me, corsHeaders);
        case "vv-mandate-uebernommen": return handleMandateUebernommen(body, env, me, corsHeaders);
        case "vv-vorabankuendigung": return handleVorabankuendigung(body, env, me, corsHeaders);
        case "vv-zahlung-sammel":  return handleZahlungSammel(body, env, me, corsHeaders);
        case "vv-sammel-zurueck":  return handleSammelZurueck(body, env, me, corsHeaders);
        case "vv-zahlung-erfassen": return handleZahlungErfassen(body, env, me, corsHeaders);
        case "vv-ruecklastschrift": return handleRuecklastschrift(body, env, me, corsHeaders);
        case "vv-forderung-stornieren": return handleForderungStornieren(body, env, me, corsHeaders);
        case "vv-offene-posten":   return handleOffenePosten(body, env, me, corsHeaders);
        case "vv-zahlungen":       return handleZahlungenListe(body, env, me, corsHeaders);
        case "vv-antraege":        return handleAntraegeListe(body, env, me, corsHeaders);
        case "vv-antrag":          return handleAntragDetail(body, env, me, corsHeaders);
        case "vv-antrag-status":   return handleAntragStatus(body, env, me, corsHeaders);
        case "vv-antrag-annehmen": return handleAntragAnnehmen(body, env, me, corsHeaders);
        case "vv-sparte-aktiv":    return handleSparteAktiv(body, env, me, corsHeaders);
        case "vv-sparte-loeschen": return handleSparteLoeschen(body, env, me, corsHeaders);
        case "vv-sparte-sportart": return handleSparteSportart(body, env, me, corsHeaders);
        case "vv-sparte-aufteilen": return handleSparteAufteilen(body, env, me, corsHeaders);
        case "vv-buch-init":       return handleBuchInit(env, me, corsHeaders);
        case "vv-buch-stammdaten": return handleBuchStammdaten(env, me, corsHeaders);
        case "vv-jahr-anlegen":    return handleJahrAnlegen(body, env, me, corsHeaders);
        case "vv-konto-speichern": return handleKontoSpeichern(body, env, me, corsHeaders);
        case "vv-buchen":          return handleBuchen(body, env, me, corsHeaders);
        case "vv-journal":         return handleJournal(body, env, me, corsHeaders);
        case "vv-buchung-stornieren": return handleBuchungStornieren(body, env, me, corsHeaders);
        case "vv-saldenliste":     return handleSaldenliste(body, env, me, corsHeaders);
        case "vv-uebernahme":      return handleUebernahmeVorschau(env, me, corsHeaders);
        case "vv-uebernahme-buchen": return handleUebernahmeBuchen(body, env, me, corsHeaders);
        case "vv-jahresabschluss": return handleJahresabschluss(body, env, me, corsHeaders);
        case "vv-eroeffnung":      return handleEroeffnung(body, env, me, corsHeaders);
        case "vv-kennzahlen":      return handleKennzahlen(body, env, me, corsHeaders);
        case "vv-bestandsmeldung": return handleBestandsmeldung(body, env, me, corsHeaders);
        // Die Datei zum Hochladen -- mit Klarnamen, deshalb an
        // darfSchreiben und nicht an darfKennzahlenSehen wie die
        // Auswertung darueber.
        case "vv-lsb-export":      return handleLsbExport(body, env, me, corsHeaders);
        case "vv-sicherung":       return handleSicherung(env, me, corsHeaders);
        case "vv-sicherung-jetzt": return handleSicherungJetzt(env, me, corsHeaders);
        case "vv-sparten-init":    return handleSpartenInit(env, me, corsHeaders);
        default:
          return json({ error: "Unbekannte Aktion" }, 400, corsHeaders);
      }
    } catch (e) {
      return json({ error: "Serverfehler: " + (e && e.message ? e.message : String(e)) }, 500, corsHeaders);
    }
  }
};
