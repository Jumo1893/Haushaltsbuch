const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadProfiles } = require("../import/profiles");
const { analyzeFile, countStatuses, buildPreview, markDuplicates } = require("../import/analyze");
const {
  PAYPAL_TRANSFER_TYPES,
  PAYPAL_CREDITOR_ID,
  pairTransfers,
  linkTransfers,
  linkedAccounts,
  previewLinks,
  isOtherSide,
  unlink,
} = require("../paypal");
const { TRANSFER } = require("../stats");

const paypal = loadProfiles(path.join(__dirname, "..", "import-profiles")).get("paypal");
const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "paypal.csv"));
const byLine = (rows) => Object.fromEntries(rows.map((r) => [r.line, r]));

test("PayPal: Beispieldatei wird vollständig gelesen, die Spaltenüberschrift trotz BOM erkannt", () => {
  const rows = analyzeFile(fixture, paypal);
  assert.deepEqual(countStatuses(rows), { total: 18, new: 12, duplicate: 0, depot: 0, skipped: 5, invalid: 1 });
  assert.deepEqual(buildPreview(rows).skipped, [
    { reason: "Ohne Auswirkung auf das Guthaben, z. B. eine Autorisierung", count: 1 },
    { reason: "Einbehaltung, die PayPal mit der Zahlung wieder freigibt", count: 2 },
    { reason: "In Fremdwährung, in Euro zählt die Währungsumrechnung", count: 2 },
  ]);
  assert.match(byLine(rows)[19].reason, /Ungültiges Datum „32\.05\.2026“/);
});

test("PayPal: Zahlung aus dem Guthaben ist eine Ausgabe mit Händler und Artikel", () => {
  const { record } = byLine(analyzeFile(fixture, paypal))[2];
  assert.equal(record.date, "2026-05-02");
  assert.equal(record.cents, -999);
  assert.equal(record.counterparty, "Musterstream AG");
  assert.equal(record.purpose, "Musterstream Abo");
  assert.deepEqual(record.details, {
    transactionId: "0PP00000000000001",
    referenceId: "B-0BA00000000000001",
    bookingText: "Zahlung im Einzugsverfahren mit Zahlungsrechnung",
  });
});

test("PayPal: Bankgutschrift bekommt den Händler der Zahlung, für die sie ist, und gilt als Umbuchung", () => {
  const lines = byLine(analyzeFile(fixture, paypal));
  // Das Guthaben deckte 20,01 €, den Rest holte PayPal vom Bankkonto
  assert.equal(lines[3].record.cents, -4500);
  assert.equal(lines[4].record.cents, 2499);
  assert.equal(lines[4].record.counterparty, "Beispiel Shop GmbH");
  assert.equal(lines[4].record.details.bookingText, "Bankgutschrift auf PayPal-Konto", "ohne Leerzeichen am Ende");
  assert.ok(PAYPAL_TRANSFER_TYPES.includes(lines[4].record.details.bookingText));
  assert.match(TRANSFER, /'Bankgutschrift auf PayPal-Konto'/);
});

test("PayPal: Einbehaltung und Autorisierung zählen nicht, nur die Zahlung danach", () => {
  const lines = byLine(analyzeFile(fixture, paypal));
  assert.deepEqual([6, 7, 8].map((n) => lines[n].status), ["skipped", "skipped", "skipped"]);
  assert.equal(lines[9].record.cents, -12000);
  assert.equal(lines[10].record.cents, 10500);
  assert.equal(lines[10].record.counterparty, "Hotel Seeblick");
});

test("PayPal: Fremdwährung zählt mit der Umrechnung in Euro, mit dem Händler aus der ausgelassenen Zeile", () => {
  const lines = byLine(analyzeFile(fixture, paypal));
  assert.equal(lines[11].status, "skipped");
  assert.equal(lines[12].status, "skipped");
  assert.equal(lines[13].record.cents, -925);
  assert.equal(lines[13].record.counterparty, "Example Games Inc.");
  assert.equal(lines[13].record.purpose, "Spielwährung");
  assert.equal(lines[14].record.counterparty, "Example Games Inc.");
});

test("PayPal: Rückzahlung, Handyzahlung mit Hinweis, Auszahlung mit Gebühr", () => {
  const lines = byLine(analyzeFile(fixture, paypal));
  assert.equal(lines[15].record.cents, 4500);
  assert.equal(lines[5].record.purpose, "Pizza");
  assert.equal(lines[16].record.cents, -4040, "die Gebühr steckt im Betrag");
  assert.equal(lines[16].record.details.fee, -0.4);
  assert.equal(lines[16].record.counterparty, "", "Auszahlungen haben keine Gegenpartei");
  assert.equal(lines[16].record.purpose, "Von Nutzer eingeleitete Abbuchung");
});

