import { useCallback, useEffect, useState } from "react";
import { createTransaction, deleteTransaction, fetchTransactions, updateTransaction } from "./api";
import { addMonths, monthOf, ym } from "./format";
import type { NewTransaction, Transaction, TransactionChanges } from "./types";
import MonthNav from "./components/MonthNav";
import BalanceCard from "./components/BalanceCard";
import TransactionForm from "./components/TransactionForm";
import CategoryBreakdown from "./components/CategoryBreakdown";
import TransactionList from "./components/TransactionList";
import CsvImport from "./components/CsvImport";
import EditTransactionDialog from "./components/EditTransactionDialog";

const firstOfThisMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

export default function App() {
  const [month, setMonth] = useState(firstOfThisMonth);
  const [items, setItems] = useState<Transaction[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Transaction | null>(null);

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

  // Zum Monat der Buchung springen; gleicher Monat → direkt neu laden
  const showMonthOf = async (date: string) => {
    const target = monthOf(date);
    if (ym(target) === ym(month)) await load(month);
    else setMonth(target);
  };

  const handleAdd = async (tx: NewTransaction) => {
    try {
      await createTransaction(tx);
    } catch {
      setError("Speichern fehlgeschlagen.");
      return false;
    }
    await showMonthOf(tx.date);
    return true;
  };

  // Fehler beim Speichern zeigt der Dialog selbst an
  const handleUpdate = async (tx: Transaction, changes: TransactionChanges) => {
    await updateTransaction(tx.id, changes);
    await showMonthOf(changes.date ?? tx.date);
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
        <h2>Umsätze importieren</h2>
        <CsvImport onImported={() => load(month)} />
      </section>

      <section>
        <h2>Ausgaben nach Kategorie</h2>
        <CategoryBreakdown items={items} />
      </section>

      <section>
        <h2>Buchungen</h2>
        <TransactionList items={items} onEdit={setEditing} onDelete={handleDelete} />
      </section>

      {editing && (
        <EditTransactionDialog
          key={editing.id}
          tx={editing}
          onSave={(changes) => handleUpdate(editing, changes)}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  );
}
