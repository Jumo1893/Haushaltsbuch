// Schulden: Personen und Einträge, die festhalten, wer wem wie viel schuldet. Sie stehen neben den Buchungen und
// ändern weder Kontostände noch Einnahmen und Ausgaben.

const { MAX_CENTS, isDate } = require("./transactions");

/** Arten von Einträgen: Eine Schuld entsteht, oder eine Schuld wird ausgeglichen. Für den Stand zählen beide gleich. */
const DEBT_KINDS = ["debt", "settlement"];

/** Längster Name einer Person und längster Grund eines Eintrags */
const MAX_NAME = 40;
const MAX_REASON = 100;

/** Höchstzahl der Einträge, die sich in einem Schritt anlegen lassen, z. B. beim Aufteilen einer Ausgabe */
const MAX_ENTRIES = 50;

/** Fehler in der Eingabe, den die API mit status und der Meldung beantwortet; bricht die Datenbanktransaktion ab */
class DebtError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

/** Name einer Person ohne doppelten Leerraum, so wird er gespeichert; ohne Inhalt null */
function personName(value) {
  if (typeof value !== "string") return null;
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_NAME).trim() || null;
}

/**
 * Prüft einen Eintrag und liefert { values } für die Datenbank oder { error }. Beim Anlegen sind person (der Name),
 * date, amount und kind Pflicht, reason und transactionId (die Buchung, zu der er gehört) optional. amount hat ein
 * Vorzeichen: Positiv schuldet die Person dir danach mehr bzw. du ihr weniger, negativ umgekehrt. Mit partial (Ändern)
 * werden nur die übergebenen Felder geprüft und zurückgegeben; die Buchung lässt sich dann nicht ändern.
 */
function readEntry(body, partial = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Ungültige Eingabe" };
  const given = (key) => !partial || body[key] !== undefined;
  const values = {};
  if (given("person")) {
    const name = personName(body.person);
    if (!name) return { error: "Bitte einen Namen angeben." };
    values.person = name;
  }
  if (given("date")) {
    if (!isDate(body.date)) return { error: "Das Datum ist ungültig." };
    values.date = body.date;
  }
  if (given("amount")) {
    const { amount } = body;
    const number = typeof amount === "number" || (typeof amount === "string" && amount.trim() !== "");
    // Auf Cent gerundet, negative Beträge wie positive (−12,346 wird −12,35)
    const cents = number ? Math.sign(Number(amount)) * Math.round(Math.abs(Number(amount)) * 100) : NaN;
    if (!(cents !== 0 && Math.abs(cents) <= MAX_CENTS)) return { error: "Der Betrag ist ungültig." };
    values.amount = (cents / 100).toFixed(2);
  }
  if (given("kind")) {
    if (!DEBT_KINDS.includes(body.kind)) return { error: "Unbekannte Art des Eintrags." };
    values.kind = body.kind;
  }
  if (given("reason")) values.reason = String(body.reason ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_REASON);
  if (!partial) {
    const id = body.transactionId ?? null;
    if (id !== null && !(Number.isInteger(id) && id > 0)) return { error: "Ungültige Buchung." };
    values.transaction_id = id;
  } else if (body.transactionId !== undefined) {
    return { error: "Die Buchung eines Eintrags lässt sich nicht ändern." };
  }
  return { values };
}

/** Prüft { entries: [...] } zum Anlegen mehrerer Einträge und liefert { entries } oder { error } */
function readEntries(body) {
  const list = body?.entries;
  if (!Array.isArray(list) || !list.length || list.length > MAX_ENTRIES) {
    return { error: `Bitte 1 bis ${MAX_ENTRIES} Einträge angeben.` };
  }
  const entries = [];
  for (const item of list) {
    const { values, error } = readEntry(item);
    if (error) return { error };
    entries.push(values);
  }
  return { entries };
}

/** Filter für GET /api/debts: person oder transaction (IDs); liefert { person, transaction } oder { error } */
function readDebtQuery(query) {
  const id = (value) => (value === undefined ? null : /^[1-9]\d{0,9}$/.test(value) ? Number(value) : NaN);
  const person = id(query.person);
  const transaction = id(query.transaction);
  if (Number.isNaN(person) || Number.isNaN(transaction) || (person === null && transaction === null)) {
    return { error: "person=ID oder transaction=ID erforderlich" };
  }
  return { person, transaction };
}

const cents = (amount) => Math.round(Math.abs(Number(amount)) * 100);

/**
 * Prüft die Einträge zu einer Buchung { type, amount }, amounts sind alle ihre Beträge. Geld, das du ausgibst, kann
 * nur erhöhen, was andere dir schulden, bzw. deine Schulden senken; Geld, das du bekommst, nur umgekehrt. Zusammen
 * dürfen die Einträge den Betrag der Buchung nicht übersteigen. Liefert den Grund oder null.
 */
function bookingProblem(booking, amounts) {
  const sign = booking.type === "out" ? 1 : -1;
  if (amounts.some((amount) => Math.sign(Number(amount)) !== sign)) {
    return booking.type === "out"
      ? "Zu einer Abbuchung passen nur Schulden anderer bei dir oder der Ausgleich deiner eigenen Schulden."
      : "Zu einer Gutschrift passen nur der Ausgleich von Schulden anderer bei dir oder deine eigenen Schulden.";
  }
  const total = amounts.reduce((sum, amount) => sum + cents(amount), 0);
  if (total > cents(booking.amount)) {
    return `Die Einträge zur Buchung (${euro.format(total / 100)}) übersteigen ihren Betrag (${euro.format(
      cents(booking.amount) / 100,
    )}).`;
  }
  return null;
}

