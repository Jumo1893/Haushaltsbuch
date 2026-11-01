const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseCsv } = require("../import/csv");
const { loadProfiles } = require("../import/profiles");
const { analyzeFile, markDuplicateMovements, countStatuses, buildPreview } = require("../import/analyze");
const {
  TRADE_BOOKING_TEXTS,
  kindOf,
  portfolio,
  standAt,
  monthlyHistory,
  flowsByMonth,
  mergeRows,
  depotOf,
} = require("../depot");
const { TRANSFER } = require("../stats");

const profiles = loadProfiles(path.join(__dirname, "..", "import-profiles"));
const tr = profiles.get("trade-republic");
const depotOnly = profiles.get("trade-republic-depot");
const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "trade-republic-depot.csv"));

/** Bewegungen der Beispieldatei in der Reihenfolge, in der sie aus der Datenbank kämen */
const sorted = (rows) =>
  rows
    .filter((r) => r.movement)
    .map((r) => r.movement)
    .map((m, i) => ({ ...m, order: i }))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.timestamp ?? "").localeCompare(b.timestamp ?? "") || a.order - b.order);

const movements = sorted(analyzeFile(fixture, tr));
const result = portfolio(movements);
const position = (isin) => [...result.positions, ...result.closed].find((p) => p.isin === isin);

