import { useId, useRef, useState, type FormEvent } from "react";
import { useData } from "../data";
import { today } from "../format";
import {
  RHYTHMS,
  kindOf,
  type Account,
  type NewAccount,
  type NewTransaction,
  type Rhythm,
  type TxKind,
  type TxType,
} from "../types";
import AccountSelect from "./AccountSelect";
import CategorySelect from "./CategorySelect";
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
  const { categoryNames } = useData();
  const [type, setType] = useState<TxType>(initial?.type ?? "out");
  const [transfer, setTransfer] = useState(initial?.transfer ?? false);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [date, setDate] = useState(initial?.date ?? today);
  const [categoryName, setCategoryName] = useState(initial?.category ?? null);
  const [note, setNote] = useState(initial?.note ?? "");
  const [rhythm, setRhythm] = useState<Rhythm | null>(initial?.rhythm ?? null);
  const [accountId, setAccountId] = useState(initial?.accountId ?? defaultAccountId);
  const amountRef = useRef<HTMLInputElement>(null);

  // Ohne Auswahl gilt das erste Konto, sobald die Konten geladen sind
  const account = accountId ?? accounts[0]?.id ?? null;

  const kind = kindOf({ type, transfer });

  // Ohne Auswahl gilt die erste Kategorie der Art, sobald die Kategorien geladen sind
  const category = categoryName ?? categoryNames[kind][0] ?? "";

  const changeKind = (k: TxKind) => {
    setTransfer(k === "transfer");
    if (k !== "transfer") setType(k);
    if (!categoryNames[k].includes(category)) setCategoryName(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!(amt > 0) || account === null || !category) return;
    const ok = await onSubmit({
      type,
      transfer,
      amount: amt,
      category,
      date,
      note: note.trim(),
      accountId: account,
      rhythm,
    });
    if (ok && !initial) {
      setAmount("");
      setNote("");
      setRhythm(null);
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
        <CategorySelect id={`${id}-cat`} kind={kind} value={category} onChange={setCategoryName} />
      </div>
      <div className="full">
        <label htmlFor={`${id}-rhythm`}>Rhythmus</label>
        <select
          id={`${id}-rhythm`}
          value={rhythm ?? ""}
          onChange={(e) => setRhythm((e.target.value || null) as Rhythm | null)}
        >
          <option value="">Einmalig</option>
          {RHYTHMS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {rhythm && <small className="hint">Nur eine Angabe, künftige Buchungen entstehen dadurch nicht.</small>}
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
