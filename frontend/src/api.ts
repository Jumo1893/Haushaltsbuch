import type {
  ImportOptions,
  ImportPreview,
  ImportResult,
  NewTransaction,
  ProfileMismatch,
  Transaction,
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

export const fetchTransactions = (month: string) =>
  request<Transaction[]>(`transactions?month=${encodeURIComponent(month)}`);

export const createTransaction = (tx: NewTransaction) =>
  request<Transaction>("transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tx),
  });

export const deleteTransaction = (id: number) => request<null>(`transactions/${id}`, { method: "DELETE" });

export const fetchImportOptions = () => request<ImportOptions>("import-profiles");

/** Schickt die Datei unverändert als Body; der Dateiname steht im Header. */
const upload = <T>(path: string, file: File) =>
  request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
    body: file,
  });

export const previewImport = (profile: string, file: File) =>
  upload<ImportPreview>(`imports/preview?profile=${encodeURIComponent(profile)}`, file);

export const runImport = (profile: string, file: File, includeDuplicates: boolean) =>
  upload<ImportResult>(
    `imports?profile=${encodeURIComponent(profile)}&duplicates=${includeDuplicates ? "include" : "skip"}`,
    file,
  );
