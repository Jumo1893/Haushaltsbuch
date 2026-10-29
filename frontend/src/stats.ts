import { roundCents } from "./format";
import type { MonthStat, Transaction } from "./types";

/** Zeiträume der Diagramme in Monaten, 0 = alles */
export const RANGES: [number, string][] = [
  [12, "12 Monate"],
  [24, "2 Jahre"],
  [0, "Alles"],
];

/** Werte eines Monats; net ist die Änderung des Kontostands: Einnahmen − Ausgaben + Umbuchungen */
export interface MonthTotals {
  month: string;
  income: number;
  expenses: number;
  transfers: number;
  net: number;
  balance: number;
}

/** Werte der Konten je Monat zusammengezählt, nach Monat sortiert */
export function totalsByMonth(stats: MonthStat[]): MonthTotals[] {
  const byMonth = new Map<string, MonthTotals>();
  for (const s of stats) {
    const t = byMonth.get(s.month) ?? { month: s.month, income: 0, expenses: 0, transfers: 0, net: 0, balance: 0 };
    t.income += s.income;
    t.expenses += s.expenses;
    t.transfers += s.transfers;
    t.net += s.income - s.expenses + s.transfers;
    t.balance += s.balance;
    byMonth.set(s.month, t);
  }
  return [...byMonth.values()]
    .map((t) => ({ ...t, net: roundCents(t.net), balance: roundCents(t.balance) }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Kontostände am Monatsende je Konto, in der Reihenfolge von months */
export function balancesOf(stats: MonthStat[], accountId: number, months: string[]) {
  const byMonth = new Map(stats.filter((s) => s.accountId === accountId).map((s) => [s.month, s.balance]));
  return months.map((m) => byMonth.get(m) ?? null);
}

/** Durchschnitt je Monat; null ohne Monate */
export function average(months: MonthTotals[]) {
  if (!months.length) return null;
  const sum = (pick: (t: MonthTotals) => number) => months.reduce((s, t) => s + pick(t), 0) / months.length;
  return { income: sum((t) => t.income), expenses: sum((t) => t.expenses), net: sum((t) => t.net) };
}

/** Summen aus Buchungen; Umbuchungen zählen nicht als Einnahme oder Ausgabe, nur zum Saldo */
export function summarize(items: Transaction[]) {
  let income = 0;
  let expenses = 0;
  let transfers = 0;
  let transferCount = 0;
  for (const x of items) {
    if (x.transfer) {
      transfers += x.type === "in" ? x.amount : -x.amount;
      transferCount++;
    } else if (x.type === "in") income += x.amount;
    else expenses += x.amount;
  }
  return { income, expenses, transfers, transferCount, net: income - expenses + transfers };
}

/** Größte Ausgaben nach Empfänger: Gegenpartei bei importierten Buchungen, sonst die Kategorie */
export function topPayees(items: Transaction[], count: number) {
  const groups = new Map<string, { label: string; amount: number; bookings: number }>();
  for (const x of items) {
    if (x.type !== "out" || x.transfer) continue;
    const label = x.counterparty || x.category;
    const key = label.trim().toLowerCase();
    const group = groups.get(key) ?? { label, amount: 0, bookings: 0 };
    group.amount += x.amount;
    group.bookings++;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.amount - a.amount).slice(0, count);
}
