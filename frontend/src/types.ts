/** Richtung einer Buchung: "in" erhöht den Kontostand, "out" senkt ihn, auch bei Umbuchungen */
export type TxType = "in" | "out";

/** Art einer Buchung in der Oberfläche: Einnahme, Ausgabe oder Umbuchung */
export type TxKind = TxType | "transfer";

/** Wie oft eine wiederkehrende Buchung anfällt */
export type Rhythm = "monthly" | "quarterly" | "semiannual" | "yearly";

export interface NewTransaction {
  type: TxType;
  amount: number;
  category: string;
  date: string; // YYYY-MM-DD
  note: string;
  accountId: number;
  transfer: boolean; // Umbuchung zwischen eigenen Konten: zählt weder als Einnahme noch als Ausgabe
  rhythm: Rhythm | null; // null: einmalig
}

/** Geänderte Felder einer Buchung */
export type TransactionChanges = Partial<NewTransaction>;

/** Änderung mehrerer Buchungen auf einmal: die Felder, die sich auch bei importierten Buchungen ändern lassen */
export type BulkChanges = Pick<TransactionChanges, "category" | "note" | "transfer" | "rhythm">;

/** Filter der Suche über alle Monate; leere Werte filtern nicht */
export interface TransactionFilters {
  text: string; // Wörter in Gegenpartei, Verwendungszweck oder Notiz
  account: number | null;
  category: string;
  type: TxKind | "";
  rhythm: Rhythm | "";
}

export const NO_FILTERS: TransactionFilters = { text: "", account: null, category: "", type: "", rhythm: "" };

export const isFiltered = ({ text, account, category, type, rhythm }: TransactionFilters) =>
  !!(text.trim() || account || category || type || rhythm);

export interface Transaction extends NewTransaction {
  id: number;
  counterparty: string;
  purpose: string;
  importId: number | null; // gesetzt, wenn die Buchung aus einem CSV-Import stammt
}

export const kindOf = ({ type, transfer }: Pick<NewTransaction, "type" | "transfer">): TxKind =>
  transfer ? "transfer" : type;

export const RHYTHMS: [Rhythm, string][] = [
  ["monthly", "Monatlich"],
  ["quarterly", "Quartalsweise"],
  ["semiannual", "Halbjährlich"],
  ["yearly", "Jährlich"],
];

export const rhythmLabel = (rhythm: Rhythm) => RHYTHMS.find(([value]) => value === rhythm)?.[1] ?? rhythm;

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
  cashAccountId: number | null; // bei einem Depot: das Geldkonto, von dem sein Geld kommt
  bankBalance: number | null; // Kontostand laut Bank am Tag bankBalanceDate, daraus ergeben sich die Kontostände
  bankBalanceDate: string | null; // YYYY-MM-DD
  balance: number; // Kontostand nach allen Buchungen, bei einem Depot mit dem Wert der Wertpapiere
  pendingRoundUps: number; // bei Trade Republic für Round-Ups vorgemerkt, noch nicht gebucht
  transactionCount: number;
  movementCount: number; // Wertpapierbewegungen, nur bei einem Depot
  firstDate: string | null; // erster und letzter Tag mit Buchung oder Bewegung, null ohne beides
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

/** Summen eines Depots. Gewinne sind vor Steuern und nach Gebühren. */
export interface DepotTotals {
  value: number; // Wert zum letzten bekannten Kurs, mit offenen Vorauszahlungen
  invested: number; // Einstand der vorhandenen Stücke, mit offenen Vorauszahlungen
  pending: number; // bezahlt, aber noch keine Anteile
  unrealized: number; // Gewinn der vorhandenen Stücke
  realized: number; // Gewinn aus Verkäufen und Rückzahlungen
  income: number; // Dividenden, Ausschüttungen und Zinsen vor Steuern
  taxes: number; // bezahlte Steuern, nach Erstattungen
  fees: number; // Gebühren, stecken schon in Einstand und Gewinnen
  received: number; // ohne Geldfluss eingebucht, zum Kurs des Tages
  result: number; // beide Gewinne und Erträge, nach Steuern
}

