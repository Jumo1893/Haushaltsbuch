import { useState } from "react";
import {
  deleteTransaction,
  fetchTransactions,
  saveTransaction,
  searchTransactions,
  updateTransactions,
} from "../api";
import { OFFLINE, useData, useLoad } from "../data";
import { bookings } from "../format";
import {
  isFiltered,
  type RememberMode,
  type Transaction,
  type TransactionChanges,
  type TransactionFilters,
} from "../types";
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
  /** Statt des Monats die Buchungen aus allen Monaten zeigen, die zu diesen Filtern passen; ohne Filter alle */
  filters?: TransactionFilters;
  /** Überschriften als h3, wenn die Ansicht unter einer h2 steht */
  nested?: boolean;
}

/**
 * Buchungen eines Monats, aller Monate oder Treffer einer Suche, mit Saldo, Ausgaben nach Kategorie und Liste zum
 * Bearbeiten und Löschen, einzeln oder mehrere auf einmal
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
  const searching = !!filters && isFiltered(filters);
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
  const handleUpdate = async (tx: Transaction, changes: TransactionChanges, remember: RememberMode | null) => {
    try {
      const { updated, assigned } = await saveTransaction(tx.id, changes, remember);
      if (updated) {
        if (selected.has(tx.id)) select([updated], true);
        const target = updated.date.slice(0, 7);
        if (!filters && target !== month) onMonthChange(target);
      }
      if (assigned !== null) {
        setSaved(
          assigned
            ? `Zuordnung gemerkt und auf ${assigned} weitere ${assigned === 1 ? "Buchung" : "Buchungen"} übertragen.`
            : "Zuordnung für künftige Buchungen gemerkt.",
        );
      }
    } finally {
      // Auch wenn nur das Merken scheitert, ist die Buchung schon geändert
      refresh();
    }
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
            <BalanceCard
              items={items}
              label={searching ? "Saldo der Treffer" : filters ? "Saldo aller Monate" : "Saldo im Monat"}
            />
            <section>
              <Heading className="h2">Ausgaben nach Kategorie</Heading>
              <CategoryBreakdown items={items} />
            </section>
          </div>
          <section>
            <Heading className="h2">{searching ? `${items.length} Treffer` : bookings(items.length)}</Heading>
            <TransactionList
              items={items}
              accounts={accounts}
              showAccount={accountId === undefined}
              showYear={!!filters}
              emptyText={searching ? "Keine Treffer." : filters ? "Noch keine Buchungen." : undefined}
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
          onSave={(changes, remember) => handleUpdate(editing, changes, remember)}
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
