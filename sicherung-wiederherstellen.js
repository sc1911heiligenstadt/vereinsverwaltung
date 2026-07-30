// =====================================================================
// Sicherung zurueckspielen
// =====================================================================
//
// Macht aus einer naechtlichen Sicherung (JSON aus Nextcloud) eine
// SQL-Datei, mit der sich die Datenbank vollstaendig neu aufbauen laesst.
//
//   node sicherung-wiederherstellen.js vereinsverwaltung-Do.json
//   -> schreibt wiederherstellung.sql daneben
//
// Einspielen, je nachdem was greifbar ist:
//
//   wrangler d1 execute vereinsverwaltung --remote --file=wiederherstellung.sql
//   sqlite3 kopie.db < wiederherstellung.sql        (zum Nachsehen lokal)
//
// WARUM DIESE DATEI IM REPO LIEGT: Der Weg zurueck muss ohne diese
// Sitzung, ohne Internet und ohne Nachdenken funktionieren. Die
// Sicherungsdatei traegt ihr eigenes Schema mit -- zusammen mit diesem
// Skript reicht die JSON-Datei allein aus, auch wenn schema.sql inzwischen
// eine andere Version hat.
//
// Geprueft in test-sicherung.js: Dump -> SQL -> frische Datenbank ->
// Zeile-fuer-Zeile-Vergleich gegen das Original.
// =====================================================================

const fs = require("fs");
const pfad = require("path");

function sqlWert(w) {
  if (w === null || w === undefined) return "NULL";
  if (typeof w === "number") return Number.isFinite(w) ? String(w) : "NULL";
  if (typeof w === "boolean") return w ? "1" : "0";
  // D1 gibt BLOBs als Byte-Array zurueck. Im aktuellen Schema kommt das
  // nicht vor, aber eine Sicherung, die an einem neuen Feld scheitert,
  // waere die schlechteste Ueberraschung von allen.
  if (Array.isArray(w) || w instanceof Uint8Array) {
    return "x'" + Array.from(w).map((b) => b.toString(16).padStart(2, "0")).join("") + "'";
  }
  if (typeof w === "object") return "'" + JSON.stringify(w).replace(/'/g, "''") + "'";
  return "'" + String(w).replace(/'/g, "''") + "'";
}

function baueSql(dump) {
  if (!dump || dump.app !== "vereinsverwaltung" || !dump.schema || !dump.tabellen) {
    throw new Error("Das ist keine Sicherung der Vereinsverwaltung");
  }
  if (dump.vollstaendig === false) {
    console.warn("WARNUNG: Die Sicherung ist als unvollstaendig gekennzeichnet:");
    (dump.warnungen || []).forEach((w) => console.warn("  - " + w));
  }

  const zeilen = [];
  zeilen.push("-- Wiederherstellung der Vereinsverwaltung");
  zeilen.push("-- Sicherung vom " + (dump.erstelltBerlin || dump.erstellt) +
              " (" + dump.ausloeser + "), " + dump.zeilenGesamt + " Zeilen");
  zeilen.push("");
  // Die Objekte stehen nach Typ sortiert, nicht nach Abhaengigkeit --
  // person verweist auf haushalt, das alphabetisch spaeter kaeme. Ohne das
  // Abschalten schlaegt jeder zweite INSERT auf einen Fremdschluessel fehl.
  zeilen.push("PRAGMA foreign_keys = OFF;");
  zeilen.push("");

  const tabellen = dump.schema.filter((o) => o.type === "table");
  const rest = dump.schema.filter((o) => o.type !== "table");

  zeilen.push("-- ---------- Aufbau ----------");
  tabellen.forEach((o) => {
    zeilen.push("DROP TABLE IF EXISTS \"" + o.name + "\";");
    zeilen.push(o.sql.trim().replace(/;+\s*$/, "") + ";");
  });
  zeilen.push("");

  zeilen.push("-- ---------- Daten ----------");
  let gesamt = 0;
  tabellen.forEach((o) => {
    const daten = dump.tabellen[o.name] || [];
    if (!daten.length) {
      zeilen.push("-- " + o.name + ": leer");
      return;
    }
    // Spaltennamen aus der ERSTEN Zeile zu nehmen reicht nicht: D1 laesst
    // Felder mit NULL zwar stehen, aber wenn eine spaetere Zeile ein Feld
    // traegt, das die erste nicht hat, fiele es lautlos weg.
    const spalten = [];
    daten.forEach((z) => Object.keys(z).forEach((k) => {
      if (!spalten.includes(k)) spalten.push(k);
    }));
    zeilen.push("-- " + o.name + ": " + daten.length + " Zeilen");
    const kopf = "INSERT INTO \"" + o.name + "\" (" +
                 spalten.map((s) => '"' + s + '"').join(", ") + ") VALUES ";
    daten.forEach((z) => {
      zeilen.push(kopf + "(" + spalten.map((s) => sqlWert(z[s])).join(", ") + ");");
      gesamt++;
    });
  });
  zeilen.push("");

  if (rest.length) {
    zeilen.push("-- ---------- Indizes und Sichten ----------");
    rest.forEach((o) => zeilen.push(o.sql.trim().replace(/;+\s*$/, "") + ";"));
    zeilen.push("");
  }

  zeilen.push("PRAGMA foreign_keys = ON;");
  return { sql: zeilen.join("\n") + "\n", tabellen: tabellen.length, zeilen: gesamt };
}

module.exports = { baueSql, sqlWert };

if (require.main === module) {
  const quelle = process.argv[2];
  if (!quelle) {
    console.error("Aufruf: node sicherung-wiederherstellen.js <sicherung.json> [ziel.sql]");
    process.exit(1);
  }
  const dump = JSON.parse(fs.readFileSync(quelle, "utf8"));
  const ergebnis = baueSql(dump);
  const ziel = process.argv[3] || pfad.join(pfad.dirname(quelle), "wiederherstellung.sql");
  fs.writeFileSync(ziel, ergebnis.sql, "utf8");
  console.log("Geschrieben: " + ziel);
  console.log("  " + ergebnis.tabellen + " Tabellen, " + ergebnis.zeilen + " Zeilen");
  console.log("");
  console.log("Einspielen:");
  console.log("  wrangler d1 execute vereinsverwaltung --remote --file=" + pfad.basename(ziel));
}