/** Herkunft eines Kurses: der Export oder ein Abruf bei Lang & Schwarz bzw. Kraken */
export type PriceSource = "export" | "ls" | "kraken";

export const PRICE_SOURCES: Record<PriceSource, string> = {
  export: "Export",
  ls: "Lang & Schwarz",
  kraken: "Kraken",
};

/** Ein Wertpapier im Depot */
export interface Position {
  isin: string; // bei Krypto das Kürzel
  name: string;
  assetClass: string;
  shares: number;
  price: number | null; // letzter bekannter Kurs, bei Anleihen als Anteil vom Nennwert (0,98 = 98 %)
  priceDate: string | null; // YYYY-MM-DD
  priceSource: PriceSource | null;
  lastDate: string; // letzte Bewegung
  invested: number;
  pending: number;
  value: number;
  unrealized: number;
  realized: number;
  income: number;
  taxes: number;
  fees: number;
  received: number;
}

export interface DepotAllocation {
  assetClass: string;
  value: number;
  share: number; // Anteil am Depotwert, 0 bis 1
}

/** Stand des Depots an einem Monatsanfang */
export interface DepotMonth {
  month: string; // YYYY-MM
  value: number;
  invested: number;
}

export interface DepotMovement {
  id: number;
  date: string; // YYYY-MM-DD
  type: string; // Buchungsart aus dem Export, z. B. BUY
  kind: "buy" | "sell" | "split" | "prepayment" | "proceeds" | "reward" | "income";
  isin: string;
  name: string;
  assetClass: string;
  shares: number | null;
  price: number | null;
  amount: number; // aus Sicht des Geldkontos: negativ geht Geld ins Depot
  fee: number;
  tax: number;
}

export interface Depot {
  totals: DepotTotals;
  positions: Position[]; // nach Wert, größte zuerst
  closed: Position[]; // nach letzter Bewegung, neueste zuerst
  allocation: DepotAllocation[];
  history: DepotMonth[];
  movements: DepotMovement[]; // neueste zuerst
  pricesFetchedAt: string | null; // ISO-Zeitstempel des letzten Kursabrufs, null: noch nie
  autoPrices: AutoPrices;
}

/** Ein Versuch des täglichen Kursabrufs */
export interface AutoPriceRun {
  ranAt: string; // ISO-Zeitstempel
  updated: number; // abgerufene Kurse
  failed: { name: string; error: string }[]; // Positionen ohne Kurs
}

/** Täglicher Kursabruf eines Depots, an Werktagen um 22:30 Uhr */
export interface AutoPrices {
  enabled: boolean;
  next: string; // ISO-Zeitstempel des nächsten Termins
  last: AutoPriceRun | null; // null: noch kein Versuch
}

/** Ergebnis des Kursabrufs für eine Position; ohne Quelle (Private Markets) fehlen Kurs und Fehler */
export interface PriceResult {
  isin: string;
  name: string;
  source: Exclude<PriceSource, "export"> | null;
  price?: number;
  date?: string; // YYYY-MM-DD
  error?: string;
}

/** Ein bisheriger Import */
export interface ImportRun {
  id: number;
  profileName: string;
  fileName: string;
  createdAt: string; // ISO-Zeitstempel
  imported: number;
  depotImported: number; // Wertpapierbewegungen
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
  counts: { total: number; new: number; duplicate: number; depot: number; skipped: number; invalid: number };
  sample: ImportRow[];
  duplicates: ImportRow[];
  errors: { line: number; reason: string }[];
  skipped: { reason: string; count: number }[];
  accounts: ImportAccount[];
  depot: { new: number; duplicate: number; positions: number }; // Wertpapierbewegungen der Datei
}

