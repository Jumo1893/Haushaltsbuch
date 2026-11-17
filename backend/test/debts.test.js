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

test("Mehrere Einträge: 1 bis 5000, ein ungültiger verhindert alle", () => {
  const read = readEntries({ entries: [entry, { ...entry, person: "Ben" }] });
  assert.equal(read.entries.length, 2);
  assert.deepEqual(read.replace, [], "ohne replace nichts ersetzen");
  assert.equal(readEntries({ entries: Array(MAX_ENTRIES).fill(entry) }).entries.length, 5000);
  assert.ok(readEntries({ entries: [] }).error);
  assert.ok(readEntries({}).error);
  assert.ok(readEntries(undefined).error);
  assert.ok(readEntries({ entries: entry }).error);
  assert.ok(readEntries({ entries: Array(MAX_ENTRIES + 1).fill(entry) }).error);
  assert.match(readEntries({ entries: [entry, { ...entry, amount: 0 }] }).error, /Betrag/);
});

test("Mehrere Einträge: Buchungen zum Ersetzen ohne Doppelte", () => {
  assert.deepEqual(readEntries({ entries: [entry], replace: [7, 9, 7] }).replace, [7, 9]);
  for (const replace of [7, ["7"], [0], [1.5], [null], Array(MAX_ENTRIES + 1).fill(1)]) {
    assert.ok(readEntries({ entries: [entry], replace }).error, JSON.stringify(replace).slice(0, 20));
  }
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
    [/^SELECT type, amount/, { rows: [{ type: "out", amount: "40.00" }] }],
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

test("Buchung prüfen: mit named nennt die Meldung die Buchung", async () => {
  const db = () =>
    fakeDb([
      [/^SELECT type, amount/, { rows: [{ type: "out", amount: "40.00", day: "02.11.2026", label: "Netflix" }] }],
      [/^SELECT amount FROM debts/, { rows: [{ amount: "50.00" }] }],
    ]);
  await assert.rejects(checkBooking(db(), 7, true), (e) => /^Buchung vom 02\.11\.2026 \(Netflix\): Die Einträge/.test(e.message));
  await assert.rejects(checkBooking(db(), 7), (e) => e.message.startsWith("Die Einträge"));
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

test("Anlegen: alle Einträge in einer Abfrage, dann jede Buchung einmal prüfen", async () => {
  const db = fakeDb([
    [/^WITH wanted/, { rows: [{ name: "Anna", id: 1 }, { name: "Ben", id: 2 }] }],
    [/^INSERT INTO debts/, (params) => ({ rows: params[0].map((_, i) => ({ id: 100 + i })) })],
    [/^SELECT type, amount/, { rows: [{ type: "out", amount: "40.00" }] }],
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
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0].params, [
    [1, 2],
    ["2026-11-02", "2026-11-02"],
    ["10.00", "10.00"],
    ["debt", "debt"],
    ["Netflix", "Netflix"],
    [7, 7],
  ]);
  assert.equal(db.queries.filter((q) => q.sql.includes("FOR UPDATE")).length, 1, "Buchung nur einmal geprüft");
  assert.equal(db.queries.some((q) => q.sql.startsWith("DELETE")), false, "ohne replace nichts gelöscht");
});

test("Anlegen mit Ersetzen: erst die bisherigen Einträge der Buchungen löschen, mehrere Buchungen mit Namen prüfen", async () => {
  const db = fakeDb([
    [/^DELETE FROM debts/, { rows: [] }],
    [/^WITH wanted/, { rows: [{ name: "Anna", id: 1 }] }],
    [/^INSERT INTO debts/, { rows: [{ id: 5 }, { id: 6 }] }],
    [/^SELECT type, amount/, { rows: [{ type: "out", amount: "40.00", day: "02.12.2026", label: "Netflix" }] }],
    [/^SELECT amount FROM debts/, { rows: [{ amount: "10.00" }] }],
  ]);
  const { entries, replace } = readEntries({
    entries: [
      { ...entry, transactionId: 7 },
      { ...entry, date: "2026-12-02", transactionId: 8 },
    ],
    replace: [7, 8, 9],
  });
  assert.deepEqual(await createEntries(db, entries, replace), [5, 6]);
  assert.match(db.queries[0].sql, /^DELETE FROM debts WHERE transaction_id = ANY/);
  assert.deepEqual(db.queries[0].params, [[7, 8, 9]]);
  const checks = db.queries.filter((q) => q.sql.includes("FOR UPDATE"));
  assert.deepEqual(checks.map((q) => q.params), [[7], [8]], "Buchung 9 bekommt nichts Neues, nichts zu prüfen");
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
    [/^SELECT type, amount/, { rows: [{ type: "in", amount: "40.00" }] }],
    [/^SELECT amount FROM debts/, { rows: [{ amount: "10.00" }] }],
  ]);
  const entries = readEntries({ entries: [{ ...entry, transactionId: 7 }] }).entries;
  await assert.rejects(createEntries(db, entries), (e) => e instanceof DebtError && /Gutschrift/.test(e.message));
});

test("Ändern: neue Person über ihren Namen, Buchung danach geprüft", async () => {
  const db = fakeDb([
    [/^WITH wanted/, { rows: [{ name: "Ben", id: 2 }] }],
    [/^UPDATE debts/, { rows: [{ transaction_id: 7 }] }],
    [/^SELECT type, amount/, { rows: [{ type: "out", amount: "40.00" }] }],
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
  assert.equal(free.queries.length, 2, "Ändern und unpassende Verbindungen lösen, keine Buchung prüfen");
});

test("Ändern: Person, Betrag oder Art lösen Verbindungen zu beglichenen Schulden, die nicht mehr passen", async () => {
  const answers = [[/^UPDATE debts/, { rows: [{ transaction_id: null }] }]];
  for (const changes of [{ person_id: 2 }, { amount: "5.00" }, { kind: "debt" }]) {
    const db = fakeDb(answers);
    await updateEntry(db, 3, changes);
    const release = db.queries[1];
    assert.match(release.sql, /SET settled_by = NULL FROM debts s/, JSON.stringify(changes));
    assert.match(release.sql, /d\.person_id <> s\.person_id/);
    assert.match(release.sql, /sign\(d\.amount\) = sign\(s\.amount\)/, "beide in derselben Richtung passen nicht");
    assert.deepEqual(release.params, [3]);
  }
  const reason = fakeDb(answers);
  await updateEntry(reason, 3, { reason: "Kino", date: "2026-11-03" });
  assert.equal(reason.queries.length, 1, "Grund und Datum lassen Verbindungen, wie sie sind");
});

test("Begleichen: nur ein Ausgleich nennt Schulden, in beiden Richtungen, ohne Doppelte", () => {
  const settlement = { ...entry, amount: -50, kind: "settlement", transactionId: 7 };
  assert.deepEqual(readEntry({ ...settlement, settles: [4, 5, 4] }).values.settles, [4, 5]);
  assert.deepEqual(readEntry({ ...settlement, amount: 50, settles: [4] }).values.settles, [4], "du zahlst");
  assert.equal("settles" in readEntry(settlement).values, false, "ohne settles kein Feld");
  assert.equal("settles" in readEntry({ ...settlement, settles: [] }).values, false);
  assert.match(readEntry({ ...entry, settles: [4] }).error, /Ausgleich/, "eine Schuld begleicht nichts");
  for (const settles of [4, ["4"], [0], [1.5], [null]]) {
    assert.ok(readEntry({ ...settlement, settles }).error, JSON.stringify(settles));
  }
  assert.ok(readEntry({ settles: [4] }, true).error, "nicht nachträglich");
});

/** Antworten für einen Ausgleich, der Schulden begleicht; updated: wie viele davon offen waren */
const settleAnswers = (updated) => [
  [/^WITH wanted/, { rows: [{ name: "Anna", id: 1 }] }],
  [/^INSERT INTO debts[\s\S]*VALUES/, { rows: [{ id: 9 }] }],
  [/^UPDATE debts SET settled_by/, { rowCount: updated, rows: [] }],
  [/^SELECT type, amount/, { rows: [{ type: "in", amount: "50.00" }] }],
  [/^SELECT amount FROM debts/, { rows: [{ amount: "-50.00" }] }],
];

test("Begleichen: Ausgleich einzeln anlegen, die offenen Schulden derselben Person zeigen auf ihn", async () => {
  const db = fakeDb(settleAnswers(2));
  const { entries } = readEntries({
    entries: [{ ...entry, amount: -50, kind: "settlement", transactionId: 7, settles: [4, 5] }],
  });
  assert.deepEqual(await createEntries(db, entries), [9]);
  assert.equal(db.queries.some((q) => /unnest\(\$1::int\[\], \$2/.test(q.sql)), false, "keine Sammelabfrage ohne Einträge");
  const update = db.queries.find((q) => q.sql.startsWith("UPDATE debts SET settled_by"));
  assert.deepEqual(update.params, [9, [4, 5], 1, 1], "zahlt die Person, ihre Schulden bei dir");
  assert.match(update.sql, /person_id = \$3 AND kind = 'debt' AND sign\(amount\) = \$4 AND settled_by IS NULL/);
  assert.equal(db.queries.filter((q) => q.sql.includes("FOR UPDATE")).length, 1, "Buchung geprüft");
});

test("Begleichen: Zahlst du, sind es deine Schulden bei der Person", async () => {
  const db = fakeDb(settleAnswers(1));
  const { entries } = readEntries({ entries: [{ ...entry, amount: 20, kind: "settlement", settles: [6] }] });
  await createEntries(db, entries);
  const update = db.queries.find((q) => q.sql.startsWith("UPDATE debts SET settled_by"));
  assert.deepEqual(update.params, [9, [6], 1, -1]);
});

test("Begleichen: Ist eine Schuld schon beglichen oder fremd, wirft es", async () => {
  const { entries } = readEntries({
    entries: [{ ...entry, amount: -50, kind: "settlement", transactionId: 7, settles: [4, 5] }],
  });
  await assert.rejects(createEntries(fakeDb(settleAnswers(1)), entries), (e) => e instanceof DebtError && e.status === 409);
});
