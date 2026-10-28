const test = require("node:test");
const assert = require("node:assert/strict");
const { CsvError, parseCsv, dropLines } = require("../import/csv");

const fields = (records) => records.map((r) => r.fields);

test("trennt Felder am Semikolon und entfernt Anführungszeichen", () => {
  assert.deepEqual(fields(parseCsv('"a";"b";c\n"1";2;"3"\n', ";")), [
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
});

test("verwendet das angegebene Trennzeichen", () => {
  assert.deepEqual(fields(parseCsv("a,b;c\n", ",")), [["a", "b;c"]]);
  assert.deepEqual(fields(parseCsv("a\tb\n", "\t")), [["a", "b"]]);
});

test("Trennzeichen und verdoppelte Anführungszeichen in Anführungszeichen gehören zum Feld", () => {
  assert.deepEqual(fields(parseCsv('"x;y";"sagt ""hallo""";""\n', ";")), [["x;y", 'sagt "hallo"', ""]]);
});

test("leere Felder bleiben erhalten", () => {
  assert.deepEqual(fields(parseCsv('a;;"";\n', ";")), [["a", "", "", ""]]);
});

test("erkennt CRLF, LF und CR als Zeilenende und zählt die Zeilen", () => {
  const records = parseCsv("a\r\nb\nc\rd", ";");
  assert.deepEqual(records, [
    { line: 1, fields: ["a"] },
    { line: 2, fields: ["b"] },
    { line: 3, fields: ["c"] },
    { line: 4, fields: ["d"] },
  ]);
});

test("Zeilenumbrüche in Anführungszeichen: Datensatz behält seine Startzeile, danach stimmt die Zählung", () => {
  const records = parseCsv('kopf\n"zwei\r\nzeilen";x\nnach\n', ";");
  assert.deepEqual(records, [
    { line: 1, fields: ["kopf"] },
    { line: 2, fields: ["zwei\r\nzeilen", "x"] },
    { line: 4, fields: ["nach"] },
  ]);
});

test("überspringt leere Zeilen und Zeilen nur aus Trennzeichen", () => {
  const records = parseCsv("a\n\n;;\n  \nb\n", ";");
  assert.deepEqual(records, [
    { line: 1, fields: ["a"] },
    { line: 5, fields: ["b"] },
  ]);
});

test("zählt Zeilen ab firstLine", () => {
  assert.deepEqual(parseCsv("a\nb", ";", 4).map((r) => r.line), [4, 5]);
});

test("nicht geschlossenes Anführungszeichen ist ein Fehler mit Zeilenangabe", () => {
  assert.throws(() => parseCsv('a\n"offen;b\nc', ";"), (e) => e instanceof CsvError && /Zeile 2/.test(e.message));
});

test("dropLines entfernt die angegebene Zahl von Zeilen", () => {
  assert.equal(dropLines("eins\r\nzwei\nkopf;x\n1;2", 2), "kopf;x\n1;2");
  assert.equal(dropLines("a\nb", 0), "a\nb");
  assert.equal(dropLines("a\nb", 5), "");
});
