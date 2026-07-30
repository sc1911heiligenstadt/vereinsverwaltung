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
    "       p.id AS person_id, p.vorname, p.nachname, p.geburtsdatum, p.geschlecht, " +
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
  if (!rolle.istAdmin && !rolle.darfBuchen && !rolle.darfSchreiben) {
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

  for (const sql of fehlend) await env.VV_DB.prepare(sql).run();

  // Vereinsstammdaten fuer die SEPA-Datei. Eigene Tabelle statt Konstanten
  // im Code: Glaeubiger-ID und Vereins-IBAN gehoeren nicht in ein
  // oeffentliches Repository.
  await env.VV_DB.prepare(
    "CREATE TABLE IF NOT EXISTS einstellung (schluessel TEXT PRIMARY KEY, wert TEXT, " +
    "geaendert_am TEXT, geaendert_von TEXT)"
  ).run();

  return json({ ok: true, ergaenzt: fehlend.length, spalten: Array.from(da) }, 200, corsHeaders);
}

// ---------------------------------------------------------------------
// Vereinsstammdaten
// ---------------------------------------------------------------------

const EINSTELLUNGEN = {
  verein_name:      { gruppe: "sepa", label: "Name des Vereins (Glaeubiger)", max: 70, pflicht: true },
  verein_iban:      { gruppe: "sepa", label: "IBAN des Vereinskontos", max: 34, pflicht: true, iban: true },
  verein_bic:       { gruppe: "sepa", label: "BIC des Vereinskontos", max: 11 },
  glaeubiger_id:    { gruppe: "sepa", label: "Glaeubiger-Identifikationsnummer", max: 35, pflicht: true },
  verwendungszweck: { gruppe: "sepa", label: "Verwendungszweck", max: 140 },

  // Mahnwesen. Fristen und Gebuehren gehoeren nicht in den Code: eine
  // geaenderte Zahlungsfrist darf kein Deploy sein.
  mahn_karenz_tage: { gruppe: "mahnung", label: "Karenz nach Faelligkeit (Tage)",
                      zahl: true, vorgabe: 14, min: 0, max_wert: 180 },
  mahn_frist_tage:  { gruppe: "mahnung", label: "Zahlungsfrist je Mahnung (Tage)",
                      zahl: true, vorgabe: 14, min: 7, max_wert: 90 },
  mahn_mindest_cent: { gruppe: "mahnung", label: "Erst ab diesem Betrag mahnen (Cent)",
                      zahl: true, vorgabe: 500, min: 0, max_wert: 100000 },
  mahn_gebuehr1_cent: { gruppe: "mahnung", label: "Gebuehr 1. Mahnung (Cent)",
                      zahl: true, vorgabe: 0, min: 0, max_wert: 10000 },
  mahn_gebuehr2_cent: { gruppe: "mahnung", label: "Gebuehr 2. Mahnung (Cent)",
                      zahl: true, vorgabe: 0, min: 0, max_wert: 10000 },
  // Satzung § 5 Abs. 3: Anhoerung mit einer Frist von 10 Tagen. Weniger
  // ist deshalb nicht einstellbar -- eine Satzung ist keine Vorgabe, die
  // man in einem Formular unterbieten darf.
  anhoerung_tage:   { gruppe: "mahnung", label: "Frist der Anhoerung vor Ausschluss (Tage, § 5 Abs. 3)",
                      zahl: true, vorgabe: 10, min: 10, max_wert: 90 }
};

// Wert einer Einstellung als Zahl, mit der hinterlegten Vorgabe.
function einstellungZahl(cfg, schluessel) {
  const regel = EINSTELLUNGEN[schluessel];
  const roh = cfg ? cfg[schluessel] : null;
  const n = parseInt(roh, 10);
  return Number.isFinite(n) ? n : regel.vorgabe;
}

// Tage auf ein ISO-Datum rechnen. Ueber Date.UTC, damit die Sommerzeit
// eine Frist nicht um einen Tag verschiebt -- bei einer Mahnfrist ist
// das kein Schoenheitsfehler.
function tageAddieren(iso, tage) {
  const t = String(iso).slice(0, 10).split("-").map(Number);
  const d = new Date(Date.UTC(t[0], t[1] - 1, t[2] + tage));
  return d.getUTCFullYear() + "-" +
    String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(d.getUTCDate()).padStart(2, "0");
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
  if (!rolle.istAdmin && !rolle.darfBuchen) {
    return json({ error: "Nur der Schatzmeister kann die Vereinsstammdaten aendern" }, 403, corsHeaders);
  }
  const schluessel = String(body.schluessel || "");
  const regel = EINSTELLUNGEN[schluessel];
  if (!regel) return json({ error: "Unbekannte Einstellung" }, 400, corsHeaders);

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
      return json({ error: regel.label + ": zulaessig sind " + regel.min + " bis " + regel.max_wert +
                    (regel.min === 10 && schluessel === "anhoerung_tage"
                      ? ". Die Satzung verlangt mindestens 10 Tage." : "") }, 400, corsHeaders);
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
  ausserhalb:     "im Beitragsjahr nicht Mitglied"
};

