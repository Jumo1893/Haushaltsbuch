import { dateFormat, dayFormat, eur, parseDate } from "../format";
import { rhythmLabel, type Account, type Transaction } from "../types";

interface Props {
  items: Transaction[];
  accounts: Account[];
  onEdit: (tx: Transaction) => void;
  /** Ohne: keine Schaltfläche zum Löschen, z. B. in der Übersicht */
  onDelete?: (tx: Transaction) => void;
  /** Ausgewählte Buchungen, gehört zu onSelect */
  selected?: ReadonlyMap<number, Transaction>;
  /** Wählt Buchungen aus oder ab; ohne gibt es keine Kästchen zum Auswählen */
  onSelect?: (txs: Transaction[], on: boolean) => void;
  /** Konto in jeder Zeile nennen, wenn es mehrere gibt (nicht auf der Seite eines Kontos) */
  showAccount?: boolean;
  /** Jahr im Datum nennen, wenn die Liste mehrere Monate umfasst */
  showYear?: boolean;
  /** Text, wenn es keine Buchungen gibt */
  emptyText?: string;
}

export default function TransactionList({
  items,
  accounts,
  onEdit,
  onDelete,
  selected,
  onSelect,
  showAccount = true,
  showYear = false,
  emptyText = "Keine Buchungen in diesem Monat.",
}: Props) {
  if (!items.length) return <p className="empty">{emptyText}</p>;

  // Das Konto nur nennen, wenn es mehrere gibt
  const accountNames = new Map(showAccount && accounts.length > 1 ? accounts.map((a) => [a.id, a.name]) : []);
  const picked = items.filter((x) => selected?.has(x.id)).length;

  return (
    <>
      {onSelect && (
        <label className="check pick-all">
          <input
            type="checkbox"
            checked={picked === items.length}
            ref={(box) => {
              if (box) box.indeterminate = picked > 0 && picked < items.length;
            }}
            onChange={(e) => onSelect(items, e.target.checked)}
          />
          Alle auswählen
        </label>
      )}
      <ul className={onSelect ? "selectable" : undefined}>
        {items.map((x) => {
          // Notiz und, bei importierten Buchungen, Gegenpartei oder Verwendungszweck
          const text = [x.note, x.counterparty || x.purpose].filter(Boolean).join(" · ");
          const day = (showYear ? dateFormat : dayFormat).format(parseDate(x.date));
          const account = accountNames.get(x.accountId);
          const amount = `${x.type === "in" ? "+" : "−"}${eur.format(x.amount)}`;
          return (
            <li key={x.id}>
              {onSelect && (
                <label className="pick">
                  <input
                    type="checkbox"
                    aria-label={`Buchung auswählen: ${x.category}, ${day}, ${amount}`}
                    checked={!!selected?.has(x.id)}
                    onChange={(e) => onSelect([x], e.target.checked)}
                  />
                </label>
              )}
              <button
                className="entry"
                aria-label={`Buchung bearbeiten: ${x.category}, ${day}, ${amount}`}
                onClick={() => onEdit(x)}
              >
                <span>
                  {x.category}
                  {x.transfer && <span className="badge">Umbuchung</span>}
                  {x.rhythm && <span className="badge">{rhythmLabel(x.rhythm)}</span>}
                  <small>
                    {day}
                    {account && ` · ${account}`}
                    {text && ` – ${text}`}
                  </small>
                </span>
                <span className={`amt ${x.transfer ? "transfer" : x.type}`}>{amount}</span>
              </button>
              {onDelete && (
                <button className="del" aria-label={`Buchung löschen: ${x.category}`} onClick={() => onDelete(x)}>
                  Löschen
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
