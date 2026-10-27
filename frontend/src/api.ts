import type { NewTransaction, Transaction } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/${path}`, init);
  if (!res.ok) throw new Error(`Anfrage fehlgeschlagen (${res.status})`);
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
