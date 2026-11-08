import type {
  Account,
  AccountChanges,
  AutoPrices,
  BulkChanges,
  Category,
  DayBalance,
  Depot,
  ImportOptions,
  ImportPreview,
  ImportResult,
  ImportRun,
  MonthStat,
  NewAccount,
  NewCategory,
  NewTransaction,
  PriceResult,
  ProfileMismatch,
  RememberMode,
  Rule,
  RulePreview,
  Transaction,
  TransactionChanges,
  TransactionFilters,
  TxKind,
} from "./types";

/** Fehlerantwort der API; `body` enthält die Meldung des Servers, falls vorhanden. */
export class ApiError extends Error {
  status: number;
  body: { error?: string; mismatch?: ProfileMismatch } | null;

  constructor(status: number, body: ApiError["body"]) {
    super(body?.error ?? `Anfrage fehlgeschlagen (${status})`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/${path}`, init);
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return (res.status === 204 ? null : await res.json()) as T;
}

/** Nur die Buchungen dieses Kontos; ohne alle */
const accountQuery = (account?: number) => (account === undefined ? "" : `&account=${account}`);

/** Buchungen eines Monats (YYYY-MM), neueste zuerst */
export const fetchTransactions = (month: string, account?: number) =>
  request<Transaction[]>(`transactions?month=${encodeURIComponent(month)}${accountQuery(account)}`);

/** Die neuesten Buchungen */
export const fetchLatest = (limit: number, account?: number) =>
  request<Transaction[]>(`transactions?limit=${limit}${accountQuery(account)}`);

/** Buchungen aus allen Monaten, die zu den Filtern passen, neueste zuerst */
export const searchTransactions = ({ text, account, category, type, rhythm }: TransactionFilters) =>
  request<Transaction[]>(
    `transactions/search?${new URLSearchParams({ q: text, category, type, rhythm })}${accountQuery(account ?? undefined)}`,
  );

/** Werte je Monat und Konto bis zum Monat until (YYYY-MM) */
export const fetchMonthStats = (until: string, account?: number) =>
  request<MonthStat[]>(`stats/months?until=${encodeURIComponent(until)}${accountQuery(account)}`);

/** Kontostand je Tag und Konto von from bis until (YYYY-MM-DD) */
export const fetchDayBalances = (from: string, until: string, account?: number) =>
  request<DayBalance[]>(
    `stats/days?from=${encodeURIComponent(from)}&until=${encodeURIComponent(until)}${accountQuery(account)}`,
  );

export const createTransaction = (tx: NewTransaction) =>
  request<Transaction>("transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tx),
  });

export const updateTransaction = (id: number, changes: TransactionChanges) =>
  request<Transaction>(`transactions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });

/** Ändert mehrere Buchungen in einem Schritt; `updated` ist die Zahl der geänderten Buchungen */
export const updateTransactions = (ids: number[], changes: BulkChanges) =>
  request<{ updated: number }>("transactions", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, changes }),
  });

export const deleteTransaction = (id: number) => request<null>(`transactions/${id}`, { method: "DELETE" });

export const fetchRules = () => request<Rule[]>("rules");

/** Was eine gemerkte Zuordnung aus der Buchung bewirken würde, wenn sie die Art kind hat */
export const previewRule = (transactionId: number, kind: TxKind) =>
  request<RulePreview>(`rules/preview?transaction=${transactionId}&kind=${kind}`);

/**
 * Merkt Kategorie und Rhythmus der Buchung für alle Buchungen derselben Gegenpartei, auch die bisherigen;
 * `assigned` ist die Zahl der anderen Buchungen, die sich dadurch geändert haben
 */
export const createRule = (transactionId: number, mode: RememberMode) =>
  request<{ rule: Rule; assigned: number }>("rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactionId, matchAmount: mode === "amount" }),
  });

/** Löscht eine gemerkte Zuordnung; ihre Buchungen bekommen wieder, was sonst für sie gilt */
export const deleteRule = (id: number) => request<null>(`rules/${id}`, { method: "DELETE" });

/**
 * Speichert die Änderungen einer Buchung und merkt danach auf Wunsch ihre Zuordnung. Liefert die geänderte Buchung
 * (ohne Änderungen null) und die Zahl der anderen Buchungen, die die gemerkte Zuordnung bekommen haben (ohne null).
 */
export async function saveTransaction(id: number, changes: TransactionChanges, remember: RememberMode | null) {
  const updated = Object.keys(changes).length ? await updateTransaction(id, changes) : null;
  const assigned = remember ? (await createRule(id, remember)).assigned : null;
  return { updated, assigned };
}

export const fetchAccounts = () => request<Account[]>("accounts");

export const createAccount = (account: NewAccount) =>
  request<Account>("accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(account),
  });

export const updateAccount = (id: number, changes: AccountChanges) =>
  request<Account>(`accounts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });

export const deleteAccount = (id: number) => request<null>(`accounts/${id}`, { method: "DELETE" });

/** Bestand, Verlauf bis zum Monat until (YYYY-MM) und Bewegungen eines Depots */
export const fetchDepot = (id: number, until: string) =>
  request<Depot>(`depots/${id}?until=${encodeURIComponent(until)}`);

/** Holt aktuelle Kurse für die offenen Positionen eines Depots bei Lang & Schwarz und Kraken und speichert sie */
export const refreshPrices = (id: number) =>
  request<{ results: PriceResult[] }>(`depots/${id}/prices`, { method: "POST" });

/** Schaltet den täglichen Kursabruf eines Depots ein oder aus und liefert seinen neuen Stand */
export const switchAutoPrices = (id: number, enabled: boolean) =>
  request<AutoPrices>(`depots/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ autoPrices: enabled }),
  });

export const fetchCategories = () => request<Category[]>("categories");

export const createCategory = (category: NewCategory) =>
  request<Category>("categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(category),
  });

/** Benennt die Kategorie um, ihre Buchungen ändern sich mit */
export const renameCategory = (id: number, name: string) =>
  request<Category>(`categories/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

/** Löscht die Kategorie; ihre Buchungen wandern in die Kategorie moveTo */
export const deleteCategory = (id: number, moveTo: number) =>
  request<null>(`categories/${id}?moveTo=${moveTo}`, { method: "DELETE" });

export const fetchImportOptions = () => request<ImportOptions>("import-profiles");

export const fetchImports = () => request<ImportRun[]>("imports");

/** Schickt die Datei unverändert als Body; der Dateiname steht im Header. */
const upload = <T>(path: string, file: File) =>
  request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
    body: file,
  });

export const previewImport = (profile: string, file: File) =>
  upload<ImportPreview>(`imports/preview?profile=${encodeURIComponent(profile)}`, file);

/** `account`: Konto für Datensätze ohne eigene IBAN, falls die Datei welche enthält */
export const runImport = (profile: string, file: File, includeDuplicates: boolean, account: number | null) =>
  upload<ImportResult>(
    `imports?profile=${encodeURIComponent(profile)}&duplicates=${includeDuplicates ? "include" : "skip"}` +
      (account === null ? "" : `&account=${account}`),
    file,
  );
