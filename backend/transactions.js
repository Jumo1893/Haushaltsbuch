// Prüfung der Eingaben für Buchungen, gemeinsam für Anlegen und Ändern

/** Größter Betrag in Cent, den die Spalte amount (NUMERIC(12,2)) aufnimmt */
const MAX_CENTS = 999999999999;

/** Felder, die bei importierten Buchungen von der Bank stammen und nicht geändert werden */
const BANK_FIELDS = ["type", "amount", "date"];

/** true, wenn der Text ein gültiges Datum im Format YYYY-MM-DD ist (z. B. kein 30. Februar) */
function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Prüft die Felder einer Buchung und liefert sie für die Datenbank aufbereitet, sonst null.
 * Beim Anlegen müssen type, amount, category und date vorhanden sein. Mit partial (Ändern)
 * werden nur die übergebenen Felder geprüft und zurückgegeben.
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
  return values;
}

/** Felder einer Änderung, die bei einer importierten Buchung nicht erlaubt sind */
const lockedFields = (changes) => BANK_FIELDS.filter((field) => field in changes);

module.exports = { BANK_FIELDS, isDate, readTransaction, lockedFields };
