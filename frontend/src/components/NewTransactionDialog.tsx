import { useEffect, useId, useRef, useState } from "react";
import { ApiError, createTransaction } from "../api";
import { useData } from "../data";
import type { NewTransaction, Transaction } from "../types";
import TransactionForm from "./TransactionForm";

interface Props {
  /** Vorausgewähltes Konto, z. B. das der geöffneten Kontoseite */
  defaultAccountId: number | null;
  /** Nach dem Speichern, mit der angelegten Buchung */
  onSaved: (tx: Transaction) => void;
  onClose: () => void;
}

/** Neue Buchung erfassen, von jeder Seite aus über „Neue Buchung“ in der Kopfleiste */
export default function NewTransactionDialog({ defaultAccountId, onSaved, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { accounts, createAccount } = useData();
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => ref.current?.close();

  const handleSubmit = async (tx: NewTransaction) => {
    try {
      onSaved(await createTransaction(tx));
      close();
      return true;
    } catch (e) {
      setError(e instanceof ApiError && e.body?.error ? e.body.error : "Speichern fehlgeschlagen.");
      return false;
    }
  };

  return (
    <dialog ref={ref} className="edit" aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId}>Neue Buchung</h2>
      {error && (
        <p className="errbox" role="alert">
          {error}
        </p>
      )}
      <TransactionForm
        accounts={accounts}
        defaultAccountId={accounts.some((a) => a.id === defaultAccountId) ? defaultAccountId : null}
        onCreateAccount={createAccount}
        onSubmit={handleSubmit}
        onCancel={close}
      />
    </dialog>
  );
}
