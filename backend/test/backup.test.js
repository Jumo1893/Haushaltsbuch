const test = require("node:test");
const assert = require("node:assert/strict");
const {
  VERSION,
  BackupError,
  AREAS,
  TABLES,
  selectSql,
  fileNameFor,
  writeBackup,
  readBackup,
  readDecimal,
} = require("../backup/format");

// Erfundene Daten für alle drei Bereiche, mit allem, was beim Schreiben und Lesen schiefgehen kann
const CREATED = "2026-11-17T19:15:00.000Z";
const TIME = "2026-10-01T08:00:00.123456Z";

const AREA_TABLES = {
  transactions: {
    accounts: [
      {
        id: 1, name: "Girokonto", kind: "giro", institution: "Beispielbank", iban: "DE89370400440532013000",
        extra_ibans: ["DE02120300000000202051", "DE12500105170648489890"], bank_balance: "-1234.50",
        bank_balance_date: "2026-10-31", cash_account_id: null, auto_prices_since: null, created_at: TIME,
      },
      {
        id: 4, name: "Broker Depot", kind: "depot", institution: "", iban: null, extra_ibans: [], bank_balance: null,
        bank_balance_date: null, cash_account_id: 1, auto_prices_since: "2026-11-04T10:00:00.000000Z", created_at: TIME,
      },
    ],
    imports: [
      {
        id: 2, profile_id: "csv-camt-v8", profile_name: "Sparkasse (CSV-CAMT V8)", file_name: "umsätze;oktober.csv",
        imported_count: 3, depot_count: 1, duplicate_count: 0, skipped_count: 2, invalid_count: 0, created_at: TIME,
      },
    ],
    transactions: [
      {
        id: 10, account_id: 1, date: "2026-10-02", type: "out", amount: "42.50", category: "Lebensmittel",
        category_manual: false, note: "", counterparty: "SUPERMARKT 4711", purpose: "Kartenzahlung\nFiliale Nord",
        rhythm: null, transfer_override: null, linked_id: 11, rule_id: 3, import_id: 2, import_hash: "ab12cd",
        details: '{"mcc": "5411", "fee": 0.30, "bookingText": "KARTENZAHLUNG"}', created_at: TIME,
      },
      {
        id: 11, account_id: 1, date: "2026-10-03", type: "in", amount: "1000.00", category: "Sonstiges",
        category_manual: true, note: "-50 € Rabatt", counterparty: "=HYPERLINK(\"x\")", purpose: "'zitiert",
        rhythm: "monthly", transfer_override: false, linked_id: 10, rule_id: null, import_id: null, import_hash: null,
        details: null, created_at: TIME,
      },
      {
        id: 12, account_id: 4, date: "2026-10-04", type: "out", amount: "0.01", category: "Investieren",
        category_manual: true, note: "  Leerraum am Rand ", counterparty: "@Händler", purpose: "+49 Telefon; \"Ziffern\"",
        rhythm: "yearly", transfer_override: true, linked_id: null, rule_id: null, import_id: null, import_hash: null,
        details: "{}", created_at: TIME,
      },
    ],
    depot_movements: [
      {
        id: 5, account_id: 4, import_id: 2, import_hash: "ff00", date: "2026-10-05", occurred_at: TIME,
        section: "TRADING", type: "BUY", isin: "US5949181045", name: "Microsoft", asset_class: "STOCK",
        shares: "0.1234567890", price: "400.5000000000", amount: "-49.45", fee: "-1.00", tax: "0.00",
      },
      {
        id: 6, account_id: 4, import_id: null, import_hash: "ff01", date: "2026-10-06", occurred_at: null,
        section: "CASH", type: "DIVIDEND", isin: "US5949181045", name: "", asset_class: "", shares: null, price: null,
        amount: "0.17", fee: "0.00", tax: "-0.03",
      },
    ],
    depot_prices: [
      { isin: "US5949181045", date: "2026-11-03", price: "401.2500000000", source: "ls", fetched_at: TIME },
      { isin: "ADA", date: "2026-11-03", price: "0.5432100000", source: "kraken", fetched_at: TIME },
    ],
  },
  debts: {
    people: [
      { id: 1, name: "Anna", created_at: TIME },
      { id: 2, name: "Ben Beispiel", created_at: TIME },
    ],
    debts: [
      {
        id: 7, person_id: 1, date: "2026-10-02", amount: "10.00", kind: "debt", reason: "Netflix", settled_by: 8,
        settles_selected: false, transaction_id: 10, transaction_date: "2026-10-02", transaction_type: "out",
        transaction_amount: "42.50", created_at: TIME,
      },
      {
        id: 8, person_id: 1, date: "2026-10-09", amount: "-10.00", kind: "settlement", reason: "", settled_by: null,
        settles_selected: true, transaction_id: null, transaction_date: null, transaction_type: null,
        transaction_amount: null, created_at: TIME,
      },
      {
        id: 9, person_id: 2, date: "2026-10-10", amount: "-3.33", kind: "debt", reason: "Pizza; groß", settled_by: null,
        settles_selected: false, transaction_id: null, transaction_date: null, transaction_type: null,
        transaction_amount: null, created_at: TIME,
      },
    ],
  },
  settings: {
    categories: [
      { id: 1, kind: "out", name: "Lebensmittel", auto_key: "food" },
      { id: 7, kind: "out", name: "Sonstiges", auto_key: null },
      { id: 8, kind: "in", name: "Sonstiges", auto_key: null },
      { id: 12, kind: "transfer", name: "Sonstiges", auto_key: null },
      { id: 13, kind: "transfer", name: "Investieren", auto_key: null },
    ],
    rules: [
      {
        id: 3, kind: "out", type: "out", counterparty: "SUPERMARKT 4711", amount: null, category_id: 1, rhythm: null,
        created_at: TIME,
      },
      {
        id: 4, kind: "out", type: "out", counterparty: "Streaming  Dienst", amount: "21.42", category_id: 1,
        rhythm: "monthly", created_at: TIME,
      },
    ],
  },
};

