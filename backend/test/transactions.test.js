const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isDate,
  isMonth,
  readTransaction,
  lockedFields,
  readBulkChange,
  accountParam,
  readListQuery,
  readSearchQuery,
} = require("../transactions");

const valid = () => ({
  type: "out",
  amount: 42.5,
  category: "Lebensmittel",
  date: "2026-10-27",
  note: "Wocheneinkauf",
  accountId: 3,
});

test("Anlegen: gültige Buchung wird für die Datenbank aufbereitet", () => {
  assert.deepEqual(readTransaction(valid()), {
    type: "out",
    amount: "42.50",
    category: "Lebensmittel",
    date: "2026-10-27",
    note: "Wocheneinkauf",
    account_id: 3,
  });
});

test("Anlegen: Notiz ist optional, Texte werden gekürzt", () => {
  const tx = readTransaction({ ...valid(), note: undefined, category: ` ${"x".repeat(50)} ` });
  assert.equal(tx.note, "");
  assert.equal(tx.category.length, 40);
  assert.equal(readTransaction({ ...valid(), note: "y".repeat(80) }).note.length, 60);
});

test("Anlegen: fehlende oder ungültige Pflichtfelder", () => {
  const cases = {
    "Art fehlt": { type: undefined },
    "unbekannte Art": { type: "transfer" },
    "Betrag fehlt": { amount: undefined },
    "Betrag 0": { amount: 0 },
    "negativer Betrag": { amount: -5 },
    "Betrag unter einem Cent": { amount: 0.004 },
    "Betrag zu groß": { amount: 1e10 },
    "Betrag kein Zahl": { amount: "zwölf" },
    "Kategorie leer": { category: "  " },
    "Kategorie keine Zeichenkette": { category: 42 },
    "Datum fehlt": { date: undefined },
    "Datum im falschen Format": { date: "27.10.2026" },
    "Datum gibt es nicht": { date: "2026-02-30" },
    "Konto fehlt": { accountId: undefined },
    "Konto als Text": { accountId: "3" },
    "Konto 0": { accountId: 0 },
    "Konto keine ganze Zahl": { accountId: 1.5 },
  };
  for (const [name, change] of Object.entries(cases)) {
    assert.equal(readTransaction({ ...valid(), ...change }), null, name);
  }
});

test("Betrag: Cent werden gerundet, Zeichenketten sind erlaubt", () => {
  assert.equal(readTransaction({ ...valid(), amount: "12.345" }).amount, "12.35");
  assert.equal(readTransaction({ ...valid(), amount: 0.1 + 0.2 }).amount, "0.30");
  assert.equal(readTransaction({ ...valid(), amount: 9999999999.99 }).amount, "9999999999.99");
});

test("Ändern: nur übergebene Felder werden geprüft und geliefert", () => {
  assert.deepEqual(readTransaction({ category: "Freizeit" }, true), { category: "Freizeit" });
  assert.deepEqual(readTransaction({ note: "" }, true), { note: "" });
  assert.deepEqual(readTransaction({}, true), {});
  assert.deepEqual(readTransaction({ accountId: 2 }, true), { account_id: 2 });
  assert.equal(readTransaction({ accountId: null }, true), null);
  assert.equal(readTransaction({ category: "" }, true), null);
  assert.equal(readTransaction({ amount: -1 }, true), null);
  assert.equal(readTransaction({ date: "2026-13-01" }, true), null);
});

test("Umbuchung: von Hand festgelegt oder automatisch", () => {
  assert.equal("transfer_override" in readTransaction(valid()), false, "ohne Angabe automatisch");
  assert.equal(readTransaction({ ...valid(), transfer: true }).transfer_override, true);
  assert.equal(readTransaction({ ...valid(), transfer: false }).transfer_override, false);
  assert.deepEqual(readTransaction({ transfer: true }, true), { transfer_override: true });
  assert.deepEqual(readTransaction({ transfer: false }, true), { transfer_override: false });
  assert.equal(readTransaction({ transfer: "ja" }, true), null);
  assert.equal(readTransaction({ transfer: null }, true), null);
  assert.equal(readTransaction({ ...valid(), transfer: 1 }), null);
});

test("Umbuchung: ist bei importierten Buchungen nicht gesperrt", () => {
  assert.deepEqual(lockedFields({ transfer_override: true }), []);
});