/**
 * Prüft die Einträge zur Buchung id (siehe bookingProblem) und sperrt sie dafür bis zum Ende der Datenbanktransaktion.
 * Zwei gleichzeitige Änderungen prüfen so nacheinander und sehen die Einträge der anderen. Wirft bei einem Problem.
 */
async function checkBooking(db, id) {
  const { rows: [booking] } = await db.query("SELECT type, amount FROM transactions WHERE id = $1 FOR UPDATE", [id]);
  if (!booking) return;
  const { rows } = await db.query("SELECT amount FROM debts WHERE transaction_id = $1", [id]);
  const problem = bookingProblem(booking, rows.map((r) => r.amount));
  if (problem) throw new DebtError(problem, 409);
}

/**
 * IDs der Personen mit diesen Namen, ohne Unterschied bei Groß- und Kleinschreibung; unbekannte werden angelegt.
 * Liefert eine Map Name → ID mit den Namen, wie sie übergeben wurden.
 */
async function personIds(db, names) {
  const { rows } = await db.query(
    `WITH wanted AS (SELECT DISTINCT n AS name, lower(n) AS key FROM unnest($1::text[]) AS n),
     inserted AS (
       INSERT INTO people (name) SELECT DISTINCT ON (key) name FROM wanted
       ON CONFLICT ((lower(name))) DO NOTHING RETURNING id, lower(name) AS key
     )
     SELECT w.name, COALESCE(i.id, p.id) AS id
     FROM wanted w LEFT JOIN inserted i ON i.key = w.key LEFT JOIN people p ON lower(p.name) = w.key`,
    [[...new Set(names)]],
  );
  const ids = new Map(rows.map((r) => [r.name, r.id]));
  // Nur möglich, wenn eine andere Anfrage dieselbe Person gerade anlegt
  if (names.some((name) => !ids.get(name))) throw new DebtError("Bitte noch einmal versuchen.", 409);
  return ids;
}

/**
 * Legt Einträge an (siehe readEntries), unbekannte Personen dabei auch, und prüft die Buchungen, zu denen sie gehören.
 * Liefert die IDs der neuen Einträge. In einer Datenbanktransaktion aufrufen, sie wirft bei einem Problem.
 */
async function createEntries(db, entries) {
  const people = await personIds(db, entries.map((e) => e.person));
  const ids = [];
  for (const e of entries) {
    const { rows: [row] } = await db.query(
      `INSERT INTO debts (person_id, date, amount, kind, reason, transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [people.get(e.person), e.date, e.amount, e.kind, e.reason ?? "", e.transaction_id],
    );
    ids.push(row.id);
  }
  for (const id of new Set(entries.map((e) => e.transaction_id).filter((id) => id !== null))) await checkBooking(db, id);
  return ids;
}

/**
 * Ändert die Felder eines Eintrags (siehe readEntry mit partial); ein neuer Name ordnet ihn einer anderen Person zu,
 * die es dafür auch neu geben kann. Liefert false, wenn es den Eintrag nicht gibt. In einer Datenbanktransaktion
 * aufrufen, sie wirft bei einem Problem mit der Buchung.
 */
async function updateEntry(db, id, changes) {
  const fields = { ...changes };
  if (fields.person !== undefined) {
    fields.person_id = (await personIds(db, [fields.person])).get(fields.person);
    delete fields.person;
  }
  // Spaltennamen stammen aus readEntry, nicht aus der Anfrage
  const columns = Object.keys(fields);
  const { rows: [row] } = await db.query(
    `UPDATE debts SET ${columns.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING transaction_id`,
    [id, ...columns.map((c) => fields[c])],
  );
  if (!row) return false;
  if (row.transaction_id !== null) await checkBooking(db, row.transaction_id);
  return true;
}

/** Personen wie in GET /api/people: Stand (Summe der Einträge), Zahl der Einträge und Tag des letzten */
const PEOPLE = `SELECT p.id, p.name, COALESCE(sum(d.amount), 0)::float8 AS balance, count(d.id)::int AS "entryCount",
  to_char(max(d.date), 'YYYY-MM-DD') AS "lastDate"
  FROM people p LEFT JOIN debts d ON d.person_id = p.id`;

/** Einträge wie in GET /api/debts, mit Person und der Buchung, zu der sie gehören (sonst null) */
const ENTRIES = `SELECT d.id, d.person_id AS "personId", p.name AS person, to_char(d.date, 'YYYY-MM-DD') AS date,
  d.amount::float8 AS amount, d.kind, d.reason, d.transaction_id AS "transactionId",
  CASE WHEN t.id IS NOT NULL THEN json_build_object('id', t.id, 'accountId', t.account_id, 'type', t.type,
    'amount', t.amount::float8, 'date', to_char(t.date, 'YYYY-MM-DD'), 'counterparty', t.counterparty,
    'category', t.category, 'note', t.note) END AS transaction
  FROM debts d JOIN people p ON p.id = d.person_id LEFT JOIN transactions t ON t.id = d.transaction_id`;

/** SQL: Einträge zur Buchung t, kurz, für die Liste der Buchungen; ohne eine leere Liste */
const BOOKING_DEBTS = `COALESCE((SELECT json_agg(json_build_object('id', d.id, 'personId', d.person_id,
  'person', p.name, 'amount', d.amount::float8, 'kind', d.kind) ORDER BY d.id)
  FROM debts d JOIN people p ON p.id = d.person_id WHERE d.transaction_id = t.id), '[]')`;

module.exports = {
  DEBT_KINDS,
  MAX_NAME,
  MAX_REASON,
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
  PEOPLE,
  ENTRIES,
  BOOKING_DEBTS,
};
