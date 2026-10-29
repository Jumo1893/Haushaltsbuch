import { useState } from "react";
import { deleteTransaction, fetchTransactions, updateTransaction } from "../api";
import { OFFLINE, useData, useLoad } from "../data";
import type { Transaction, TransactionChanges } from "../types";
import BalanceCard from "./BalanceCard";
import CategoryBreakdown from "./CategoryBreakdown";
import EditTransactionDialog from "./EditTransactionDialog";
import TransactionList from "./TransactionList";

interface Props {
  month: string; // YYYY-MM
  /** Wechselt den Monat, z. B. wenn eine Buchung in einen anderen Monat verschoben wurde */
  onMonthChange: (month: string) => void;
  /** Nur die Buchungen dieses Kontos; ohne alle */
  accountId?: number;
  /** Überschriften als h3, wenn die Ansicht unter einer h2 steht */
  nested?: boolean;
}

/** Buchungen eines Monats mit Saldo, Ausgaben nach Kategorie und Liste zum Bearbeiten und Löschen */
export default function MonthBookings({ month, onMonthChange, accountId, nested = false }: Props) {
  const { accounts, createAccount, refresh } = useData();
  const { data, failed, loading } = useLoad(() => fetchTransactions(month, accountId), [month, accountId]);
  const items = data ?? [];
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [error, setError] = useState("");
  // Unter einer h2 eine Ebene tiefer, aber gleich groß
  const Heading = nested ? "h3" : "h2";

  // Fehler beim Speichern zeigt der Dialog selbst an
  const handleUpdate = async (tx: Transaction, changes: TransactionChanges) => {
    await updateTransaction(tx.id, changes);
    const target = (changes.date ?? tx.date).slice(0, 7);
    if (target !== month) onMonthChange(target);
    refresh();
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteTransaction(id);
      setError("");
      refresh();
    } catch {
      setError("Löschen fehlgeschlagen.");
    }
  };

  return (
    <>
      {(error || failed) && (
        <p className="errbox" role="alert">
          {error || OFFLINE}
        </p>
      )}
      {/* Beim ersten Laden nichts zeigen statt einer leeren Liste; danach bleibt die alte stehen, bis die neue da ist */}
      {data && (
        <div className={`grid columns${loading ? " stale" : ""}`}>
          <div>
            <BalanceCard items={items} />
            <section>
              <Heading className="h2">Ausgaben nach Kategorie</Heading>
              <CategoryBreakdown items={items} />
            </section>
          </div>
          <section>
            <Heading className="h2">
              {items.length} {items.length === 1 ? "Buchung" : "Buchungen"}
            </Heading>
            <TransactionList
              items={items}
              accounts={accounts}
              showAccount={accountId === undefined}
              onEdit={setEditing}
              onDelete={handleDelete}
            />
          </section>
        </div>
      )}
      {editing && (
        <EditTransactionDialog
          key={editing.id}
          tx={editing}
          accounts={accounts}
          onCreateAccount={createAccount}
          onSave={(changes) => handleUpdate(editing, changes)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