/** Die Beispieldatei so, wie sie nach einem Umweg über eine Tabellenkalkulation aussieht: gekürzt, ohne IDs, Datum M/D/YYYY */
function shortened() {
  const [head, ...rest] = parseCsv(fixture.toString("utf8"), ",").map((r) => r.fields);
  const keep = head.map((_, i) => i).slice(0, 17);
  const usDate = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(0, 4)}`;
  const trim = (value) => (/^-?\d+\.\d+$/.test(value) ? String(Number(value)) : value);
  const lines = rest.map((fields) =>
    keep.map((i) => (head[i] === "date" ? usDate(fields[i]) : head[i] === "datetime" ? `${usDate(fields[i])} 12:00` : trim(fields[i]))).join(","));
  return Buffer.from([keep.map((i) => head[i]).join(","), ...lines].join("\r\n"), "utf8");
}

test("Zeilen mit Wertpapier werden Bewegungen, die übrigen bleiben reine Umsätze", () => {
  const rows = analyzeFile(fixture, tr);
  assert.deepEqual(countStatuses(rows), { total: 31, new: 24, duplicate: 0, depot: 7, skipped: 0, invalid: 0 });
  assert.equal(rows.filter((r) => r.movement).length, 29, "alles außer Einzahlung und Kartenzahlung");
  const [inpayment, buy] = rows;
  assert.equal(inpayment.movement, undefined);
  assert.equal(buy.record.cents, -10100, "der Kauf bleibt auch eine Buchung");
  assert.deepEqual(
    { ...buy.movement, hash: undefined },
    {
      date: "2026-01-05",
      timestamp: "2026-01-05T10:00:00.000Z",
      section: "TRADING",
      type: "BUY",
      isin: "DE000MUSTER1",
      name: "Muster AG",
      assetClass: "STOCK",
      shares: 10,
      price: 10,
      amount: -10000,
      fee: -100,
      tax: 0,
      hash: undefined,
    },
  );
});

test("Zeilen ohne Geldbewegung gehen nur ins Depot", () => {
  const rows = analyzeFile(fixture, tr);
  const only = rows.filter((r) => r.status === "depot");
  assert.deepEqual(only.map((r) => r.movement.type), ["SPLIT", "REVERSE_SPLIT", "REVERSE_SPLIT", "REDEMPTION", "BUY", "BUY", "FREE_RECEIPT"]);
  assert.ok(only.every((r) => r.record === undefined));
  assert.equal(buildPreview(rows).skipped.length, 0, "nichts geht verloren");
});

test("Arten der Bewegungen", () => {
  const kinds = Object.fromEntries(movements.map((m) => [m.type, kindOf(m)]));
  assert.deepEqual(kinds, {
    BUY: "buy",
    SELL: "sell",
    SPLIT: "split",
    REVERSE_SPLIT: "split",
    REDEMPTION: "sell",
    FREE_RECEIPT: "buy",
    DIVIDEND: "income",
    DISTRIBUTION: "income",
    EARNINGS: "income",
    PRE_DETERMINED_TAX_BASE: "income",
    INTEREST_PAYMENT: "income",
    BOND_ACCRUED_INTEREST: "income",
    SEC_ACCOUNT: "income",
    PRIVATE_MARKET_BUY: "prepayment",
    IPO_SUBSCRIPTION: "prepayment",
    EARLY_REDEMPTION: "proceeds",
    BENEFITS_SAVEBACK: "reward",
    STOCKPERK: "reward",
  });
});

test("Kauf und Verkauf: gleitender Einstand mit Gebühren, Gewinn nach Gebühren und vor Steuern", () => {
  const p = position("DE000MUSTER1");
  assert.equal(p.name, "Muster AG");
  assert.equal(p.invested, 165.75, "221 € für 20 Stück, 5 verkauft");
  assert.equal(p.realized, 18.75, "75 € − 1 € Gebühr − 55,25 € Einstand");
  assert.equal(p.income, 5);
  assert.equal(p.taxes, 3);
  assert.equal(p.fees, 2);
});

test("Split: mehr Stücke, gleicher Einstand, der letzte Kurs gilt für die neue Stückzahl", () => {
  const p = position("DE000MUSTER1");
  assert.equal(p.shares, 30);
  assert.equal(p.price, 7.5);
  assert.equal(p.priceDate, "2026-03-02");
  assert.equal(p.value, 225);
  assert.equal(p.unrealized, 59.25);
});

test("Umtausch in eine neue ISIN: Der Einstand zieht um, kein Gewinn oder Verlust", () => {
  const before = position("US00ALT00001");
  assert.equal(before.shares, 0);
  assert.equal(before.invested, 0);
  assert.equal(before.realized, 0);
  assert.ok(result.closed.includes(before));

  const after = position("US00NEU00001");
  assert.equal(after.shares, 1);
  assert.equal(after.name, "Neu AG");
  assert.equal(after.invested, 21);
  assert.equal(after.price, 20, "1 € je alter Aktie, 20 alte sind eine neue");
  assert.equal(after.priceDate, "2026-01-10");
  assert.equal(after.value, 20);
});

test("Private Markets: Geld vorab, Anteile später; offene Vorauszahlung zählt zum Depot", () => {
  const p = position("LU00MUSTER01");
  assert.equal(p.shares, 0.5);
  assert.equal(p.pending, 50, "100 € bezahlt, Anteile für 50 € gebucht");
  assert.equal(p.value, 100);
  assert.equal(p.invested, 101, "mit 1 € Gebühr");
  assert.equal(p.unrealized, -1);
  assert.equal(p.received, 0);
});

test("Zeichnung: Rückzahlung und Zuteilung in beliebiger Reihenfolge, nichts bleibt offen", () => {
  const p = position("US00IPO00001");
  assert.equal(p.shares, 2);
  assert.equal(p.pending, 0);
  assert.equal(p.invested, 41);
  assert.equal(p.value, 40);
  assert.equal(p.received, 0);
});

test("Gratis-Eingang: zählt zum Kurs des Tages als Einstand und wird ausgewiesen", () => {
  const p = position("BTC");
  assert.ok(Math.abs(p.shares - 0.0011) < 1e-9);
  assert.equal(p.invested, 56);
  assert.equal(p.received, 6);
  assert.equal(p.value, 66);
  assert.equal(p.price, 60000);
});

test("Anleihe: Rückzahlung beendet die Position, das Geld dazu kommt in einer eigenen Zeile", () => {
  const p = position("XS00MUSTER01");
  assert.equal(p.shares, 0);
  assert.equal(p.realized, -1, "100 € zurück, 101 € bezahlt");
  assert.equal(p.income, 2.1);
  assert.equal(p.taxes, 0.35, "0,52 € Steuern, 0,17 € erstattet");
  assert.ok(result.closed.includes(p));
});

test("Prämien sind kein Ertrag, Vorabpauschale nur Steuer, Ausschüttung Ertrag", () => {
  const p = position("IE00MUSTER02");
  assert.equal(p.income, 1);
  assert.equal(p.taxes, 0.55);
  assert.equal(p.invested, 17);
  assert.equal(p.value, 17);
});

test("Summen und Anlageklassen", () => {
  assert.deepEqual(result.totals, {
    value: 468,
    invested: 401.75,
    pending: 50,
    unrealized: 66.25,
    realized: 17.75,
    income: 8.1,
    taxes: 3.9,
    fees: 6,
    received: 6,
    result: 88.2,
  });
  assert.deepEqual(result.positions.map((p) => p.value), [225, 100, 66, 40, 20, 17], "größte zuerst");
  assert.deepEqual(result.allocation.map((a) => a.assetClass), ["STOCK", "PRIVATE_FUND", "CRYPTO", "FUND"]);
  assert.equal(result.allocation[0].value, 285);
  assert.ok(Math.abs(result.allocation.reduce((sum, a) => sum + a.share, 0) - 1) < 1e-9);
});

test("Kassenprobe: Das Geld der Trades ergibt sich aus Einstand, Gewinn und Steuern auf Verkäufe", () => {
  const cash = movements.filter((m) => TRADE_BOOKING_TEXTS.includes(m.type)).reduce((sum, m) => sum + m.amount + m.fee + m.tax, 0);
  const { invested, received, realized } = result.totals;
  assert.equal(cash, -38000);
  assert.equal(-Math.round((invested - received - realized) * 100) - 200, cash, "2 € Steuer auf den Verkauf");
});

test("Ohne Bewegungen ist das Depot leer", () => {
  const empty = portfolio([]);
  assert.equal(empty.totals.value, 0);
  assert.deepEqual([empty.positions, empty.closed, empty.allocation], [[], [], []]);
  assert.deepEqual(monthlyHistory([], "2026-10"), []);
});

const move = (date, section, type, isin, shares, price, amount = 0, fee = 0, tax = 0) =>
  ({ date, section, type, isin, name: isin, assetClass: "STOCK", shares, price, amount, fee, tax });

test("Verkauf aller Stücke hinterlässt keine Rundungsreste", () => {
  const { positions, closed } = portfolio([
    move("2026-01-01", "TRADING", "BUY", "A", 0.1, 10, -100),
    move("2026-01-01", "TRADING", "BUY", "A", 0.2, 10, -200),
    move("2026-01-02", "TRADING", "SELL", "A", -0.1, 10, 100),
    move("2026-01-02", "TRADING", "SELL", "A", -0.2, 10, 200),
  ]);
  assert.deepEqual(positions, []);
  assert.equal(closed[0].shares, 0);
  assert.equal(closed[0].invested, 0);
  assert.equal(closed[0].realized, 0);
});

test("Fehlen ältere Käufe im Export, wird der Bestand nicht negativ", () => {
  const { positions, closed } = portfolio([move("2026-01-02", "TRADING", "SELL", "A", -3, 10, 3000)]);
  assert.deepEqual(positions, []);
  assert.equal(closed[0].shares, 0);
  assert.equal(closed[0].realized, 30, "ohne Einstand zählt der ganze Erlös");
});

test("Auslieferung aus dem Depot ist kein Verkauf", () => {
  const { closed } = portfolio([
    move("2026-01-01", "TRADING", "BUY", "A", 2, 10, -2000),
    move("2026-01-02", "DELIVERY", "TRANSFER_OUT", "A", -2, null),
  ]);
  assert.equal(closed[0].realized, 0);
  assert.equal(closed[0].invested, 0);
});

test("Der Depotwert im Zeitverlauf nutzt den bis dahin bekannten Kurs", () => {
  const list = [
    move("2026-01-10", "TRADING", "BUY", "A", 2, 10, -2000),
    move("2026-02-10", "TRADING", "BUY", "A", 1, 16, -1600),
    move("2026-03-10", "TRADING", "SELL", "A", -3, 20, 6000),
  ];
  assert.deepEqual(standAt(list, ["2026-01-10", "2026-01-11", "2026-02-11", "2026-03-11"]), [
    { value: 0, invested: 0 },
    { value: 20, invested: 20 },
    { value: 48, invested: 36 },
    { value: 0, invested: 0 },
  ]);
  assert.deepEqual(monthlyHistory(list, "2026-04"), [
    { month: "2026-01", value: 0, invested: 0 },
    { month: "2026-02", value: 20, invested: 20 },
    { month: "2026-03", value: 48, invested: 36 },
    { month: "2026-04", value: 0, invested: 0 },
  ]);
  assert.deepEqual([...flowsByMonth(list)], [["2026-01", 2000], ["2026-02", 1600], ["2026-03", -6000]]);
});

test("Der Verlauf reicht bis zur letzten Bewegung, auch wenn sie nach until liegt", () => {
  const list = [move("2026-01-10", "TRADING", "BUY", "A", 2, 10, -2000), move("2026-03-10", "TRADING", "BUY", "A", 1, 10, -1000)];
  assert.deepEqual(monthlyHistory(list, "2026-02").map((h) => h.month), ["2026-01", "2026-02", "2026-03"]);
});

test("Werte der Depots ergänzen die Zeilen der Konten", () => {
  const rows = [
    { month: "2026-01", accountId: 1, income: 5, expenses: 0, transfers: -10, balance: 100 },
    { month: "2026-01", accountId: 2, income: 0, expenses: 0, transfers: 0, balance: 7 },
    { month: "2026-02", accountId: 1, income: 0, expenses: 0, transfers: 0, balance: 95 },
  ];
  const merged = mergeRows(rows, [
    { month: "2026-01", accountId: 2, income: 0, expenses: 0, transfers: 10, balance: 50 },
    { month: "2026-02", accountId: 2, income: 0, expenses: 0, transfers: 0, balance: 60 },
  ], "month");
  assert.deepEqual(merged.map((r) => [r.month, r.accountId, r.transfers, r.balance]), [
    ["2026-01", 1, -10, 100],
    ["2026-01", 2, 10, 57],
    ["2026-02", 1, 0, 95],
    ["2026-02", 2, 0, 60],
  ]);
});

test("Duplikate: am Inhalt erkannt, gleiche Zeilen zählen einzeln", () => {
  const rows = analyzeFile(fixture, tr);
  const [first] = rows.filter((r) => r.movement);
  assert.equal(buildPreview(markDuplicateMovements(rows, new Map())).depot.new, 29);

  const known = new Map([[first.movement.hash, 1]]);
  const preview = buildPreview(markDuplicateMovements(analyzeFile(fixture, tr), known));
  assert.deepEqual(preview.depot, { new: 28, duplicate: 1, positions: 8 });

  const twice = analyzeFile(fixture, tr).filter((r) => r.movement).slice(0, 1);
  const again = analyzeFile(fixture, tr).filter((r) => r.movement).slice(0, 1);
  markDuplicateMovements([...twice, ...again], new Map([[first.movement.hash, 1]]));
  assert.deepEqual([twice[0].movement.duplicate, again[0].movement.duplicate], [true, false]);
});

test("Gekürzter Export: nur Depot, keine Umsätze, dieselben Bewegungen wie im vollen Export", () => {
  const rows = analyzeFile(shortened(), depotOnly);
  assert.deepEqual(countStatuses(rows), { total: 31, new: 0, duplicate: 0, depot: 29, skipped: 2, invalid: 0 });
  assert.deepEqual(buildPreview(rows).skipped, [{ reason: "Kein Wertpapier", count: 2 }]);
  assert.deepEqual(
    rows.filter((r) => r.movement).map((r) => r.movement.hash),
    analyzeFile(fixture, tr).filter((r) => r.movement).map((r) => r.movement.hash),
    "ein voller Export erkennt die Bewegungen wieder",
  );
});

test("Gekürzter Export: Die Vorschau zeigt die ersten Bewegungen", () => {
  const { sample } = buildPreview(markDuplicateMovements(analyzeFile(shortened(), depotOnly), new Map()));
  assert.equal(sample.length, 10);
  assert.deepEqual(sample[0], {
    line: 3,
    date: "2026-01-05",
    amount: -101,
    counterparty: "Muster AG",
    purpose: "BUY",
    duplicate: false,
  });
});

test("Das Profil für den vollen Export lehnt den gekürzten ab, statt Umsätze doppelt anzulegen", () => {
  assert.throws(() => analyzeFile(shortened(), tr), /Es fehlen Spalten/);
});

test("Käufe und Verkäufe gelten im Geldkonto als Umbuchung", () => {
  for (const type of TRADE_BOOKING_TEXTS) assert.ok(TRANSFER.includes(`'${type}'`), type);
  for (const type of ["DIVIDEND", "BENEFITS_SAVEBACK", "EARNINGS"]) assert.ok(!TRANSFER.includes(`'${type}'`), type);
});

/** Datenbank-Attrappe: antwortet der Reihe nach und merkt sich die Abfragen */
const fakeDb = (...answers) => {
  const db = { queries: [], query: async (sql, params) => (db.queries.push({ sql, params }), { rows: answers.shift() ?? [] }) };
  return db;
};

test("Ein Depot als gewähltes Konto nimmt die Bewegungen selbst auf", async () => {
  const db = fakeDb();
  assert.deepEqual(await depotOf(db, { id: 4, name: "Mein Depot", kind: "depot" }), { id: 4, name: "Mein Depot", isNew: false });
  assert.equal(db.queries.length, 0);
});

test("Zum Geldkonto wird das verknüpfte Depot gefunden", async () => {
  const db = fakeDb([{ id: 9, name: "Trade Republic Depot" }]);
  assert.deepEqual(await depotOf(db, { id: 3, name: "Trade Republic", kind: "credit_card", institution: "TR" }), {
    id: 9,
    name: "Trade Republic Depot",
    isNew: false,
  });
  assert.equal(db.queries.length, 1);
});

test("Gibt es noch kein Depot, wird es mit dem Geldkonto verknüpft angelegt", async () => {
  const db = fakeDb([], [{ id: 10, name: "Trade Republic Depot" }]);
  const depot = await depotOf(db, { id: 3, name: "Trade Republic", kind: "credit_card", institution: "TR" });
  assert.deepEqual(depot, { id: 10, name: "Trade Republic Depot", isNew: true });
  assert.deepEqual(db.queries[1].params, ["Trade Republic Depot", "TR", 3]);
});