test("Rhythmus: optional, null heißt einmalig", () => {
  assert.equal("rhythm" in readTransaction(valid()), false);
  for (const rhythm of ["monthly", "quarterly", "semiannual", "yearly"]) {
    assert.equal(readTransaction({ ...valid(), rhythm }).rhythm, rhythm);
  }
  assert.equal(readTransaction({ ...valid(), rhythm: null }).rhythm, null);
  assert.deepEqual(readTransaction({ rhythm: "yearly" }, true), { rhythm: "yearly" });
  assert.deepEqual(readTransaction({ rhythm: null }, true), { rhythm: null });
  assert.equal(readTransaction({ rhythm: "weekly" }, true), null);
  assert.equal(readTransaction({ rhythm: "" }, true), null);
  assert.equal(readTransaction({ ...valid(), rhythm: 12 }), null);
});

test("Rhythmus: ist bei importierten Buchungen nicht gesperrt", () => {
  assert.deepEqual(lockedFields({ rhythm: "monthly" }), []);
});

test("Ändern: unbekannte Felder werden ignoriert", () => {
  assert.deepEqual(readTransaction({ category: "Wohnen", id: 7, import_id: null, account_id: 5, counterparty: "X" }, true), {
    category: "Wohnen",
  });
});

test("importierte Buchungen: Art, Betrag, Datum und Konto sind gesperrt", () => {
  assert.deepEqual(lockedFields({ category: "Wohnen", note: "Miete" }), []);
  assert.deepEqual(lockedFields({ amount: "1.00", date: "2026-01-01", note: "" }), ["amount", "date"]);
  assert.deepEqual(lockedFields({ type: "in" }), ["type"]);
  assert.deepEqual(lockedFields({ account_id: 2, category: "Wohnen" }), ["account_id"]);
});

test("Sammeländerung: Kategorie und Notiz für mehrere Buchungen", () => {
  assert.deepEqual(readBulkChange({ ids: [1, 2], changes: { category: " Lebensmittel ", note: "Einkauf" } }), {
    ids: [1, 2],
    changes: { category: "Lebensmittel", note: "Einkauf" },
  });
  assert.deepEqual(readBulkChange({ ids: [3], changes: { note: "" } }), { ids: [3], changes: { note: "" } });
  assert.deepEqual(readBulkChange({ ids: [4, 4, 5], changes: { category: "Wohnen" } }).ids, [4, 5]);
  assert.deepEqual(readBulkChange({ ids: [6], changes: { transfer: true, category: "Sparen" } }), {
    ids: [6],
    changes: { category: "Sparen", transfer_override: true },
  });
  assert.deepEqual(readBulkChange({ ids: [7], changes: { transfer: false } }).changes, { transfer_override: false });
  assert.deepEqual(readBulkChange({ ids: [8], changes: { rhythm: "monthly" } }).changes, { rhythm: "monthly" });
  assert.deepEqual(readBulkChange({ ids: [9], changes: { rhythm: null } }).changes, { rhythm: null });
});

test("Sammeländerung: fehlende oder ungültige Eingaben", () => {
  const changes = { category: "Wohnen" };
  const cases = {
    "nichts angegeben": {},
    "IDs fehlen": { changes },
    "keine IDs": { ids: [], changes },
    "IDs keine Liste": { ids: 1, changes },
    "ID als Text": { ids: ["1"], changes },
    "ID 0": { ids: [0], changes },
    "ID keine ganze Zahl": { ids: [1.5], changes },
    "Änderungen fehlen": { ids: [1] },
    "Änderungen leer": { ids: [1], changes: {} },
    "Änderungen nur mit unbekannten Feldern": { ids: [1], changes: { id: 7 } },
    "Kategorie leer": { ids: [1], changes: { category: " " } },
    "Umbuchung kein Wahrheitswert": { ids: [1], changes: { transfer: "ja" } },
    "unbekannter Rhythmus": { ids: [1], changes: { rhythm: "weekly" } },
    "Betrag": { ids: [1], changes: { amount: 5 } },
    "Datum": { ids: [1], changes: { date: "2026-10-27" } },
    "Art": { ids: [1], changes: { type: "in" } },
    "Konto": { ids: [1], changes: { accountId: 2 } },
    "Konto zusammen mit Kategorie": { ids: [1], changes: { accountId: 2, category: "Wohnen" } },
  };
  for (const [name, body] of Object.entries(cases)) assert.equal(readBulkChange(body), null, name);
});