test("PayPal: Duplikate über Transaktionscode und Art, auch wenn sich ein Code zwei Zeilen teilt", () => {
  const rows = analyzeFile(fixture, paypal);
  const lines = byLine(rows);
  assert.equal(lines[17].record.details.transactionId, lines[18].record.details.transactionId);
  assert.notEqual(lines[17].record.hash, lines[18].record.hash);
  const hashes = rows.filter((r) => r.record).map((r) => r.record.hash);
  assert.equal(new Set(hashes).size, hashes.length);

  // Ein späterer Export mit geändertem Status, Guthaben und Text erkennt dieselben Umsätze wieder
  const later = Buffer.from(
    fixture.toString("utf8").replace(/"Ausstehend"/g, '"Abgeschlossen"').replace("Bestellung 4711", "Bestellung 4711 (2 Artikel)"),
  );
  const again = analyzeFile(later, paypal);
  markDuplicates(again, new Map(hashes.map((h) => [h, 1])));
  assert.equal(countStatuses(again).new, 0);
  assert.equal(countStatuses(again).duplicate, 12);
});

// Zuordnung von Geldbewegungen bei PayPal zu Buchungen anderer Konten

const pp = (id, date, cents, type = "Bankgutschrift auf PayPal-Konto", counterparty = "Beispiel Shop GmbH") => ({
  id,
  accountId: 9,
  date,
  cents,
  type,
  counterparty,
});
const bank = (id, date, cents, purpose = "", accountId = 1) => ({ id, accountId, date, cents, purpose });
const ids = (pairs) => pairs.map(({ paypal: p, other: o }) => [p.id, o.id]);

test("Paare: gleicher Betrag in Gegenrichtung, Lastschrift bis zu 7 Tage später oder 3 Tage früher", () => {
  const paypalSide = [pp(1, "2026-05-03", 2499)];
  const at = (date, cents = -2499) => ids(pairTransfers(paypalSide, [bank(100, date, cents)]));
  assert.deepEqual(at("2026-05-05"), [[1, 100]]);
  assert.deepEqual(at("2026-05-10"), [[1, 100]], "7 Tage später");
  assert.deepEqual(at("2026-04-30"), [[1, 100]], "3 Tage früher");
  assert.deepEqual(at("2026-05-11"), [], "8 Tage später");
  assert.deepEqual(at("2026-04-29"), [], "4 Tage früher");
  assert.deepEqual(at("2026-05-05", -2498), [], "anderer Betrag");
  assert.deepEqual(at("2026-05-05", 2499), [], "gleiche Richtung");
});

test("Paare: Auszahlung ohne Gebühr, nur mit anderen Konten, jede Buchung höchstens einmal", () => {
  const withdrawal = { ...pp(1, "2026-05-13", -4000, "Von Nutzer eingeleitete Abbuchung", ""), cents: -4000 };
  assert.deepEqual(ids(pairTransfers([withdrawal], [bank(100, "2026-05-14", 4000)])), [[1, 100]]);
  assert.deepEqual(ids(pairTransfers([pp(1, "2026-05-03", 2499)], [bank(100, "2026-05-04", -2499, "", 9)])), [], "eigenes Konto");
  const two = pairTransfers([pp(1, "2026-05-03", 2499), pp(2, "2026-05-03", 2499)], [bank(100, "2026-05-05", -2499)]);
  assert.equal(two.length, 1);
});

test("Paare: Händler im Verwendungszweck geht vor, dann Lastschrift nach PayPal, dann der kleinste Abstand", () => {
  const shop = pp(1, "2026-05-03", 999, undefined, "Beispiel Shop GmbH");
  const stream = pp(2, "2026-05-03", 999, undefined, "Musterstream AG");
  const purpose = (name) => `1234567890123/PP.1234.PP/. ${name}, Ihr Einkauf bei ${name}`;
  // Die Lastschrift für den Shop kommt zuerst, nach dem Abstand allein bekäme sie der Stream
  const pairs = pairTransfers([stream, shop], [bank(100, "2026-05-04", -999, purpose("Beispiel Shop GmbH")), bank(101, "2026-05-06", -999, purpose("Musterstream AG"))]);
  assert.deepEqual(ids(pairs).sort(), [[1, 100], [2, 101]]);

  const early = bank(100, "2026-05-02", -999);
  const late = bank(101, "2026-05-05", -999);
  assert.deepEqual(ids(pairTransfers([pp(1, "2026-05-03", 999, undefined, "")], [early, late])), [[1, 101]], "nicht vor PayPal");
  assert.deepEqual(ids(pairTransfers([pp(1, "2026-05-03", 999, undefined, "")], [bank(100, "2026-05-07", -999), late])), [[1, 101]]);
});

