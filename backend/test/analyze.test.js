const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadProfiles, compileProfile } = require("../import/profiles");
const { ImportError, analyzeFile, markDuplicates, countStatuses, buildPreview } = require("../import/analyze");

const camt = loadProfiles(path.join(__dirname, "..", "import-profiles")).get("csv-camt-v8");
const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "csv-camt-v8.csv"));

const simple = compileProfile("testbank", {
  name: "Testbank",
  delimiter: ";",
  dateFormats: ["DD.MM.YYYY"],
  decimalSeparator: ",",
  thousandsSeparator: ".",
  columns: { date: "Datum", amount: "Betrag", counterparty: "Name", purpose: "Zweck" },
});
const csv = (lines) => Buffer.from(lines.join("\n"), "utf8");
const byLine = (rows) => Object.fromEntries(rows.map((r) => [r.line, r]));
const rejects = (fn, status, pattern) =>
  assert.throws(fn, (e) => e instanceof ImportError && e.status === status && pattern.test(e.message));

test("CSV-CAMT V8: Beispieldatei wird vollständig gelesen", () => {
  const rows = analyzeFile(fixture, camt);
  assert.deepEqual(countStatuses(rows), { total: 11, new: 7, duplicate: 0, skipped: 1, invalid: 3 });

  const lines = byLine(rows);
  assert.deepEqual(lines[2], { line: 2, status: "skipped", reason: "Vorgemerkter Umsatz (noch nicht gebucht)" });
  assert.match(lines[9].reason, /Ungültiges Datum „31\.09\.26“ in Spalte „Buchungstag“/);
  assert.match(lines[10].reason, /Unlesbarer Betrag „-45,1x“ in Spalte „Betrag“/);
  assert.match(lines[12].reason, /Währung „USD“ wird nicht unterstützt/);
});

test("CSV-CAMT V8: Felder werden zugeordnet, Umlaute aus Windows-1252 korrekt gelesen", () => {
  const { record } = byLine(analyzeFile(fixture, camt))[3];
  assert.equal(record.date, "2026-10-27");
  assert.equal(record.cents, -2347);
  assert.equal(record.counterparty, "Supermarkt Müller");
  assert.equal(record.purpose, "2026-10-26T12:05 Debitk.1 2029-12");
  assert.deepEqual(record.details, {
    account: "DE00123456780000000001",
    valueDate: "2026-10-27",
    bookingText: "KARTENZAHLUNG",
    counterpartyIban: "DE00987654320000000012",
    counterpartyBic: "TESTDEFFXXX",
  });
});

test("CSV-CAMT V8: Lastschrift mit Gläubiger-ID und Gutschrift mit positivem Betrag", () => {
  const lines = byLine(analyzeFile(fixture, camt));
  assert.equal(lines[4].record.details.creditorId, "DE00ZZZ00000000001");
  assert.equal(lines[4].record.details.mandateReference, "VERS-2024-0815");
  assert.equal(lines[5].record.cents, 234567);
  assert.equal(lines[6].record.purpose, "Miete Oktober Musterstraße 1");
});

test("CSV-CAMT V8: Zelle mit Formel wird als reiner Text gespeichert", () => {
  const { record } = byLine(analyzeFile(fixture, camt))[11];
  assert.equal(record.counterparty, `'=HYPERLINK("http://example.invalid";"Gewinn")`);
});

test("CSV-CAMT V8: dieselbe Datei in UTF-8 mit BOM ergibt dasselbe Ergebnis", () => {
  const text = fixture.toString("latin1");
  const utf8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]);
  assert.deepEqual(analyzeFile(utf8, camt), analyzeFile(fixture, camt));
});

