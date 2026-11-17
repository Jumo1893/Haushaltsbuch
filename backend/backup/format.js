// Datensicherung: Aufbau der CSV-Dateien, Schreiben und Lesen
//
// Eine Datei sichert einen Bereich: Buchungen und Konten, Schulden oder Einstellungen. Sie besteht aus Abschnitten, einer
// je Tabelle: eine Zeile mit dem Namen der Tabelle in eckigen Klammern, eine Kopfzeile mit ihren Spalten (wie in der
// Datenbank) und eine Zeile je Datensatz. Der erste Abschnitt, [backup], nennt Bereich, Version des Formats und Zeitpunkt.
// Geschrieben wird für Excel mit deutschen Einstellungen: UTF-8 mit BOM, Semikolon und Dezimalkomma. Gelesen wird auch,
// was Excel beim Speichern daraus macht, z. B. ein Datum als TT.MM.JJJJ, WAHR und FALSCH oder Windows-1252.

const { CsvError, parseCsv } = require("../import/csv");
const { decode } = require("../import/values");
const { KINDS: ACCOUNT_KINDS } = require("../accounts");
const { KINDS: CATEGORY_KINDS, FALLBACK_CATEGORY } = require("../categories");
const { RHYTHMS, isDate } = require("../transactions");
const { DEBT_KINDS } = require("../debts");

/** Kennung und Version des Formats. Ältere Versionen muss jede neue lesen können, neuere werden abgelehnt. */
const FORMAT = "haushaltsbuch";
const VERSION = 1;
const DELIMITER = ";";

/** Fehler in einer Sicherung oder beim Hochladen, den die API mit status und der Meldung beantwortet */
class BackupError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Größter Wert einer Spalte INTEGER */
const MAX_INT = 2147483647;

/**
 * Texte, die Excel als Formel liest (=, +, -, @, Tabulator, Wagenrücklauf), bekommen beim Schreiben ein ' vorangestellt,
 * ebenso Texte, die mit ' beginnen. Beim Lesen fällt genau ein ' am Anfang weg. Gegenparteien und Verwendungszwecke
 * schreiben Fremde, so führt Excel nichts davon aus.
 */