test("Paare: Händlername zählt nur als ganzes Wort", () => {
  const apple = pp(1, "2026-05-03", 999, undefined, "Apple");
  const pairs = pairTransfers([apple, pp(2, "2026-05-03", 999, undefined, "")], [
    bank(100, "2026-05-04", -999, "Ihr Einkauf bei Pineapple Store"),
    bank(101, "2026-05-05", -999, "Ihr Einkauf bei Apple"),
  ]);
  assert.deepEqual(ids(pairs).sort(), [[1, 101], [2, 100]]);
});

test("Paare: Rückzahlung eines PayPal-Kredits darf bis zu 45 Tage später kommen", () => {
  const credit = pp(1, "2026-05-03", 12000, "Zahlung per PayPal-Käuferkredit", "Hotel Seeblick");
  assert.deepEqual(ids(pairTransfers([credit], [bank(100, "2026-06-02", -12000)])), [[1, 100]]);
  assert.deepEqual(ids(pairTransfers([credit], [bank(100, "2026-06-18", -12000)])), []);
  assert.deepEqual(ids(pairTransfers([credit], [bank(100, "2026-05-01", -12000)])), [], "nicht vorher");
});

test("Andere Seite: Gegenpartei PayPal oder Gläubiger-ID von PayPal, keine Wertpapiere und keine PayPal-Zeilen", () => {
  const record = (counterparty, details = {}) => ({ counterparty, details });
  assert.equal(isOtherSide(record("PayPal Europe S.a.r.l. et Cie S.C.A", { bookingText: "FOLGELASTSCHRIFT" })), true);
  assert.equal(isOtherSide(record("PAYPAL *SHOP")), true);
  assert.equal(isOtherSide(record("Lastschrift", { creditorId: PAYPAL_CREDITOR_ID })), true);
  assert.equal(isOtherSide(record("PayPal", { bookingText: "BUY" })), false, "Kauf von PayPal-Aktien");
  assert.equal(isOtherSide(record("PayPal", { bookingText: "Bankgutschrift auf PayPal-Konto" })), false);
  assert.equal(isOtherSide(record("Supermarkt Müller")), false);
});

/** Datenbank zum Mitschreiben wie in rules.test.js: Die erste Antwort, deren Muster passt, gilt. */
function fakeDb(answers) {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      const answer = answers.find(([pattern]) => pattern.test(sql));
      if (!answer) throw new Error(`unerwartete Abfrage: ${sql}`);
      return typeof answer[1] === "function" ? answer[1](params) : answer[1];
    },
  };
}

const ACCOUNTS = [/FROM accounts WHERE id = ANY/, (params) => ({ rows: params[0].map((id) => ({ id, name: `Konto ${id}` })) })];

test("Verbinden: beide Buchungen zeigen aufeinander, nur offene Buchungen zählen", async () => {
  const db = fakeDb([
    [/t\.purpose FROM transactions/, { rows: [{ id: 100, accountId: 1, importId: 3, date: "2026-05-05", cents: "-2499", purpose: "" }] }],
    [/AS type, t\.counterparty/, { rows: [{ id: 7, accountId: 9, importId: 4, date: "2026-05-03", cents: "2499", type: "Bankgutschrift auf PayPal-Konto", counterparty: "" }] }],
    [/^UPDATE transactions/, { rowCount: 2 }],
  ]);
  const pairs = await linkTransfers(db);
  assert.deepEqual(ids(pairs), [[7, 100]]);
  const [paypalQuery, othersQuery, update] = db.queries;
  assert.match(paypalQuery.sql, /t\.linked_id IS NULL AND t\.transfer_override IS NOT FALSE/, "nicht von Hand abgelehnt");
  assert.match(othersQuery.sql, /t\.counterparty ILIKE '%paypal%'/);
  assert.deepEqual(othersQuery.params, ["2026-05-03", "2026-05-03", -3, 45], "nur im möglichen Zeitraum");
  assert.deepEqual(update.params, [[7, 100], [100, 7], "Sonstiges"]);
  assert.match(update.sql, /WHEN t\.category_manual OR t\.rule_id IS NOT NULL THEN t\.category ELSE \$3/, "automatische Kategorie zurück");
});

