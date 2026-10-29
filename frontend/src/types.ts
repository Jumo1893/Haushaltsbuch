export type TxType = "in" | "out";

export interface NewTransaction {
  type: TxType;
  amount: number;
  category: string;
  date: string; // YYYY-MM-DD
  note: string;
  accountId: number;
}

/** Geänderte Felder einer Buchung */
export type TransactionChanges = Partial<NewTransaction>;

export interface Transaction extends NewTransaction {
  id: number;
  counterparty: string;
  purpose: string;
  importId: number | null; // gesetzt, wenn die Buchung aus einem CSV-Import stammt
}

export type AccountKind = "giro" | "savings" | "depot" | "credit_card" | "cash" | "other";

export interface NewAccount {
  name: string;
  kind: AccountKind;
  institution: string;
  iban: string | null; // ohne Leerzeichen; Umsätze mit dieser IBAN ordnet der Import dem Konto zu
}

export interface Account extends NewAccount {
  id: number;
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

export const CATEGORIES: Record<TxType, string[]> = {
  out: ["Wohnen", "Lebensmittel", "Mobilität", "Freizeit", "Versicherung", "Gesundheit", "Sonstiges"],
  in: ["Gehalt", "Nebenverdienst", "Erstattung", "Sonstiges"],
};

export const ACCOUNT_KINDS: [AccountKind, string][] = [
  ["giro", "Girokonto"],
  ["savings", "Tagesgeld"],
  ["depot", "Depot"],
  ["credit_card", "Kreditkarte"],
  ["cash", "Bargeld"],
  ["other", "Sonstiges"],
];
