import { useId, useRef, useState, type FormEvent } from "react";
import { today } from "../format";
import {
  CATEGORIES,
  kindOf,
  type Account,
  type NewAccount,
  type NewTransaction,
  type TxKind,
  type TxType,
} from "../types";
import AccountSelect from "./AccountSelect";
import Segmented from "./Segmented";

const KINDS: [TxKind, string][] = [
  ["out", "Ausgabe"],
  ["in", "Einnahme"],
  ["transfer", "Umbuchung"],
];

const DIRECTIONS: [TxType, string][] = [
  ["out", "Abbuchung"],
  ["in", "Gutschrift"],
];

interface Props {
  /** Vorhandene Buchung zum Bearbeiten; ohne wird eine neue Buchung erfasst. */
  initial?: NewTransaction;
  /** Vorausgewähltes Konto für eine neue Buchung; ohne das erste der Liste */
  defaultAccountId?: number | null;
  accounts: Account[];
  /** Legt ein Konto aus der Kontoauswahl heraus an. */
  onCreateAccount: (account: NewAccount) => Promise<Account>;
  /** Richtung, Betrag, Datum und Konto sperren, z. B. bei importierten Buchungen. */
  lockBankData?: boolean;
  submitLabel?: string;
  /** Liefert true, wenn gespeichert wurde – bei einer neuen Buchung wird das Formular dann geleert. */
  onSubmit: (tx: NewTransaction) => Promise<boolean>;
  onCancel?: () => void;
}

export default function TransactionForm({
  initial,
  defaultAccountId = null,
  accounts,
  onCreateAccount,
  lockBankData = false,
  submitLabel = "Buchung speichern",
  onSubmit,
  onCancel,
}: Props) {
  const id = useId(); // eindeutige IDs, weil das Formular mehrfach auf der Seite stehen kann
  const [type, setType] = useState<TxType>(initial?.type ?? "out");
  const [transfer, setTransfer] = useState(initial?.transfer ?? false);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [date, setDate] = useState(initial?.date ?? today);
  const [category, setCategory] = useState(initial?.category ?? CATEGORIES.out[0]);
  const [note, setNote] = useState(initial?.note ?? "");
  const [accountId, setAccountId] = useState(initial?.accountId ?? defaultAccountId);
  const amountRef = useRef<HTMLInputElement>(null);

  // Ohne Auswahl gilt das erste Konto, sobald die Konten geladen sind
  const account = accountId ?? accounts[0]?.id ?? null;

  const kind = kindOf({ type, transfer });

  // Eine Kategorie, die nicht (mehr) in der Liste steht, bleibt auswählbar
  const categories = CATEGORIES[kind].includes(category) ? CATEGORIES[kind] : [category, ...CATEGORIES[kind]];

  const changeKind = (k: TxKind) => {
    setTransfer(k === "transfer");
    if (k !== "transfer") setType(k);
    if (!CATEGORIES[k].includes(category)) setCategory(CATEGORIES[k][0]);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!(amt > 0) || account === null) return;
    const ok = await onSubmit({ type, transfer, amount: amt, category, date, note: note.trim(), accountId: account });
    if (ok && !initial) {
      setAmount("");
      setNote("");
      amountRef.current?.focus();
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Segmented
        className="full seg"
        label="Art"
        options={KINDS}
        value={kind}
        isDisabled={(k) => lockBankData && k !== "transfer" && k !== type}
        onChange={changeKind}
      />
      {transfer && (
        <>
          <Segmented
            className="full seg"
            label="Richtung"
            options={DIRECTIONS}
            value={type}
            isDisabled={() => lockBankData}
            onChange={setType}
          />
          <small className="hint full">Zählt weder als Einnahme noch als Ausgabe, ändert aber den Kontostand.</small>
        </>
      )}
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
        <label htmlFor={`${id}-account`}>Konto</label>
        <AccountSelect
          id={`${id}-account`}
          accounts={accounts}
          value={account}
          disabled={lockBankData}
          onChange={setAccountId}
          onCreate={onCreateAccount}
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
      <div className="full">
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
