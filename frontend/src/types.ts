export type TxType = "in" | "out";

export interface NewTransaction {
  type: TxType;
  amount: number;
  category: string;
  date: string; // YYYY-MM-DD
  note: string;
}

/** Geänderte Felder einer Buchung */
export type TransactionChanges = Partial<NewTransaction>;

export interface Transaction extends NewTransaction {
  id: number;
  counterparty: string;
  purpose: string;
  importId: number | null; // gesetzt, wenn die Buchung aus einem CSV-Import stammt
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

export interface ImportPreview {
  profile: { id: string; name: string };
  fileName: string;
  counts: { total: number; new: number; duplicate: number; skipped: number; invalid: number };
  sample: ImportRow[];
  duplicates: ImportRow[];
  errors: { line: number; reason: string }[];
  skipped: { reason: string; count: number }[];
}

export interface ImportResult {
  importId: number;
  imported: number;
  duplicatesSkipped: number;
  skipped: number;
  invalid: number;
  category: string;
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
