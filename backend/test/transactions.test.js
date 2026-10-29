const test = require("node:test");
const assert = require("node:assert/strict");
const { isDate, readTransaction, lockedFields } = require("../transactions");

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

test("Datum: Schaltjahre und Monatsenden", () => {
  assert.equal(isDate("2024-02-29"), true);
  assert.equal(isDate("2025-02-29"), false);
  assert.equal(isDate("2026-04-31"), false);
  assert.equal(isDate("2026-12-31"), true);
  assert.equal(isDate(20261231), false);
});
