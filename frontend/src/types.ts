/** Richtung einer Buchung: "in" erhöht den Kontostand, "out" senkt ihn, auch bei Umbuchungen */
export type TxType = "in" | "out";

/** Art einer Buchung in der Oberfläche: Einnahme, Ausgabe oder Umbuchung */
export type TxKind = TxType | "transfer";

export interface NewTransaction {
  type: TxType;
  amount: number;
  category: string;
  date: string; // YYYY-MM-DD
  note: string;
  accountId: number;
  transfer: boolean; // Umbuchung zwischen eigenen Konten: zählt weder als Einnahme noch als Ausgabe
}

/** Geänderte Felder einer Buchung */
export type TransactionChanges = Partial<NewTransaction>;

/** Änderung mehrerer Buchungen auf einmal: die Felder, die sich auch bei importierten Buchungen ändern lassen */
export type BulkChanges = Pick<TransactionChanges, "category" | "note" | "transfer">;

/** Filter der Suche über alle Monate; leere Werte filtern nicht */
export interface TransactionFilters {
  text: string; // Wörter in Gegenpartei, Verwendungszweck oder Notiz
  account: number | null;
  category: string;
  type: TxKind | "";
}

export const NO_FILTERS: TransactionFilters = { text: "", account: null, category: "", type: "" };

export const isFiltered = ({ text, account, category, type }: TransactionFilters) =>
  !!(text.trim() || account || category || type);

export interface Transaction extends NewTransaction {
  id: number;
  counterparty: string;
  purpose: string;
  importId: number | null; // gesetzt, wenn die Buchung aus einem CSV-Import stammt
}

export const kindOf = ({ type, transfer }: Pick<NewTransaction, "type" | "transfer">): TxKind =>
  transfer ? "transfer" : type;

export type AccountKind = "giro" | "savings" | "depot" | "credit_card" | "cash" | "other";

export interface NewAccount {
  name: string;
  kind: AccountKind;
  institution: string;
  iban: string | null; // ohne Leerzeichen; Umsätze mit dieser IBAN ordnet der Import dem Konto zu
  extraIbans: string[]; // weitere IBANs, z. B. der Lastschrifteinzug: erkennen Umbuchungen, ordnen aber nichts zu
}

export interface Account extends NewAccount {
  id: number;
  bankBalance: number | null; // Kontostand laut Bank am Tag bankBalanceDate, daraus ergeben sich die Kontostände
  bankBalanceDate: string | null; // YYYY-MM-DD
  balance: number; // Kontostand nach allen Buchungen
  pendingRoundUps: number; // bei Trade Republic für Round-Ups vorgemerkt, noch nicht gebucht
  transactionCount: number;
  firstDate: string | null; // erster und letzter Buchungstag, null ohne Buchungen
  lastDate: string | null;
}

/** Änderungen an einem Konto; bankBalance und bankBalanceDate gehören zusammen, null entfernt sie */
export type AccountChanges = Partial<NewAccount> & { bankBalance?: number | null; bankBalanceDate?: string | null };

/** Werte eines Kontos in einem Monat */
export interface MonthStat {
  month: string; // YYYY-MM
  accountId: number;
  income: number; // ohne Umbuchungen
  expenses: number; // ohne Umbuchungen, positiv
  transfers: number; // Umbuchungen mit Vorzeichen
  balance: number; // Kontostand am Monatsanfang
}

/** Kontostand eines Kontos an einem Tag */
export interface DayBalance {
  date: string; // YYYY-MM-DD
  accountId: number;
  balance: number; // Kontostand am Tagesende
}

/** Ein bisheriger Import */
export interface ImportRun {
  id: number;
  profileName: string;
  fileName: string;
  createdAt: string; // ISO-Zeitstempel
  imported: number;
  duplicatesSkipped: number;
  skipped: number;
  invalid: number;
  accounts: { id: number; name: string }[];
}

export interface ImportProfile {
  id: string;
  name: string;
  description: string;
}

export interface ImportOptions {
  maxFileBytes: number;
  profiles: ImportProfile[];
}

export interface ImportRow {
  line: number;
  date: string; // YYYY-MM-DD
  amount: number; // negativ für Ausgaben
  counterparty: string;
  purpose: string;
  duplicate: boolean;
}

/** Konto, in das Datensätze der Datei gehen, mit der Anzahl gültiger Datensätze */
export interface ImportAccount {
  iban: string | null; // eigene IBAN aus der Datei; null: Datensätze ohne IBAN, ihr Konto wird gewählt
  accountId: number | null; // null: wird beim Import angelegt (mit IBAN) bzw. gewählt (ohne IBAN)
  accountName: string | null;
  new: number;
  duplicate: number;
}

export interface ImportPreview {
  profile: { id: string; name: string };
  fileName: string;
  counts: { total: number; new: number; duplicate: number; skipped: number; invalid: number };
  sample: ImportRow[];
  duplicates: ImportRow[];
  errors: { line: number; reason: string }[];
  skipped: { reason: string; count: number }[];
  accounts: ImportAccount[];
}

export interface ImportResult {
  importId: number;
  imported: number;
  duplicatesSkipped: number;
  skipped: number;
  invalid: number;
  category: string;
  accounts: { id: number; name: string; imported: number; created: boolean }[];
}

/** Spalten, wenn die Datei nicht zum gewählten Importprofil passt */
export interface ProfileMismatch {
  expected: string[];
  found: string[];
  missing: string[];
}

export const CATEGORIES: Record<TxKind, string[]> = {
  out: ["Wohnen", "Lebensmittel", "Mobilität", "Freizeit", "Versicherung", "Gesundheit", "Sonstiges"],
  in: ["Gehalt", "Nebenverdienst", "Erstattung", "Sonstiges"],
  transfer: ["Sparen", "Investieren", "Bargeld", "Sonstiges"],
};

/** Kategorien aller Arten zusammen, jede einmal */
export const ALL_CATEGORIES = [...new Set(Object.values(CATEGORIES).flat())];

export const ACCOUNT_KINDS: [AccountKind, string][] = [
  ["giro", "Girokonto"],
  ["savings", "Tagesgeld"],
  ["depot", "Depot"],
  ["credit_card", "Kreditkarte"],
  ["cash", "Bargeld"],
  ["other", "Sonstiges"],
];

export const kindLabel = (kind: AccountKind) => ACCOUNT_KINDS.find(([value]) => value === kind)?.[1] ?? kind;