// Aus Eintritt, Austritt und Beitragsjahr den Betrag. Bewusst ohne
// Datenbankzugriff, damit die Regel einzeln nachrechenbar bleibt.
//
// Vorgabe ist der VOLLE Jahresbeitrag, auch bei unterjaehrigem Eintritt --
// so rechnet der Vereinsmeister, und die Kontrollzahl 39.972 EUR haengt
// daran. Anteilig ist eine bewusste Entscheidung je Lauf, keine
// stillschweigende Voreinstellung.
function berechneBetrag(satzCent, jahr, eintritt, austritt, anteilig) {
  const jahresBeginn = jahr + "-01-01";
  const jahresEnde = jahr + "-12-31";
  const ein = String(eintritt || "").slice(0, 10);
  const aus = String(austritt || "").slice(0, 10);

  if (ein && ein > jahresEnde) return null;
  if (aus && aus < jahresBeginn) return null;

  const von = ein && ein > jahresBeginn ? ein : jahresBeginn;
  const bis = aus && aus < jahresEnde ? aus : jahresEnde;
  if (von > bis) return null;

  if (!anteilig) {
    return { betrag_cent: satzCent, monate: 12, von: jahresBeginn, bis: jahresEnde, anteilig: false };
  }

  // Angefangene Monate zaehlen voll. Wer am 20.03. eintritt, zahlt ab
  // Maerz -- alles andere waere auf den Tag genau und damit eine
  // Rechenart, die dem Mitglied niemand erklaeren kann.
  const monate = (Number(bis.slice(5, 7)) - Number(von.slice(5, 7))) + 1;
  if (monate <= 0) return null;
  return {
    betrag_cent: Math.round(satzCent * monate / 12),
    monate, von, bis, anteilig: true
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
  const jahresBeginn = lauf.jahr + "-01-01";
  const jahresEnde = lauf.jahr + "-12-31";

  const bedingungen = [
    "m.status <> 'antrag'",
    "m.eintritt <= ?",
    "(m.austritt IS NULL OR m.austritt >= ?)"
  ];
  const werte = [jahresEnde, jahresBeginn];
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

    const rechnung = berechneBetrag(klasse.betrag_cent, lauf.jahr, z.eintritt, z.austritt, opt.anteilig);
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

  // Ein zweiter Lauf fuer dasselbe Jahr ist kein Fehler (Nachzuegler,
  // Umlage), aber fast immer ein Versehen -- deshalb muss er ausdruecklich
  // gewollt sein.
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
  const id = uuid();
  const jetzt = new Date().toISOString();

  await env.VV_DB.prepare(
    "INSERT INTO beitragslauf (id, bezeichnung, jahr, periode, stichtag, faelligkeit, status, " +
    "optionen_json, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,'entwurf',?,?,?)"
  ).bind(id, sauber(body.bezeichnung, 120) || ("Jahresbeitrag " + jahr), jahr,
         "jaehrlich", stichtag, faelligkeit, JSON.stringify(optionen), jetzt, me.username).run();

  await protokolliere(env, me.username, "beitragslauf-angelegt", "beitragslauf", id, { jahr, faelligkeit });
  return json({ ok: true, id }, 200, corsHeaders);
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
            faelligkeit: lauf.faelligkeit, status: lauf.status, optionen: laufOptionen(lauf) },
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
    const z = await env.VV_DB.prepare(
      "SELECT COUNT(*) AS n FROM mitgliedschaft m WHERE m.status <> 'antrag' " +
      "AND m.eintritt <= ? AND (m.austritt IS NULL OR m.austritt >= ?)"
    ).bind(lauf.jahr + "-12-31", lauf.jahr + "-01-01").first();
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
           lauf.bezeichnung, lauf.jahr, "jaehrlich", z.betrag_cent, lauf.faelligkeit,
           JSON.stringify({ klasse: z.klasse, satz_cent: z.rechnung.betrag_cent,
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
    lauf: Object.assign({}, lauf, { optionen: laufOptionen(lauf) }),
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
async function handleLaufVerwerfen(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen) {
    return json({ error: "Nur der Schatzmeister kann einen Lauf verwerfen" }, 403, corsHeaders);
  }
  const lauf = await ladeLauf(env, body.lauf_id);
  if (!lauf) return json({ error: "Beitragslauf nicht gefunden" }, 404, corsHeaders);
  if (lauf.status === "festgeschrieben") {
    return json({ error: "Ein festgeschriebener Lauf kann nicht verworfen werden" }, 409, corsHeaders);
  }

  const datei = await env.VV_DB.prepare(
    "SELECT COUNT(*) AS n FROM sepa_datei WHERE beitragslauf_id = ?").bind(lauf.id).first();
  if (datei && datei.n > 0) {
    return json({ error: "Zu diesem Lauf gibt es bereits eine SEPA-Datei" }, 409, corsHeaders);
  }
  const bezahlt = await env.VV_DB.prepare(
    "SELECT COUNT(*) AS n FROM zahlung z JOIN forderung f ON f.id = z.forderung_id " +
    "WHERE f.beitragslauf_id = ?").bind(lauf.id).first();
  if (bezahlt && bezahlt.n > 0) {
    return json({ error: "Zu diesem Lauf sind bereits Zahlungen verbucht" }, 409, corsHeaders);
  }

  await env.VV_DB.batch([
    env.VV_DB.prepare("DELETE FROM forderung WHERE beitragslauf_id = ?").bind(lauf.id),
    env.VV_DB.prepare("DELETE FROM beitragslauf WHERE id = ?").bind(lauf.id)
  ]);
  await protokolliere(env, me.username, "beitragslauf-verworfen", "beitragslauf", lauf.id,
                      { jahr: lauf.jahr, anzahl: lauf.anzahl_erzeugt });
  return json({ ok: true }, 200, corsHeaders);
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

  const msgId = sepaText("VV" + lauf.jahr + "-" + heute.getTime().toString(36).toUpperCase(), 35);
  const zweckMuster = cfg.verwendungszweck || "Mitgliedsbeitrag {jahr}";

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
      const zweck = sepaText(
        zweckMuster.replace(/\{jahr\}/g, String(lauf.jahr)) + " Nr. " + p.nummern.join(", "), 140);
      const e2e = sepaText("B" + lauf.jahr + "-" + p.nummern[0] + "-" + lfd, 35);
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
  // Offene Mahnungen der bezahlten Haushalte schliessen -- sonst mahnt
  // der naechste Lauf jemanden, der laengst gezahlt hat.
  const haushalte = Array.from(new Set(offen.map((z) => z.haushalt_id)));
  for (let i = 0; i < haushalte.length; i += 50) {
    anweisungen.push(mahnungenErledigen(env, haushalte.slice(i, i + 50), jetzt));
  }
  anweisungen.push(env.VV_DB.prepare("UPDATE sepa_datei SET gebucht_am = ? WHERE id = ?")
    .bind(jetzt, datei.id));

  await env.VV_DB.batch(anweisungen);
  await protokolliere(env, me.username, "sepa-datei-gebucht", "sepa_datei", datei.id,
                      { anzahl: offen.length, summeCent: summe });
  return json({ ok: true, anzahl: offen.length, summeCent: summe, eingang }, 200, corsHeaders);
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
  anweisungen.push(mahnungenErledigen(env, [zeilen[0].haushalt_id], jetzt));
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
    "        WHERE z.forderung_id = f.id AND z.storniert_am IS NULL) AS bezahlt_cent, " +
    "       (SELECT COUNT(*) FROM mahnung mh WHERE mh.haushalt_id = f.haushalt_id " +
    "        AND mh.erledigt_am IS NULL) AS mahnungen " +
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
    ueberfaellig: f.faellig_am < heute,
    mahnungen: f.mahnungen
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
// Mahnwesen nach § 5 Abs. 3 der Satzung
// ---------------------------------------------------------------------
//
// "Ein Mitglied kann ausgeschlossen werden, wenn es trotz zweier
//  schriftlicher Mahnungen mit dem Beitrag im Rueckstand ist. Vor der
//  Entscheidung ist ihm Gelegenheit zur Aeusserung zu geben, mit einer
//  Frist von zehn Tagen."
//
// Daraus folgen drei Stufen, und zwar in genau dieser Reihenfolge:
//   1  erste schriftliche Mahnung
//   2  zweite schriftliche Mahnung
//   3  Anhoerung vor dem Ausschluss, Frist mindestens 10 Tage
//
// Eine Stufe wird erst erreicht, wenn die FRIST der vorigen abgelaufen
// ist. Zwei Mahnungen am selben Tag sind keine zwei Mahnungen -- das
// waere der Fehler, an dem ein Ausschluss vor Gericht scheitert.
//
// Und: diese App schliesst NIEMANDEN aus. Sie legt dem Vorstand eine
// Liste vor. Der Beschluss ist ein Vorstandsakt, so wie die Aufnahme
// nach § 4 einer ist.

const MAHN_STUFE_TEXT = {
  1: "1. Mahnung",
  2: "2. Mahnung",
  3: "Anhoerung vor Ausschluss (§ 5 Abs. 3)"
};

// Mahnungen eines Haushalts gelten als erledigt, sobald dort nichts mehr
// offen ist. Mengenbasiert, wird an jede Zahlungsbuchung angehaengt --
// sonst mahnt der naechste Lauf jemanden, der laengst bezahlt hat.
function mahnungenErledigen(env, haushaltIds, jetzt) {
  const p = haushaltIds.map(() => "?").join(",");
  return env.VV_DB.prepare(
    "UPDATE mahnung SET erledigt_am = ? WHERE erledigt_am IS NULL " +
    "AND haushalt_id IN (" + p + ") AND NOT EXISTS (" +
    "  SELECT 1 FROM forderung f WHERE f.haushalt_id = mahnung.haushalt_id " +
    "  AND f.storniert_am IS NULL AND f.status <> 'bezahlt')"
  ).bind(jetzt, ...haushaltIds);
}

// Wer ist mahnfaellig, und auf welcher Stufe? Zwei Abfragen fuer den
// gesamten Bestand, danach nur noch Rechnen.
async function sammleMahnfaelle(env, cfg, heute) {
  const karenz = einstellungZahl(cfg, "mahn_karenz_tage");
  const frist = einstellungZahl(cfg, "mahn_frist_tage");
  const mindest = einstellungZahl(cfg, "mahn_mindest_cent");
  const anhoerung = einstellungZahl(cfg, "anhoerung_tage");
  const stichtag = tageAddieren(heute, -karenz);

  const offen = await env.VV_DB.prepare(
    "SELECT f.haushalt_id, COUNT(*) AS anzahl, MIN(f.faellig_am) AS aeltester, " +
    "  SUM(f.betrag_cent - (SELECT COALESCE(SUM(z.betrag_cent),0) FROM zahlung z " +
    "      WHERE z.forderung_id = f.id AND z.storniert_am IS NULL)) AS offen_cent " +
    "FROM forderung f " +
    "WHERE f.storniert_am IS NULL AND f.status <> 'bezahlt' AND f.faellig_am <= ? " +
    "GROUP BY f.haushalt_id"
  ).bind(stichtag).all();

  const bestehend = await env.VV_DB.prepare(
    "SELECT haushalt_id, MAX(stufe) AS stufe, MAX(frist_bis) AS frist_bis " +
    "FROM mahnung WHERE erledigt_am IS NULL GROUP BY haushalt_id"
  ).all();
  const stand = new Map();
  for (const z of bestehend.results || []) stand.set(z.haushalt_id, z);

  const faellig = [];
  const wartend = [];
  const zuKlein = [];
  const ausschluss = [];

  for (const h of offen.results || []) {
    if (h.offen_cent <= 0) continue;
    const vorher = stand.get(h.haushalt_id);
    const stufeVorher = vorher ? vorher.stufe : 0;

    if (stufeVorher >= 3) {
      // Anhoerung laeuft oder ist abgelaufen. Nicht weiter mahnen --
      // ab hier entscheidet der Vorstand.
      ausschluss.push({ haushalt_id: h.haushalt_id, offen_cent: h.offen_cent,
                        frist_bis: vorher.frist_bis,
                        frist_abgelaufen: vorher.frist_bis < heute });
      continue;
    }
    if (vorher && vorher.frist_bis >= heute) {
      wartend.push({ haushalt_id: h.haushalt_id, offen_cent: h.offen_cent,
                     stufe: stufeVorher, frist_bis: vorher.frist_bis });
      continue;
    }
    if (h.offen_cent < mindest) {
      zuKlein.push({ haushalt_id: h.haushalt_id, offen_cent: h.offen_cent });
      continue;
    }

    const stufe = stufeVorher + 1;
    faellig.push({
      haushalt_id: h.haushalt_id,
      stufe,
      anzahl: h.anzahl,
      offen_cent: h.offen_cent,
      aeltester: h.aeltester,
      frist_bis: tageAddieren(heute, stufe === 3 ? anhoerung : frist),
      gebuehr_cent: stufe === 1 ? einstellungZahl(cfg, "mahn_gebuehr1_cent")
                  : stufe === 2 ? einstellungZahl(cfg, "mahn_gebuehr2_cent") : 0
    });
  }

  return { faellig, wartend, zuKlein, ausschluss, karenz, frist, mindest, anhoerung, stichtag };
}

// Namen und Anschriften zu einer Menge von Haushalten. Eine Abfrage.
async function ladeHaushaltsInfos(env, ids) {
  const infos = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const b = ids.slice(i, i + 50);
    const r = await env.VV_DB.prepare(
      "SELECT h.id, h.abw_empfaenger, h.abw_strasse, h.abw_plz, h.abw_ort, " +
      "       zp.vorname AS z_vorname, zp.nachname AS z_nachname, zp.email AS z_email, " +
      "       zp.strasse AS z_strasse, zp.plz AS z_plz, zp.ort AS z_ort " +
      "FROM haushalt h LEFT JOIN person zp ON zp.id = h.zahler_person_id " +
      "WHERE h.id IN (" + b.map(() => "?").join(",") + ")"
    ).bind(...b).all();
    for (const z of r.results || []) {
      infos.set(z.id, {
        empfaenger: z.abw_empfaenger || ((z.z_vorname || "") + " " + (z.z_nachname || "")).trim(),
        email: z.z_email || "",
        strasse: z.abw_strasse || z.z_strasse || "",
        plz: z.abw_plz || z.z_plz || "",
        ort: z.abw_ort || z.z_ort || ""
      });
    }
  }
  return infos;
}

// Mitglieder eines Haushalts mit offener Forderung -- fuer den Brieftext
// und, bei Stufe 3, fuer die einzelnen Anhoerungen.
async function ladeBetroffene(env, ids) {
  const nach = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const b = ids.slice(i, i + 50);
    const r = await env.VV_DB.prepare(
      "SELECT f.id AS forderung_id, f.haushalt_id, f.mitgliedschaft_id, f.bezeichnung, " +
      "       f.jahr, f.faellig_am, f.betrag_cent, m.mitgliedsnummer, p.vorname, p.nachname, " +
      "       (SELECT COALESCE(SUM(z.betrag_cent),0) FROM zahlung z " +
      "        WHERE z.forderung_id = f.id AND z.storniert_am IS NULL) AS bezahlt_cent " +
      "FROM forderung f JOIN mitgliedschaft m ON m.id = f.mitgliedschaft_id " +
      "JOIN person p ON p.id = m.person_id " +
      "WHERE f.storniert_am IS NULL AND f.status <> 'bezahlt' " +
      "  AND f.haushalt_id IN (" + b.map(() => "?").join(",") + ") " +
      "ORDER BY f.faellig_am"
    ).bind(...b).all();
    for (const z of r.results || []) {
      if (!nach.has(z.haushalt_id)) nach.set(z.haushalt_id, []);
      nach.get(z.haushalt_id).push(z);
    }
  }
  return nach;
}

async function handleMahnlauf(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  const nurPruefen = !!body.pruefen;
  if (!rolle.istAdmin && !rolle.darfBuchen && !(nurPruefen && rolle.darfSchreiben)) {
    return json({ error: "Nur der Schatzmeister kann mahnen" }, 403, corsHeaders);
  }

  const cfg = (await ladeEinstellungen(env)) || {};
  const heute = istIsoDatum(body.datum) ? body.datum : new Date().toISOString().slice(0, 10);
  const s = await sammleMahnfaelle(env, cfg, heute);

  const alleIds = s.faellig.map((f) => f.haushalt_id)
    .concat(s.ausschluss.map((a) => a.haushalt_id));
  const infos = await ladeHaushaltsInfos(env, alleIds);
  const betroffene = await ladeBetroffene(env, alleIds);

  function anreichern(x) {
    const i = infos.get(x.haushalt_id) || {};
    const p = betroffene.get(x.haushalt_id) || [];
    return Object.assign({}, x, {
      empfaenger: i.empfaenger || "(kein Zahler hinterlegt)",
      email: i.email || "",
      hatAnschrift: !!(i.strasse && i.ort),
      mitglieder: p.map((f) => ({ nr: f.mitgliedsnummer,
                                  name: (f.vorname + " " + f.nachname).trim() }))
        .filter((m, k, a) => a.findIndex((y) => y.nr === m.nr) === k)
    });
  }

  const vorschau = {
    ok: true, heute, pruefung: nurPruefen,
    regeln: { karenz: s.karenz, frist: s.frist, mindest_cent: s.mindest,
              anhoerung: s.anhoerung, stichtag: s.stichtag },
    faellig: s.faellig.map(anreichern),
    nachStufe: [1, 2, 3].map((st) => ({
      stufe: st, text: MAHN_STUFE_TEXT[st],
      anzahl: s.faellig.filter((f) => f.stufe === st).length,
      summe_cent: s.faellig.filter((f) => f.stufe === st).reduce((a, f) => a + f.offen_cent, 0)
    })).filter((x) => x.anzahl),
    wartend: s.wartend.length,
    zuKlein: s.zuKlein.length,
    zuKleinSumme: s.zuKlein.reduce((a, x) => a + x.offen_cent, 0),
    ausschluss: s.ausschluss.map(anreichern),
    summeCent: s.faellig.reduce((a, f) => a + f.offen_cent, 0)
  };

  if (nurPruefen) return json(vorschau, 200, corsHeaders);
  if (!s.faellig.length) {
    return json({ error: "Es ist derzeit niemand mahnfaellig" }, 409, corsHeaders);
  }

  const jetzt = new Date().toISOString();
  const anweisungen = [];
  let gebuehren = 0;

  for (const f of s.faellig) {
    const posten = (betroffene.get(f.haushalt_id) || []);
    const forderungsIds = posten.map((x) => x.forderung_id);

    if (f.stufe === 3) {
      // Die Anhoerung geht an das MITGLIED, nicht an den Haushalt: der
      // Ausschluss trifft eine Person. Bei einer Familie bekommt deshalb
      // jedes betroffene Mitglied eine eigene -- adressiert wird
      // trotzdem der Zahler.
      const mitgliedschaften = Array.from(new Set(posten.map((x) => x.mitgliedschaft_id)));
      for (const mid of mitgliedschaften) {
        anweisungen.push(env.VV_DB.prepare(
          "INSERT INTO mahnung (id, haushalt_id, mitgliedschaft_id, stufe, erstellt_datum, " +
          "frist_bis, summe_cent, forderungen_json, versand_art, erstellt_am, erstellt_von) " +
          "VALUES (?,?,?,3,?,?,?,?,'brief',?,?)"
        ).bind(uuid(), f.haushalt_id, mid, heute, f.frist_bis, f.offen_cent,
               JSON.stringify(posten.filter((x) => x.mitgliedschaft_id === mid)
                                    .map((x) => x.forderung_id)),
               jetzt, me.username));
      }
      continue;
    }

    anweisungen.push(env.VV_DB.prepare(
      "INSERT INTO mahnung (id, haushalt_id, stufe, erstellt_datum, frist_bis, summe_cent, " +
      "forderungen_json, versand_art, erstellt_am, erstellt_von) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).bind(uuid(), f.haushalt_id, f.stufe, heute, f.frist_bis, f.offen_cent,
           JSON.stringify(forderungsIds), infos.get(f.haushalt_id) &&
           infos.get(f.haushalt_id).email ? "mail" : "brief", jetzt, me.username));

    // Mahngebuehr als eigene Forderung, nie auf den Beitrag geschlagen.
    // Sie haengt an der aeltesten offenen Forderung des Haushalts, damit
    // sie einer Mitgliedschaft zugeordnet ist.
    if (f.gebuehr_cent > 0 && posten.length) {
      gebuehren++;
      anweisungen.push(env.VV_DB.prepare(
        "INSERT INTO forderung (id, mitgliedschaft_id, haushalt_id, art, bezeichnung, jahr, " +
        "betrag_cent, faellig_am, status, erstellt_am, erstellt_von) " +
        "VALUES (?,?,?,'mahngebuehr',?,?,?,?,'offen',?,?)"
      ).bind(uuid(), posten[0].mitgliedschaft_id, f.haushalt_id,
             "Mahngebuehr " + f.stufe + ". Mahnung", posten[0].jahr,
             f.gebuehr_cent, f.frist_bis, jetzt, me.username));
    }
  }

  await env.VV_DB.batch(anweisungen);
  await protokolliere(env, me.username, "mahnlauf", "mahnung", null,
                      { anzahl: s.faellig.length, summeCent: vorschau.summeCent, heute });

  return json(Object.assign({}, vorschau, {
    pruefung: false, erzeugt: s.faellig.length, gebuehren
  }), 200, corsHeaders);
}

// Alle Mahnungen, jüngste zuerst. Mit dem aktuellen Rueckstand des
// Haushalts, nicht nur dem Betrag zum Zeitpunkt der Mahnung -- sonst
// steht in der Liste eine Summe, die laengst bezahlt ist.
async function handleMahnungenListe(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen && !rolle.darfSchreiben) {
    return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  }
  const heute = new Date().toISOString().slice(0, 10);
  const bedingungen = [];
  if (!body.auch_erledigte) bedingungen.push("mh.erledigt_am IS NULL");

  const r = await env.VV_DB.prepare(
    "SELECT mh.id, mh.haushalt_id, mh.mitgliedschaft_id, mh.stufe, mh.erstellt_datum, " +
    "       mh.frist_bis, mh.summe_cent, mh.versand_art, mh.versendet_am, mh.erledigt_am, " +
    "       zp.vorname AS z_vorname, zp.nachname AS z_nachname, zp.email AS z_email, " +
    "       h.abw_empfaenger, " +
    "       (SELECT COALESCE(SUM(f.betrag_cent - (SELECT COALESCE(SUM(z.betrag_cent),0) " +
    "          FROM zahlung z WHERE z.forderung_id = f.id AND z.storniert_am IS NULL)),0) " +
    "        FROM forderung f WHERE f.haushalt_id = mh.haushalt_id " +
    "        AND f.storniert_am IS NULL AND f.status <> 'bezahlt') AS aktuell_offen " +
    "FROM mahnung mh JOIN haushalt h ON h.id = mh.haushalt_id " +
    "LEFT JOIN person zp ON zp.id = h.zahler_person_id " +
    (bedingungen.length ? "WHERE " + bedingungen.join(" AND ") + " " : "") +
    "ORDER BY mh.erstellt_datum DESC, mh.stufe DESC LIMIT 500"
  ).all();

  return json({
    ok: true, heute,
    mahnungen: (r.results || []).map((m) => ({
      id: m.id, haushalt_id: m.haushalt_id, stufe: m.stufe,
      stufe_text: MAHN_STUFE_TEXT[m.stufe] || String(m.stufe),
      empfaenger: m.abw_empfaenger || ((m.z_vorname || "") + " " + (m.z_nachname || "")).trim(),
      email: m.z_email || "",
      erstellt_datum: m.erstellt_datum, frist_bis: m.frist_bis,
      summe_cent: m.summe_cent, aktuell_offen: m.aktuell_offen,
      versand_art: m.versand_art, versendet_am: m.versendet_am, erledigt_am: m.erledigt_am,
      frist_abgelaufen: !m.erledigt_am && m.frist_bis < heute
    })),
    darfBuchen: rolle.istAdmin || rolle.darfBuchen
  }, 200, corsHeaders);
}

