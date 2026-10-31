import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../api";
import type { Account, NewAccount, NewTransaction, Transaction, TransactionChanges } from "../types";
import TransactionForm from "./TransactionForm";

interface Props {
  tx: Transaction;
  accounts: Account[];
  onCreateAccount: (account: NewAccount) => Promise<Account>;
  /** Speichert die geänderten Felder; wirft bei einem Fehler. */
  onSave: (changes: TransactionChanges) => Promise<void>;
  onClose: () => void;
}

/** Nur die Felder, die sich gegenüber der Buchung geändert haben */
const diff = (tx: Transaction, updated: NewTransaction) =>
  Object.fromEntries(
    Object.entries(updated).filter(([key, value]) => value !== tx[key as keyof NewTransaction]),
  ) as TransactionChanges;

export default function EditTransactionDialog({ tx, accounts, onCreateAccount, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [error, setError] = useState("");
  const imported = tx.importId !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => ref.current?.close();

  const handleSubmit = async (updated: NewTransaction) => {
    const changes = diff(tx, updated);
    if (!Object.keys(changes).length) {
      close();
      return true;
    }
    try {
      await onSave(changes);
      close();
      return true;
    } catch (e) {
      setError(e instanceof ApiError && e.body?.error ? e.body.error : "Speichern fehlgeschlagen.");
      return false;
    }
  };

  return (
    <dialog ref={ref} className="edit" aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId}>Buchung bearbeiten</h2>
      {imported && (
        <>
          <dl className="source">
            {tx.counterparty && (
              <div>
                <dt>Gegenpartei</dt>
                <dd>{tx.counterparty}</dd>
              </div>
            )}
            {tx.purpose && (
              <div>
                <dt>Verwendungszweck</dt>
                <dd>{tx.purpose}</dd>
              </div>
            )}
          </dl>
          <p className="hint">
            Aus einem CSV-Import: Richtung, Betrag, Datum und Konto stehen durch den Import fest. Ob es eine Umbuchung
            ist, lässt sich ändern.
          </p>
        </>
      )}
      {error && (
        <p className="errbox" role="alert">
          {error}
        </p>
      )}
      <TransactionForm
        initial={tx}
        accounts={accounts}
        onCreateAccount={onCreateAccount}
        lockBankData={imported}
        submitLabel="Änderungen speichern"
        onSubmit={handleSubmit}
        onCancel={close}
      />
    </dialog>
  );
}