/** Wie readBackup die Werte aufbereitet: Dezimalzahlen ohne Nullen am Ende */
const canonical = (value) => (typeof value === "string" && /^-?\d+\.\d+$/.test(value) ? readDecimal(value, 10, 14) : value);

const withoutLines = (rows) => rows.map(({ line, ...row }) => row);

const write = (area, tables = AREA_TABLES[area]) => writeBackup(area, tables, CREATED);
const read = (text, name = "sicherung.csv") => readBackup(Buffer.from(text, "utf8"), name);

/** Erwartet einen BackupError, dessen Meldung zum Muster passt */
const rejects = (fn, pattern) =>
  assert.throws(fn, (e) => {
    assert.ok(e instanceof BackupError, `kein BackupError: ${e}`);
    assert.match(e.message, pattern);
    return true;
  });

/** Ersetzt eine Zeile der Datei; Zeilen ab 1 gezählt */
function replaceLine(text, number, change) {
  const lines = text.split("\r\n");
  lines[number - 1] = change(lines[number - 1]);
  return lines.join("\r\n");
}

/** Nummer der ersten Zeile, die mit prefix beginnt */
const lineOf = (text, prefix) => text.replace(/^﻿/, "").split("\r\n").findIndex((l) => l.startsWith(prefix)) + 1;

test("Sicherung: jeder Bereich kommt nach Schreiben und Lesen unverändert zurück", () => {
  for (const area of Object.keys(AREAS)) {
    const backup = read(write(area));
    assert.equal(backup.area, area);
    assert.equal(backup.version, VERSION);
    assert.equal(backup.created, CREATED);
    for (const table of AREAS[area].tables) {
      const expected = AREA_TABLES[area][table].map((row) =>
        Object.fromEntries(Object.entries(row).map(([key, value]) => [key, canonical(value)])),
      );
      assert.deepEqual(withoutLines(backup.tables[table]), expected, `${area}/${table}`);
    }
  }
});

