const test = require("node:test");
const assert = require("node:assert/strict");
const { KINDS, FALLBACK_CATEGORY, DEFAULT_CATEGORIES, readCategory } = require("../categories");

test("Standardkategorien: Jede Art hat die Auffangkategorie, jeder Name steht je Art nur einmal da", () => {
  for (const kind of KINDS) {
    assert.ok(DEFAULT_CATEGORIES[kind].includes(FALLBACK_CATEGORY), kind);
    assert.equal(new Set(DEFAULT_CATEGORIES[kind]).size, DEFAULT_CATEGORIES[kind].length, kind);
  }
});

test("Kategorie anlegen: Eingaben werden aufbereitet", () => {
  assert.deepEqual(readCategory({ name: " Haustier ", kind: "out" }), { values: { name: "Haustier", kind: "out" } });
  assert.equal(readCategory({ name: "x".repeat(50), kind: "in" }).values.name.length, 40);
  assert.equal(readCategory({ name: "Depot", kind: "transfer" }).values.kind, "transfer");
});

test("Kategorie anlegen: fehlende oder ungültige Angaben werden mit Grund abgelehnt", () => {
  const cases = {
    "Name fehlt": { kind: "out" },
    "Name leer": { name: "  ", kind: "out" },
    "Name keine Zeichenkette": { name: 7, kind: "out" },
    "Art fehlt": { name: "Haustier" },
    "unbekannte Art": { name: "Haustier", kind: "umbuchung" },
  };
  for (const [name, body] of Object.entries(cases)) {
    const result = readCategory(body);
    assert.equal(result.values, undefined, name);
    assert.ok(result.error, name);
  }
});

test("Kategorie umbenennen: nur der Name zählt, die Art bleibt", () => {
  assert.deepEqual(readCategory({ name: " Tiere ", kind: "in" }, true), { values: { name: "Tiere" } });
  assert.ok(readCategory({ name: "" }, true).error);
  assert.ok(readCategory({}, true).error);
});
