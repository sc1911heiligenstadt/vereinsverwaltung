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
// Nutzer wuerde die alte Rolle erben. Die Aktion vv-rollen-abgleich
// listet Rollen ohne Gateway-Konto.
// =====================================================================

const ALLOWED_ORIGINS = [
  "http://localhost:8810",
  "https://tecko1985.github.io"
];

// Muss dem Tool-Id im TOOLS-Array von ToolsUebersicht entsprechen --
// daran haengt die Aufloesung von canEdit/canAdmin im Gateway.
const TOOL_ID = "vereinsverwaltung";

const ROLLEN = new Set([
  "geschaeftsstelle",
  "schatzmeister",
  "abteilungsleiter",
  "vorstand"
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
      || rollen.some((z) => z.rolle === "geschaeftsstelle" || z.rolle === "schatzmeister")
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
    darfSchreiben: rolle.darfSchreiben
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

  const sortSchluessel = SORTIERUNGEN[body.sortierung] ? body.sortierung : "name";
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

  const sql = "SELECT id, name, kurz, zuschlag_cent, aktiv FROM sparte"
    + (nurEigene ? " WHERE id IN (" + rolle.sparten.map(() => "?").join(",") + ")" : "")
    + " ORDER BY sortierung, name";
  const st = nurEigene && rolle.sparten.length
    ? env.VV_DB.prepare(sql).bind(...rolle.sparten)
    : env.VV_DB.prepare(nurEigene ? "SELECT id, name, kurz, zuschlag_cent, aktiv FROM sparte WHERE 1=0" : sql);

  const r = await st.all();
  return json({ sparten: r.results || [] }, 200, corsHeaders);
}

// ---------------------------------------------------------------------
// STUFE 1 -- Mitglieder bearbeiten
// ---------------------------------------------------------------------

// Felder, die geaendert werden duerfen -- als Weissliste, nicht als
// Sperrliste. Was hier nicht steht, kommt auch dann nicht in die
// Datenbank, wenn es im Body mitgeschickt wird.
const PERSON_FELDER = ["vorname", "nachname", "geburtsdatum", "geschlecht",
                       "strasse", "plz", "ort", "email", "telefon", "mobil", "bemerkung"];

// Diese Felder darf ein Abteilungsleiter NICHT anfassen. Kontaktdaten
// seiner Spartenmitglieder zu pflegen ist sein Auftrag; ob jemand
// Ehrenmitglied wird oder wann er eingetreten ist, entscheidet der
// Verein und nicht die Abteilung.
const MITGLIEDSCHAFT_FELDER = ["art", "eintritt", "status", "ermaessigt",
                               "ermaessigt_grund", "nachweis_geprueft_am",
                               "nachweis_gueltig_bis"];

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
    "       p.id AS person_id, p.vorname, p.nachname, p.geburtsdatum, p.geschlecht, " +
    "       p.strasse, p.plz, p.ort, p.email, p.telefon, p.mobil, p.bemerkung, " +
    "       p.haushalt_id " +
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

  return json({
    mitglied: zeile,
    sparten: sp.results || [],
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
        mWerte.push(body[f] === "" ? null : body[f]);
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
    "INSERT INTO person (id, haushalt_id, vorname, nachname, geburtsdatum, geschlecht, " +
    "strasse, plz, ort, email, telefon, mobil, bemerkung, zusatz_json, erstellt_am, erstellt_von) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(personId, haushaltId, satz.vorname, satz.nachname, satz.geburtsdatum, satz.geschlecht,
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
// Belastungstest (Stufe 0) -- misst, ob der kostenlose Cloudflare-Tarif
// den Beitragslauf traegt. Kann nach der Tarifentscheidung raus.
//
// Free:  50 D1-Abfragen und 10 ms CPU je Aufruf
// Paid:  1000 D1-Abfragen und 30 s CPU je Aufruf
//
// Ohne Messung waere die Entscheidung geraten. Deshalb arbeiten beide
// Aktionen mit ECHTEN Abfragen gegen das echte Schema, nicht mit einer
// Schaetzung.
// ---------------------------------------------------------------------

const VORNAMEN = ["Lukas","Marie","Jonas","Emma","Felix","Lena","Paul","Mia","Tim","Sophie",
                  "Jan","Hannah","Nico","Lea","Ben","Emily","Max","Anna","Leon","Clara"];
const NACHNAMEN = ["Mueller","Schmidt","Schneider","Fischer","Weber","Meyer","Wagner","Becker",
                   "Hoffmann","Koch","Bauer","Richter","Klein","Wolf","Schroeder","Neumann"];

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

async function handleSeed(body, env, me, corsHeaders) {
  if (!me.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const anzahl = Math.min(Math.max(parseInt(body.anzahl, 10) || 5, 1), 100);
  const jetzt = new Date().toISOString();

  const s = await env.VV_DB.prepare("SELECT id FROM sparte").all();
  const spartenIds = (s.results || []).map((z) => z.id);
  if (!spartenIds.length) {
    return json({ error: "Keine Sparten vorhanden - zuerst vv-sparten-init aufrufen" }, 400, corsHeaders);
  }

  const anweisungen = [];
  for (let i = 0; i < anzahl; i++) {
    const haushaltId = uuid();
    const personId = uuid();
    const mgsId = uuid();
    const lfd = Math.floor(Math.random() * 1e9);
    const vorname = VORNAMEN[i % VORNAMEN.length];
    const nachname = NACHNAMEN[(i * 7) % NACHNAMEN.length];
    const jahr = 1950 + (i % 70);

    // Reihenfolge ist zwingend: person.haushalt_id und haushalt.zahler_person_id
    // zeigen aufeinander. Der Haushalt entsteht deshalb OHNE Zahler, die Person
    // danach, und der Zahler wird per UPDATE nachgetragen. Andersherum schlaegt
    // die Fremdschluesselpruefung zu (D1 hat sie standardmaessig an) -- genau
    // daran ist der erste Seed-Versuch gescheitert.
    anweisungen.push(env.VV_DB.prepare(
      "INSERT INTO haushalt (id, zahlungsweise, zahlungsart, erstellt_am, erstellt_von) VALUES (?,?,?,?,?)"
    ).bind(haushaltId, "jaehrlich", "lastschrift", jetzt, me.username));

    anweisungen.push(env.VV_DB.prepare(
      "INSERT INTO person (id, haushalt_id, vorname, nachname, geburtsdatum, strasse, plz, ort, email, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(personId, haushaltId, vorname, nachname + "-" + lfd,
           jahr + "-06-15", "Teststrasse " + (i % 200), "37308", "Heilbad Heiligenstadt",
           "test" + lfd + "@example.invalid", jetzt, me.username));

    anweisungen.push(env.VV_DB.prepare(
      "UPDATE haushalt SET zahler_person_id = ? WHERE id = ?"
    ).bind(personId, haushaltId));

    anweisungen.push(env.VV_DB.prepare(
      "INSERT INTO mitgliedschaft (id, person_id, mitgliedsnummer, art, eintritt, status, ermaessigt, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,0,?,?)"
    ).bind(mgsId, personId, "T" + lfd, "ordentlich",
           "2020-01-01", "aktiv", jetzt, me.username));

    // Ein bis drei Sparten je Mitglied -- der Fall, den der Vereinsmeister
    // nicht kann und der den Beitrag treibt.
    const anzSparten = (i % 3) + 1;
    for (let k = 0; k < anzSparten; k++) {
      anweisungen.push(env.VV_DB.prepare(
        "INSERT INTO mitgliedschaft_sparte (id, mitgliedschaft_id, sparte_id, eintritt, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?)"
      ).bind(uuid(), mgsId, spartenIds[(i + k) % spartenIds.length],
             "2020-01-01", jetzt, me.username));
    }

    anweisungen.push(env.VV_DB.prepare(
      "INSERT INTO sepa_mandat (id, haushalt_id, referenz, kontoinhaber, iban, erteilt_am, quelle, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind(uuid(), haushaltId, "TEST-" + lfd,
           vorname + " " + nachname, "DE02120300000000202051",
           "2020-01-01", "import", jetzt, me.username));
  }

  const start = Date.now();
  await env.VV_DB.batch(anweisungen);
  return json({
    ok: true,
    angelegt: anzahl,
    anweisungen: anweisungen.length,
    dauerMs: Date.now() - start
  }, 200, corsHeaders);
}

// Simuliert einen Beitragslauf auf ECHTEN Abfragen und meldet, wie weit
// er in einem einzigen Aufruf kommt. Der Client ruft mit steigendem
// limit auf, bis der Worker abbricht -- die letzte erfolgreiche Zahl ist
// die Antwort auf die Tarifentscheidung.
async function handleMesslauf(body, env, me, corsHeaders) {
  if (!me.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const limit = Math.min(Math.max(parseInt(body.limit, 10) || 10, 1), 2500);
  const start = Date.now();
  let abfragen = 0;

  const mgs = await env.VV_DB.prepare(
    "SELECT id FROM mitgliedschaft WHERE status = 'aktiv' ORDER BY id LIMIT ?"
  ).bind(limit).all();
  abfragen++;
  const liste = mgs.results || [];

  const forderungen = [];
  for (const m of liste) {
    // Genau die Abfragen, die der echte Lauf je Mitglied braucht.
    const sparten = await env.VV_DB.prepare(
      "SELECT s.zuschlag_cent, ms.zuschlag_cent AS abweichend FROM mitgliedschaft_sparte ms JOIN sparte s ON s.id = ms.sparte_id WHERE ms.mitgliedschaft_id = ? AND ms.austritt IS NULL"
    ).bind(m.id).all();
    abfragen++;

    const haushalt = await env.VV_DB.prepare(
      "SELECT h.id, h.zahlungsweise FROM haushalt h JOIN person p ON p.haushalt_id = h.id JOIN mitgliedschaft mg ON mg.person_id = p.id WHERE mg.id = ?"
    ).bind(m.id).first();
    abfragen++;

    let betrag = 9600; // Grundbeitrag 8 EUR/Monat als Platzhalter
    for (const s of sparten.results || []) {
      betrag += (s.abweichend !== null && s.abweichend !== undefined)
        ? s.abweichend
        : s.zuschlag_cent;
    }
    forderungen.push({ mgsId: m.id, haushaltId: haushalt ? haushalt.id : null, betrag });
  }

  return json({
    ok: true,
    verarbeitet: liste.length,
    abfragen,
    abfragenJeMitglied: liste.length ? +(abfragen / liste.length).toFixed(2) : 0,
    summeCent: forderungen.reduce((s, f) => s + f.betrag, 0),
    dauerMs: Date.now() - start,
    hinweis: "Free-Tarif: 50 Abfragen und 10 ms CPU je Aufruf. Paid: 1000 Abfragen und 30 s."
  }, 200, corsHeaders);
}

// Dasselbe fachliche Ergebnis wie handleMesslauf, aber mengenbasiert:
// EINE Abfrage fuer beliebig viele Mitglieder statt zwei je Mitglied.
// Der Vergleich der beiden Aktionen beantwortet die Tariffrage ehrlich --
// sonst bezahlt man einen hoeheren Tarif fuer einen Konstruktionsfehler.
async function handleMesslaufSchnell(body, env, me, corsHeaders) {
  if (!me.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const limit = Math.min(Math.max(parseInt(body.limit, 10) || 100, 1), 5000);
  const start = Date.now();

  // Grundbeitrag und Spartenzuschlaege in einem Zug. COALESCE bildet die
  // Regel ab: ein am Einzelfall hinterlegter Zuschlag schlaegt den der
  // Sparte. LEFT JOIN, damit ein Mitglied ohne Sparte nicht herausfaellt.
  const zeilen = await env.VV_DB.prepare(
    "SELECT m.id AS mgs_id, h.id AS haushalt_id, " +
    "       COALESCE(SUM(COALESCE(ms.zuschlag_cent, s.zuschlag_cent)), 0) AS zuschlaege " +
    "FROM mitgliedschaft m " +
    "JOIN person p ON p.id = m.person_id " +
    "JOIN haushalt h ON h.id = p.haushalt_id " +
    "LEFT JOIN mitgliedschaft_sparte ms ON ms.mitgliedschaft_id = m.id AND ms.austritt IS NULL " +
    "LEFT JOIN sparte s ON s.id = ms.sparte_id " +
    "WHERE m.status = 'aktiv' " +
    "GROUP BY m.id, h.id ORDER BY m.id LIMIT ?"
  ).bind(limit).all();

  const liste = zeilen.results || [];
  const GRUNDBEITRAG_CENT = 9600;
  let summe = 0;
  for (const z of liste) summe += GRUNDBEITRAG_CENT + (z.zuschlaege || 0);

  return json({
    ok: true,
    verarbeitet: liste.length,
    abfragen: 1,
    summeCent: summe,
    dauerMs: Date.now() - start
  }, 200, corsHeaders);
}

// Raeumt AUSSCHLIESSLICH Testdaten weg. Erkennungsmerkmal ist die
// E-Mail-Domain example.invalid -- die ist per RFC 2606 fuer genau
// diesen Zweck reserviert und kann in echten Mitgliederdaten nicht
// vorkommen. Kein Loeschen ueber Datum, Zeitraum oder "alles".
async function handleTestdatenLoeschen(env, me, corsHeaders) {
  if (!me.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const treffer = await env.VV_DB.prepare(
    "SELECT id, haushalt_id FROM person WHERE email LIKE '%@example.invalid'"
  ).all();
  const personen = treffer.results || [];
  if (!personen.length) {
    return json({ ok: true, geloescht: 0, hinweis: "Keine Testdaten gefunden" }, 200, corsHeaders);
  }

  const haushaltIds = [...new Set(personen.map((p) => p.haushalt_id).filter(Boolean))];

  // Die Loeschungen laufen ohne gebundene Parameter ueber Unterabfragen --
  // D1 begrenzt die Parameter je Abfrage, mit 2500 IDs in einem IN(...)
  // liefe man dagegen. Die Reihenfolge ist zwingend, sonst greift die
  // Fremdschluesselpruefung: erst den Zirkel haushalt <-> person aufloesen,
  // dann von den Blaettern nach innen.
  const T = "SELECT id FROM person WHERE email LIKE '%@example.invalid'";
  const M = "SELECT id FROM mitgliedschaft WHERE person_id IN (" + T + ")";
  await env.VV_DB.batch([
    env.VV_DB.prepare("UPDATE haushalt SET zahler_person_id = NULL WHERE zahler_person_id IN (" + T + ")"),
    env.VV_DB.prepare("DELETE FROM mitgliedschaft_sparte WHERE mitgliedschaft_id IN (" + M + ")"),
    env.VV_DB.prepare("DELETE FROM forderung WHERE mitgliedschaft_id IN (" + M + ")"),
    env.VV_DB.prepare("DELETE FROM mitgliedschaft WHERE person_id IN (" + T + ")"),
    env.VV_DB.prepare("DELETE FROM sepa_mandat WHERE haushalt_id IN (SELECT haushalt_id FROM person WHERE email LIKE '%@example.invalid')"),
    env.VV_DB.prepare("DELETE FROM person WHERE email LIKE '%@example.invalid'")
  ]);

  // Haushalte zuletzt und in Bloecken: sie sind ueber die geloeschten
  // Personen nicht mehr auffindbar, deshalb die vorher gemerkten IDs.
  // Bloecke zu 50, damit die Parametergrenze sicher eingehalten wird.
  for (let i = 0; i < haushaltIds.length; i += 50) {
    const block = haushaltIds.slice(i, i + 50);
    await env.VV_DB.prepare(
      "DELETE FROM haushalt WHERE id IN (" + block.map(() => "?").join(",") + ")"
    ).bind(...block).run();
  }

  return json({
    ok: true,
    geloescht: personen.length,
    haushalte: haushaltIds.length,
    hinweis: "Sparten bleiben stehen - die sind echte Stammdaten"
  }, 200, corsHeaders);
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

export default {
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

    // Fail-closed. Ohne Binding lieber gar nichts als ungeprueft.
    if (!env.LANDINGPAGE) {
      return json({ error: "Service Binding 'LANDINGPAGE' fehlt (siehe Datei-Kopf)" }, 500, corsHeaders);
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
        case "vv-testdaten-loeschen": return handleTestdatenLoeschen(env, me, corsHeaders);
        case "vv-rollen":          return handleRollenListe(env, me, request.headers.get("Authorization"), corsHeaders);
        case "vv-rolle-setzen":    return handleRolleSetzen(body, env, me, corsHeaders);
        case "vv-rolle-loeschen":  return handleRolleLoeschen(body, env, me, corsHeaders);
        case "vv-sparten-init":    return handleSpartenInit(env, me, corsHeaders);
        case "vv-seed":            return handleSeed(body, env, me, corsHeaders);
        case "vv-messlauf":        return handleMesslauf(body, env, me, corsHeaders);
        case "vv-messlauf-schnell": return handleMesslaufSchnell(body, env, me, corsHeaders);
        default:
          return json({ error: "Unbekannte Aktion" }, 400, corsHeaders);
      }
    } catch (e) {
      return json({ error: "Serverfehler: " + (e && e.message ? e.message : String(e)) }, 500, corsHeaders);
    }
  }
};
