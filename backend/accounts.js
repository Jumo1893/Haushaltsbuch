// Konten: Prüfung der Eingaben und Zuordnung von Umsätzen über die eigene IBAN

const { MAX_CENTS, isDate } = require("./transactions");

/** Arten von Konten */
const KINDS = ["giro", "savings", "depot", "credit_card", "cash", "other"];

/** IBAN ohne Leerraum und in Großbuchstaben, so wird sie gespeichert und verglichen */
const normalizeIban = (value) => String(value ?? "").replace(/\s+/g, "").toUpperCase();

/** IBAN in Vierergruppen, z. B. "DE89 3704 0044 0532 0130 00" */
const formatIban = (iban) => iban.replace(/(.{4})(?=.)/g, "$1 ");

/** true, wenn eine normalisierte IBAN Aufbau und Prüfziffern einer IBAN hat (ISO 13616) */
function isIban(iban) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  // Ländercode und Prüfziffern ans Ende, Buchstaben als Zahlen (A = 10 … Z = 35), Rest bei Division durch 97 muss 1 sein
  const digits = `${iban.slice(4)}${iban.slice(0, 4)}`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const digit of digits) rest = (rest * 10 + Number(digit)) % 97;
  return rest === 1;
}

/**
 * Kontostand laut Bank an einem Tag, aus dem sich die Kontostände des Kontos ergeben.
 * Betrag (darf negativ sein) und Datum gehören zusammen; beide null entfernen den Kontostand.
 */
function readBankBalance(amount, date) {
  if (amount === null && date === null) return { values: { bank_balance: null, bank_balance_date: null } };
  if (amount === null || date === null) return { error: "Bitte Kontostand und Datum zusammen angeben." };
  const given = typeof amount === "number" || (typeof amount === "string" && amount.trim() !== "");
  const cents = given ? Math.round(Number(amount) * 100) : NaN;
  if (!(Math.abs(cents) <= MAX_CENTS)) return { error: "Der Kontostand ist ungültig." };
  if (!isDate(date)) return { error: "Das Datum des Kontostands ist ungültig." };
  return { values: { bank_balance: (cents / 100).toFixed(2), bank_balance_date: date } };
}

/**
 * Prüft die Felder eines Kontos und liefert { values } für die Datenbank oder { error } mit dem Grund.
 * Beim Anlegen müssen name und kind vorhanden sein. Mit partial (Ändern) werden nur die übergebenen
 * Felder geprüft und zurückgegeben. Der Kontostand laut Bank (bankBalance, bankBalanceDate) ist
 * immer optional und wird zu den Spalten bank_balance und bank_balance_date. extraIbans wird zur
 * Spalte extra_ibans.
 */
function readAccount(body, partial = false) {
  const given = (key) => !partial || body[key] !== undefined;
  const values = {};
  if (given("name")) {
    if (typeof body.name !== "string" || !body.name.trim()) return { error: "Bitte einen Namen für das Konto angeben." };
    values.name = body.name.trim().slice(0, 60);
  }
  if (given("kind")) {
    if (!KINDS.includes(body.kind)) return { error: "Unbekannte Kontoart." };
    values.kind = body.kind;
  }
  if (given("institution")) values.institution = String(body.institution ?? "").trim().slice(0, 60);
  if (given("iban")) {
    const iban = normalizeIban(body.iban);
    if (iban && !isIban(iban)) return { error: "Die IBAN ist ungültig. Bitte auf Tippfehler prüfen." };
    values.iban = iban || null;
  }
  if (given("extraIbans")) {
    const list = body.extraIbans ?? [];
    if (!Array.isArray(list)) return { error: "Die weiteren IBANs sind ungültig." };
    const ibans = [...new Set(list.map(normalizeIban).filter(Boolean))];
    const wrong = ibans.find((iban) => !isIban(iban));
    if (wrong) return { error: `Die IBAN ${formatIban(wrong)} ist ungültig. Bitte auf Tippfehler prüfen.` };
    values.extra_ibans = ibans;
  }
  if (body.bankBalance !== undefined || body.bankBalanceDate !== undefined) {
    const bank = readBankBalance(body.bankBalance ?? null, body.bankBalanceDate ?? null);
    if (bank.error) return bank;
    Object.assign(values, bank.values);
  }
  return { values };
}

/**
 * Konten zu eigenen IBANs aus einer Importdatei: IBAN → { id, name, isNew }.
 * Mit create wird für jede unbekannte IBAN ein Konto angelegt (Name = IBAN, Art „Sonstiges“).
 * Ohne create hat eine unbekannte IBAN die id null und den Namen, den ihr Konto bekäme.
 */
async function accountsForIbans(db, ibans, create = false) {
  const accounts = new Map();
  if (!ibans.length) return accounts;
  const { rows } = await db.query("SELECT id, name, iban FROM accounts WHERE iban = ANY($1)", [ibans]);
  for (const { id, name, iban } of rows) accounts.set(iban, { id, name, isNew: false });
  for (const iban of ibans) {
    if (accounts.has(iban)) continue;
    const name = formatIban(iban);
    let id = null;
    if (create) {
      const { rows: [created] } = await db.query(
        "INSERT INTO accounts (name, kind, iban) VALUES ($1, 'other', $2) RETURNING id",
        [name, iban],
      );
      id = created.id;
    }
    accounts.set(iban, { id, name, isNew: true });
  }
  return accounts;
}

module.exports = { KINDS, normalizeIban, formatIban, isIban, readAccount, accountsForIbans };
