import { useId, useRef, useState, type FormEvent } from "react";
import { today } from "../format";
import { CATEGORIES, type NewTransaction, type TxType } from "../types";

const TYPES: [TxType, string][] = [
  ["out", "Ausgabe"],
  ["in", "Einnahme"],
];

interface Props {
  /** Vorhandene Buchung zum Bearbeiten; ohne wird eine neue Buchung erfasst. */
  initial?: NewTransaction;
  /** Art, Betrag und Datum sperren, z. B. bei importierten Buchungen. */
  lockBankData?: boolean;
  submitLabel?: string;
  /** Liefert true, wenn gespeichert wurde – bei einer neuen Buchung wird das Formular dann geleert. */
  onSubmit: (tx: NewTransaction) => Promise<boolean>;
  onCancel?: () => void;
}

export default function TransactionForm({
  initial,
  lockBankData = false,
  submitLabel = "Buchung speichern",
  onSubmit,
  onCancel,
}: Props) {
  const id = useId(); // eindeutige IDs, weil das Formular mehrfach auf der Seite stehen kann
  const [type, setType] = useState<TxType>(initial?.type ?? "out");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [date, setDate] = useState(initial?.date ?? today);
  const [category, setCategory] = useState(initial?.category ?? CATEGORIES.out[0]);
  const [note, setNote] = useState(initial?.note ?? "");
  const amountRef = useRef<HTMLInputElement>(null);

  // Eine Kategorie, die nicht (mehr) in der Liste steht, bleibt auswählbar
  const categories = CATEGORIES[type].includes(category) ? CATEGORIES[type] : [category, ...CATEGORIES[type]];

  const changeType = (t: TxType) => {
    setType(t);
    setCategory(CATEGORIES[t][0]);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!(amt > 0)) return;
    const ok = await onSubmit({ type, amount: amt, category, date, note: note.trim() });
    if (ok && !initial) {
      setAmount("");
      setNote("");
      amountRef.current?.focus();
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="full seg" role="radiogroup" aria-label="Art">
        {TYPES.map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name={`${id}-type`}
              value={value}
              checked={type === value}
              disabled={lockBankData}
              onChange={() => changeType(value)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <div>
        <label htmlFor={`${id}-amount`}>Betrag in €</label>
        <input
          id={`${id}-amount`}
          ref={amountRef}
          type="number"
          step="0.01"
          min="0.01"
          required
          inputMode="decimal"
          disabled={lockBankData}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor={`${id}-date`}>Datum</label>
        <input
          id={`${id}-date`}
          type="date"
          required
          disabled={lockBankData}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor={`${id}-cat`}>Kategorie</label>
        <select id={`${id}-cat`} value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-note`}>Notiz</label>
        <input id={`${id}-note`} type="text" maxLength={60} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {onCancel ? (
        <div className="full actions">
          <button className="add" type="submit">
            {submitLabel}
          </button>
          <button className="ghost" type="button" onClick={onCancel}>
            Abbrechen
          </button>
        </div>
      ) : (
        <button className="add full" type="submit">
          {submitLabel}
        </button>
      )}
    </form>
  );
}
