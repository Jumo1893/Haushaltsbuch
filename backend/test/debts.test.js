const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_ENTRIES,
  DebtError,
  personName,
  readEntry,
  readEntries,
  readDebtQuery,
  bookingProblem,
  checkBooking,
  personIds,
  createEntries,
  updateEntry,
} = require("../debts");

/**
 * Datenbank zum Mitschreiben: Jede Abfrage beantwortet die erste Antwort, deren Muster passt. Eine Antwort ist eine
 * Funktion der Parameter oder ein fester Wert ({ rows }).
 */
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

const entry = { person: "Anna", date: "2026-11-02", amount: 10, kind: "debt", reason: "Netflix" };

test("Name: ohne doppelten Leerraum, höchstens 40 Zeichen, leer ist kein Name", () => {
  assert.equal(personName("  Anna   Muster "), "Anna Muster");
  assert.equal(personName("x".repeat(50)), "x".repeat(40));
  assert.equal(personName(`${"x".repeat(39)} y`), "x".repeat(39), "kein Leerzeichen am Ende");
  assert.equal(personName("   "), null);
  assert.equal(personName(7), null);
  assert.equal(personName(undefined), null);
});

test("Eintrag: Betrag mit Vorzeichen auf Cent, Grund gekürzt, ohne Buchung null", () => {
  assert.deepEqual(readEntry(entry), {
    values: { person: "Anna", date: "2026-11-02", amount: "10.00", kind: "debt", reason: "Netflix", transaction_id: null },
  });
  const settlement = readEntry({ ...entry, amount: "-12.346", kind: "settlement", reason: undefined, transactionId: 9 });
  assert.deepEqual(settlement.values, {
    person: "Anna",
    date: "2026-11-02",
    amount: "-12.35",
    kind: "settlement",
    reason: "",
    transaction_id: 9,
  });
  assert.equal(readEntry({ ...entry, reason: "a ".repeat(80) }).values.reason.length, 100);
});

test("Eintrag: ungültige Eingaben nennen den Grund", () => {
  const invalid = {
    "ohne Person": { ...entry, person: undefined },
    "leere Person": { ...entry, person: "  " },
    "ohne Datum": { ...entry, date: undefined },
    "30. Februar": { ...entry, date: "2026-02-30" },
    "Betrag 0": { ...entry, amount: 0 },
    "Betrag unter einem Cent": { ...entry, amount: 0.004 },
    "Betrag als Wort": { ...entry, amount: "zehn" },
    "Betrag leer": { ...entry, amount: " " },
    "Betrag zu groß": { ...entry, amount: 1e10 },
    "unbekannte Art": { ...entry, kind: "loan" },
    "Buchung als Text": { ...entry, transactionId: "9" },
    "Buchung 0": { ...entry, transactionId: 0 },
  };
  for (const [name, body] of Object.entries(invalid)) assert.ok(readEntry(body).error, name);
  assert.ok(readEntry(null).error);
  assert.ok(readEntry([entry]).error);
});

test("Eintrag ändern: nur übergebene Felder, die Buchung bleibt", () => {
  assert.deepEqual(readEntry({ amount: -5 }, true), { values: { amount: "-5.00" } });
  assert.deepEqual(readEntry({ reason: " Kino ", person: "Ben" }, true), { values: { reason: "Kino", person: "Ben" } });
  assert.deepEqual(readEntry({}, true), { values: {} });
  assert.ok(readEntry({ transactionId: 3 }, true).error);
  assert.ok(readEntry({ transactionId: null }, true).error);
  assert.ok(readEntry({ amount: 0 }, true).error);
});

test("Mehrere Einträge: 1 bis 50, ein ungültiger verhindert alle", () => {
  assert.equal(readEntries({ entries: [entry, { ...entry, person: "Ben" }] }).entries.length, 2);
  assert.ok(readEntries({ entries: [] }).error);
  assert.ok(readEntries({}).error);
  assert.ok(readEntries(undefined).error);
  assert.ok(readEntries({ entries: entry }).error);
  assert.ok(readEntries({ entries: Array(MAX_ENTRIES + 1).fill(entry) }).error);
  assert.match(readEntries({ entries: [entry, { ...entry, amount: 0 }] }).error, /Betrag/);
});

test("Abfrage: Einträge einer Person oder einer Buchung", () => {
  assert.deepEqual(readDebtQuery({ person: "3" }), { person: 3, transaction: null });
  assert.deepEqual(readDebtQuery({ transaction: "12" }), { person: null, transaction: 12 });
  for (const query of [{}, { person: "0" }, { person: "x" }, { transaction: "-1" }, { person: "1.5" }]) {
    assert.ok(readDebtQuery(query).error, JSON.stringify(query));
  }
});

test("Buchung: Abbuchung erhöht, was andere dir schulden, Gutschrift senkt es", () => {
  const out = { type: "out", amount: "40.00" };
  assert.equal(bookingProblem(out, ["10.00", "10.00", "10.00"]), null, "Netflix für vier");
  assert.equal(bookingProblem(out, ["40.00"]), null, "ganzer Betrag");
  assert.equal(bookingProblem(out, []), null);
  assert.match(bookingProblem(out, ["10.00", "-10.00"]), /Abbuchung/);
  assert.match(bookingProblem(out, ["20.00", "20.01"]), /40,01\s€.*40,00\s€/, "mehr als der Betrag");
  const incoming = { type: "in", amount: "50.00" };
  assert.equal(bookingProblem(incoming, ["-50.00"]), null, "Rückzahlung");
  assert.match(bookingProblem(incoming, ["50.00"]), /Gutschrift/);
  assert.match(bookingProblem(incoming, [-30, -20.5]), /übersteigen/);
});

