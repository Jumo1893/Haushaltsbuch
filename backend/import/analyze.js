// Liest eine hochgeladene CSV-Datei mit einem Importprofil und prüft jede Zeile.

const crypto = require("node:crypto");
const { CsvError, parseCsv, dropLines } = require("./csv");
const { decode, cleanText, neutralizeFormula } = require("./values");

const MAX_ROWS = 10000;
const SAMPLE_SIZE = 10;
const LIST_LIMIT = 100;

/** Problem mit der ganzen Datei; `status` ist der HTTP-Status der Antwort. */
class ImportError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const normalize = (s) => cleanText(s).toLowerCase();
const quote = (s) => `„${s.length > 40 ? `${s.slice(0, 40)}…` : s}“`;

/**
 * Liest die Datei und liefert je Datenzeile ein Ergebnis:
 * - { line, status: "new", record }     gültiger Umsatz (Duplikate markiert erst markDuplicates)
 * - { line, status: "invalid", reason } fehlerhafte Zeile
 * - { line, status: "skipped", reason } ausgelassen: Regel des Profils oder keine Geldbewegung
 * Passt die ganze Datei nicht (Kodierung, Aufbau, Spalten), wird ein ImportError geworfen.
 */
function analyzeFile(buffer, profile, { maxRows = MAX_ROWS } = {}) {
  if (buffer.includes(0)) throw new ImportError(415, "Die Datei enthält Binärdaten und ist keine CSV-Datei.");
  const text = decode(buffer, profile.encodings);
  if (text === null) {
    throw new ImportError(422, `Die Datei ist nicht in der erwarteten Zeichenkodierung (${profile.encodings.join(" oder ")}) gespeichert.`);
  }

  let records;
  try {
    records = parseCsv(dropLines(text, profile.skipLines), profile.delimiter, profile.skipLines + 1);
  } catch (e) {
    if (e instanceof CsvError) throw new ImportError(422, `Die Datei ist keine gültige CSV-Datei. ${e.message}`);
    throw e;
  }

  const [head, ...data] = records;
  if (!head) throw new ImportError(422, "Die Datei enthält keine Spaltenüberschrift.");
  const index = matchHeader(profile, head.fields);
  if (data.length > maxRows) {
    throw new ImportError(422, `Die Datei enthält ${data.length} Datensätze, erlaubt sind höchstens ${maxRows}. Bitte einen kürzeren Zeitraum exportieren.`);
  }
  return data.map((rec) => readRow(rec, profile, index, head.fields.length));
}

/** Ordnet die Spalten des Profils den Positionen in der Kopfzeile zu. */
function matchHeader(profile, header) {
  const positions = new Map();
  header.forEach((name, i) => {
    if (!positions.has(normalize(name))) positions.set(normalize(name), i);
  });
  const missing = profile.expectedColumns.filter((c) => !positions.has(normalize(c)));
  if (missing.length) {
    let message = `Die Datei passt nicht zum Profil „${profile.name}“: Es fehlen Spalten, die das Profil erwartet.`;
    if (header.length === 1) message += ` Die Datei verwendet möglicherweise ein anderes Trennzeichen als „${profile.delimiter}“.`;
    throw new ImportError(422, message, {
      mismatch: {
        expected: profile.expectedColumns,
        found: header.map(cleanText).filter(Boolean).slice(0, 50).map((h) => (h.length > 80 ? `${h.slice(0, 80)}…` : h)),
        missing,
      },
    });
  }
  return new Map(profile.expectedColumns.map((c) => [c, positions.get(normalize(c))]));
}