test("Suche: alle Filter sind optional", () => {
  assert.deepEqual(readSearchQuery({}), { patterns: [], category: null, type: null, rhythm: null, account: null });
  assert.deepEqual(readSearchQuery({ q: "", category: "", type: "", rhythm: "", account: "" }), {
    patterns: [],
    category: null,
    type: null,
    rhythm: null,
    account: null,
  });
  assert.deepEqual(readSearchQuery({ q: "penny", category: "Sonstiges", type: "out", rhythm: "yearly", account: "3" }), {
    patterns: ["%penny%"],
    category: "Sonstiges",
    type: "out",
    rhythm: "yearly",
    account: 3,
  });
  assert.equal(readSearchQuery({ type: "in" }).type, "in");
  assert.equal(readSearchQuery({ type: "transfer" }).type, "transfer");
});

test("Suche: jedes Wort ist ein Muster, Platzhalter zählen als normale Zeichen", () => {
  assert.deepEqual(readSearchQuery({ q: "  penny   markt " }).patterns, ["%penny%", "%markt%"]);
  assert.deepEqual(readSearchQuery({ q: "100%" }).patterns, ["%100\\%%"]);
  assert.deepEqual(readSearchQuery({ q: "a_b" }).patterns, ["%a\\_b%"]);
  assert.deepEqual(readSearchQuery({ q: "c\\d" }).patterns, ["%c\\\\d%"]);
  assert.deepEqual(readSearchQuery({ q: "   " }).patterns, []);
});

test("Suche: ungültige Parameter", () => {
  const cases = {
    "Text doppelt": { q: ["a", "b"] },
    "Kategorie doppelt": { category: ["a", "b"] },
    "unbekannte Art": { type: "umbuchung" },
    "Art doppelt": { type: ["in", "out"] },
    "unbekannter Rhythmus": { rhythm: "weekly" },
    "Rhythmus doppelt": { rhythm: ["monthly", "yearly"] },
    "Konto kein Zahl": { account: "abc" },
    "Konto 0": { account: "0" },
  };
  for (const [name, query] of Object.entries(cases)) assert.ok(readSearchQuery(query).error, name);
});

test("Liste: Buchungen eines Monats oder die neuesten, optional eines Kontos", () => {
  assert.deepEqual(readListQuery({ month: "2026-10" }), { month: "2026-10", account: null });
  assert.deepEqual(readListQuery({ month: "2026-10", account: "3" }), { month: "2026-10", account: 3 });
  assert.deepEqual(readListQuery({ limit: "8" }), { limit: 8, account: null });
  assert.deepEqual(readListQuery({ limit: "100", account: "2" }), { limit: 100, account: 2 });
  assert.deepEqual(readListQuery({ month: "2026-10", limit: "abc" }), { month: "2026-10", account: null });
});

test("Liste: fehlende oder ungültige Parameter", () => {
  const cases = {
    "nichts angegeben": {},
    "Monat 13": { month: "2026-13" },
    "Monat ohne führende Null": { month: "2026-1" },
    "Monat doppelt": { month: ["2026-10", "2026-11"] },
    "Limit 0": { limit: "0" },
    "Limit zu groß": { limit: "101" },
    "Limit keine ganze Zahl": { limit: "2.5" },
    "Konto 0": { month: "2026-10", account: "0" },
    "Konto kein Zahl": { limit: "5", account: "abc" },
  };
  for (const [name, query] of Object.entries(cases)) assert.ok(readListQuery(query).error, name);
});

test("Monat und Konto aus Query-Parametern", () => {
  assert.equal(isMonth("2026-01"), true);
  assert.equal(isMonth("2026-12"), true);
  assert.equal(isMonth("2026-00"), false);
  assert.equal(isMonth(undefined), false);
  assert.equal(accountParam(undefined), null);
  assert.equal(accountParam(""), null);
  assert.equal(accountParam("7"), 7);
  assert.ok(Number.isNaN(accountParam("-1")));
  assert.ok(Number.isNaN(accountParam(["1", "2"])));
});

test("Datum: Schaltjahre und Monatsenden", () => {
  assert.equal(isDate("2024-02-29"), true);
  assert.equal(isDate("2025-02-29"), false);
  assert.equal(isDate("2026-04-31"), false);
  assert.equal(isDate("2026-12-31"), true);
  assert.equal(isDate(20261231), false);
});
