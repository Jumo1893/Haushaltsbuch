// Importprofile: fest hinterlegte Beschreibungen der CSV-Formate einzelner Institute.
// Jede JSON-Datei in import-profiles/ ist ein Profil, der Dateiname ist die Profil-ID.

const fs = require("node:fs");
const path = require("node:path");
const { compileDateFormat, compileAmountFormat, compileNumberFormat } = require("./values");

/**
 * Felder der App, denen ein Profil Spalten zuordnen kann.
 * - type "amount": Beträge aller Amount-Felder (Betrag, Gebühr, Steuer) ergeben zusammen den Buchungsbetrag
 * - detail: wird nicht als eigene Spalte, sondern in transactions.details (JSON) gespeichert
 */
const FIELDS = {
  date: { type: "date", required: true },
  amount: { type: "amount", required: true },
  fee: { type: "amount", detail: true },
  tax: { type: "amount", detail: true },
  currency: { type: "currency" },
  counterparty: { type: "text" },
  purpose: { type: "text" },
  transactionId: { type: "text", detail: true },
  account: { type: "text", detail: true },
  valueDate: { type: "date", detail: true },
  bookingText: { type: "text", detail: true },
  counterpartyIban: { type: "text", detail: true },
  counterpartyBic: { type: "text", detail: true },
  creditorId: { type: "text", detail: true },
  mandateReference: { type: "text", detail: true },
  endToEndReference: { type: "text", detail: true },
  paymentReference: { type: "text", detail: true },
  mcc: { type: "text", detail: true },
  isin: { type: "text", detail: true },
  assetClass: { type: "text", detail: true },
  shares: { type: "number", detail: true },
  price: { type: "number", detail: true },
  originalAmount: { type: "number", detail: true },
  originalCurrency: { type: "text", detail: true },
  fxRate: { type: "number", detail: true },
};

const KEYS = [
  "name", "description", "encoding", "delimiter", "skipLines", "dateFormats",
  "decimalSeparator", "thousandsSeparator", "columns", "skipRows",
];

class ProfileError extends Error {}

const isText = (v) => typeof v === "string" && v.trim() !== "";

/** Prüft eine Profil-Konfiguration und bereitet sie für den Import auf. */
function compileProfile(id, raw) {
  const fail = (message) => {
    throw new ProfileError(`Importprofil „${id}“: ${message}`);
  };
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail("Der Dateiname darf nur a–z, 0–9 und - enthalten");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("muss ein JSON-Objekt sein");
  for (const key of Object.keys(raw)) if (!KEYS.includes(key)) fail(`unbekannter Eintrag „${key}“`);

  if (!isText(raw.name)) fail("„name“ fehlt");
  if (raw.description !== undefined && typeof raw.description !== "string") fail("„description“ muss Text sein");

  const encodings = [].concat(raw.encoding ?? "utf-8");
  for (const encoding of encodings) {
    try {
      new TextDecoder(encoding);
    } catch {
      fail(`Zeichenkodierung „${encoding}“ wird nicht unterstützt`);
    }
  }

  const { delimiter, skipLines = 0, decimalSeparator, thousandsSeparator = "" } = raw;
  if (typeof delimiter !== "string" || delimiter.length !== 1 || /["\r\n]/.test(delimiter))
    fail("„delimiter“ muss genau ein Zeichen sein (kein Anführungszeichen oder Zeilenumbruch)");
  if (!Number.isInteger(skipLines) || skipLines < 0) fail("„skipLines“ muss eine ganze Zahl ab 0 sein");

  if (!Array.isArray(raw.dateFormats) || !raw.dateFormats.length) fail("„dateFormats“ braucht mindestens ein Format");
  const dateParsers = raw.dateFormats.map(
    (f) => compileDateFormat(f) ?? fail(`ungültiges Datumsformat „${f}“ (erlaubt sind DD, MM, YY oder YYYY mit Trennzeichen)`),
  );

  if (![",", "."].includes(decimalSeparator)) fail("„decimalSeparator“ muss „,“ oder „.“ sein");
  if (!["", ".", ",", " ", "'"].includes(thousandsSeparator) || thousandsSeparator === decimalSeparator)
    fail("„thousandsSeparator“ muss leer, „.“, „,“, „'“ oder ein Leerzeichen sein und sich vom Dezimaltrennzeichen unterscheiden");

  // Ein Feld kann eine Spalte oder eine Liste von Spalten haben; dann gilt die erste nicht leere.
  const mapping = raw.columns;
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) fail("„columns“ fehlt");
  const fields = Object.entries(mapping).map(([field, value]) => {
    if (!FIELDS[field]) fail(`unbekanntes Feld „${field}“ in „columns“ (bekannt: ${Object.keys(FIELDS).join(", ")})`);
    const columns = [].concat(value);
    if (!columns.length || !columns.every(isText)) fail(`Spaltenname für „${field}“ fehlt`);
    return { field, columns, ...FIELDS[field] };
  });
  for (const [field, def] of Object.entries(FIELDS))
    if (def.required && !mapping[field]) fail(`Pflichtfeld „${field}“ fehlt in „columns“`);

  const skipRows = raw.skipRows ?? [];
  if (!Array.isArray(skipRows)) fail("„skipRows“ muss eine Liste sein");
  for (const rule of skipRows)
    if (!rule || !isText(rule.column) || typeof rule.equals !== "string" || !isText(rule.reason))
      fail("Jede Regel in „skipRows“ braucht „column“, „equals“ und „reason“");

  return {
    id,
    name: raw.name.trim(),
    description: raw.description ?? "",
    encodings,
    delimiter,
    skipLines,
    fields,
    skipRows: skipRows.map(({ column, equals, reason }) => ({ column, equals, reason })),
    /** Spalten, die in der Datei vorhanden sein müssen */
    expectedColumns: [...new Set([...fields.flatMap((f) => f.columns), ...skipRows.map((r) => r.column)])],
    parseDate: (value) => {
      for (const parse of dateParsers) {
        const iso = parse(value);
        if (iso) return iso;
      }
      return null;
    },
    parseAmount: compileAmountFormat(decimalSeparator, thousandsSeparator),
    parseNumber: compileNumberFormat(decimalSeparator, thousandsSeparator),
  };
}

/** Lädt alle Profile aus einem Verzeichnis. Ein fehlerhaftes Profil verhindert den Start. */
function loadProfiles(dir) {
  const profiles = new Map();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const id = path.basename(file, ".json");
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    let raw;
    try {
      // Ein BOM (z. B. von Windows-Editoren) vor dem JSON überspringen
      raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch (e) {
      throw new ProfileError(`Importprofil „${id}“: kein gültiges JSON (${e.message})`);
    }
    profiles.set(id, compileProfile(id, raw));
  }
  return profiles;
}

module.exports = { FIELDS, ProfileError, compileProfile, loadProfiles };
