import { useState } from "react";
import {
  deleteTransaction,
  fetchTransactions,
  searchTransactions,
  updateTransaction,
  updateTransactions,
} from "../api";
import { OFFLINE, useData, useLoad } from "../data";
import { bookings } from "../format";
import type { Transaction, TransactionChanges, TransactionFilters } from "../types";
import BalanceCard from "./BalanceCard";
import BulkEditDialog, { type BulkUpdate } from "./BulkEditDialog";
import CategoryBreakdown from "./CategoryBreakdown";
import EditTransactionDialog from "./EditTransactionDialog";
import TransactionList from "./TransactionList";

interface Props {
  month: string; // YYYY-MM
  /** Wechselt den Monat, z. B. wenn eine Buchung in einen anderen Monat verschoben wurde */
  onMonthChange: (month: string) => void;
  /** Nur die Buchungen dieses Kontos; ohne alle */
  accountId?: number;
  /** Statt des Monats die Treffer dieser Filter aus allen Monaten zeigen */
  filters?: TransactionFilters;
  /** Überschriften als h3, wenn die Ansicht unter einer h2 steht */
  nested?: boolean;
}

/**
 * Buchungen eines Monats oder Treffer einer Suche, mit Saldo, Ausgaben nach Kategorie und Liste zum Bearbeiten und
 * Löschen, einzeln oder mehrere auf einmal
 */
export default function BookingsView({ month, onMonthChange, accountId, filters, nested = false }: Props) {
  const { accounts, createAccount, refresh } = useData();
  const { data, failed, loading } = useLoad(
    () => (filters ? searchTransactions(filters) : fetchTransactions(month, accountId)),
    [month, accountId, filters],
  );
  const items = data ?? [];
  const [editing, setEditing] = useState<Transaction | null>(null);
  // Bleibt beim Blättern und Suchen bestehen, so lässt sich eine Auswahl über mehrere Monate und Konten zusammenstellen
  const [selected, setSelected] = useState<ReadonlyMap<number, Transaction>>(new Map());
  const [bulkEditing, setBulkEditing] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  // Unter einer h2 eine Ebene tiefer, aber gleich groß
  const Heading = nested ? "h3" : "h2";
  const outOfView = selected.size - items.filter((x) => selected.has(x.id)).length;

  const select = (txs: Transaction[], on: boolean) => {
    setSelected((current) => {
      const next = new Map(current);
      for (const tx of txs) {
        if (on) next.set(tx.id, tx);
        else next.delete(tx.id);
      }
      return next;
    });
    setSaved("");
  };

  // Fehler beim Speichern zeigen die Dialoge selbst an
  const handleUpdate = async (tx: Transaction, changes: TransactionChanges) => {
    const updated = await updateTransaction(tx.id, changes);
    if (selected.has(tx.id)) select([updated], true);
    const target = updated.date.slice(0, 7);
    if (!filters && target !== month) onMonthChange(target);
    refresh();
  };

  const handleBulkUpdate = async (updates: BulkUpdate[]) => {
    try {
      const results = await Promise.all(updates.map(({ ids, changes }) => updateTransactions(ids, changes)));
      setSaved(`${bookings(results.reduce((sum, r) => sum + r.updated, 0))} geändert.`);
      setSelected(new Map());
    } finally {
      refresh();
    }
  };

  const handleDelete = async (tx: Transaction) => {
    try {
      await deleteTransaction(tx.id);
      setError("");
      select([tx], false);
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
            <BalanceCard items={items} label={filters ? "Saldo der Treffer" : "Saldo im Monat"} />
            <section>
              <Heading className="h2">Ausgaben nach Kategorie</Heading>
              <CategoryBreakdown items={items} />
            </section>
          </div>
          <section>
            <Heading className="h2">{filters ? `${items.length} Treffer` : bookings(items.length)}</Heading>
            <TransactionList
              items={items}
              accounts={accounts}
              showAccount={accountId === undefined}
              showYear={!!filters}
              emptyText={filters ? "Keine Treffer." : undefined}
              selected={selected}
              onSelect={select}
              onEdit={setEditing}
              onDelete={handleDelete}
            />
          </section>
        </div>
      )}
      {selected.size > 0 && (
        <div className="selection">
          <span role="status">
            {selected.size} ausgewählt{outOfView > 0 && `, davon ${outOfView} nicht in dieser Ansicht`}
          </span>
          <button className="add" onClick={() => setBulkEditing(true)}>
            Bearbeiten
          </button>
          <button className="ghost" onClick={() => setSelected(new Map())}>
            Auswahl aufheben
          </button>
        </div>
      )}
      {saved && (
        <div className="selection">
          <span role="status">{saved}</span>
          <button className="ghost" onClick={() => setSaved("")}>
            Schließen
          </button>
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
      {bulkEditing && (
        <BulkEditDialog
          items={[...selected.values()]}
          onSave={handleBulkUpdate}
          onClose={() => setBulkEditing(false)}
        />
      )}
    </>
  );
}
