import { eur, roundCents } from "./format";
import type { DebtKind, Person, Transaction, TransactionDebt } from "./types";

export const KIND_LABELS: Record<DebtKind, string> = { debt: "Schuld", settlement: "Ausgleich" };

/** Name, wie das Backend ihn speichert: ohne doppelten Leerraum */
export const cleanName = (name: string) => name.replace(/\s+/g, " ").trim();

/** Person mit diesem Namen, ohne Unterschied bei Groß- und Kleinschreibung */
export const findPerson = (people: Person[], name: string) => {
  const key = cleanName(name).toLowerCase();
  return key ? people.find((p) => p.name.toLowerCase() === key) : undefined;
};

/** Stand mit einer Person in Worten, z. B. „Anna schuldet dir 12,00 €“ */
export function balanceText(name: string, balance: number) {
  const value = roundCents(balance);
  if (value > 0) return `${name} schuldet dir ${eur.format(value)}`;
  if (value < 0) return `Du schuldest ${name} ${eur.format(-value)}`;
  return `Mit ${name} ausgeglichen`;
}

/** Was ein Eintrag bewirkt, z. B. „Anna schuldet dir 10,00 €“ oder „Anna gleicht 10,00 € aus“ */
export function effectText(person: string, amount: number, kind: DebtKind) {
  const value = eur.format(Math.abs(amount));
  if (kind === "debt") return amount > 0 ? `${person} schuldet dir ${value}` : `Du schuldest ${person} ${value}`;
  return amount < 0 ? `${person} gleicht ${value} aus` : `Du gleichst ${value} bei ${person} aus`;
}

/** Kurzer Text für eine Buchung: Gegenpartei, sonst Notiz oder Kategorie */
export const bookingLabel = (tx: Pick<Transaction, "counterparty" | "note" | "category">) =>
  tx.counterparty || tx.note || tx.category;

/** Markierung einer Buchung mit Schulden in der Liste, z. B. „Schulden · 3 Personen“ oder „Ausgleich · Anna“ */
export function debtBadge(debts: TransactionDebt[]) {
  const kind = debts.every((d) => d.kind === "settlement") ? "Ausgleich" : "Schulden";
  const people = new Set(debts.map((d) => d.personId));
  return `${kind} · ${people.size === 1 ? debts[0].person : `${people.size} Personen`}`;
}

/** Wie ein Betrag aufgeteilt wird: zu gleichen Teilen, nach Prozent oder in Beträgen */
export type SplitMode = "equal" | "percent" | "amount";

export const SPLIT_MODES: [SplitMode, string][] = [
  ["equal", "Gleich"],
  ["percent", "Prozent"],
  ["amount", "Beträge"],
];

export type SplitResult = { payer: number; others: number[] } | { error: string };

/** Verteilt den Rest (positiv oder negativ, in Cent) centweise auf die ersten Anteile */
function spread(shares: number[], rest: number) {
  const result = [...shares];
  for (let i = 0; rest !== 0; i = (i + 1) % result.length) {
    const step = Math.sign(rest);
    result[i] += step;
    rest -= step;
  }
  return result;
}

/**
 * Teilt total (in Cent) zwischen dem, der bezahlt hat, und den anderen Beteiligten auf. inputs enthält je anderem
 * Beteiligten den Prozentsatz bzw. den Betrag in Cent, bei gleichen Teilen zählt nur ihre Zahl. Wer bezahlt hat, trägt
 * den Rest, auch Rundungscents. Ist er selbst nicht beteiligt, muss für ihn nichts übrig bleiben, Rundungscents gehen
 * dann an die ersten anderen. Liefert die Anteile in Cent oder den Grund, warum die Aufteilung nicht aufgeht.
 */
export function splitCents(total: number, mode: SplitMode, payerIncluded: boolean, inputs: number[]): SplitResult {
  if (!(Number.isInteger(total) && total > 0)) return { error: "Bitte den Betrag angeben." };
  if (!inputs.length) return { error: "Bitte mindestens eine weitere Person angeben." };
  const sum = (list: number[]) => list.reduce((s, x) => s + x, 0);
  let others: number[];
  if (mode === "equal") {
    const base = Math.floor(total / (inputs.length + (payerIncluded ? 1 : 0)));
    others = inputs.map(() => base);
    if (!payerIncluded) others = spread(others, total - sum(others));
  } else {
    if (inputs.some((x) => !(Number.isFinite(x) && x >= 0))) return { error: "Bitte für jede Person einen Anteil angeben." };
    if (mode === "percent") {
      const percent = Math.round(sum(inputs) * 1e6) / 1e6;
      if (percent > 100) return { error: `Zusammen ${percent.toLocaleString("de-DE")} %, mehr als 100 %.` };
      if (!payerIncluded && percent !== 100) {
        return { error: `Zusammen ${percent.toLocaleString("de-DE")} % statt 100 %.` };
      }
      others = inputs.map((p) => Math.round((total * p) / 100));
      if (!payerIncluded) others = spread(others, total - sum(others));
    } else {
      others = inputs.map((x) => Math.round(x));
    }
  }
  const payer = total - sum(others);
  if (payer < 0) {
    return { error: `Die Anteile ergeben zusammen ${eur.format(sum(others) / 100)}, mehr als ${eur.format(total / 100)}.` };
  }
  if (!payerIncluded && payer !== 0) {
    return { error: `Die Anteile ergeben zusammen ${eur.format(sum(others) / 100)} statt ${eur.format(total / 100)}.` };
  }
  return { payer, others };
}