test("Verbinden: ohne Geldbewegungen bei PayPal keine weitere Abfrage", async () => {
  const db = fakeDb([[/AS type, t\.counterparty/, { rows: [] }]]);
  assert.deepEqual(await linkTransfers(db), []);
  assert.equal(db.queries.length, 1);
});

test("Zusammenfassung: Konten der Gegenbuchungen, nur für Paare mit Buchungen dieses Imports", async () => {
  const side = (id, accountId, importId) => ({ id, accountId, importId });
  const pairs = [
    { paypal: side(1, 9, 5), other: side(100, 1, 2) },
    { paypal: side(2, 9, 5), other: side(101, 1, 2) },
    { paypal: side(3, 9, 5), other: side(102, 3, 1) },
    { paypal: side(4, 9, 4), other: side(103, 1, 2) }, // älteres Paar, gehört nicht zu diesem Import
  ];
  const db = fakeDb([ACCOUNTS]);
  assert.deepEqual(await linkedAccounts(db, pairs, 5), [
    { id: 1, name: "Konto 1", count: 2 },
    { id: 3, name: "Konto 3", count: 1 },
  ]);
  assert.deepEqual(await linkedAccounts(fakeDb([]), pairs, 6), [], "ohne Paare keine Abfrage");
});

test("Vorschau: zählt, mit welchen Buchungen anderer Konten neue Umsätze der Datei verbunden würden", async () => {
  const rows = analyzeFile(fixture, paypal);
  const db = fakeDb([
    [/t\.purpose FROM transactions/, {
      rows: [
        { id: 100, accountId: 1, importId: 2, date: "2026-05-05", cents: "-2499", purpose: "Ihr Einkauf bei Beispiel Shop GmbH" },
        { id: 101, accountId: 1, importId: 2, date: "2026-05-11", cents: "-10500", purpose: "" },
        { id: 102, accountId: 3, importId: 1, date: "2026-05-14", cents: "4000", purpose: "" },
      ],
    }],
    [/AS type, t\.counterparty/, { rows: [] }],
    ACCOUNTS,
  ]);
  assert.deepEqual(await previewLinks(db, rows, () => null), [
    { id: 1, name: "Konto 1", count: 2 },
    { id: 3, name: "Konto 3", count: 1 },
  ]);

  // Duplikate sind schon gespeichert und zählen nicht noch einmal
  markDuplicates(rows, new Map(rows.filter((r) => r.record).map((r) => [r.record.hash, 1])));
  assert.deepEqual(await previewLinks(fakeDb([]), rows, () => null), []);
});

test("Vorschau: eine Lastschrift aus der Bankdatei passt zur gespeicherten Bankgutschrift bei PayPal", async () => {
  const record = { date: "2026-05-05", cents: -2499, counterparty: "PayPal Europe S.a.r.l. et Cie S.C.A", purpose: "", details: { bookingText: "FOLGELASTSCHRIFT" } };
  const rows = [{ status: "new", record }, { status: "new", record: { ...record, counterparty: "Supermarkt" } }];
  const db = fakeDb([
    [/t\.purpose FROM transactions/, { rows: [] }],
    [/AS type, t\.counterparty/, { rows: [{ id: 7, accountId: 9, importId: 4, date: "2026-05-03", cents: "2499", type: "Bankgutschrift auf PayPal-Konto", counterparty: "" }] }],
    ACCOUNTS,
  ]);
  assert.deepEqual(await previewLinks(db, rows, () => 1), [{ id: 9, name: "Konto 9", count: 1 }]);
});

test("Lösen: beide Seiten verlieren die Verbindung, geliefert werden die Gegenbuchungen", async () => {
  const db = fakeDb([[/^UPDATE transactions SET linked_id = NULL/, { rows: [{ id: 7 }, { id: 100 }] }]]);
  assert.deepEqual(await unlink(db, [7]), [100]);
  assert.deepEqual(db.queries[0].params, [[7]]);
});

test("Umbuchung: Eine verbundene Buchung ist eine Umbuchung, außer von Hand anders festgelegt", () => {
  assert.match(TRANSFER, /^COALESCE\(t\.transfer_override, t\.linked_id IS NOT NULL OR /);
});
