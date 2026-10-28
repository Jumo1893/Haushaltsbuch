const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { ProfileError, compileProfile, loadProfiles } = require("../import/profiles");

const minimal = () => ({
  name: "Testbank",
  delimiter: ";",
  dateFormats: ["DD.MM.YYYY"],
  decimalSeparator: ",",
  columns: { date: "Datum", amount: "Betrag" },
});

test("die mitgelieferten Profile sind gültig", () => {
  const profiles = loadProfiles(path.join(__dirname, "..", "import-profiles"));
  const camt = profiles.get("csv-camt-v8");
  assert.ok(camt, "Profil csv-camt-v8 fehlt");
  assert.equal(camt.name, "CSV-CAMT V8");
  assert.deepEqual(camt.encodings, ["utf-8", "windows-1252"]);
  for (const column of ["Buchungstag", "Betrag", "Waehrung", "Verwendungszweck", "Beguenstigter/Zahlungspflichtiger", "Info"]) {
    assert.ok(camt.expectedColumns.includes(column), column);
  }
});

test("ein minimales Profil wird mit Standardwerten ergänzt", () => {
  const profile = compileProfile("testbank", minimal());
  assert.equal(profile.description, "");
  assert.deepEqual(profile.encodings, ["utf-8"]);
  assert.equal(profile.skipLines, 0);
  assert.deepEqual(profile.expectedColumns, ["Datum", "Betrag"]);
  assert.equal(profile.parseDate("31.12.2025"), "2025-12-31");
  assert.equal(profile.parseAmount("-1,5"), -150);
});

test("mehrere Datumsformate werden der Reihe nach versucht", () => {
  const profile = compileProfile("testbank", { ...minimal(), dateFormats: ["DD.MM.YY", "DD.MM.YYYY"] });
  assert.equal(profile.parseDate("28.10.26"), "2026-10-28");
  assert.equal(profile.parseDate("28.10.2026"), "2026-10-28");
  assert.equal(profile.parseDate("2026-10-28"), null);
});

test("Spalten aus skipRows gehören zu den erwarteten Spalten", () => {
  const profile = compileProfile("testbank", {
    ...minimal(),
    skipRows: [{ column: "Status", equals: "vorgemerkt", reason: "Vorgemerkt" }],
  });
  assert.deepEqual(profile.expectedColumns, ["Datum", "Betrag", "Status"]);
});

const invalid = {
  "unbekannter Eintrag": { delimeter: "," },
  "Name fehlt": { name: "" },
  "unbekannte Kodierung": { encoding: "klingonisch" },
  "Trennzeichen zu lang": { delimiter: ";;" },
  "Anführungszeichen als Trennzeichen": { delimiter: '"' },
  "negative skipLines": { skipLines: -1 },
  "kein Datumsformat": { dateFormats: [] },
  "ungültiges Datumsformat": { dateFormats: ["TT.MM.JJJJ"] },
  "ungültiges Dezimaltrennzeichen": { decimalSeparator: ";" },
  "gleiche Trennzeichen für Dezimal und Tausender": { thousandsSeparator: "," },
  "unbekanntes Feld": { columns: { date: "Datum", amount: "Betrag", isin: "ISIN" } },
  "Pflichtfeld Datum fehlt": { columns: { amount: "Betrag" } },
  "Pflichtfeld Betrag fehlt": { columns: { date: "Datum" } },
  "leerer Spaltenname": { columns: { date: "Datum", amount: " " } },
  "unvollständige skipRows-Regel": { skipRows: [{ column: "Info" }] },
};

for (const [name, change] of Object.entries(invalid)) {
  test(`ungültiges Profil: ${name}`, () => {
    assert.throws(() => compileProfile("testbank", { ...minimal(), ...change }), ProfileError);
  });
}

test("ungültige Profil-ID (Dateiname)", () => {
  assert.throws(() => compileProfile("Test Bank", minimal()), /Dateiname/);
});
