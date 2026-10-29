import { dayFormat, eur, parseDate } from "../format";
import { TRANSFER_CATEGORY, type Account, type Transaction } from "../types";

interface Props {
  items: Transaction[];
  accounts: Account[];
  onEdit: (tx: Transaction) => void;
  /** Ohne: keine Schaltfläche zum Löschen, z. B. in der Übersicht */
  onDelete?: (id: number) => void;
  /** Konto in jeder Zeile nennen, wenn es mehrere gibt (nicht auf der Seite eines Kontos) */
  showAccount?: boolean;
  /** Text, wenn es keine Buchungen gibt */
  emptyText?: string;
}

export default function TransactionList({
  items,
  accounts,
  onEdit,
  onDelete,
  showAccount = true,
  emptyText = "Keine Buchungen in diesem Monat.",
}: Props) {
  if (!items.length) return <p className="empty">{emptyText}</p>;

  // Das Konto nur nennen, wenn es mehrere gibt
  const accountNames = new Map(showAccount && accounts.length > 1 ? accounts.map((a) => [a.id, a.name]) : []);

  return (
    <ul>
      {items.map((x) => {
        // Notiz und, bei importierten Buchungen, Gegenpartei oder Verwendungszweck
        const text = [x.note, x.counterparty || x.purpose].filter(Boolean).join(" · ");
        const day = dayFormat.format(parseDate(x.date));
        const account = accountNames.get(x.accountId);
        const amount = `${x.type === "in" ? "+" : "−"}${eur.format(x.amount)}`;
        return (
          <li key={x.id}>
            <button
              className="entry"
              aria-label={`Buchung bearbeiten: ${x.category}, ${day}, ${amount}`}
              onClick={() => onEdit(x)}
            >
              <span>
                {x.category}
                {/* an der IBAN erkannte Umbuchung; mit der Kategorie Umbuchung steht es schon da */}
                {x.transfer && x.category !== TRANSFER_CATEGORY && <span className="badge">Umbuchung</span>}
                <small>
                  {day}
                  {account && ` · ${account}`}
                  {text && ` – ${text}`}
                </small>
              </span>
              <span className={`amt ${x.transfer ? "transfer" : x.type}`}>{amount}</span>
            </button>
            {onDelete && (
              <button className="del" aria-label={`Buchung löschen: ${x.category}`} onClick={() => onDelete(x.id)}>
                Löschen
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