test("Sicherung: UTF-8 mit BOM, Semikolon, CRLF, ein Abschnitt je Tabelle mit den Spalten der Datenbank", () => {
  const text = write("settings");
  assert.ok(text.startsWith("﻿[backup]\r\nformat;area;version;created\r\nhaushaltsbuch;settings;1;"));
  assert.ok(text.includes("\r\n\r\n[categories]\r\nid;kind;name;auto_key\r\n1;out;Lebensmittel;food\r\n7;out;Sonstiges;\r\n"));
  assert.ok(text.includes("[rules]\r\nid;kind;type;counterparty;amount;category_id;rhythm;created_at\r\n"));
  for (const area of Object.keys(AREAS)) {
    const sections = [...write(area).replace(/^﻿/, "").matchAll(/^\[(\w+)\]$/gm)].map((m) => m[1]);
    assert.deepEqual(sections, ["backup", ...AREAS[area].tables]);
  }
});

test("Sicherung: Beträge mit Dezimalkomma, Zahlen ohne Nullen am Ende, leere Zelle für NULL", () => {
  const text = write("transactions");
  assert.ok(text.includes("1;Girokonto;giro;Beispielbank;DE89370400440532013000;DE02120300000000202051 DE12500105170648489890;-1234,50;2026-10-31;;;"));
  assert.ok(text.includes(";-49,45;-1,00;0,00"), "Beträge mit zwei Nachkommastellen");
  assert.ok(text.includes(";0,123456789;400,5;"), "Stückzahl und Kurs ohne Nullen am Ende");
  assert.ok(text.includes("ADA;2026-11-03;0,54321;kraken;"));
});

test("Sicherung: Texte, die Excel als Formel läse, beginnen mit '; Trennzeichen, Anführungszeichen und Umbrüche in Anführungszeichen", () => {
  const text = write("transactions");
  const line = (id) => text.split("\r\n").find((l) => l.startsWith(`${id};`));
  assert.ok(line(11).includes(";'-50 € Rabatt;\"'=HYPERLINK(\"\"x\"\")\";''zitiert;monthly;false;"), line(11));
  assert.ok(line(12).includes(";\"  Leerraum am Rand \";'@Händler;\"'+49 Telefon; \"\"Ziffern\"\"\";yearly;true;"), line(12));
  assert.ok(text.includes(";\"Kartenzahlung\nFiliale Nord\";"), "Zeilenumbruch bleibt in der Zelle");
  assert.ok(text.includes(';"umsätze;oktober.csv";'));
});

