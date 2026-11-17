// Schulden: Personen und Einträge, die festhalten, wer wem wie viel schuldet. Sie stehen neben den Buchungen und
// ändern weder Kontostände noch Einnahmen und Ausgaben.

const { MAX_CENTS, isDate } = require("./transactions");

/** Arten von Einträgen: Eine Schuld entsteht, oder eine Schuld wird ausgeglichen. Für den Stand zählen beide gleich. */
const DEBT_KINDS = ["debt", "settlement"];

/** Längster Name einer Person und längster Grund eines Eintrags */
const MAX_NAME = 40;
const MAX_REASON = 100;

/**
 * Höchstzahl der Einträge, die sich in einem Schritt anlegen lassen, z. B. beim Aufteilen vieler Buchungen auf mehrere
 * Personen, und der Buchungen, deren Einträge sie dabei ersetzen
 */
const MAX_ENTRIES = 5000;

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
 * Beim Anlegen eines Ausgleichs nennt settles optional die Schulden (IDs von Einträgen), die er begleicht, z. B. alte
 * Rechnungen: Zahlt die Person (negativer Betrag), sind es ihre Schulden bei dir, zahlst du, deine bei ihr. Ohne steht
 * settles nicht in values.
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
    const settles = body.settles ?? [];
    if (!Array.isArray(settles) || settles.length > MAX_ENTRIES || !settles.every((s) => Number.isInteger(s) && s > 0)) {
      return { error: "Ungültige Schulden zum Begleichen." };
    }
    if (settles.length) {
      if (values.kind !== "settlement") return { error: "Schulden begleicht nur ein Ausgleich." };
      values.settles = [...new Set(settles)];
    }
  } else if (body.transactionId !== undefined || body.settles !== undefined) {
    return { error: "Buchung und beglichene Schulden eines Eintrags lassen sich nicht ändern." };
  }
  return { values };
}

/**
 * Prüft { entries: [...], replace: [...] } zum Anlegen mehrerer Einträge. replace ist optional: Buchungen (IDs), deren
 * bisherige Einträge im selben Schritt wegfallen, z. B. wenn sie neu aufgeteilt werden. Liefert { entries, replace }
 * (replace ohne Doppelte) oder { error }.
 */