// Serienbriefdaten. Wie bei der Vorabankuendigung: die App erzeugt die
// Liste, nicht den Versand. Eine Mahnung, die im Spam landet, ist keine
// schriftliche Mahnung im Sinne des § 5 Abs. 3 -- und genau daran haengt
// spaeter die Wirksamkeit des Ausschlusses.
async function handleMahnungBrief(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen && !rolle.darfSchreiben) {
    return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  }

  const stufe = parseInt(body.stufe, 10);
  const datum = istIsoDatum(body.erstellt_datum) ? body.erstellt_datum : null;
  const bedingungen = ["mh.erledigt_am IS NULL", "mh.versendet_am IS NULL"];
  const werte = [];
  if (stufe >= 1 && stufe <= 3) { bedingungen.push("mh.stufe = ?"); werte.push(stufe); }
  if (datum) { bedingungen.push("mh.erstellt_datum = ?"); werte.push(datum); }

  const r = await env.VV_DB.prepare(
    "SELECT mh.id, mh.haushalt_id, mh.stufe, mh.erstellt_datum, mh.frist_bis, " +
    "       mh.summe_cent, mh.forderungen_json, " +
    "       h.abw_empfaenger, h.abw_strasse, h.abw_plz, h.abw_ort, " +
    "       zp.vorname AS z_vorname, zp.nachname AS z_nachname, zp.email AS z_email, " +
    "       zp.strasse AS z_strasse, zp.plz AS z_plz, zp.ort AS z_ort " +
    "FROM mahnung mh JOIN haushalt h ON h.id = mh.haushalt_id " +
    "LEFT JOIN person zp ON zp.id = h.zahler_person_id " +
    "WHERE " + bedingungen.join(" AND ") + " ORDER BY mh.stufe, zp.nachname LIMIT 500"
  ).bind(...werte).all();

  const zeilen = r.results || [];
  const alleForderungen = [];
  for (const m of zeilen) {
    try { alleForderungen.push(...JSON.parse(m.forderungen_json || "[]")); } catch { /* leer */ }
  }

  // Die Einzelposten dazu -- eine Mahnung ohne Aufstellung, wofuer
  // gemahnt wird, kann niemand pruefen.
  const posten = new Map();
  for (let i = 0; i < alleForderungen.length; i += 50) {
    const b = alleForderungen.slice(i, i + 50);
    const p = await env.VV_DB.prepare(
      "SELECT f.id, f.haushalt_id, f.bezeichnung, f.faellig_am, f.betrag_cent, " +
      "       m.mitgliedsnummer, pe.vorname, pe.nachname, " +
      "       (SELECT COALESCE(SUM(z.betrag_cent),0) FROM zahlung z " +
      "        WHERE z.forderung_id = f.id AND z.storniert_am IS NULL) AS bezahlt_cent " +
      "FROM forderung f JOIN mitgliedschaft m ON m.id = f.mitgliedschaft_id " +
      "JOIN person pe ON pe.id = m.person_id " +
      "WHERE f.id IN (" + b.map(() => "?").join(",") + ")"
    ).bind(...b).all();
    for (const z of p.results || []) {
      if (!posten.has(z.haushalt_id)) posten.set(z.haushalt_id, []);
      posten.get(z.haushalt_id).push(z);
    }
  }

  const cfg = (await ladeEinstellungen(env)) || {};
  return json({
    ok: true,
    verein: cfg.verein_name || "",
    anzahl: zeilen.length,
    briefe: zeilen.map((m) => {
      const p = (posten.get(m.haushalt_id) || []).filter((x) => x.betrag_cent > x.bezahlt_cent);
      return {
        id: m.id, stufe: m.stufe, stufe_text: MAHN_STUFE_TEXT[m.stufe],
        empfaenger: m.abw_empfaenger || ((m.z_vorname || "") + " " + (m.z_nachname || "")).trim(),
        strasse: m.abw_strasse || m.z_strasse || "",
        plz: m.abw_plz || m.z_plz || "",
        ort: m.abw_ort || m.z_ort || "",
        email: m.z_email || "",
        erstellt_datum: m.erstellt_datum,
        frist_bis: m.frist_bis,
        summe_cent: p.reduce((a, x) => a + (x.betrag_cent - x.bezahlt_cent), 0),
        posten: p.map((x) => ({
          nr: x.mitgliedsnummer, name: (x.vorname + " " + x.nachname).trim(),
          bezeichnung: x.bezeichnung, faellig_am: x.faellig_am,
          rest_cent: x.betrag_cent - x.bezahlt_cent
        }))
      };
    }).filter((b) => b.summe_cent > 0)
  }, 200, corsHeaders);
}