test("Profilprüfung: fehlende Spalten brechen ab und nennen erwartete und gefundene Spalten", () => {
  const file = csv(['"Datum";"Betrag";"Name"', '"01.02.2026";"-1,00";"X"']);
  try {
    analyzeFile(file, camt);
    assert.fail("ImportError erwartet");
  } catch (e) {
    assert.ok(e instanceof ImportError);
    assert.equal(e.status, 422);
    assert.match(e.message, /passt nicht zum Profil „CSV-CAMT V8“/);
    assert.deepEqual(e.details.mismatch.found, ["Datum", "Betrag", "Name"]);
    assert.deepEqual(e.details.mismatch.expected, camt.expectedColumns);
    assert.ok(e.details.mismatch.missing.includes("Buchungstag"));
    assert.ok(!e.details.mismatch.missing.includes("Betrag"));
  }
});

test("Profilprüfung: Spaltennamen ohne Rücksicht auf Groß-/Kleinschreibung und Leerraum, Reihenfolge egal", () => {
  const rows = analyzeFile(csv(["zweck; NAME ;betrag;DATUM", "Miete;Vermieter;-850,00;01.10.2026"]), simple);
  assert.equal(rows[0].status, "new");
  assert.equal(rows[0].record.cents, -85000);
  assert.equal(rows[0].record.counterparty, "Vermieter");
});

test("Profilprüfung: Hinweis auf falsches Trennzeichen", () => {
  rejects(() => analyzeFile(csv(["Datum,Betrag,Name,Zweck", "01.02.2026,-1,X,Y"]), simple), 422, /anderes Trennzeichen als „;“/);
});

test("Datei: Binärdaten werden abgelehnt", () => {
  rejects(() => analyzeFile(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]), simple), 415, /keine CSV-Datei/);
});

test("Datei: falsche Zeichenkodierung wird gemeldet", () => {
  rejects(() => analyzeFile(Buffer.from("Datum;Betrag\n01.02.2026;Müller", "latin1"), simple), 422, /Zeichenkodierung \(utf-8\)/);
});

test("Datei: leere Datei und kaputte Anführungszeichen", () => {
  rejects(() => analyzeFile(csv(["", ""]), simple), 422, /keine Spaltenüberschrift/);
  rejects(() => analyzeFile(csv(["Datum;Betrag;Name;Zweck", '01.02.2026;-1,00;"offen;x']), simple), 422, /Zeile 2 wird nicht geschlossen/);
});

test("Datei: zu viele Datensätze", () => {
  const lines = ["Datum;Betrag;Name;Zweck", ...Array(4).fill("01.02.2026;-1,00;X;Y")];
  rejects(() => analyzeFile(csv(lines), simple, { maxRows: 3 }), 422, /höchstens 3/);
  assert.equal(analyzeFile(csv(lines), simple, { maxRows: 4 }).length, 4);
});

test("Zeilen: falsche Spaltenzahl, fehlende Pflichtwerte, Betrag 0", () => {
  const rows = analyzeFile(
    csv(["Datum;Betrag;Name;Zweck", "01.02.2026;-1,00;X", "01.02.2026;-1,00;X;Y;;", ";;X;Y", "01.02.2026;0,00;X;Y", "01.02.2026;-1,00;X;Y;Z"]),
    simple,
  );
  assert.deepEqual(
    rows.map((r) => [r.line, r.status, r.reason]),
    [
      [2, "invalid", "Die Zeile hat 3 statt 4 Spalten."],
      [3, "new", undefined],
      [4, "invalid", "Spalte „Datum“ ist leer; Spalte „Betrag“ ist leer"],
      [5, "invalid", "Der Betrag ist 0,00"],
      [6, "invalid", "Die Zeile hat 5 statt 4 Spalten."],
    ],
  );
});

test("Kopfzeilen vor der Spaltenüberschrift werden übersprungen, Zeilennummern bleiben richtig", () => {
  const profile = compileProfile("mit-kopf", {
    name: "Mit Kopf",
    delimiter: ",",
    skipLines: 2,
    dateFormats: ["YYYY-MM-DD"],
    decimalSeparator: ".",
    columns: { date: "Date", amount: "Amount" },
  });
  const rows = analyzeFile(csv(["Konto: Test", "Zeitraum: 2026", "Date,Amount", "2026-01-15,12.5", "2026-13-01,1"]), profile);
  assert.deepEqual(rows.map((r) => [r.line, r.status]), [[4, "new"], [5, "invalid"]]);
  assert.equal(rows[0].record.cents, 1250);
});

