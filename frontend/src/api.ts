import type {
  Account,
  AccountChanges,
  DayBalance,
  ImportOptions,
  ImportPreview,
  ImportResult,
  ImportRun,
  MonthStat,
  NewAccount,
  NewTransaction,
  ProfileMismatch,
  Transaction,
  TransactionChanges,
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

export const deleteTransaction = (id: number) => request<null>(`transactions/${id}`, { method: "DELETE" });

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
