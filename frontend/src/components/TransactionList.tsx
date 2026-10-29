import { dayFormat, eur, parseDate } from "../format";
import type { Transaction } from "../types";

interface Props {
  items: Transaction[];
  onEdit: (tx: Transaction) => void;
  onDelete: (id: number) => void;
}

export default function TransactionList({ items, onEdit, onDelete }: Props) {
  if (!items.length) {
    return <p className="empty">Keine Buchungen. Trage oben deine erste Einnahme oder Ausgabe ein.</p>;
  }

  return (
    <ul>
      {items.map((x) => {
        // Notiz und, bei importierten Buchungen, Gegenpartei oder Verwendungszweck
        const text = [x.note, x.counterparty || x.purpose].filter(Boolean).join(" · ");
        const day = dayFormat.format(parseDate(x.date));
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
                <small>
                  {day}
                  {text && ` – ${text}`}
                </small>
              </span>
              <span className={`amt ${x.type}`}>{amount}</span>
            </button>
            <button className="del" aria-label={`Buchung löschen: ${x.category}`} onClick={() => onDelete(x.id)}>
              Löschen
            </button>
          </li>
        );
      })}
    </ul>
  );
}
