const test = require("node:test");
const assert = require("node:assert/strict");
const { FALLBACK_CATEGORY } = require("../categories");
const {
  matchKey,
  FREE,
  countByName,
  mergeCounts,
  applyRules,
  rememberRule,
  forgetRule,
  previewRule,
  readRuleInput,
  readPreviewQuery,
} = require("../rules");

test("Vergleich: Gegenpartei ohne Unterschied bei Groß- und Kleinschreibung und Leerraum", () => {
  assert.equal(matchKey("t.counterparty"), "lower(btrim(regexp_replace(t.counterparty, '\\s+', ' ', 'g')))");
});

test("Frei: von Hand gewählte Kategorien und von Hand gesetzte Rhythmen bleiben", () => {
  assert.match(FREE, /NOT t\.category_manual/);
  assert.match(FREE, /t\.rule_id IS NOT NULL OR t\.rhythm IS NULL/);
});

test("Zählen: je Kategorie, die meisten zuerst, ohne Auffangkategorie", () => {
  const rows = [{ name: "Freizeit" }, { name: "Wohnen" }, { name: "Freizeit" }, { name: FALLBACK_CATEGORY }];
  assert.deepEqual(countByName(rows), [{ name: "Freizeit", count: 2 }, { name: "Wohnen", count: 1 }]);
  assert.deepEqual(countByName([]), []);
});

test("Zählen: Listen aus gemerkten und automatischen Zuordnungen zusammenfassen", () => {
  const ruled = [{ name: "Freizeit", count: 1 }, { name: "Abos", count: 3 }];
  const auto = [{ name: "Lebensmittel", count: 3 }, { name: "Freizeit", count: 4 }];
  assert.deepEqual(mergeCounts(ruled, auto), [
    { name: "Freizeit", count: 5 },
    { name: "Abos", count: 3 },
    { name: "Lebensmittel", count: 3 },
  ]);
  assert.deepEqual(mergeCounts([], []), []);
});

test("Eingabe: Buchung und ob nur ihr Betrag gilt", () => {
  assert.deepEqual(readRuleInput({ transactionId: 7, matchAmount: true }), { transactionId: 7, matchAmount: true });
  assert.deepEqual(readRuleInput({ transactionId: 7, matchAmount: false, extra: 1 }), {
    transactionId: 7,
    matchAmount: false,
  });
  const invalid = {
    "ohne Buchung": { matchAmount: true },
    "Buchung als Text": { transactionId: "7", matchAmount: true },
    "Buchung 0": { transactionId: 0, matchAmount: true },
    "Buchung gebrochen": { transactionId: 1.5, matchAmount: true },
    "ohne matchAmount": { transactionId: 7 },
    "matchAmount als Text": { transactionId: 7, matchAmount: "true" },
  };
  for (const [name, body] of Object.entries(invalid)) assert.equal(readRuleInput(body), null, name);
});

test("Vorschau: Buchung ist Pflicht, die Art optional", () => {
  assert.deepEqual(readPreviewQuery({ transaction: "12" }), { transactionId: 12, kind: null });
  assert.deepEqual(readPreviewQuery({ transaction: "12", kind: "" }), { transactionId: 12, kind: null });
  for (const kind of ["out", "in", "transfer"]) {
    assert.deepEqual(readPreviewQuery({ transaction: "3", kind }), { transactionId: 3, kind });
  }
  for (const query of [{}, { transaction: "" }, { transaction: "x" }, { transaction: "-1" }, { transaction: "2", kind: "all" }]) {
    assert.equal(readPreviewQuery(query), null, JSON.stringify(query));
  }
});

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

test("Anwenden: liefert zugeordnete Buchungen je Kategorie und zählt die zurückgesetzten", async () => {
  const db = fakeDb([
    [/^WITH candidates/, {
      rows: [
        { id: 1, name: "Freizeit", assigned: true },
        { id: 2, name: "Freizeit", assigned: true },
        { id: 3, name: FALLBACK_CATEGORY, assigned: true }, // Zuordnung nur mit Rhythmus
        { id: 4, name: FALLBACK_CATEGORY, assigned: false },
      ],
    }],
  ]);
  const result = await applyRules(db, { importId: 9 });
  assert.deepEqual(result, { ids: [1, 2, 3], counts: [{ name: "Freizeit", count: 2 }], reverted: 1 });
  const [{ sql, params }] = db.queries;
  assert.deepEqual(params, [FALLBACK_CATEGORY, 9, null], "nur dieser Import");
  assert.match(sql, /NOT t\.category_manual/, "von Hand gewählte bleiben");
  assert.match(sql, /ORDER BY r\.amount IS NULL/, "die Zuordnung mit Betrag geht vor");
});

test("Anwenden: ohne Angabe für alle Buchungen, mit key nur für eine Gegenpartei", async () => {
  const db = fakeDb([[/^WITH candidates/, { rows: [] }]]);
  assert.deepEqual(await applyRules(db), { ids: [], counts: [], reverted: 0 });
  await applyRules(db, { key: "anthropic* claude sub" });
  assert.deepEqual(db.queries.map((q) => q.params), [
    [FALLBACK_CATEGORY, null, null],
    [FALLBACK_CATEGORY, null, "anthropic* claude sub"],
  ]);
});