function readRow({ line, fields }, profile, index, width) {
  const invalid = (reason) => ({ line, status: "invalid", reason });
  if (fields.length < width || fields.slice(width).some((f) => f.trim() !== "")) {
    return invalid(`Die Zeile hat ${fields.length} statt ${width} Spalten.`);
  }
  const cell = (column) => cleanText(fields[index.get(column)]);
  /** Wert eines Feldes: die erste nicht leere seiner Spalten */
  const pick = (columns) => {
    for (const column of columns) {
      const value = cell(column);
      if (value) return { value, column };
    }
    return { value: "", column: columns[0] };
  };

  for (const rule of profile.skipRows) {
    if (cell(rule.column).toLowerCase() === normalize(rule.equals)) return { line, status: "skipped", reason: rule.reason };
  }

  const errors = [];
  const record = { date: "", cents: 0, counterparty: "", purpose: "", details: {} };
  const set = (f, value) => {
    if (f.detail) record.details[f.field] = value;
    else record[f.field] = value;
  };

  for (const f of profile.fields) {
    const { value, column } = pick(f.columns);
    if (!value) {
      if (f.required && f.type !== "amount") errors.push(`Spalte „${column}“ ist leer`);
      continue;
    }
    if (f.type === "date") {
      const iso = profile.parseDate(value);
      if (iso) set(f, iso);
      else errors.push(`Ungültiges Datum ${quote(value)} in Spalte „${column}“`);
    } else if (f.type === "amount") {
      // Betrag, Gebühr und Steuer ergeben zusammen den Buchungsbetrag
      const cents = profile.parseAmount(value);
      if (cents === null) errors.push(`Unlesbarer Betrag ${quote(value)} in Spalte „${column}“`);
      else {
        record.cents += cents;
        if (f.detail && cents) set(f, cents / 100);
      }
    } else if (f.type === "number") {
      const number = profile.parseNumber(value);
      if (number === null) errors.push(`Ungültige Zahl ${quote(value)} in Spalte „${column}“`);
      else set(f, number);
    } else if (f.type === "currency") {
      if (value.toUpperCase() !== "EUR") errors.push(`Währung ${quote(value)} wird nicht unterstützt, nur EUR`);
    } else {
      set(f, neutralizeFormula(value));
    }
  }

  if (errors.length) return invalid(errors.join("; "));
  if (record.cents === 0) return { line, status: "skipped", reason: "Keine Geldbewegung (Betrag leer oder 0,00)" };
  if (Math.abs(record.cents) >= 1e12) return invalid("Der Betrag ist zu groß");
  record.hash = fingerprint(record);
  return { line, status: "new", record };
}

/**
 * Fingerabdruck, an dem ein bereits importierter Umsatz wiedererkannt wird. Liefert das Format eine
 * Transaktions-ID, genügt sie. Sonst zählen eigenes Konto, Buchungstag, Betrag, Gegenpartei (Name und IBAN)
 * und Verwendungszweck.
 */
function fingerprint(r) {
  const parts = r.details.transactionId
    ? ["transaction-id", r.details.transactionId]
    : [r.details.account, r.date, r.cents, r.counterparty, r.details.counterpartyIban, r.purpose];
  const key = parts.map((p) => normalize(String(p ?? ""))).join("\u001f");
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Setzt den Status gültiger Zeilen auf "new" oder "duplicate".
 * `existing`: Fingerabdruck → Anzahl der bereits gespeicherten Umsätze.
 * Steht ein Umsatz mehrfach in der Datei (z. B. zwei gleiche Einkäufe am selben Tag),
 * gelten nur so viele als Duplikat, wie schon gespeichert sind.
 */
function markDuplicates(rows, existing) {
  const seen = new Map();
  for (const row of rows) {
    if (!row.record) continue;
    const n = seen.get(row.record.hash) ?? 0;
    seen.set(row.record.hash, n + 1);
    row.status = n < (existing.get(row.record.hash) ?? 0) ? "duplicate" : "new";
  }
  return rows;
}

function countStatuses(rows) {
  const counts = { total: rows.length, new: 0, duplicate: 0, skipped: 0, invalid: 0 };
  for (const row of rows) counts[row.status]++;
  return counts;
}

/** Vorschau für die Oberfläche: Anzahlen, die ersten Datensätze, Duplikate, Fehler. */
function buildPreview(rows) {
  const view = ({ line, status, record }) => ({
    line,
    date: record.date,
    amount: record.cents / 100,
    counterparty: record.counterparty,
    purpose: record.purpose,
    duplicate: status === "duplicate",
  });
  const skipped = new Map();
  for (const row of rows) if (row.status === "skipped") skipped.set(row.reason, (skipped.get(row.reason) ?? 0) + 1);

  return {
    counts: countStatuses(rows),
    sample: rows.filter((r) => r.record).slice(0, SAMPLE_SIZE).map(view),
    duplicates: rows.filter((r) => r.status === "duplicate").slice(0, LIST_LIMIT).map(view),
    errors: rows.filter((r) => r.status === "invalid").slice(0, LIST_LIMIT).map(({ line, reason }) => ({ line, reason })),
    skipped: [...skipped].map(([reason, count]) => ({ reason, count })),
  };
}

module.exports = { MAX_ROWS, ImportError, analyzeFile, markDuplicates, countStatuses, buildPreview };