export interface ImportResult {
  importId: number;
  imported: number;
  duplicatesSkipped: number;
  skipped: number;
  invalid: number;
  /** Kategorie der Umsätze, die sich nicht automatisch zuordnen ließen */
  category: string;
  /** Automatisch zugeordnete Umsätze je Kategorie, die meisten zuerst */
  autoCategorized: { name: string; count: number }[];
  accounts: { id: number; name: string; imported: number; created: boolean }[];
  depot: { id: number; name: string; imported: number; created: boolean } | null;
}

/** Spalten, wenn die Datei nicht zum gewählten Importprofil passt */
export interface ProfileMismatch {
  expected: string[];
  found: string[];
  missing: string[];
}

/** Eine Kategorie gehört zu einer Art; Buchungen speichern ihren Namen */
export interface NewCategory {
  kind: TxKind;
  name: string;
}

export interface Category extends NewCategory {
  id: number;
  fixed: boolean; // lässt sich weder umbenennen noch löschen
  /** Welche Ausgaben die Kategorie automatisch bekommt, z. B. „Supermärkte, Bäcker …“; sonst null */
  auto: string | null;
  transactionCount: number;
}

export const ACCOUNT_KINDS: [AccountKind, string][] = [
  ["giro", "Girokonto"],
  ["savings", "Tagesgeld"],
  ["depot", "Depot"],
  ["credit_card", "Kreditkarte"],
  ["cash", "Bargeld"],
  ["other", "Sonstiges"],
];

export const kindLabel = (kind: AccountKind) => ACCOUNT_KINDS.find(([value]) => value === kind)?.[1] ?? kind;

/** Anlageklassen in fester Reihenfolge; ihre Stelle bestimmt die Farbe in Diagrammen (--c1 …) */
export const ASSET_CLASSES: [string, string][] = [
  ["STOCK", "Aktien"],
  ["FUND", "Fonds und ETFs"],
  ["PRIVATE_FUND", "Private Märkte"],
  ["CRYPTO", "Krypto"],
  ["BOND", "Anleihen"],
];

export const assetClassLabel = (assetClass: string) =>
  ASSET_CLASSES.find(([value]) => value === assetClass)?.[1] ?? (assetClass || "Sonstige");

/** Stelle der Anlageklasse in ASSET_CLASSES, unbekannte zuletzt */
export const assetClassRank = (assetClass: string) => {
  const rank = ASSET_CLASSES.findIndex(([value]) => value === assetClass);
  return rank < 0 ? ASSET_CLASSES.length : rank;
};

const MOVEMENT_LABELS: Record<string, string> = {
  BUY: "Kauf",
  SELL: "Verkauf",
  FREE_RECEIPT: "Gratis-Eingang",
  SPLIT: "Aktiensplit",
  REVERSE_SPLIT: "Zusammenlegung",
  REDEMPTION: "Rückzahlung",
  EARLY_REDEMPTION: "Vorzeitige Rückzahlung",
  DIVIDEND: "Dividende",
  DISTRIBUTION: "Ausschüttung",
  EARNINGS: "Ertrag",
  PRE_DETERMINED_TAX_BASE: "Vorabpauschale",
  INTEREST_PAYMENT: "Zinsen",
  BOND_ACCRUED_INTEREST: "Stückzinsen",
  SEC_ACCOUNT: "Steuerkorrektur",
  PRIVATE_MARKET_BUY: "Vorauszahlung",
  IPO_SUBSCRIPTION: "Zeichnung",
  BENEFITS_SAVEBACK: "Saveback",
  STOCKPERK: "Aktien-Prämie",
};

/** Name einer Bewegung. EARNINGS ohne Betrag ist die Steuer auf die Vorabpauschale. */
export const movementLabel = ({ type, amount }: Pick<DepotMovement, "type" | "amount">) =>
  type === "EARNINGS" && !amount ? "Vorabpauschale" : (MOVEMENT_LABELS[type] ?? type);