test("Buchung prüfen: sperrt sie und wirft bei einem Problem", async () => {
  const answers = (amounts) => [
    [/^SELECT type, amount FROM transactions/, { rows: [{ type: "out", amount: "40.00" }] }],
    [/^SELECT amount FROM debts/, { rows: amounts.map((amount) => ({ amount })) }],
  ];
  const db = fakeDb(answers(["10.00", "30.00"]));
  await checkBooking(db, 7);
  assert.match(db.queries[0].sql, /FOR UPDATE/);
  assert.deepEqual(db.queries[1].params, [7]);
  await assert.rejects(checkBooking(fakeDb(answers(["10.00", "30.01"])), 7), (e) => e instanceof DebtError && e.status === 409);
  const gone = fakeDb([[/^SELECT type/, { rows: [] }]]);
  await checkBooking(gone, 7);
  assert.equal(gone.queries.length, 1, "ohne Buchung nichts zu prüfen");
});

test("Personen: unbekannte werden angelegt, Groß- und Kleinschreibung zählt nicht", async () => {
  const db = fakeDb([[/^WITH wanted/, { rows: [{ name: "Anna", id: 1 }, { name: "ben", id: 2 }] }]]);
  const ids = await personIds(db, ["Anna", "ben", "Anna"]);
  assert.deepEqual([...ids], [["Anna", 1], ["ben", 2]]);
  assert.deepEqual(db.queries[0].params, [["Anna", "ben"]]);
  assert.match(db.queries[0].sql, /ON CONFLICT \(\(lower\(name\)\)\) DO NOTHING/);
  const race = fakeDb([[/^WITH wanted/, { rows: [{ name: "Anna", id: null }] }]]);
  await assert.rejects(personIds(race, ["Anna"]), DebtError);
});

test("Anlegen: alle Einträge, dann jede Buchung einmal prüfen", async () => {
  let next = 100;
  const db = fakeDb([
    [/^WITH wanted/, { rows: [{ name: "Anna", id: 1 }, { name: "Ben", id: 2 }] }],
    [/^INSERT INTO debts/, () => ({ rows: [{ id: next++ }] })],
    [/^SELECT type, amount FROM transactions/, { rows: [{ type: "out", amount: "40.00" }] }],
    [/^SELECT amount FROM debts/, { rows: [{ amount: "10.00" }, { amount: "10.00" }] }],
  ]);
  const entries = readEntries({
    entries: [
      { ...entry, transactionId: 7 },
      { ...entry, person: "Ben", transactionId: 7 },
    ],
  }).entries;
  assert.deepEqual(await createEntries(db, entries), [100, 101]);
  const inserts = db.queries.filter((q) => q.sql.startsWith("INSERT"));
  assert.deepEqual(inserts.map((q) => q.params), [
    [1, "2026-11-02", "10.00", "debt", "Netflix", 7],
    [2, "2026-11-02", "10.00", "debt", "Netflix", 7],
  ]);
  assert.equal(db.queries.filter((q) => q.sql.includes("FOR UPDATE")).length, 1, "Buchung nur einmal geprüft");
});

test("Anlegen: ohne Buchung keine Prüfung", async () => {
  const db = fakeDb([
    [/^WITH wanted/, { rows: [{ name: "Anna", id: 1 }] }],
    [/^INSERT INTO debts/, { rows: [{ id: 5 }] }],
  ]);
  assert.deepEqual(await createEntries(db, readEntries({ entries: [entry] }).entries), [5]);
});

test("Anlegen: passt es nicht zur Buchung, wirft es", async () => {
  const db = fakeDb([
    [/^WITH wanted/, { rows: [{ name: "Anna", id: 1 }] }],
    [/^INSERT INTO debts/, { rows: [{ id: 5 }] }],
    [/^SELECT type, amount FROM transactions/, { rows: [{ type: "in", amount: "40.00" }] }],
    [/^SELECT amount FROM debts/, { rows: [{ amount: "10.00" }] }],
  ]);
  const entries = readEntries({ entries: [{ ...entry, transactionId: 7 }] }).entries;
  await assert.rejects(createEntries(db, entries), (e) => e instanceof DebtError && /Gutschrift/.test(e.message));
});

test("Ändern: neue Person über ihren Namen, Buchung danach geprüft", async () => {
  const db = fakeDb([
    [/^WITH wanted/, { rows: [{ name: "Ben", id: 2 }] }],
    [/^UPDATE debts/, { rows: [{ transaction_id: 7 }] }],
    [/^SELECT type, amount FROM transactions/, { rows: [{ type: "out", amount: "40.00" }] }],
    [/^SELECT amount FROM debts/, { rows: [{ amount: "15.00" }] }],
  ]);
  assert.equal(await updateEntry(db, 3, { person: "Ben", amount: "15.00" }), true);
  const update = db.queries.find((q) => q.sql.startsWith("UPDATE"));
  assert.match(update.sql, /SET amount = \$2, person_id = \$3 WHERE id = \$1/);
  assert.deepEqual(update.params, [3, "15.00", 2]);
});

test("Ändern: unbekannter Eintrag, ohne Buchung keine Prüfung", async () => {
  assert.equal(await updateEntry(fakeDb([[/^UPDATE debts/, { rows: [] }]]), 3, { reason: "Kino" }), false);
  const free = fakeDb([[/^UPDATE debts/, { rows: [{ transaction_id: null }] }]]);
  assert.equal(await updateEntry(free, 3, { amount: "-5.00" }), true);
  assert.equal(free.queries.length, 1);
});
