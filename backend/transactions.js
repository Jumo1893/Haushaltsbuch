// Prüfung der Eingaben für Buchungen, gemeinsam für Anlegen und Ändern

/** Größter Betrag in Cent, den die Spalte amount (NUMERIC(12,2)) aufnimmt */
const MAX_CENTS = 999999999999;

/** Felder, die bei importierten Buchungen aus dem Import stammen und nicht geändert werden */
const BANK_FIELDS = ["type", "amount", "date", "account_id"];

/** true, wenn der Text ein gültiges Datum im Format YYYY-MM-DD ist (z. B. kein 30. Februar) */
function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Prüft die Felder einer Buchung und liefert sie für die Datenbank aufbereitet, sonst null.
 * Die Schlüssel sind Spaltennamen (accountId wird zu account_id). Beim Anlegen müssen type, amount,
 * category, date und accountId vorhanden sein. Mit partial (Ändern) werden nur die übergebenen
 * Felder geprüft und zurückgegeben.
 */
function readTransaction(body, partial = false) {
  const given = (key) => !partial || body[key] !== undefined;
  const values = {};
  if (given("type")) {
    if (body.type !== "in" && body.type !== "out") return null;
    values.type = body.type;
  }
  if (given("amount")) {
    const cents = Math.round(Number(body.amount) * 100);
    if (!(cents >= 1 && cents <= MAX_CENTS)) return null;
    values.amount = (cents / 100).toFixed(2);
  }
  if (given("category")) {
    if (typeof body.category !== "string" || !body.category.trim()) return null;
    values.category = body.category.trim().slice(0, 40);
  }
  if (given("date")) {
    if (!isDate(body.date)) return null;
    values.date = body.date;
  }
  if (given("note")) values.note = String(body.note ?? "").trim().slice(0, 60);
  if (given("accountId")) {
    // Ob es das Konto gibt, prüft die Datenbank (Fremdschlüssel)
    if (!Number.isInteger(body.accountId) || body.accountId < 1) return null;
    values.account_id = body.accountId;
  }
  return values;
}

/** Felder einer Änderung, die bei einer importierten Buchung nicht erlaubt sind */
const lockedFields = (changes) => BANK_FIELDS.filter((field) => field in changes);

/** true, wenn der Text ein Monat im Format YYYY-MM ist */
const isMonth = (value) => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/** Konto aus dem Query-Parameter account: null ohne Angabe, NaN wenn ungültig */
function accountParam(value) {
  if (value === undefined || value === "") return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}

/** Höchstzahl der Buchungen bei GET /api/transactions?limit= */
const MAX_LIMIT = 100;

/**
 * Prüft die Parameter für die Liste der Buchungen: entweder month (Buchungen eines Monats) oder
 * limit (die neuesten Buchungen), jeweils optional account. Liefert { month, account },
 * { limit, account } oder { error }.
 */
function readListQuery(query) {
  const account = accountParam(query.account);
  if (Number.isNaN(account)) return { error: "Ungültiges Konto" };
  if (query.month !== undefined) {
    if (!isMonth(query.month)) return { error: "month=YYYY-MM erforderlich" };
    return { month: query.month, account };
  }
  const limit = Number(query.limit);
  if (query.limit === undefined || !(Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT)) {
    return { error: `month=YYYY-MM oder limit=1 bis ${MAX_LIMIT} erforderlich` };
  }
  return { limit, account };
}

module.exports = { BANK_FIELDS, MAX_CENTS, isDate, isMonth, readTransaction, lockedFields, accountParam, readListQuery };
