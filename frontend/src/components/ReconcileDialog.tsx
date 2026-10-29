import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api";
import { dateFormat, eur, money, parseDate, today } from "../format";
import type { Account } from "../types";

interface Props {
  account: Account;
  /** Speichert den Kontostand laut Bank; beide null entfernen ihn. Wirft bei einem Fehler. */
  onSave: (bankBalance: number | null, bankBalanceDate: string | null) => Promise<void>;
  onClose: () => void;
}

/** Kontostand mit der Bank abgleichen: Aus dem Kontostand an einem Tag ergeben sich alle Kontostände. */
export default function ReconcileDialog({ account, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => ref.current?.close();

  const save = async (bankBalance: number | null, bankBalanceDate: string | null) => {
    setSaving(true);
    try {
      await onSave(bankBalance, bankBalanceDate);
      close();
    } catch (err) {
      setError(err instanceof ApiError && err.body?.error ? err.body.error : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const value = parseFloat(amount);
    if (Number.isFinite(value)) save(value, date);
  };

  return (
    <dialog ref={ref} className="edit" aria-labelledby={`${id}-title`} onClose={onClose}>
      <h2 id={`${id}-title`}>Kontostand abgleichen</h2>
      <p className="hint">
        Trag den Kontostand ein, den deine Bank für einen Tag anzeigt, z. B. heute im Online-Banking: den gebuchten
        Kontostand am Ende des Tages, mit allen Buchungen bis zu diesem Tag und ohne vorgemerkte Umsätze. Daraus
        berechnet die App den Kontostand für jeden Monat. Buchungen, die später für diese Zeit importiert werden,
        ändern den aktuellen Kontostand deshalb nicht.
      </p>
      <dl className="source">
        <div>
          <dt>Kontostand laut App</dt>
          <dd>{money(account.balance)}</dd>
        </div>
        <div>
          <dt>Zuletzt abgeglichen</dt>
          <dd>
            {account.bankBalance !== null && account.bankBalanceDate
              ? `${eur.format(account.bankBalance)} am ${dateFormat.format(parseDate(account.bankBalanceDate))}`
              : "noch nie, der Kontostand ist die Summe aller Buchungen"}
          </dd>
        </div>
      </dl>
      {error && (
        <p className="errbox" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor={`${id}-amount`}>Kontostand laut Bank in €</label>
          <input
            id={`${id}-amount`}
            type="number"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${id}-date`}>Stand am</label>
          <input id={`${id}-date`} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="full actions">
          <button className="add" type="submit" disabled={saving}>
            {saving ? "Wird gespeichert …" : "Übernehmen"}
          </button>
          {account.bankBalance !== null && (
            <button className="ghost" type="button" disabled={saving} onClick={() => save(null, null)}>
              Abgleich entfernen
            </button>
          )}
          <button className="ghost" type="button" onClick={close}>
            Abbrechen
          </button>
        </div>
      </form>
    </dialog>
  );
}