function readEntries(body) {
  const list = body?.entries;
  if (!Array.isArray(list) || !list.length || list.length > MAX_ENTRIES) {
    return { error: `Bitte 1 bis ${MAX_ENTRIES} Einträge angeben.` };
  }
  const replace = body.replace ?? [];
  if (!Array.isArray(replace) || replace.length > MAX_ENTRIES || !replace.every((id) => Number.isInteger(id) && id > 0)) {
    return { error: "Ungültige Buchungen zum Ersetzen." };
  }
  const entries = [];
  for (const item of list) {
    const { values, error } = readEntry(item);
    if (error) return { error };
    entries.push(values);
  }
  return { entries, replace: [...new Set(replace)] };
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
 * Zwei gleichzeitige Änderungen prüfen so nacheinander und sehen die Einträge der anderen. Wirft bei einem Problem, mit
 * named nennt die Meldung Tag und Text der Buchung, z. B. wenn mehrere auf einmal geprüft werden.
 */
async function checkBooking(db, id, named = false) {
  const { rows: [booking] } = await db.query(
    `SELECT type, amount, to_char(date, 'DD.MM.YYYY') AS day,
       COALESCE(NULLIF(counterparty, ''), NULLIF(note, ''), category) AS label
     FROM transactions WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!booking) return;
  const { rows } = await db.query("SELECT amount FROM debts WHERE transaction_id = $1", [id]);
  const problem = bookingProblem(booking, rows.map((r) => r.amount));
  if (problem) throw new DebtError(named ? `Buchung vom ${booking.day} (${booking.label}): ${problem}` : problem, 409);
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
 * Vorher fallen die bisherigen Einträge der Buchungen in replace weg. Liefert die IDs der neuen Einträge. In einer
 * Datenbanktransaktion aufrufen, sie wirft bei einem Problem.
 */
async function createEntries(db, entries, replace = []) {
  if (replace.length) await db.query("DELETE FROM debts WHERE transaction_id = ANY($1::int[])", [replace]);
  const people = await personIds(db, entries.map((e) => e.person));
  const ids = [];
  // Ohne beglichene Schulden in einer Abfrage, beim Aufteilen vieler Buchungen sind es schnell Hunderte
  const plain = entries.filter((e) => !e.settles);
  if (plain.length) {
    const { rows } = await db.query(
      `INSERT INTO debts (person_id, date, amount, kind, reason, transaction_id)
       SELECT * FROM unnest($1::int[], $2::date[], $3::numeric[], $4::text[], $5::text[], $6::int[])
       RETURNING id`,
      [
        plain.map((e) => people.get(e.person)),
        plain.map((e) => e.date),
        plain.map((e) => e.amount),
        plain.map((e) => e.kind),
        plain.map((e) => e.reason ?? ""),
        plain.map((e) => e.transaction_id),
      ],
    );
    ids.push(...rows.map((r) => r.id));
  }
  // Ein Ausgleich, der bestimmte Schulden begleicht, einzeln: Die Schulden zeigen danach auf ihn
  for (const e of entries.filter((entry) => entry.settles)) {
    const personId = people.get(e.person);
    const { rows: [row] } = await db.query(
      `INSERT INTO debts (person_id, date, amount, kind, reason, transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [personId, e.date, e.amount, e.kind, e.reason ?? "", e.transaction_id],
    );
    ids.push(row.id);
    // Offene Schulden derselben Person in Gegenrichtung: Zahlt sie, ihre bei dir (positiv), zahlst du, deine (negativ)
    const { rowCount } = await db.query(
      `UPDATE debts SET settled_by = $1
       WHERE id = ANY($2::int[]) AND person_id = $3 AND kind = 'debt' AND sign(amount) = $4 AND settled_by IS NULL`,
      [row.id, e.settles, personId, -Math.sign(Number(e.amount))],
    );
    if (rowCount !== e.settles.length) {
      throw new DebtError(
        "Ein Teil der gewählten Schulden ist schon beglichen, gelöscht oder gehört zu einer anderen Person. Bitte neu laden.",
        409,
      );
    }
  }
  const bookings = new Set(entries.map((e) => e.transaction_id).filter((id) => id !== null));
  for (const id of bookings) await checkBooking(db, id, bookings.size > 1);
  return ids;
}

/**
 * Löst Verbindungen zwischen beglichenen Schulden und ihrem Ausgleich, die nach einer Änderung am Eintrag id nicht mehr
 * passen: andere Person, keine Schuld bzw. kein Ausgleich mehr, oder beide in derselben Richtung.
 */
async function releaseSettlements(db, id) {
  await db.query(
    `UPDATE debts d SET settled_by = NULL FROM debts s
     WHERE s.id = d.settled_by AND (d.id = $1 OR s.id = $1)
       AND (d.kind <> 'debt' OR s.kind <> 'settlement' OR sign(d.amount) = sign(s.amount) OR d.person_id <> s.person_id)`,
    [id],
  );
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
  if (fields.person_id !== undefined || fields.amount !== undefined || fields.kind !== undefined) {
    await releaseSettlements(db, id);
  }
  if (row.transaction_id !== null) await checkBooking(db, row.transaction_id);
  return true;
}

/** Personen wie in GET /api/people: Stand (Summe der Einträge), Zahl der Einträge und Tag des letzten */
const PEOPLE = `SELECT p.id, p.name, COALESCE(sum(d.amount), 0)::float8 AS balance, count(d.id)::int AS "entryCount",
  to_char(max(d.date), 'YYYY-MM-DD') AS "lastDate"
  FROM people p LEFT JOIN debts d ON d.person_id = p.id`;

/**
 * Einträge wie in GET /api/debts, mit Person und der Buchung, zu der sie gehören (sonst null). Bei einer beglichenen
 * Schuld der Ausgleich und sein Tag, bei einem Ausgleich die Zahl der Schulden, die er begleicht.
 */
const ENTRIES = `SELECT d.id, d.person_id AS "personId", p.name AS person, to_char(d.date, 'YYYY-MM-DD') AS date,
  d.amount::float8 AS amount, d.kind, d.reason, d.transaction_id AS "transactionId",
  CASE WHEN t.id IS NOT NULL THEN json_build_object('id', t.id, 'accountId', t.account_id, 'type', t.type,
    'amount', t.amount::float8, 'date', to_char(t.date, 'YYYY-MM-DD'), 'counterparty', t.counterparty,
    'category', t.category, 'note', t.note) END AS transaction,
  d.settled_by AS "settledBy", to_char(sb.date, 'YYYY-MM-DD') AS "settledDate",
  (SELECT count(*) FROM debts c WHERE c.settled_by = d.id)::int AS "settlesCount"
  FROM debts d JOIN people p ON p.id = d.person_id LEFT JOIN transactions t ON t.id = d.transaction_id
  LEFT JOIN debts sb ON sb.id = d.settled_by`;

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
