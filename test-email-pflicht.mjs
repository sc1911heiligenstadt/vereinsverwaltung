// Prueft, dass die beiden oeffentlichen Formulare die E-Mail-Adresse VOR
// dem Absenden verlangen -- und dass sie dabei genau dieselbe Grenze
// ziehen wie der Server.
//
// ⚠️ Warum es dafuer eine Pruefung braucht: die naheliegende Loesung waere
// ein `required` am Eingabefeld gewesen. Sie wirkt hier NICHT -- antrag.html
// und nachwuchs.html haben kein <form>, der Absendeknopf ist type="button"
// und ruft absenden() selbst auf. Der Browser prueft dann gar nichts, und
// eine spaeter eingebaute `required`-Zeile saehe aus wie eine Absicherung,
// ohne eine zu sein.
//
// ⚠️ Alle Werte hier sind ERFUNDEN und muessen es bleiben (Adressen auf
// @example.invalid nach RFC 2606, IBAN das neutrale Standard-Testkonto).
// Dieses Repo ist oeffentlich.
//
// Lauf: node test-email-pflicht.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const hier = dirname(fileURLToPath(import.meta.url));
const quelle = readFileSync(join(hier, "antrag-felder.js"), "utf8");
const workerQuelle = readFileSync(join(hier, "vereinsverwaltung-worker.js"), "utf8");

// Stub-DOM: nur die Elemente, die pruefeGemeinsameFelder wirklich anfasst.
// Der Kern wird als ECHTE Datei geladen, nicht nachgebaut.
function baueDom(o) {
  const el = {
    "a-karte-gesetzl": { hidden: o.minder !== true },
    "a-gesetzl2-block": { hidden: true },
    "a-sig-gesetzl2-block": { hidden: true }
  };
  return { getElementById: (id) => el[id] || null };
}

let rot = 0;
function zusage(name, ist, soll) {
  const ok = ist === soll;
  if (!ok) rot++;
  console.log((ok ? "  ok  " : "  XX  ") + name +
    (ok ? "" : `  (ist: ${JSON.stringify(ist)}, soll: ${JSON.stringify(soll)})`));
}

function lauf(daten, domOpt = {}) {
  const ctx = { document: baueDom(domOpt), console };
  vm.createContext(ctx);
  vm.runInContext(quelle, ctx);
  return ctx.pruefeGemeinsameFelder(daten);
}

const ABSAGE = "Bitte tragen Sie oben eine gültige E-Mail-Adresse ein.";
const basis = {
  email: "eltern@example.invalid",
  unterschrift: "data:image/png;base64,x",
  unterschrift_gesetzl: "",
  unterschrift_gesetzl2: "",
  gesetzl2_name: "",
  zahlungsart: "lastschrift",
  iban: "DE02100500000054540402"
};

console.log("\nA  Die E-Mail wird im Client verlangt");
zusage("A1 leere E-Mail wird abgewiesen", lauf({ ...basis, email: "" }), ABSAGE);
zusage("A2 nur Leerzeichen wird abgewiesen", lauf({ ...basis, email: "   " }), ABSAGE);
zusage("A3 ohne @ wird abgewiesen", lauf({ ...basis, email: "elternexample.invalid" }), ABSAGE);
zusage("A4 ohne Punkt danach wird abgewiesen", lauf({ ...basis, email: "eltern@example" }), ABSAGE);
// GEGENPROBE: ohne sie waeren A1-A4 auch dann gruen, wenn die Pruefung
// grundsaetzlich alles abwiese.
zusage("A5 GEGENPROBE: gueltige E-Mail kommt durch", lauf(basis), null);
zusage("A6 GEGENPROBE: Rand-Leerzeichen stoeren nicht",
  lauf({ ...basis, email: "  eltern@example.invalid  " }), null);

console.log("\nB  Gemeldet wird das OBERSTE fehlende Feld");
// ⚠️ Die E-Mail steht im Bogen oben, die Unterschrift unten. Stuende die
// Pruefung hinter der Unterschrift, schickte man jemanden erst nach unten
// und danach wieder nach oben.
zusage("B1 fehlt beides, gemeldet wird die E-Mail",
  lauf({ ...basis, email: "", unterschrift: "" }), ABSAGE);
zusage("B2 GEGENPROBE: bei gueltiger E-Mail kommt die Unterschrift-Absage",
  lauf({ ...basis, unterschrift: "" }), "Bitte unterschreiben Sie im Feld unten.");

console.log("\nC  Die uebrigen Pruefungen sind unveraendert");
zusage("C1 Minderjaehriger ohne Unterschrift des Vertreters",
  lauf({ ...basis, unterschrift_gesetzl: "" }, { minder: true }),
  "Bei Minderjährigen wird auch die Unterschrift des gesetzlichen Vertreters gebraucht.");
zusage("C2 kaputte IBAN",
  lauf({ ...basis, iban: "DE00100500000054540402" }),
  "Die IBAN stimmt nicht. Bitte prüfen Sie sie noch einmal.");

console.log("\nD  Client und Server ziehen dieselbe Grenze");
// ⚠️ Laesst der Client MEHR durch als der Server, wandert die Absage
// zurueck ans Ende des Bogens -- genau der Zustand, der behoben wurde.
const mClient = quelle.match(/const EMAIL_MUSTER_CLIENT = (\/.*\/);/)[1];
const mServer = workerQuelle.match(/const EMAIL_MUSTER = (\/.*\/);/)[1];
zusage("D1 beide Muster sind zeichengleich", mClient, mServer);

const rClient = new RegExp(mClient.slice(1, -1));
const rServer = new RegExp(mServer.slice(1, -1));
const proben = ["a@b.de", "a@b", "a b@c.de", "@b.de", "a@.de", "a@b.c", "a@b.deutschland", ""];
zusage("D2 acht Adressen, gleiches Urteil auf beiden Seiten",
  proben.filter((p) => rClient.test(p) === rServer.test(p)).length, proben.length);
// GEGENPROBE zur Gegenprobe: D2 waere auch gruen, wenn beide Muster alles
// durchliessen. Durch kommen genau "a@b.de" und "a@b.deutschland" --
// "a@b.c" nicht, die Endung braucht mindestens zwei Buchstaben.
zusage("D3 GEGENPROBE: nicht alles kommt durch",
  proben.filter((p) => rClient.test(p)).length, 2);

console.log("\n" + "─".repeat(60));
console.log(rot === 0 ? "ALLE PRUEFUNGEN GRUEN" : `${rot} PRUEFUNG(EN) ROT`);
process.exit(rot === 0 ? 0 : 1);