test("Duplikate: bekannte Umsätze werden erkannt, neue nicht", () => {
  const rows = analyzeFile(fixture, camt);
  const known = byLine(rows)[3].record.hash;
  markDuplicates(rows, new Map([[known, 1]]));
  assert.equal(byLine(rows)[3].status, "duplicate");
  assert.deepEqual(countStatuses(rows), { total: 11, new: 6, duplicate: 1, skipped: 1, invalid: 3 });
});

test("Duplikate: gleiche Umsätze in einer Datei zählen nur so oft als Duplikat, wie sie gespeichert sind", () => {
  const rows = analyzeFile(fixture, camt);
  const lines = byLine(rows);
  assert.equal(lines[7].record.hash, lines[8].record.hash, "zwei gleiche Parkhaus-Buchungen");

  markDuplicates(rows, new Map());
  assert.deepEqual([lines[7].status, lines[8].status], ["new", "new"]);
  markDuplicates(rows, new Map([[lines[7].record.hash, 1]]));
  assert.deepEqual([lines[7].status, lines[8].status], ["duplicate", "new"]);
  markDuplicates(rows, new Map([[lines[7].record.hash, 2]]));
  assert.deepEqual([lines[7].status, lines[8].status], ["duplicate", "duplicate"]);
});

test("Duplikate: Fingerabdruck ignoriert Leerraum und Groß-/Kleinschreibung, unterscheidet aber Betrag und Datum", () => {
  const hash = (line) =>
    analyzeFile(csv(["Datum;Betrag;Name;Zweck", line]), simple)[0].record.hash;
  const base = hash("01.02.2026;-12,50;Muster GmbH;Rechnung 1");
  assert.equal(hash("01.02.2026;-12,50;  muster   GMBH ;Rechnung  1"), base);
  assert.notEqual(hash("01.02.2026;-12,51;Muster GmbH;Rechnung 1"), base);
  assert.notEqual(hash("01.02.2026;12,50;Muster GmbH;Rechnung 1"), base);
  assert.notEqual(hash("02.02.2026;-12,50;Muster GmbH;Rechnung 1"), base);
  assert.notEqual(hash("01.02.2026;-12,50;Muster GmbH;Rechnung 2"), base);
});

test("Vorschau: Anzahlen, erste Datensätze, Duplikate, Fehler und gruppierte Auslassungen", () => {
  const rows = analyzeFile(fixture, camt);
  markDuplicates(rows, new Map([[byLine(rows)[3].record.hash, 1]]));
  const preview = buildPreview(rows);

  assert.deepEqual(preview.counts, { total: 11, new: 6, duplicate: 1, skipped: 1, invalid: 3 });
  assert.equal(preview.sample.length, 7);
  assert.deepEqual(preview.sample[0], {
    line: 3,
    date: "2026-10-27",
    amount: -23.47,
    counterparty: "Supermarkt Müller",
    purpose: "2026-10-26T12:05 Debitk.1 2029-12",
    duplicate: true,
  });
  assert.deepEqual(preview.duplicates.map((d) => d.line), [3]);
  assert.deepEqual(preview.errors.map((e) => e.line), [9, 10, 12]);
  assert.deepEqual(preview.skipped, [{ reason: "Vorgemerkter Umsatz (noch nicht gebucht)", count: 1 }]);
});

test("Vorschau: höchstens zehn Beispielzeilen", () => {
  const lines = ["Datum;Betrag;Name;Zweck", ...Array.from({ length: 25 }, (_, i) => `01.02.2026;-${i + 1},00;X;Y`)];
  const preview = buildPreview(markDuplicates(analyzeFile(csv(lines), simple), new Map()));
  assert.equal(preview.counts.new, 25);
  assert.equal(preview.sample.length, 10);
});
