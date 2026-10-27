import { useCallback, useEffect, useState } from "react";
import { createTransaction, deleteTransaction, fetchTransactions } from "./api";
import { addMonths, monthOf, ym } from "./format";
import type { NewTransaction, Transaction } from "./types";
import MonthNav from "./components/MonthNav";
import BalanceCard from "./components/BalanceCard";
import TransactionForm from "./components/TransactionForm";
import CategoryBreakdown from "./components/CategoryBreakdown";
import TransactionList from "./components/TransactionList";

const firstOfThisMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

export default function App() {
  const [month, setMonth] = useState(firstOfThisMonth);
  const [items, setItems] = useState<Transaction[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async (m: Date) => {
    try {
      setItems(await fetchTransactions(ym(m)));
      setError("");
    } catch {
      setError("Der Server ist nicht erreichbar. Prüfe, ob alle Container laufen.");
    }
  }, []);

  useEffect(() => {
    load(month);
  }, [month, load]);

  const handleAdd = async (tx: NewTransaction) => {
    try {
      await createTransaction(tx);
    } catch {
      setError("Speichern fehlgeschlagen.");
      return false;
    }
    // Zum Monat der neuen Buchung springen; gleicher Monat → direkt neu laden
    const target = monthOf(tx.date);
    if (ym(target) === ym(month)) await load(month);
    else setMonth(target);
    return true;
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteTransaction(id);
      await load(month);
    } catch {
      setError("Löschen fehlgeschlagen.");
    }
  };

  return (
    <main>
      <header>
        <h1>Haushaltsbuch</h1>
        <MonthNav month={month} onChange={(n) => setMonth((m) => addMonths(m, n))} />
      </header>

      {error && (
        <p className="errbox" role="alert">
          {error}
        </p>
      )}

      <BalanceCard items={items} />

      <section>
        <h2>Neue Buchung</h2>
        <TransactionForm onSubmit={handleAdd} />
      </section>

      <section>
        <h2>Ausgaben nach Kategorie</h2>
        <CategoryBreakdown items={items} />
      </section>

      <section>
        <h2>Buchungen</h2>
        <TransactionList items={items} onDelete={handleDelete} />
      </section>
    </main>
  );
}
