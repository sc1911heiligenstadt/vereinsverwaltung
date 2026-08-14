// Pruefstand fuer die Angleichung an das Papier-Formular (2026-08-06).
//
// Faehrt den ECHTEN Worker-Code gegen das ECHTE Schema: node:sqlite mit
// einem duennen D1-Aufsatz, schema-kompakt.sql eingespielt. Der Code wird
// aus der Datei gezogen (bis "export default" abgeschnitten, ueber
// new Function geladen) -- nicht nachgebaut. Muster wie test-antrag.js.

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// Relativ zur Datei: der Pruefstand liegt im Repo und soll auch dann
// laufen, wenn das Laufwerk anders heisst.
const REPO = new URL(".", import.meta.url).pathname.replace(/^\//, "");

let ok = 0, fehler = 0;
const fehlerListe = [];
function pruefe(name, bedingung, zusatz) {
  if (bedingung) { ok++; return; }
  fehler++;
  fehlerListe.push(name + (zusatz ? "  → " + zusatz : ""));
}

// --- D1-Aufsatz -------------------------------------------------------

function d1(db) {
  const lauf = { abfragen: 0 };
  return {
    lauf,
    prepare(sql) {
      const self = {
        _sql: sql, _werte: [],
        bind(...w) { const k = Object.create(self); k._werte = w; return k; },
        first() {
          lauf.abfragen++;
          const s = db.prepare(this._sql);
          const r = s.get(...this._werte);
          return r === undefined ? null : r;
        },
        all() {
          lauf.abfragen++;
          return { results: db.prepare(this._sql).all(...this._werte) };
        },
        run() {
          lauf.abfragen++;
          db.prepare(this._sql).run(...this._werte);
          return { success: true };
        }
      };
      return self;
    },
    async batch(liste) {
      lauf.abfragen++;
      const out = [];
      for (const a of liste) out.push(a.run());
      return out;
    }
  };
}

// --- Worker-Code laden ------------------------------------------------

const roh = readFileSync(REPO + "/vereinsverwaltung-worker.js", "utf8");
const schnitt = roh.indexOf("export default");
if (schnitt < 0) throw new Error("export default nicht gefunden");
const quelle = roh.slice(0, schnitt);

const namen = ["pruefeAntrag", "handleMigration", "handleAntragSenden",
               "handleAntragAnnehmen", "anweisungenFuerAnnahme", "alterAm",
               "hatGesetzl2Spalte", "pruefeMitgliedssatz", "PERSON_FELDER"];
const W = new Function(quelle + "\nreturn {" + namen.join(",") + "};")();

// --- Datenbank aufsetzen ----------------------------------------------

const db = new DatabaseSync(":memory:");
const schema = readFileSync(REPO + "/schema-kompakt.sql", "utf8");
for (const anw of schema.split(";").map((s) => s.trim()).filter(Boolean)) {
  db.exec(anw + ";");
}
const env = { VV_DB: d1(db) };

// Die Migration soll auf einer Datenbank OHNE die neuen Spalten laufen --
// genau der Live-Zustand. schema-kompakt.sql hat sie inzwischen, also
// bauen wir den Altstand her.
db.exec("ALTER TABLE person DROP COLUMN geburtsort");
db.exec("ALTER TABLE sepa_mandat DROP COLUMN bank_name");
db.exec("ALTER TABLE sepa_mandat DROP COLUMN kontoinhaber_anschrift");
db.exec("ALTER TABLE sepa_mandat DROP COLUMN erteilt_ort");
db.exec("ALTER TABLE aufnahmeantrag DROP COLUMN unterschrift_gesetzl2_datei");

const me = { username: "pruefer", isAdmin: true, canEdit: true, canAdmin: true };
const cors = {};
const spalten = (t) => new Set(db.prepare("PRAGMA table_info(" + t + ")").all().map((s) => s.name));

// ======================================================================
console.log("A  Migration");
// ======================================================================

pruefe("A1 Altstand: person.geburtsort fehlt", !spalten("person").has("geburtsort"));
pruefe("A2 Altstand: aufnahmeantrag ohne zweite Unterschrift",
       !spalten("aufnahmeantrag").has("unterschrift_gesetzl2_datei"));

const mig1 = await W.handleMigration(env, me, cors);
pruefe("A3 Migration antwortet 200", mig1.status === 200, "status " + mig1.status);

pruefe("A4 person.geburtsort ist da", spalten("person").has("geburtsort"));
pruefe("A5 sepa_mandat.bank_name ist da", spalten("sepa_mandat").has("bank_name"));
pruefe("A6 sepa_mandat.kontoinhaber_anschrift ist da",
       spalten("sepa_mandat").has("kontoinhaber_anschrift"));
pruefe("A7 sepa_mandat.erteilt_ort ist da", spalten("sepa_mandat").has("erteilt_ort"));
pruefe("A8 aufnahmeantrag.unterschrift_gesetzl2_datei ist da",
       spalten("aufnahmeantrag").has("unterschrift_gesetzl2_datei"));

// Zweiter Lauf muss folgenlos sein -- sonst wirft ADD COLUMN beim
// naechsten Seitenaufruf.
const mig2 = await W.handleMigration(env, me, cors);
pruefe("A9 Zweiter Lauf ist folgenlos", mig2.status === 200, "status " + mig2.status);
const mig2b = await mig2.json();
pruefe("A10 Zweiter Lauf ergaenzt nichts mehr", mig2b.ergaenzt === 0,
       "ergaenzt " + mig2b.ergaenzt);

// ======================================================================
console.log("B  pruefeAntrag — neue Felder");
// ======================================================================

const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const HEUTE = "2026-08-06";
const sparten = new Set(["sp-1", "sp-2"]);

function antrag(mehr) {
  return Object.assign({
    vorname: "Erika", nachname: "Mustermann", geburtsdatum: "1985-03-12",
    strasse: "Musterweg 1", plz: "37308", ort: "Heilbad Heiligenstadt",
    email: "erika@example.invalid", art: "ordentlich",
    zahlungsart: "lastschrift", iban: "DE02100500000054540402",
    kontoinhaber: "Erika Mustermann",
    einwilligung_satzung: true, einwilligung_datenschutz: true,
    unterschrift: SIG, sparten: []
  }, mehr || {});
}

const b1 = W.pruefeAntrag(antrag({
  geburtsort: "Erfurt", bank_name: "VR-Bank Mitte", bic: "GENODEF1ESW",
  kontoinhaber_anschrift: "Anderer Weg 9, 37308 Heilbad Heiligenstadt",
  unterschrift_ort: "Erfurt"
}), sparten, HEUTE);
pruefe("B1 Antrag mit neuen Feldern geht durch", !b1.fehler, b1.fehler);
pruefe("B2 Geburtsort uebernommen", b1.satz && b1.satz.inhalt.geburtsort === "Erfurt");
pruefe("B3 Kreditinstitut uebernommen", b1.satz && b1.satz.inhalt.bank_name === "VR-Bank Mitte");
pruefe("B4 Abweichende Anschrift uebernommen",
       b1.satz && /Anderer Weg 9/.test(b1.satz.inhalt.kontoinhaber_anschrift));
pruefe("B5 Ort der Unterschrift uebernommen",
       b1.satz && b1.satz.inhalt.unterschrift_ort === "Erfurt");

// Ohne Ortsangabe faellt es auf den Wohnort zurueck, statt leer zu bleiben.
const b2 = W.pruefeAntrag(antrag({ unterschrift_ort: "" }), sparten, HEUTE);
pruefe("B6 Ort faellt auf den Wohnort zurueck",
       b2.satz && b2.satz.inhalt.unterschrift_ort === "Heilbad Heiligenstadt",
       b2.satz && b2.satz.inhalt.unterschrift_ort);

// Seit 14.08.2026 nimmt der Verein NEUE Antraege nur noch per Lastschrift
// an. Die Zahlungsart gehoert damit zur Weissliste: sie wird gesetzt, nicht
// entgegengenommen. Frueher stand hier die Gegenprobe -- Ueberweisung geht
// ohne IBAN durch. Genau die darf jetzt nicht mehr aufgehen.
const b3 = W.pruefeAntrag(antrag({
  zahlungsart: "ueberweisung", iban: "", kontoinhaber: "",
  bank_name: "VR-Bank Mitte", kontoinhaber_anschrift: "Anderer Weg 9"
}), sparten, HEUTE);
pruefe("B7 Ein mitgeschicktes 'ueberweisung' kommt ohne IBAN NICHT mehr durch",
       !!b3.fehler && /IBAN/.test(b3.fehler), b3.fehler);

// ... und mit IBAN wird daraus eine Lastschrift, keine Ueberweisung. Ohne
// diese Zeile waere B7 auch dann gruen, wenn der Server das Feld weiterhin
// vom Client uebernaehme und nur die IBAN-Pflicht vorgezogen worden waere.
const b3b = W.pruefeAntrag(antrag({
  zahlungsart: "ueberweisung",
  bank_name: "VR-Bank Mitte", kontoinhaber_anschrift: "Anderer Weg 9"
}), sparten, HEUTE);
pruefe("B8 Ein mitgeschicktes 'ueberweisung' wird als Lastschrift gespeichert",
       b3b.satz && b3b.satz.inhalt.zahlungsart === "lastschrift",
       b3b.fehler || (b3b.satz && b3b.satz.inhalt.zahlungsart));
pruefe("B9 Kreditinstitut und Kontoinhaber-Anschrift bleiben dabei erhalten",
       b3b.satz && b3b.satz.inhalt.bank_name === "VR-Bank Mitte" &&
       /Anderer Weg 9/.test(b3b.satz.inhalt.kontoinhaber_anschrift || ""));

// Weissliste: der Server baut den Satz selbst.
const b4 = W.pruefeAntrag(antrag({
  status: "angenommen", person_id: "fremd", id: "fremd", eingang_am: "1999-01-01",
  minderjaehrig: true, allein_sorgeberechtigt: true
}), sparten, HEUTE);
pruefe("B10 Fremdes status wird nicht uebernommen", b4.satz && b4.satz.inhalt.status === undefined);
pruefe("B11 Fremdes person_id wird nicht uebernommen", b4.satz && b4.satz.inhalt.person_id === undefined);
pruefe("B12 minderjaehrig kommt aus dem Geburtsdatum, nicht aus dem Body",
       b4.satz && b4.satz.inhalt.minderjaehrig === false);
pruefe("B13 allein_sorgeberechtigt gilt nur bei Minderjaehrigen",
       b4.satz && b4.satz.inhalt.allein_sorgeberechtigt === false);

// Laenge wird gekappt, nicht abgelehnt.
const b5 = W.pruefeAntrag(antrag({ geburtsort: "x".repeat(300) }), sparten, HEUTE);
pruefe("B14 Zu langer Geburtsort wird gekappt",
       b5.satz && b5.satz.inhalt.geburtsort.length === 80,
       b5.satz && String(b5.satz.inhalt.geburtsort.length));

// ======================================================================
console.log("C  Zweiter Erziehungsberechtigter");
// ======================================================================

const KIND = { geburtsdatum: "2015-06-01", gesetzl_name: "Erika Mustermann",
               unterschrift_gesetzl: SIG };

const c1 = W.pruefeAntrag(antrag(KIND), sparten, HEUTE);
pruefe("C1 Minderjaehrig ohne zweiten Vertreter wird abgewiesen", !!c1.fehler);
pruefe("C2 Der Fehlersatz nennt den Ausweg", c1.fehler && /allein sorgeberechtigt/.test(c1.fehler),
       c1.fehler);

const c2 = W.pruefeAntrag(antrag(Object.assign({}, KIND, {
  gesetzl2_name: "Max Mustermann" })), sparten, HEUTE);
pruefe("C3 Zweiter Name ohne Unterschrift wird abgewiesen", !!c2.fehler, c2.fehler);

const c3 = W.pruefeAntrag(antrag(Object.assign({}, KIND, {
  gesetzl2_name: "Max Mustermann", gesetzl2_verhaeltnis: "Vater",
  unterschrift_gesetzl2: SIG })), sparten, HEUTE);
pruefe("C4 Mit beiden Unterschriften geht es durch", !c3.fehler, c3.fehler);
pruefe("C5 Zweite Unterschrift steht im Satz", c3.satz && c3.satz.unterschrift_gesetzl2 === SIG);
pruefe("C6 Zweiter Name steht im Inhalt", c3.satz && c3.satz.inhalt.gesetzl2_name === "Max Mustermann");
pruefe("C7 Verhaeltnis des Zweiten steht im Inhalt",
       c3.satz && c3.satz.inhalt.gesetzl2_verhaeltnis === "Vater");
pruefe("C8 allein_sorgeberechtigt ist dann falsch",
       c3.satz && c3.satz.inhalt.allein_sorgeberechtigt === false);

const c4 = W.pruefeAntrag(antrag(Object.assign({}, KIND, {
  allein_sorgeberechtigt: true })), sparten, HEUTE);
pruefe("C9 Alleiniges Sorgerecht ist der Ausweg", !c4.fehler, c4.fehler);
pruefe("C10 Die Erklaerung wird festgehalten",
       c4.satz && c4.satz.inhalt.allein_sorgeberechtigt === true);
pruefe("C11 Dann keine zweite Unterschrift", c4.satz && c4.satz.unterschrift_gesetzl2 === null);

// Ein untergeschobenes Bild darf nicht als zweite Unterschrift durchgehen,
// wenn alleiniges Sorgerecht erklaert wurde.
const c5 = W.pruefeAntrag(antrag(Object.assign({}, KIND, {
  allein_sorgeberechtigt: true, gesetzl2_name: "Max Mustermann",
  unterschrift_gesetzl2: SIG })), sparten, HEUTE);
pruefe("C12 Bei alleinigem Sorgerecht wird ein zweiter Name ignoriert",
       c5.satz && c5.satz.inhalt.gesetzl2_name === null, c5.satz && c5.satz.inhalt.gesetzl2_name);
pruefe("C13 Bei alleinigem Sorgerecht wird eine zweite Unterschrift ignoriert",
       c5.satz && c5.satz.unterschrift_gesetzl2 === null);

// Ein kaputtes Bild darf nicht als "fehlt" durchgehen.
const c6 = W.pruefeAntrag(antrag(Object.assign({}, KIND, {
  gesetzl2_name: "Max Mustermann", unterschrift_gesetzl2: "kein-bild" })), sparten, HEUTE);
pruefe("C14 Unerwartetes Format der zweiten Unterschrift faellt auf",
       c6.fehler && /Format/.test(c6.fehler), c6.fehler);

// Genau 18 ist volljaehrig.
const c7 = W.pruefeAntrag(antrag({ geburtsdatum: "2008-08-06" }), sparten, HEUTE);
pruefe("C15 Am 18. Geburtstag ist niemand mehr minderjaehrig", !c7.fehler, c7.fehler);
const c8 = W.pruefeAntrag(antrag({ geburtsdatum: "2008-08-07" }), sparten, HEUTE);
pruefe("C16 Einen Tag davor schon", !!c8.fehler);

// ======================================================================
console.log("D  Absenden und Annehmen gegen die echte Datenbank");
// ======================================================================

const anfrage = {
  headers: { get: (n) => (n === "CF-Connecting-IP" ? "203.0.113.7" : "Pruefstand/1.0") }
};

db.prepare("INSERT INTO einstellung (schluessel, wert) VALUES ('antrag_offen','1')").run();
db.prepare("INSERT INTO sparte (id, name, aktiv, sortierung, erstellt_am, erstellt_von) " +
           "VALUES ('sp-1','Fussball',1,10,'2026-01-01','pruefer')").run();

const senden = await W.handleAntragSenden(antrag({
  geburtsort: "Erfurt", bank_name: "VR-Bank Mitte",
  kontoinhaber_anschrift: "Anderer Weg 9, 37308 Heilbad Heiligenstadt",
  unterschrift_ort: "Erfurt", sparten: ["sp-1"]
}), env, anfrage, cors);
pruefe("D1 Antrag wird angenommen", senden.status === 200, "status " + senden.status);
const gesendet = await senden.json();

const zeile = db.prepare("SELECT * FROM aufnahmeantrag WHERE id = ?").get(gesendet.id);
const gespeichert = JSON.parse(zeile.antrag_json);
pruefe("D2 Geburtsort steht in der Datenbank", gespeichert.geburtsort === "Erfurt");
pruefe("D3 Kreditinstitut steht in der Datenbank", gespeichert.bank_name === "VR-Bank Mitte");
pruefe("D4 Ort der Unterschrift steht in der Datenbank", gespeichert.unterschrift_ort === "Erfurt");

// Minderjaehriger mit zwei Unterschriften -- die zweite muss in ihrer
// eigenen Spalte landen, nicht nur im JSON.
const senden2 = await W.handleAntragSenden(antrag(Object.assign({}, KIND, {
  vorname: "Lena", geburtsort: "Göttingen", gesetzl2_name: "Max Mustermann",
  unterschrift_gesetzl2: SIG, sparten: ["sp-1"] })), env, anfrage, cors);
pruefe("D5 Antrag eines Minderjaehrigen geht durch", senden2.status === 200,
       "status " + senden2.status);
const gesendet2 = await senden2.json();
const zeile2 = db.prepare("SELECT * FROM aufnahmeantrag WHERE id = ?").get(gesendet2.id);
pruefe("D6 Zweite Unterschrift liegt in ihrer eigenen Spalte",
       zeile2.unterschrift_gesetzl2_datei === SIG);

// Annahme: geburtsort in person, Mandatsfelder im Mandat.
db.prepare("INSERT INTO beitragsklasse (id, name, aktiv, sortierung, erstellt_am, erstellt_von) " +
           "VALUES ('bk-1','Erwachsener',1,10,'2026-01-01','pruefer')").run();

const annahme = await W.handleAntragAnnehmen({
  id: gesendet.id, beschluss_am: "2026-08-01", eintritt: "2026-08-01",
  mitgliedsnummer: "9001", beitragsklasse_id: "bk-1", sparte_ids: ["sp-1"]
}, env, me, cors);
pruefe("D7 Annahme antwortet 200", annahme.status === 200, "status " + annahme.status);

const person = db.prepare(
  "SELECT p.* FROM person p JOIN mitgliedschaft m ON m.person_id = p.id " +
  "WHERE m.mitgliedsnummer = '9001'").get();
pruefe("D8 Geburtsort steht an der Person", person && person.geburtsort === "Erfurt",
       person && String(person.geburtsort));

const mandat = db.prepare("SELECT * FROM sepa_mandat WHERE referenz = 'M-9001'").get();
pruefe("D9 Mandat angelegt", !!mandat);
pruefe("D10 Kreditinstitut steht am Mandat", mandat && mandat.bank_name === "VR-Bank Mitte");
pruefe("D11 Abweichende Anschrift steht am Mandat",
       mandat && /Anderer Weg 9/.test(mandat.kontoinhaber_anschrift || ""));
pruefe("D12 Ort der Unterschrift steht am Mandat", mandat && mandat.erteilt_ort === "Erfurt");
pruefe("D13 Mandat traegt die Unterschrift des Antragstellers",
       mandat && mandat.unterschrift_datei === SIG);

// Der Minderjaehrige: das Mandat traegt die Unterschrift des Vertreters.
const annahme2 = await W.handleAntragAnnehmen({
  id: gesendet2.id, beschluss_am: "2026-08-01", eintritt: "2026-08-01",
  mitgliedsnummer: "9002", beitragsklasse_id: "bk-1", sparte_ids: []
}, env, me, cors);
pruefe("D14 Annahme des Minderjaehrigen antwortet 200", annahme2.status === 200,
       "status " + annahme2.status);
const person2 = db.prepare(
  "SELECT p.* FROM person p JOIN mitgliedschaft m ON m.person_id = p.id " +
  "WHERE m.mitgliedsnummer = '9002'").get();
pruefe("D15 Geburtsort des Minderjaehrigen steht an der Person",
       person2 && person2.geburtsort === "Göttingen", person2 && String(person2.geburtsort));
pruefe("D16 Der zweite Vertreter steht in der Bemerkung",
       person2 && /Zweiter Erziehungsberechtigter: Max Mustermann/.test(person2.bemerkung || ""),
       person2 && person2.bemerkung);

// ======================================================================
console.log("E  Mitglied von Hand anlegen und aendern");
// ======================================================================

pruefe("E1 geburtsort steht in der Weissliste der Personenfelder",
       W.PERSON_FELDER.includes("geburtsort"));
const e1 = W.pruefeMitgliedssatz({ vorname: "Hans", nachname: "Beispiel",
                                   geburtsort: "Kassel", eintritt: "2026-01-01" });
pruefe("E2 Neuanlage nimmt den Geburtsort auf", e1.satz && e1.satz.geburtsort === "Kassel",
       e1.fehler);

// ======================================================================
console.log("F  Rueckfall: Worker deployt, Migration noch nicht gelaufen");
// ======================================================================
//
// Das Fenster zwischen Worker-Deploy und der ersten Anmeldung eines
// Berechtigten. Der oeffentliche Endpunkt kann die Migration nicht
// anstossen -- er muss trotzdem funktionieren. Eigene Worker-Instanz,
// damit der Isolate-Cache in hatGesetzl2Spalte frisch ist.

const W2 = new Function(quelle + "\nreturn {" + namen.join(",") + "};")();
const db2 = new DatabaseSync(":memory:");
for (const anw of schema.split(";").map((s) => s.trim()).filter(Boolean)) db2.exec(anw + ";");
db2.exec("ALTER TABLE aufnahmeantrag DROP COLUMN unterschrift_gesetzl2_datei");
db2.prepare("INSERT INTO einstellung (schluessel, wert) VALUES ('antrag_offen','1')").run();
db2.prepare("INSERT INTO sparte (id, name, aktiv, sortierung, erstellt_am, erstellt_von) " +
            "VALUES ('sp-1','Fussball',1,10,'2026-01-01','pruefer')").run();
const env2 = { VV_DB: d1(db2) };

const f1 = await W2.handleAntragSenden(antrag({ geburtsort: "Erfurt" }), env2, anfrage, cors);
pruefe("F1 Erwachsener kommt trotz fehlender Spalte durch", f1.status === 200,
       "status " + f1.status);
const f1b = await f1.json();
const f1z = db2.prepare("SELECT * FROM aufnahmeantrag WHERE id = ?").get(f1b.id);
pruefe("F2 Sein Antrag ist vollstaendig gespeichert",
       f1z && JSON.parse(f1z.antrag_json).geburtsort === "Erfurt");
pruefe("F3 Seine Unterschrift ist da", f1z && f1z.unterschrift_datei === SIG);

const f2 = await W2.handleAntragSenden(antrag(Object.assign({}, KIND, {
  gesetzl2_name: "Max Mustermann", unterschrift_gesetzl2: SIG })), env2, anfrage, cors);
pruefe("F4 Zweite Unterschrift wird sichtbar abgewiesen statt still verworfen",
       f2.status === 503, "status " + f2.status);
const f2b = await f2.json();
pruefe("F5 Der Text nennt einen Weg", f2b.error && /Gesch/.test(f2b.error), f2b.error);
pruefe("F6 Nichts halb Gespeichertes zurueckgeblieben",
       db2.prepare("SELECT COUNT(*) AS n FROM aufnahmeantrag").get().n === 1);

// Nach der Migration laeuft derselbe Antrag durch.
await W2.handleMigration(env2, me, cors);
const f3 = await W2.handleAntragSenden(antrag(Object.assign({}, KIND, {
  gesetzl2_name: "Max Mustermann", unterschrift_gesetzl2: SIG })), env2, anfrage, cors);
pruefe("F7 Nach der Migration geht derselbe Antrag durch", f3.status === 200,
       "status " + f3.status);
const f3b = await f3.json();
pruefe("F8 Und die zweite Unterschrift ist dann gespeichert",
       db2.prepare("SELECT * FROM aufnahmeantrag WHERE id = ?")
          .get(f3b.id).unterschrift_gesetzl2_datei === SIG);

// ======================================================================
console.log("G  Papierausdruck (antrag-druck.js, von beiden Seiten benutzt)");
// ======================================================================
//
// papierAntragHtml ist reine Zeichenkette -- kein DOM, kein Fenster.
// Deshalb hier pruefbar und nicht nur im Browser. Die Datei wird von der
// Verwaltung UND vom Sicht-Reiter des oeffentlichen Formulars geladen;
// beide muessen dasselbe Blatt ergeben.

const druckQuelle = readFileSync(REPO + "/antrag-druck.js", "utf8");
const D = new Function(druckQuelle + "\nreturn { papierAntragHtml };")();

const gAntrag = {
  eingang_am: "2026-08-06T09:00:00.000Z", signatur_zeit: "2026-08-06T09:00:00.000Z",
  sparten: ["s1"], unterschrift: SIG, unterschrift_gesetzl: SIG, unterschrift_gesetzl2: SIG,
  inhalt: {
    vorname: "Lena", nachname: "Mustermann", geburtsdatum: "2015-06-01",
    geburtsort: "Göttingen", strasse: "Musterweg 1", plz: "37308",
    ort: "Heilbad Heiligenstadt", email: "lena@example.invalid",
    zahlungsart: "lastschrift", kontoinhaber: "Max Mustermann",
    kontoinhaber_anschrift: "Anderer Weg 9", bank_name: "VR-Bank Mitte",
    iban: "DE02100500000054540402", unterschrift_ort: "Heilbad Heiligenstadt",
    minderjaehrig: true, gesetzl_name: "Erika Mustermann", gesetzl2_name: "Max Mustermann",
    einwilligung_satzung: true, einwilligung_datenschutz: true, einwilligung_fotos: false
  }
};
const gSparten = [{ id: "s1", name: "Fussball" }, { id: "s2", name: "Wandern" }];
const gCfg = { verein_name: "1. SC 1911 Heiligenstadt e.V.", verein_iban: "DE62 5226",
               verein_bic: "GENODEF1ESW", glaeubiger_id: "DE71ZZZ00000406867" };

const gVerwaltung = D.papierAntragHtml({ antrag: gAntrag, sparten: gSparten,
                                         einstellungen: gCfg, mitgliedsnummer: "9001" });
const gAntragsseite = D.papierAntragHtml({ antrag: gAntrag, sparten: gSparten,
                                           einstellungen: gCfg, mitgliedsnummer: "" });

pruefe("G1 Vier Blaetter", (gVerwaltung.match(/class="blatt"/g) || []).length === 4);
pruefe("G2 Fuenf Unterschriftsbilder",
       (gVerwaltung.match(/<img src="data:image\/png/g) || []).length === 5);
pruefe("G3 Geburtsort steht drin", /Göttingen/.test(gVerwaltung));
pruefe("G4 Kreditinstitut steht drin", /VR-Bank Mitte/.test(gVerwaltung));
pruefe("G5 Abweichende Anschrift steht drin", /Anderer Weg 9/.test(gVerwaltung));
pruefe("G6 Nur die gewaehlte Abteilung, nicht alle",
       /Fussball/.test(gVerwaltung) && !/Wandern/.test(gVerwaltung));
pruefe("G7 Foto-Einwilligung als 'nein' wiedergegeben",
       /freiwillig\)<\/th><td>nein<\/td>/.test(gVerwaltung));
pruefe("G8 Satzung als 'ja' wiedergegeben", /anerkannt<\/th><td>ja<\/td>/.test(gVerwaltung));
pruefe("G9 Glaeubiger-ID in der Fusszeile", /DE71ZZZ00000406867/.test(gVerwaltung));

// Der einzige zulaessige Unterschied zwischen beiden Aufrufern.
pruefe("G10 Verwaltung druckt die Mitgliedsnummer",
       /Mitgliedsnummer: <span class="wert">9001<\/span>/.test(gVerwaltung));
pruefe("G11 Der Sicht-Reiter laesst sie leer",
       /Mitgliedsnummer: <span class="wert"><\/span>/.test(gAntragsseite));
pruefe("G12 Sonst sind beide Blaetter identisch",
       gVerwaltung.replace(">9001<", "><") === gAntragsseite,
       "Laengen " + gVerwaltung.length + " / " + gAntragsseite.length);

// Ohne Stammdaten bleibt die Fusszeile kuerzer statt falsch dazustehen.
const gOhneCfg = D.papierAntragHtml({ antrag: gAntrag, sparten: gSparten });
pruefe("G13 Ohne Stammdaten keine erfundene IBAN", !/IBAN: DE/.test(gOhneCfg));
pruefe("G14 Der Vereinsname steht trotzdem da",
       /1\. SC 1911 Heiligenstadt e\.V\./.test(gOhneCfg));

// Ueberweisung: kein Mandat, aber auch keine leere Mandatstabelle.
const gUeber = D.papierAntragHtml({
  antrag: { ...gAntrag, inhalt: { ...gAntrag.inhalt, zahlungsart: "ueberweisung" } },
  sparten: gSparten, einstellungen: gCfg });
pruefe("G15 Bei Ueberweisung steht der Hinweis statt des Mandats",
       /keine Lastschrift<\/strong>/.test(gUeber) && !/Kontoinhaber<\/th>/.test(gUeber));

// Alleiniges Sorgerecht: der Grund fuer die fehlende zweite Unterschrift
// muss auf dem Blatt stehen, nicht bloss fehlen.
const gAllein = D.papierAntragHtml({
  antrag: { ...gAntrag, unterschrift_gesetzl2: null,
            inhalt: { ...gAntrag.inhalt, gesetzl2_name: null, allein_sorgeberechtigt: true } },
  sparten: gSparten, einstellungen: gCfg });
pruefe("G16 Alleiniges Sorgerecht wird benannt", /alleiniges Sorgerecht<\/strong>/.test(gAllein));
pruefe("G17 Dann vier Unterschriftsbilder statt fuenf",
       (gAllein.match(/<img src="data:image\/png/g) || []).length === 4);

// Freitext aus dem Antrag darf das Dokument nicht zerlegen.
const gBoese = D.papierAntragHtml({
  antrag: { ...gAntrag, inhalt: { ...gAntrag.inhalt,
    vorname: '<img src=x onerror="alert(1)">', familie_hinweis: "</table><script>böse<\/script>" } },
  sparten: gSparten, einstellungen: gCfg });
// ⚠️ Nicht auf "onerror=" pruefen -- das steht als TEXT weiterhin da und
// ist genau dann harmlos, wenn das oeffnende "<" entschaerft ist. Der
// Nachweis ist deshalb: kein Tag aus den Nutzdaten, und die spitze
// Klammer kommt als &lt; an.
pruefe("G18 Freitext wird escaped",
       !/<img src=x/.test(gBoese) && /&lt;img src=x/.test(gBoese));
pruefe("G19 Kein eingeschleustes Skript", !/<script>böse/.test(gBoese));
pruefe("G20 Das eigene Druck-Skript ist noch da", /window\.print\(\)/.test(gBoese));

// ======================================================================
const summe = ok + fehler;
console.log("");
console.log("─".repeat(60));
console.log(fehler === 0
  ? "ALLE " + summe + " PRUEFUNGEN GRUEN"
  : fehler + " von " + summe + " FEHLGESCHLAGEN");
for (const f of fehlerListe) console.log("  ✗ " + f);
process.exit(fehler === 0 ? 0 : 1);
