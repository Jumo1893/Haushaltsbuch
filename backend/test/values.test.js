const test = require("node:test");
const assert = require("node:assert/strict");
const { decode, compileDateFormat, compileAmountFormat, cleanText, neutralizeFormula } = require("../import/values");

const cp1252 = (s) => Buffer.from(s, "latin1");
const utf8 = (s) => Buffer.from(s, "utf8");

test("Kodierung: Windows-1252 mit Umlauten", () => {
  assert.equal(decode(cp1252("Bäckerei Schön, Straße"), ["windows-1252"]), "Bäckerei Schön, Straße");
});

test("Kodierung: UTF-8 wird bevorzugt, wenn die Datei gültiges UTF-8 ist", () => {
  assert.equal(decode(utf8("Müller"), ["utf-8", "windows-1252"]), "Müller");
});

test("Kodierung: ohne gültiges UTF-8 greift die nächste Kodierung", () => {
  assert.equal(decode(cp1252("Müller"), ["utf-8", "windows-1252"]), "Müller");
});

test("Kodierung: UTF-8-BOM hat Vorrang und wird entfernt", () => {
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8("Müller")]);
  assert.equal(decode(withBom, ["windows-1252"]), "Müller");
});

test("Kodierung: null, wenn keine Kodierung passt", () => {
  assert.equal(decode(cp1252("Müller"), ["utf-8"]), null);
});

test("Datum: DD.MM.YY und DD.MM.YYYY", () => {
  assert.equal(compileDateFormat("DD.MM.YY")("28.10.26"), "2026-10-28");
  assert.equal(compileDateFormat("DD.MM.YYYY")("01.02.2024"), "2024-02-01");
});

test("Datum: andere Reihenfolgen und Trennzeichen", () => {
  assert.equal(compileDateFormat("YYYY-MM-DD")("2024-02-29"), "2024-02-29");
  assert.equal(compileDateFormat("MM/DD/YYYY")("12/31/2025"), "2025-12-31");
});

test("Datum: ungültige Kalenderdaten und falsche Schreibweisen", () => {
  const parse = compileDateFormat("DD.MM.YYYY");
  for (const value of ["31.09.2026", "29.02.2025", "00.01.2026", "01.13.2026", "1.2.2026", "01.02.26", "01-02-2026", "abc", ""]) {
    assert.equal(parse(value), null, value);
  }
  assert.equal(compileDateFormat("DD.MM.YY")("28.10.2026"), null);
});

test("Datum: ungültige Formate werden erkannt", () => {
  for (const format of ["DD.MM", "DD.MM.YY.YYYY", "TT.MM.JJJJ", "DD.DD.YYYY", "", 42]) {
    assert.equal(compileDateFormat(format), null, String(format));
  }
});

test("Betrag: deutsches Format mit Komma und Tausenderpunkt", () => {
  const parse = compileAmountFormat(",", ".");
  assert.equal(parse("-12,50"), -1250);
  assert.equal(parse("2345,67"), 234567);
  assert.equal(parse("1.234.567,89"), 123456789);
  assert.equal(parse("+5"), 500);
  assert.equal(parse("0,5"), 50);
  assert.equal(parse(" -1.000 "), -100000);
});

test("Betrag: englisches Format mit Punkt und Komma", () => {
  const parse = compileAmountFormat(".", ",");
  assert.equal(parse("-1,234.56"), -123456);
  assert.equal(parse("19.99"), 1999);
});

test("Betrag: ohne Tausendertrennzeichen", () => {
  const parse = compileAmountFormat(",", "");
  assert.equal(parse("1234,56"), 123456);
  assert.equal(parse("1.234,56"), null);
});

test("Betrag: unlesbare Werte", () => {
  const parse = compileAmountFormat(",", ".");
  for (const value of ["", "abc", "12,345", "12.50", "1.23,45", "12,5x", "--1", "1 234,00", "12,"]) {
    assert.equal(parse(value), null, value);
  }
});

test("Text: Steuerzeichen und mehrfache Leerzeichen werden zu einem Leerzeichen", () => {
  assert.equal(cleanText("  Miete\tOktober \r\n  2026\u0000 "), "Miete Oktober 2026");
});

test("Formel-Injection: Formelzeichen am Anfang werden entschärft", () => {
  assert.equal(neutralizeFormula('=HYPERLINK("http://x")'), `'=HYPERLINK("http://x")`);
  assert.equal(neutralizeFormula("+49 170 000000"), "'+49 170 000000");
  assert.equal(neutralizeFormula("-Rückzahlung"), "'-Rückzahlung");
  assert.equal(neutralizeFormula("@SUMME(A1)"), "'@SUMME(A1)");
  assert.equal(neutralizeFormula("Miete = 850"), "Miete = 850");
});