const FORMULA = /^[=+\-@\t\r']/;
const protect = (text) => (FORMULA.test(text) ? `'${text}` : text);
const unprotect = (text) => (text.startsWith("'") ? text.slice(1) : text);

function readInteger(text, min) {
  if (!/^\d{1,10}$/.test(text)) return undefined;
  const n = Number(text);
  return n >= min && n <= MAX_INT ? n : undefined;
}

/**
 * Dezimalzahl mit Komma oder Punkt, ohne Tausendertrennzeichen, als Text mit Punkt für die Datenbank, z. B. "-12.3".
 * Mehr als `fraction` Nachkommastellen sind nur als Nullen am Ende erlaubt, mehr als `integer` Vorkommastellen gar nicht.
 */
function readDecimal(text, fraction, integer) {
  const match = /^([+-]?)(\d+)(?:[.,](\d*))?$/.exec(text);
  if (!match) return undefined;
  const digits = (match[3] ?? "").replace(/0+$/, "");
  const whole = match[2].replace(/^0+(?=\d)/, "");
  if (digits.length > fraction || whole.length > integer) return undefined;
  const value = digits ? `${whole}.${digits}` : whole;
  return match[1] === "-" && /[1-9]/.test(value) ? `-${value}` : value;
}

/** Datum als JJJJ-MM-TT oder, wie es Excel speichert, als TT.MM.JJJJ; liefert JJJJ-MM-TT */
function readDate(text) {
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  const iso = german ? `${german[3]}-${german[2].padStart(2, "0")}-${german[1].padStart(2, "0")}` : text;
  return isDate(iso) ? iso : undefined;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const readTimestamp = (text) =>
  TIMESTAMP.test(text) && isDate(text.slice(0, 10)) && !Number.isNaN(Date.parse(text)) ? text : undefined;

const BOOLEANS = new Map([
  ["true", true], ["wahr", true], ["ja", true], ["1", true],
  ["false", false], ["falsch", false], ["nein", false], ["0", false],
]);

function readJson(text) {
  const json = unprotect(text);
  try {
    JSON.parse(json);
    return json;
  } catch {
    return undefined;
  }
}

/** SQL für einen Zeitpunkt in UTC mit Mikrosekunden, z. B. 2026-11-17T19:15:00.123456Z */
const timestampSql = (expr) => `to_char(${expr} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * Spaltentypen. select: SQL für den Wert beim Sichern; write: Wert → Zelle; read: Zelle → Wert für die Datenbank,
 * undefined wenn ungültig; problem: Grund dafür.
 */
const ID = { select: (e) => e, write: String, read: (t) => readInteger(t.trim(), 1), problem: "ist keine gültige ID" };
const COUNT = { select: (e) => e, write: String, read: (t) => readInteger(t.trim(), 0), problem: "ist keine gültige Anzahl" };
const TEXT = { select: (e) => e, write: protect, read: unprotect };
const NAME = { select: (e) => e, write: protect, read: (t) => (unprotect(t).trim() ? unprotect(t) : undefined), problem: "darf nicht leer sein" };
const MONEY = {
  select: (e) => `${e}::text`,
  write: (v) => v.replace(".", ","),
  read: (t) => readDecimal(t.trim(), 2, 10),
  problem: "ist kein gültiger Betrag",
};
const DECIMAL = {
  select: (e) => `${e}::text`,
  write: (v) => (v.includes(".") ? v.replace(/\.?0+$/, "") : v).replace(".", ","),
  read: (t) => readDecimal(t.trim(), 10, 14),
  problem: "ist keine gültige Zahl",
};
const DATE = { select: (e) => `to_char(${e}, 'YYYY-MM-DD')`, write: String, read: (t) => readDate(t.trim()), problem: "ist kein gültiges Datum" };
const TIME = { select: timestampSql, write: String, read: (t) => readTimestamp(t.trim()), problem: "ist kein gültiger Zeitpunkt" };
const BOOL = { select: (e) => e, write: String, read: (t) => BOOLEANS.get(t.trim().toLowerCase()), problem: "muss true oder false sein" };
const JSON_TEXT = { select: (e) => `${e}::text`, write: protect, read: readJson, problem: "ist kein gültiges JSON" };
/** Liste von Wörtern ohne Leerraum, z. B. IBANs, durch Leerzeichen getrennt */
const LIST = { select: (e) => e, write: (v) => v.join(" "), read: (t) => (t.trim() ? t.trim().split(/\s+/) : []) };
const oneOf = (values) => ({
  select: (e) => e,
  write: String,
  read: (t) => (values.includes(t.trim()) ? t.trim() : undefined),
  problem: `muss einer dieser Werte sein: ${values.join(", ")}`,
});
/** Derselbe Typ, eine leere Zelle steht für NULL */
const optional = (type) => ({
  ...type,
  optional: true,
  write: (v) => (v === null || v === undefined ? "" : type.write(v)),
  read: (t) => (t.trim() === "" ? null : type.read(t)),
});

const TYPE = oneOf(["in", "out"]);

/**
 * Tabellen der Sicherung: Name für die Oberfläche, Spalten [Name, Typ, SQL beim Sichern (ohne Angabe x.Name)],
 * FROM (ohne Angabe die Tabelle als x) und Reihenfolge
 */
const TABLES = {
  accounts: {
    label: "Konten",
    order: "x.id",
    columns: [
      ["id", ID],
      ["name", NAME],
      ["kind", oneOf(ACCOUNT_KINDS)],
      ["institution", TEXT],
      ["iban", optional(NAME)],
      ["extra_ibans", LIST],
      ["bank_balance", optional(MONEY)],
      ["bank_balance_date", optional(DATE)],
      ["cash_account_id", optional(ID)],
      ["auto_prices_since", optional(TIME)],
      ["created_at", TIME],
    ],
  },
  imports: {
    label: "Importe",
    order: "x.id",
    columns: [
      ["id", ID],
      ["profile_id", NAME],
      ["profile_name", TEXT],
      ["file_name", TEXT],
      ["imported_count", COUNT],
      ["depot_count", COUNT],
      ["duplicate_count", COUNT],
      ["skipped_count", COUNT],
      ["invalid_count", COUNT],
      ["created_at", TIME],
    ],
  },
  transactions: {
    label: "Buchungen",
    order: "x.id",
    columns: [
      ["id", ID],
      ["account_id", ID],
      ["date", DATE],
      ["type", TYPE],
      ["amount", MONEY],
      ["category", NAME],
      ["category_manual", BOOL],
      ["note", TEXT],
      ["counterparty", TEXT],
      ["purpose", TEXT],
      ["rhythm", optional(oneOf(RHYTHMS))],
      ["transfer_override", optional(BOOL)],
      ["linked_id", optional(ID)],
      ["rule_id", optional(ID)],
      ["import_id", optional(ID)],
      ["import_hash", optional(NAME)],
      ["details", optional(JSON_TEXT)],
      ["created_at", TIME],
    ],
  },
  depot_movements: {
    // Mit weichem Trennzeichen, damit das Wort auf schmalen Bildschirmen umbricht
    label: "Wertpapier­bewegungen",
    order: "x.id",
    columns: [
      ["id", ID],
      ["account_id", ID],
      ["import_id", optional(ID)],
      ["import_hash", NAME],
      ["date", DATE],
      ["occurred_at", optional(TIME)],
      ["section", TEXT],
      ["type", TEXT],
      ["isin", NAME],
      ["name", TEXT],
      ["asset_class", TEXT],
      ["shares", optional(DECIMAL)],
      ["price", optional(DECIMAL)],
      ["amount", MONEY],
      ["fee", MONEY],
      ["tax", MONEY],
    ],
  },
  depot_prices: {
    label: "Kurse",
    order: "x.isin, x.date",
    columns: [
      ["isin", NAME],
      ["date", DATE],
      ["price", DECIMAL],
      ["source", NAME],
      ["fetched_at", TIME],
    ],
  },
  people: {
    label: "Personen",
    order: "x.id",
    columns: [
      ["id", ID],
      ["name", NAME],
      ["created_at", TIME],
    ],
  },
  debts: {
    label: "Einträge",
    // Tag, Richtung und Betrag der Buchung: Beim Wiederherstellen gehört ein Eintrag nur zu einer Buchung, die dazu passt
    from: "debts x LEFT JOIN transactions t ON t.id = x.transaction_id",
    order: "x.id",
    columns: [
      ["id", ID],
      ["person_id", ID],
      ["date", DATE],
      ["amount", MONEY],
      ["kind", oneOf(DEBT_KINDS)],
      ["reason", TEXT],
      ["settled_by", optional(ID)],
      ["settles_selected", BOOL],
      ["transaction_id", optional(ID)],
      ["transaction_date", optional(DATE), "t.date"],
      ["transaction_type", optional(TYPE), "t.type"],
      ["transaction_amount", optional(MONEY), "t.amount"],
      ["created_at", TIME],
    ],
  },
  categories: {
    label: "Kategorien",
    order: "x.id",
    columns: [
      ["id", ID],
      ["kind", oneOf(CATEGORY_KINDS)],
      ["name", NAME],
      ["auto_key", optional(NAME)],
    ],
  },
  rules: {
    label: "Gemerkte Zuordnungen",
    order: "x.id",
    columns: [
      ["id", ID],
      ["kind", oneOf(CATEGORY_KINDS)],
      ["type", TYPE],
      ["counterparty", NAME],
      ["amount", optional(MONEY)],
      ["category_id", ID],
      ["rhythm", optional(oneOf(RHYTHMS))],
      ["created_at", TIME],
    ],
  },
};

/** Bereiche einer Sicherung, je Bereich eine Datei, in der Reihenfolge, in der sie wiederhergestellt werden */
const AREAS = {
  transactions: {
    label: "Buchungen und Konten",
    file: "buchungen",
    tables: ["accounts", "imports", "transactions", "depot_movements", "depot_prices"],
  },
  settings: { label: "Einstellungen", file: "einstellungen", tables: ["categories", "rules"] },
  debts: { label: "Schulden", file: "schulden", tables: ["people", "debts"] },
};

/** Spalten des Abschnitts [backup] */
const META = [
  ["format", NAME],
  ["area", oneOf(Object.keys(AREAS))],
  ["version", ID],
  ["created", TIME],
];

/** SQL, das eine Tabelle so liest, wie die Sicherung sie schreibt */
function selectSql(table) {
  const { from = `${table} x`, order, columns } = TABLES[table];
  const list = columns.map(([column, type, sql]) => `${type.select(sql ?? `x.${column}`)} AS "${column}"`);
  return `SELECT ${list.join(", ")} FROM ${from} ORDER BY ${order}`;
}

/** Dateiname einer Sicherung, mit dem Tag in deutscher Zeit, z. B. haushaltsbuch-schulden-2026-11-17.csv */
const fileNameFor = (area, time) =>
  `haushaltsbuch-${AREAS[area].file}-${new Date(time).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" })}.csv`;

/** Zelle in Anführungszeichen, wenn sie Trennzeichen, Anführungszeichen, Zeilenumbrüche oder Leerraum am Rand enthält */
const cell = (text) => (/[;"\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);

/**
 * Schreibt die Sicherung eines Bereichs: tables enthält je Tabelle des Bereichs die Zeilen, wie sie selectSql liest;
 * created ist der Zeitpunkt der Sicherung (ISO). Liefert den Inhalt der Datei mit BOM und Zeilenenden CRLF.
 */
function writeBackup(area, tables, created) {
  const lines = [];
  const section = (name, columns, rows) => {
    lines.push(`[${name}]`, columns.map(([column]) => column).join(DELIMITER));
    for (const row of rows) lines.push(columns.map(([column, type]) => cell(type.write(row[column]))).join(DELIMITER));
    lines.push("");
  };
  section("backup", META, [{ format: FORMAT, area, version: VERSION, created }]);
  for (const table of AREAS[area].tables) section(table, TABLES[table].columns, tables[table]);
  return `﻿${lines.join("\r\n")}`;
}

/** Name des Abschnitts, wenn die Zeile einen beginnt ([name], Rest leer), sonst null */
function sectionName(fields) {
  const match = /^\[([a-z_]+)\]$/.exec(fields[0].trim());
  return match && fields.slice(1).every((f) => !f.trim()) ? match[1] : null;
}

/** Trennzeichen aus der Kopfzeile von [backup]: Semikolon, oder was Excel daraus gemacht hat (Komma, Tabulator) */
function sniffDelimiter(text) {
  const header = text.split(/\r\n|\r|\n/).filter((line) => line.trim())[1] ?? "";
  return [DELIMITER, ",", "\t"].find((d) => header.includes(d)) ?? DELIMITER;
}

const shorten = (text) => (text.length > 40 ? `${text.slice(0, 39)}…` : text);

/** Spalte → Position aus der Kopfzeile eines Abschnitts. Weitere Spalten werden übergangen, fehlende sind ein Fehler. */
function readHeader(fields, section, where) {
  const index = new Map();
  fields.forEach((field, i) => {
    const name = field.trim();
    if (!name) return;
    if (index.has(name)) throw new BackupError(`${where}: Die Spalte ${name} kommt in [${section.name}] zweimal vor.`);
    index.set(name, i);
  });
  const missing = section.columns.map(([column]) => column).filter((column) => !index.has(column));
  if (missing.length) {
    throw new BackupError(`${where}: In [${section.name}] fehlen die Spalten ${missing.join(", ")}.`);
  }
  return index;
}

function readRow(fields, section, line, where) {
  const row = { line };
  for (const [column, type] of section.columns) {
    const text = fields[section.header.get(column)] ?? "";
    const value = type.read(text);
    if (value === undefined) {
      const reason = text.trim() ? `${type.problem} („${shorten(text.trim())}“)` : "fehlt";
      throw new BackupError(`${where}: ${column} ${reason}.`);
    }
    row[column] = value;
  }
  return row;
}

/** Prüft, dass jede ID der Tabelle nur einmal vorkommt; liefert die Zeilen nach ID */
function byId(rows, table, at) {
  const map = new Map();
  for (const row of rows) {
    if (map.has(row.id)) throw new BackupError(`${at(row.line)}: Die ID ${row.id} kommt in [${table}] zweimal vor.`);
    map.set(row.id, row);
  }
  return map;
}

/** Prüft, dass der Verweis in row[column] leer ist oder eine Zeile von `target` (Tabelle `table`) trifft */
function reference(row, column, target, table, at) {
  const id = row[column];
  if (id !== null && !target.has(id)) throw new BackupError(`${at(row.line)}: ${column} ${id} gibt es in [${table}] nicht.`);
}

/** Prüft, dass kein Schlüssel zweimal vorkommt; ein Schlüssel null zählt nicht */
function unique(rows, key, what, at) {
  const seen = new Set();
  for (const row of rows) {
    const value = key(row);
    if (value === null) continue;
    if (seen.has(value)) throw new BackupError(`${at(row.line)}: ${what(row)} kommt zweimal vor.`);
    seen.add(value);
  }
}

const isPositive = (decimal) => !decimal.startsWith("-") && /[1-9]/.test(decimal);
const sign = (decimal) => (decimal.startsWith("-") ? -1 : 1);

/** Gegenpartei zum Vergleichen, wie matchKey in rules.js */
const counterpartyKey = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();

const CHECKS = {
  transactions(tables, at) {
    const accounts = byId(tables.accounts, "accounts", at);
    const imports = byId(tables.imports, "imports", at);
    const transactions = byId(tables.transactions, "transactions", at);
    byId(tables.depot_movements, "depot_movements", at);
    unique(tables.accounts, (a) => a.iban, (a) => `Die IBAN ${a.iban}`, at);
    for (const a of tables.accounts) {
      reference(a, "cash_account_id", accounts, "accounts", at);
      if (a.cash_account_id === a.id) throw new BackupError(`${at(a.line)}: Ein Konto ist nicht sein eigenes Geldkonto.`);
      if ((a.bank_balance === null) !== (a.bank_balance_date === null)) {
        throw new BackupError(`${at(a.line)}: bank_balance und bank_balance_date gibt es nur zusammen.`);
      }
    }
    for (const t of tables.transactions) {
      reference(t, "account_id", accounts, "accounts", at);
      reference(t, "import_id", imports, "imports", at);
      reference(t, "linked_id", transactions, "transactions", at);
      if (t.linked_id === t.id) throw new BackupError(`${at(t.line)}: Eine Buchung ist nicht ihre eigene Gegenbuchung.`);
      if (!isPositive(t.amount)) throw new BackupError(`${at(t.line)}: amount muss größer als 0 sein.`);
    }
    for (const m of tables.depot_movements) {
      reference(m, "account_id", accounts, "accounts", at);
      reference(m, "import_id", imports, "imports", at);
    }
    unique(tables.depot_prices, (p) => `${p.isin}\u001f${p.date}`, (p) => `Der Kurs von ${p.isin} am ${p.date}`, at);
    for (const p of tables.depot_prices) {
      if (!isPositive(p.price)) throw new BackupError(`${at(p.line)}: price muss größer als 0 sein.`);
    }
  },

  debts(tables, at) {
    const people = byId(tables.people, "people", at);
    const debts = byId(tables.debts, "debts", at);
    unique(tables.people, (p) => p.name.toLowerCase(), (p) => `Der Name „${p.name}“`, at);
    for (const d of tables.debts) {
      reference(d, "person_id", people, "people", at);
      if (d.amount === "0") throw new BackupError(`${at(d.line)}: amount darf nicht 0 sein.`);
      reference(d, "settled_by", debts, "debts", at);
      const by = debts.get(d.settled_by);
      if (by && (d.kind !== "debt" || by.kind !== "settlement" || by.person_id !== d.person_id || sign(by.amount) === sign(d.amount))) {
        throw new BackupError(`${at(d.line)}: settled_by muss bei einer Schuld auf einen Ausgleich derselben Person in Gegenrichtung zeigen.`);
      }
      if (d.transaction_id !== null && [d.transaction_date, d.transaction_type, d.transaction_amount].includes(null)) {
        throw new BackupError(`${at(d.line)}: Zur Buchung ${d.transaction_id} fehlen transaction_date, transaction_type oder transaction_amount.`);
      }
    }
  },

  settings(tables, at, file) {
    const categories = byId(tables.categories, "categories", at);
    byId(tables.rules, "rules", at);
    unique(tables.categories, (c) => `${c.kind}\u001f${c.name}`, (c) => `Die Kategorie „${c.name}“ (${c.kind})`, at);
    unique(tables.categories, (c) => c.auto_key, (c) => `Die automatische Zuordnung ${c.auto_key}`, at);
    for (const kind of CATEGORY_KINDS) {
      if (!tables.categories.some((c) => c.kind === kind && c.name === FALLBACK_CATEGORY)) {
        throw new BackupError(`${file}: Die Kategorie „${FALLBACK_CATEGORY}“ (${kind}) fehlt.`);
      }
    }
    for (const r of tables.rules) {
      reference(r, "category_id", categories, "categories", at);
      if (categories.get(r.category_id).kind !== r.kind) {
        throw new BackupError(`${at(r.line)}: Die Kategorie ${r.category_id} gehört nicht zur Art ${r.kind}.`);
      }
      if (r.amount !== null && !isPositive(r.amount)) throw new BackupError(`${at(r.line)}: amount muss größer als 0 sein.`);
    }
    unique(
      tables.rules,
      (r) => [r.kind, r.type, counterpartyKey(r.counterparty), r.amount ?? ""].join("\u001f"),
      (r) => `Die gemerkte Zuordnung für „${r.counterparty}“${r.amount === null ? "" : ` bei ${r.amount}`}`,
      at,
    );
  },
};

/**
 * Liest und prüft eine Sicherung (siehe writeBackup). Liefert { fileName, area, version, created, tables } mit den
 * Zeilen je Tabelle des Bereichs, Werte wie für die Datenbank aufbereitet, und mit der Zeile in der Datei (line).
 * Wirft BackupError mit Datei, Zeile und Grund, wenn etwas nicht passt.
 */
function readBackup(buffer, fileName) {
  const at = (line) => `${fileName}, Zeile ${line}`;
  const text = decode(buffer, ["utf-8", "windows-1252"]);
  let records;
  try {
    records = parseCsv(text, sniffDelimiter(text));
  } catch (e) {
    if (e instanceof CsvError) throw new BackupError(`${fileName}: ${e.message}`);
    throw e;
  }

  const notBackup = new BackupError(`${fileName}: Das ist keine Datensicherung des Haushaltsbuchs.`);
  const sections = new Map();
  let meta = null;
  let current = null;
  /** Prüft [backup], sobald der Abschnitt zu Ende ist, und liefert seine Zeile */
  const readMeta = () => {
    const { rows } = sections.get("backup");
    if (rows.length !== 1) throw new BackupError(`${fileName}: In [backup] steht nicht genau eine Zeile.`);
    if (rows[0].format !== FORMAT) throw notBackup;
    if (rows[0].version > VERSION) {
      throw new BackupError(
        `${fileName}: Die Sicherung hat das Format ${rows[0].version}, dieses Haushaltsbuch kennt nur Format ${VERSION}. Bitte erst das Haushaltsbuch aktualisieren.`,
      );
    }
    return rows[0];
  };
  for (const { line, fields } of records) {
    const name = sectionName(fields);
    if (name !== null) {
      if (!sections.size && name !== "backup") throw notBackup;
      if (sections.has(name)) throw new BackupError(`${at(line)}: Der Abschnitt [${name}] kommt zweimal vor.`);
      const columns = name === "backup" ? META : TABLES[name]?.columns;
      if (!columns) throw new BackupError(`${at(line)}: Den Abschnitt [${name}] gibt es nicht.`);
      meta ??= sections.size ? readMeta() : null;
      if (meta && !AREAS[meta.area].tables.includes(name)) {
        throw new BackupError(`${at(line)}: Der Abschnitt [${name}] gehört nicht zu „${AREAS[meta.area].label}“.`);
      }
      current = { name, columns, header: null, rows: [] };
      sections.set(name, current);
    } else if (!current) {
      throw notBackup;
    } else if (!current.header) {
      current.header = readHeader(fields, current, at(line));
    } else {
      current.rows.push(readRow(fields, current, line, at(line)));
    }
  }

  if (!sections.has("backup")) throw notBackup;
  meta ??= readMeta();
  const { area, version, created } = meta;
  const names = AREAS[area].tables;
  const missing = names.filter((name) => !sections.get(name)?.header);
  if (missing.length) {
    throw new BackupError(`${fileName}: Es fehlen die Abschnitte ${missing.map((n) => `[${n}]`).join(", ")}.`);
  }

  const tables = Object.fromEntries(names.map((name) => [name, sections.get(name).rows]));
  CHECKS[area](tables, at, fileName);
  return { fileName, area, version, created, tables };
}

module.exports = {
  FORMAT,
  VERSION,
  BackupError,
  TABLES,
  AREAS,
  selectSql,
  fileNameFor,
  writeBackup,
  readBackup,
  readDecimal,
  counterpartyKey,
};