test("Abfragen: Spalten in der Reihenfolge der Datei, Zeitpunkte in UTC, Beträge als Text, Schulden mit Tag, Richtung und Betrag der Buchung", () => {
  const sql = selectSql("debts");
  assert.match(sql, /^SELECT x\.id AS "id", x\.person_id AS "person_id", to_char\(x\.date, 'YYYY-MM-DD'\) AS "date", x\.amount::text AS "amount"/);
  assert.match(sql, /to_char\(t\.date, 'YYYY-MM-DD'\) AS "transaction_date", t\.type AS "transaction_type", t\.amount::text AS "transaction_amount"/);
  assert.match(sql, /FROM debts x LEFT JOIN transactions t ON t\.id = x\.transaction_id ORDER BY x\.id$/);
  assert.match(selectSql("transactions"), /to_char\(x\.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS\.US"Z"'\) AS "created_at"/);
  assert.match(selectSql("transactions"), /x\.details::text AS "details"/);
  assert.match(selectSql("depot_prices"), /FROM depot_prices x ORDER BY x\.isin, x\.date$/);
  for (const [table, { columns }] of Object.entries(TABLES)) {
    assert.equal((selectSql(table).match(/ AS "/g) ?? []).length, columns.length, table);
  }
});

test("Dateiname: Bereich und Tag in deutscher Zeit", () => {
  assert.equal(fileNameFor("transactions", "2026-11-17T12:00:00Z"), "haushaltsbuch-buchungen-2026-11-17.csv");
  assert.equal(fileNameFor("debts", "2026-11-17T23:30:00Z"), "haushaltsbuch-schulden-2026-11-18.csv");
  assert.equal(fileNameFor("settings", "2026-07-01T22:30:00Z"), "haushaltsbuch-einstellungen-2026-07-02.csv");
});

test("Lesen: was Excel beim Speichern ändert, kommt richtig an", () => {
  let text = write("debts").replace(/^﻿/, "");
  // Datum als TT.MM.JJJJ, WAHR/FALSCH, Dezimalpunkt, Leerraum um Zahlen, zusätzliche leere Spalten
  text = text.replace("2026-10-10;-3,33;debt", "10.10.2026; -3.33 ;debt").replace(";true;", ";WAHR;").replace(/;false;/g, ";FALSCH;");
  text = text.replace("[people]", "[people];;").replace("id;name;created_at", "id;name;created_at;;");
  const backup = read(text);
  const debt = backup.tables.debts.find((d) => d.id === 9);
  assert.equal(debt.date, "2026-10-10");
  assert.equal(debt.amount, "-3.33");
  assert.equal(backup.tables.debts.find((d) => d.id === 8).settles_selected, true);
  assert.equal(debt.settles_selected, false);
  assert.equal(backup.tables.people.length, 2);
});

test("Lesen: Windows-1252, Komma oder Tabulator als Trennzeichen und zusätzliche Spalten", () => {
  const text = write("debts").replace(/^﻿/, "").replace('"Pizza; groß"', "Pizza groß");
  const ansi = Buffer.from(text, "latin1");
  assert.equal(readBackup(ansi, "a.csv").tables.debts.find((d) => d.id === 9).reason, "Pizza groß");

  // Excel mit englischen Einstellungen: Komma trennt, Zellen mit Komma stehen in Anführungszeichen
  const comma = text
    .split("\r\n")
    .map((line) => line.split(";").map((cell) => (cell.includes(",") ? `"${cell}"` : cell)).join(","))
    .join("\r\n");
  const fromComma = read(comma);
  assert.equal(fromComma.tables.debts.find((d) => d.id === 8).amount, "-10");
  assert.equal(fromComma.tables.debts.find((d) => d.id === 7).transaction_amount, "42.5");

  const tab = text.replace(/;/g, "\t");
  assert.equal(read(tab).tables.people[1].name, "Ben Beispiel");

  const extra = text.replace("id;name;created_at", "id;name;created_at;Notiz");
  assert.equal(read(extra).tables.people[0].name, "Anna");
});

test("Lesen: Spalten dürfen in anderer Reihenfolge stehen", () => {
  const text = write("settings").replace("id;kind;name;auto_key", "name;auto_key;kind;id").replace(
    /^(\d+);(\w+);([^;\r\n]*);([^;\r\n]*)$/gm,
    (_, id, kind, name, key) => `${name};${key};${kind};${id}`,
  );
  const backup = read(text);
  assert.deepEqual(withoutLines(backup.tables.categories), AREA_TABLES.settings.categories);
});

test("Lesen: keine Sicherung, neueres Format, falsche oder fehlende Abschnitte", () => {
  rejects(() => read("Buchungstag;Betrag\r\n01.10.2026;-12,00\r\n", "bank.csv"), /^bank\.csv: Das ist keine Datensicherung/);
  rejects(() => read(write("debts").replace("haushaltsbuch;debts", "anderes;debts")), /keine Datensicherung/);
  rejects(() => read(write("debts").replace(";debts;1;", `;debts;${VERSION + 1};`)), /Format 2, dieses Haushaltsbuch kennt nur Format 1/);
  rejects(() => read(write("debts").replace(";debts;1;", ";konten;1;")), /area muss einer dieser Werte sein: transactions, settings, debts/);
  rejects(() => read(write("debts").replace("[people]", "[personen]")), /Zeile 5: Den Abschnitt \[personen\] gibt es nicht/);
  rejects(() => read(write("debts").replace("[people]", "[categories]")), /\[categories\] gehört nicht zu „Schulden“/);
  rejects(() => read(write("debts").replace(/\[people\][^[]*/, "")), /Es fehlen die Abschnitte \[people\]/);
  rejects(() => read(`${write("debts")}\r\n[people]\r\nid;name;created_at\r\n`), /Der Abschnitt \[people\] kommt zweimal vor/);
  rejects(() => read(write("debts").replace("id;name;created_at", "id;created_at")), /Zeile 6: In \[people\] fehlen die Spalten name/);
  rejects(() => read(write("debts").replace("id;name;created_at", "id;name;name;created_at")), /Spalte name kommt in \[people\] zweimal vor/);
  rejects(
    () => read(write("debts").replace("haushaltsbuch;debts;1;2026-11-17T19:15:00.000Z", "haushaltsbuch;debts;1;2026-11-17T19:15:00.000Z\r\nhaushaltsbuch;debts;1;2026-11-17T19:15:00.000Z")),
    /In \[backup\] steht nicht genau eine Zeile/,
  );
});

test("Lesen: ungültige Werte mit Datei, Zeile, Spalte und Wert", () => {
  const text = write("transactions");
  const at = lineOf(text, "10;1;");
  const change = (from, to) => read(replaceLine(text, at, (l) => l.replace(from, to)), "b.csv");
  rejects(() => change("2026-10-02", "2026-02-30"), new RegExp(`^b\\.csv, Zeile ${at}: date ist kein gültiges Datum \\(„2026-02-30“\\)\\.$`));
  rejects(() => change(";42,50;", ";42,505;"), /amount ist kein gültiger Betrag \(„42,505“\)/);
  rejects(() => change(";42,50;", ";1.042,50;"), /amount ist kein gültiger Betrag/);
  rejects(() => change(";42,50;", ";0,00;"), /amount muss größer als 0 sein/);
  rejects(() => change(";out;", ";aus;"), /type muss einer dieser Werte sein: in, out/);
  rejects(() => change(";false;", ";vielleicht;"), /category_manual muss true oder false sein/);
  rejects(() => change(";Lebensmittel;", ";;"), /category fehlt\.$/);
  rejects(() => change(";Lebensmittel;", ";  ;"), /category fehlt\.$/);
  rejects(() => change(/^10;/, ";"), /id fehlt/);
  rejects(() => change('{""mcc""', '{mcc'), /details ist kein gültiges JSON/);
  rejects(() => change(TIME, "2026-10-01 08:00"), /created_at ist kein gültiger Zeitpunkt/);
});

test("Lesen: Verweise und doppelte Einträge in Buchungen und Konten", () => {
  const text = write("transactions");
  const tx = lineOf(text, "10;1;");
  rejects(() => read(replaceLine(text, tx, (l) => l.replace(/^10;1;/, "10;9;"))), new RegExp(`Zeile ${tx}: account_id 9 gibt es in \\[accounts\\] nicht`));
  rejects(() => read(replaceLine(text, tx, (l) => l.replace(";11;3;2;", ";99;3;2;"))), /linked_id 99 gibt es in \[transactions\] nicht/);
  rejects(() => read(replaceLine(text, tx, (l) => l.replace(";11;3;2;", ";10;3;2;"))), /nicht ihre eigene Gegenbuchung/);
  rejects(() => read(replaceLine(text, tx, (l) => l.replace(";11;3;2;", ";11;3;5;"))), /import_id 5 gibt es in \[imports\] nicht/);
  rejects(() => read(replaceLine(text, tx, (l) => l.replace(/^10;/, "11;"))), /Die ID 11 kommt in \[transactions\] zweimal vor/);
  const depot = lineOf(text, "4;Broker");
  rejects(() => read(replaceLine(text, depot, (l) => l.replace(";;1;", ";;4;"))), /nicht sein eigenes Geldkonto/);
  rejects(
    () => read(replaceLine(text, depot, (l) => l.replace("depot;;;;;;1;", "depot;;DE89370400440532013000;;;;1;"))),
    /Die IBAN DE89370400440532013000 kommt zweimal vor/,
  );
  const giro = lineOf(text, "1;Girokonto");
  rejects(() => read(replaceLine(text, giro, (l) => l.replace(";2026-10-31;", ";;"))), /bank_balance und bank_balance_date gibt es nur zusammen/);
  const price = lineOf(text, "ADA;");
  rejects(() => read(replaceLine(text, price, (l) => l.replace("ADA", "US5949181045"))), /Der Kurs von US5949181045 am 2026-11-03 kommt zweimal vor/);
  rejects(() => read(replaceLine(text, price, (l) => l.replace("0,54321", "0"))), /price muss größer als 0 sein/);
});

test("Lesen: Verweise in Schulden und Einstellungen", () => {
  const debts = write("debts");
  const settled = lineOf(debts, "7;1;");
  rejects(() => read(replaceLine(debts, settled, (l) => l.replace(";Netflix;8;", ";Netflix;9;"))), /settled_by muss bei einer Schuld auf einen Ausgleich derselben Person/);
  rejects(() => read(replaceLine(debts, settled, (l) => l.replace(";Netflix;8;", ";Netflix;5;"))), /settled_by 5 gibt es in \[debts\] nicht/);
  rejects(() => read(replaceLine(debts, settled, (l) => l.replace(";2026-10-02;out;42,50;", ";;out;42,50;"))), /Zur Buchung 10 fehlen transaction_date/);
  rejects(() => read(replaceLine(debts, settled, (l) => l.replace(";10,00;", ";0;"))), /amount darf nicht 0 sein/);
  rejects(() => read(replaceLine(debts, lineOf(debts, "2;Ben"), (l) => l.replace("Ben Beispiel", "ANNA"))), /Der Name „ANNA“ kommt zweimal vor/);
  rejects(() => read(replaceLine(debts, settled, (l) => l.replace(/^7;1;/, "7;3;"))), /person_id 3 gibt es in \[people\] nicht/);

  const settings = write("settings");
  rejects(() => read(settings.replace("7;out;Sonstiges;", "7;out;Andere;")), /Die Kategorie „Sonstiges“ \(out\) fehlt/);
  rejects(() => read(settings.replace("13;transfer;Investieren;", "13;transfer;Investieren;food")), /Die automatische Zuordnung food kommt zweimal vor/);
  rejects(() => read(settings.replace("13;transfer;Investieren;", "13;transfer;Sonstiges;")), /Die Kategorie „Sonstiges“ \(transfer\) kommt zweimal vor/);
  const rule = lineOf(settings, "4;out;");
  rejects(() => read(replaceLine(settings, rule, (l) => l.replace(";21,42;1;", ";21,42;13;"))), /Die Kategorie 13 gehört nicht zur Art out/);
  rejects(() => read(replaceLine(settings, rule, (l) => l.replace(";21,42;1;", ";21,42;99;"))), /category_id 99 gibt es in \[categories\] nicht/);
  rejects(() => read(replaceLine(settings, rule, (l) => l.replace("Streaming  Dienst;21,42", " supermarkt   4711 ;"))), /Die gemerkte Zuordnung für „ supermarkt   4711 “ kommt zweimal vor/);
  assert.equal(read(replaceLine(settings, rule, (l) => l.replace("Streaming  Dienst", "Supermarkt 4711"))).tables.rules.length, 2, "anderer Betrag ist eine eigene Zuordnung");
});

test("Dezimalzahlen: Komma oder Punkt, Nullen am Ende zählen nicht, Grenzen der Spalte", () => {
  assert.equal(readDecimal("12,30", 2, 10), "12.3");
  assert.equal(readDecimal("-0012.00", 2, 10), "-12");
  assert.equal(readDecimal("-0,00", 2, 10), "0");
  assert.equal(readDecimal("+5", 2, 10), "5");
  assert.equal(readDecimal("12,", 2, 10), "12");
  assert.equal(readDecimal("9999999999,99", 2, 10), "9999999999.99");
  assert.equal(readDecimal("99999999999", 2, 10), undefined);
  assert.equal(readDecimal("1,234", 2, 10), undefined);
  assert.equal(readDecimal("1,2300000", 2, 10), "1.23");
  assert.equal(readDecimal("0,1234567890", 10, 14), "0.123456789");
  assert.equal(readDecimal("1.234,56", 2, 10), undefined);
  assert.equal(readDecimal(",5", 2, 10), undefined);
  assert.equal(readDecimal("1e3", 2, 10), undefined);
});