// Als versendet kennzeichnen. Erst DAS macht aus einer erzeugten Mahnung
// eine schriftliche Mahnung -- die Stufenzaehlung des § 5 Abs. 3 haengt
// daran, nicht am Erzeugen.
async function handleMahnungVersendet(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen) {
    return json({ error: "Nur der Schatzmeister kann den Versand bestaetigen" }, 403, corsHeaders);
  }
  const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 500) : [];
  const stufe = parseInt(body.stufe, 10);
  const datum = istIsoDatum(body.versendet_am) ? body.versendet_am
                                               : new Date().toISOString().slice(0, 10);
  const jetzt = new Date().toISOString();

  if (ids.length) {
    const anweisungen = [];
    for (let i = 0; i < ids.length; i += 50) {
      const b = ids.slice(i, i + 50);
      anweisungen.push(env.VV_DB.prepare(
        "UPDATE mahnung SET versendet_am = ?, versendet_von = ? WHERE versendet_am IS NULL " +
        "AND id IN (" + b.map(() => "?").join(",") + ")"
      ).bind(datum, me.username, ...b));
    }
    await env.VV_DB.batch(anweisungen);
    await protokolliere(env, me.username, "mahnungen-versendet", "mahnung", null,
                        { anzahl: ids.length, datum });
    return json({ ok: true, anzahl: ids.length }, 200, corsHeaders);
  }

  // Ohne Liste: alle noch nicht versendeten einer Stufe.
  if (!(stufe >= 1 && stufe <= 3)) {
    return json({ error: "Weder Mahnungen noch eine Stufe angegeben" }, 400, corsHeaders);
  }
  const zahl = await env.VV_DB.prepare(
    "SELECT COUNT(*) AS n FROM mahnung WHERE versendet_am IS NULL AND erledigt_am IS NULL AND stufe = ?"
  ).bind(stufe).first();
  await env.VV_DB.prepare(
    "UPDATE mahnung SET versendet_am = ?, versendet_von = ? " +
    "WHERE versendet_am IS NULL AND erledigt_am IS NULL AND stufe = ?"
  ).bind(datum, me.username, stufe).run();
  await protokolliere(env, me.username, "mahnungen-versendet", "mahnung", null,
                      { stufe, anzahl: zahl ? zahl.n : 0, datum });
  return json({ ok: true, anzahl: zahl ? zahl.n : 0 }, 200, corsHeaders);
}

