export type TxType = "in" | "out";

export interface Transaction {
  id: number;
  type: TxType;
  amount: number;
  category: string;
  date: string; // YYYY-MM-DD
  note: string;
}

export type NewTransaction = Omit<Transaction, "id">;

export const CATEGORIES: Record<TxType, string[]> = {
  out: ["Wohnen", "Lebensmittel", "Mobilität", "Freizeit", "Versicherung", "Gesundheit", "Sonstiges"],
  in: ["Gehalt", "Nebenverdienst", "Erstattung", "Sonstiges"],
};