/** Antworten für rememberRule: die Buchung, die Kategorie und was das Anwenden ändert */
const rememberAnswers = ({ tx, category = { id: 4 }, changed = [] }) => [
  [/^SELECT t\.type/, { rows: tx ? [tx] : [] }],
  [/^SELECT id FROM categories/, { rows: category ? [category] : [] }],
  [/^INSERT INTO rules/, { rows: [{ id: 11, key: "anthropic* claude sub" }] }],
  [/^WITH candidates/, { rows: changed.map((id) => ({ id, name: "Freizeit", assigned: true })) }],
  [/^SELECT r\.id/, (params) => ({ rows: [{ id: params[0], category: "Freizeit" }] })],
];

const claude = {
  type: "out",
  amount: "21.42",
  counterparty: "ANTHROPIC* CLAUDE SUB",
  category: "Freizeit",
  rhythm: "monthly",
  kind: "out",
};

test("Merken: mit Betrag, gilt sofort für die anderen Buchungen der Gegenpartei", async () => {
  const db = fakeDb(rememberAnswers({ tx: claude, changed: [5, 6, 7] }));
  const result = await rememberRule(db, 5, true);
  assert.deepEqual(result, { rule: { id: 11, category: "Freizeit" }, assigned: 2 }, "die Buchung selbst zählt nicht");
  const insert = db.queries.find((q) => q.sql.startsWith("INSERT"));
  assert.deepEqual(insert.params, ["out", "out", "ANTHROPIC* CLAUDE SUB", "21.42", 4, "monthly"]);
  assert.match(insert.sql, /ON CONFLICT \(kind, type, match_key, amount\) DO UPDATE/, "ersetzt die bisherige");
  const category = db.queries.find((q) => q.sql.startsWith("SELECT id FROM categories"));
  assert.deepEqual(category.params, ["out", "Freizeit"], "Kategorie der Art der Buchung");
  const apply = db.queries.find((q) => q.sql.startsWith("WITH candidates"));
  assert.deepEqual(apply.params, [FALLBACK_CATEGORY, null, "anthropic* claude sub"], "nur diese Gegenpartei");
});

test("Merken: bei jedem Betrag ohne Betrag in der Zuordnung", async () => {
  const db = fakeDb(rememberAnswers({ tx: { ...claude, rhythm: null } }));
  const result = await rememberRule(db, 5, false);
  assert.equal(result.assigned, 0);
  const insert = db.queries.find((q) => q.sql.startsWith("INSERT"));
  assert.deepEqual(insert.params, ["out", "out", "ANTHROPIC* CLAUDE SUB", null, 4, null]);
});

test("Merken: unbekannte Buchung, ohne Gegenpartei oder mit Kategorie einer anderen Art", async () => {
  const cases = [
    [{ tx: null }, 404],
    [{ tx: { ...claude, counterparty: "  " } }, 400],
    [{ tx: claude, category: null }, 409],
  ];
  for (const [answers, status] of cases) {
    const db = fakeDb(rememberAnswers(answers));
    const result = await rememberRule(db, 5, true);
    assert.equal(result.status, status);
    assert.ok(result.error);
    assert.equal(db.queries.some((q) => q.sql.startsWith("INSERT")), false, "nichts gespeichert");
  }
});

test("Löschen: Buchungen der Zuordnung gehen zurück, dann gilt, was sonst passt", async () => {
  const db = fakeDb([
    [/^SELECT match_key/, { rows: [{ key: "anthropic* claude sub" }] }],
    [/^UPDATE transactions/, { rowCount: 3 }],
    [/^DELETE FROM rules/, { rowCount: 1 }],
    [/^WITH candidates/, { rows: [] }],
  ]);
  assert.equal(await forgetRule(db, 11), true);
  assert.deepEqual(
    db.queries.map((q) => q.sql.split(/\s/)[0] + " " + JSON.stringify(q.params)),
    [
      `SELECT [11]`,
      `UPDATE [11,"${FALLBACK_CATEGORY}"]`,
      `DELETE [11]`,
      `WITH ${JSON.stringify([FALLBACK_CATEGORY, null, "anthropic* claude sub"])}`,
    ],
  );
  assert.match(db.queries[1].sql, /rhythm = NULL, rule_id = NULL WHERE rule_id = \$1/);
});

test("Löschen: unbekannte Zuordnung ändert nichts", async () => {
  const db = fakeDb([[/^SELECT match_key/, { rows: [] }]]);
  assert.equal(await forgetRule(db, 99), false);
  assert.equal(db.queries.length, 1);
});

test("Vorschau: zählt für die Art der Buchung oder die angegebene und liefert die geltenden Zuordnungen", async () => {
  const answers = () => [
    [/^SELECT t\.type/, { rows: [{ type: "out", amount: "21.42", key: "anthropic* claude sub", kind: "out" }] }],
    [/^WITH others/, { rows: [{ sameAmount: 11, anyAmount: 14 }] }],
    [/^SELECT r\.id/, { rows: [{ id: 11, amount: 21.42 }] }],
  ];
  const db = fakeDb(answers());
  assert.deepEqual(await previewRule(db, 5), { sameAmount: 11, anyAmount: 14, rules: [{ id: 11, amount: 21.42 }] });
  assert.deepEqual(db.queries[1].params, ["out", "out", "anthropic* claude sub", "21.42", 5], "ohne die Buchung selbst");
  assert.deepEqual(db.queries[2].params, ["out", "out", "anthropic* claude sub", "21.42"]);

  const asTransfer = fakeDb(answers());
  await previewRule(asTransfer, 5, "transfer");
  assert.equal(asTransfer.queries[1].params[0], "transfer");
});

test("Vorschau: unbekannte Buchung", async () => {
  const db = fakeDb([[/^SELECT t\.type/, { rows: [] }]]);
  assert.equal(await previewRule(db, 5), null);
});
