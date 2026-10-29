import { useCallback, useEffect, useState } from "react";
import {
  createAccount,
  createTransaction,
  deleteTransaction,
  fetchAccounts,
  fetchTransactions,
  updateTransaction,
} from "./api";
import { addMonths, monthOf, ym } from "./format";
import type { Account, NewAccount, NewTransaction, Transaction, TransactionChanges } from "./types";
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

/** Konten alphabetisch, wie in den Auswahllisten */
const byName = (a: Account, b: Account) => a.name.localeCompare(b.name, "de") || a.id - b.id;

export default function App() {
  const [month, setMonth] = useState(firstOfThisMonth);
  const [items, setItems] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
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

  const loadAccounts = useCallback(async () => {
    try {
      setAccounts((await fetchAccounts()).sort(byName));
    } catch {
      setError("Der Server ist nicht erreichbar. Prüfe, ob alle Container laufen.");
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // Fehler beim Anlegen zeigt der Dialog selbst an
  const handleCreateAccount = async (account: NewAccount) => {
    const created = await createAccount(account);
    setAccounts((list) => [...list, created].sort(byName));
    return created;
  };

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
        <TransactionForm accounts={accounts} onCreateAccount={handleCreateAccount} onSubmit={handleAdd} />
      </section>

      <section>
        <h2>Umsätze importieren</h2>
        <CsvImport
          accounts={accounts}
          onCreateAccount={handleCreateAccount}
          onImported={() => {
            load(month);
            loadAccounts(); // der Import kann Konten angelegt haben
          }}
        />
      </section>

      <section>
        <h2>Ausgaben nach Kategorie</h2>
        <CategoryBreakdown items={items} />
      </section>

      <section>
        <h2>Buchungen</h2>
        <TransactionList items={items} accounts={accounts} onEdit={setEditing} onDelete={handleDelete} />
      </section>

      {editing && (
        <EditTransactionDialog
          key={editing.id}
          tx={editing}
          accounts={accounts}
          onCreateAccount={handleCreateAccount}
          onSave={(changes) => handleUpdate(editing, changes)}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  );
}
