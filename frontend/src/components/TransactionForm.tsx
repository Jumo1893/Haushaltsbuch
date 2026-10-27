import { useRef, useState, type FormEvent } from "react";
import { today } from "../format";
import { CATEGORIES, type NewTransaction, type TxType } from "../types";

const TYPES: [TxType, string][] = [
  ["out", "Ausgabe"],
  ["in", "Einnahme"],
];

interface Props {
  /** Liefert true, wenn gespeichert wurde – dann wird das Formular geleert. */
  onSubmit: (tx: NewTransaction) => Promise<boolean>;
}

export default function TransactionForm({ onSubmit }: Props) {
  const [type, setType] = useState<TxType>("out");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [category, setCategory] = useState(CATEGORIES.out[0]);
  const [note, setNote] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  const changeType = (t: TxType) => {
    setType(t);
    setCategory(CATEGORIES[t][0]);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!(amt > 0)) return;
    const ok = await onSubmit({ type, amount: amt, category, date, note: note.trim() });
    if (ok) {
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
            <input type="radio" name="type" value={value} checked={type === value} onChange={() => changeType(value)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <div>
        <label htmlFor="amount">Betrag in €</label>
        <input
          id="amount"
          ref={amountRef}
          type="number"
          step="0.01"
          min="0.01"
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="date">Datum</label>
        <input id="date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div>
        <label htmlFor="cat">Kategorie</label>
        <select id="cat" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES[type].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="note">Notiz</label>
        <input id="note" type="text" maxLength={60} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <button className="add full" type="submit">
        Buchung speichern
      </button>
    </form>
  );
}