async function handleMahnungErledigt(body, env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen) {
    return json({ error: "Nur der Schatzmeister kann eine Mahnung abschliessen" }, 403, corsHeaders);
  }
  const id = String(body.id || "");
  if (!id) return json({ error: "Keine Mahnung angegeben" }, 400, corsHeaders);
  await env.VV_DB.prepare(
    "UPDATE mahnung SET erledigt_am = ? WHERE id = ? AND erledigt_am IS NULL"
  ).bind(new Date().toISOString(), id).run();
  await protokolliere(env, me.username, "mahnung-erledigt", "mahnung", id,
                      { grund: sauber(body.grund, 200) });
  return json({ ok: true }, 200, corsHeaders);
}

// Wer erfuellt die Voraussetzungen des § 5 Abs. 3? Ausdruecklich eine
// VORLAGE fuer den Vorstand: zwei versendete Mahnungen, abgelaufene
// Anhoerungsfrist, immer noch offen. Diese App schliesst niemanden aus.
async function handleAusschlussKandidaten(env, me, corsHeaders) {
  const rolle = await ladeRolle(env, me);
  if (!rolle.istAdmin && !rolle.darfBuchen && !rolle.darfSchreiben) {
    return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  }
  const heute = new Date().toISOString().slice(0, 10);

  const r = await env.VV_DB.prepare(
    "SELECT mh.id, mh.haushalt_id, mh.mitgliedschaft_id, mh.frist_bis, mh.versendet_am, " +
    "       m.mitgliedsnummer, m.status, p.vorname, p.nachname, " +
    "       (SELECT COUNT(*) FROM mahnung m2 WHERE m2.haushalt_id = mh.haushalt_id " +
    "        AND m2.stufe IN (1,2) AND m2.versendet_am IS NOT NULL) AS mahnungen_versendet, " +
    "       (SELECT COALESCE(SUM(f.betrag_cent - (SELECT COALESCE(SUM(z.betrag_cent),0) " +
    "          FROM zahlung z WHERE z.forderung_id = f.id AND z.storniert_am IS NULL)),0) " +
    "        FROM forderung f WHERE f.haushalt_id = mh.haushalt_id " +
    "        AND f.storniert_am IS NULL AND f.status <> 'bezahlt') AS offen_cent " +
    "FROM mahnung mh " +
    "LEFT JOIN mitgliedschaft m ON m.id = mh.mitgliedschaft_id " +
    "LEFT JOIN person p ON p.id = m.person_id " +
    "WHERE mh.stufe = 3 AND mh.erledigt_am IS NULL " +
    "ORDER BY mh.frist_bis"
  ).all();

  const kandidaten = [];
  const nochNicht = [];
  for (const z of r.results || []) {
    const eintrag = {
      mahnung_id: z.id, mitgliedschaft_id: z.mitgliedschaft_id,
      mitgliedsnummer: z.mitgliedsnummer,
      name: ((z.vorname || "") + " " + (z.nachname || "")).trim(),
      status: z.status, frist_bis: z.frist_bis, offen_cent: z.offen_cent,
      mahnungen_versendet: z.mahnungen_versendet,
      anhoerung_versendet: !!z.versendet_am
    };
    // Alle drei Bedingungen der Satzung muessen erfuellt sein.
    const bereit = z.mahnungen_versendet >= 2 && !!z.versendet_am &&
                   z.frist_bis < heute && z.offen_cent > 0 && z.status !== "beendet";
    if (bereit) kandidaten.push(eintrag);
    else {
      // Als Code, nicht als Satz: der Text gehoert in die Oberflaeche,
      // wo er mit Umlauten und deutschem Datum geschrieben werden kann.
      eintrag.grund =
        z.offen_cent <= 0 ? "bezahlt"
        : z.status === "beendet" ? "beendet"
        : z.mahnungen_versendet < 2 ? "mahnungen_fehlen"
        : !z.versendet_am ? "anhoerung_nicht_versendet"
        : "frist_laeuft";
      nochNicht.push(eintrag);
    }
  }

  return json({ ok: true, heute, kandidaten, nochNicht,
                darfBuchen: rolle.istAdmin || rolle.darfBuchen }, 200, corsHeaders);
}

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
  return json({
    ok: true,
    faellig, jahr: lauf.jahr,
    glaeubiger_id: cfg.glaeubiger_id || "",
    verein_name: cfg.verein_name || "",
    anzahl: liste.length,
    mitEmail: liste.filter((e) => e.email).length,
    summeCent: liste.reduce((s, e) => s + e.betrag_cent, 0),
    empfaenger: liste
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
        case "vv-zahlung-erfassen": return handleZahlungErfassen(body, env, me, corsHeaders);
        case "vv-ruecklastschrift": return handleRuecklastschrift(body, env, me, corsHeaders);
        case "vv-forderung-stornieren": return handleForderungStornieren(body, env, me, corsHeaders);
        case "vv-offene-posten":   return handleOffenePosten(body, env, me, corsHeaders);
        case "vv-zahlungen":       return handleZahlungenListe(body, env, me, corsHeaders);
        case "vv-mahnlauf":        return handleMahnlauf(body, env, me, corsHeaders);
        case "vv-mahnungen":       return handleMahnungenListe(body, env, me, corsHeaders);
        case "vv-mahnung-brief":   return handleMahnungBrief(body, env, me, corsHeaders);
        case "vv-mahnung-versendet": return handleMahnungVersendet(body, env, me, corsHeaders);
        case "vv-mahnung-erledigt": return handleMahnungErledigt(body, env, me, corsHeaders);
        case "vv-ausschluss-kandidaten": return handleAusschlussKandidaten(env, me, corsHeaders);
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
