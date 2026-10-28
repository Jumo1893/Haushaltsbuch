import { dayFormat, eur, parseDate } from "../format";
import type { Transaction } from "../types";

interface Props {
  items: Transaction[];
  onDelete: (id: number) => void;
}

export default function TransactionList({ items, onDelete }: Props) {
  if (!items.length) {
    return <p className="empty">Keine Buchungen. Trage oben deine erste Einnahme oder Ausgabe ein.</p>;
  }

  return (
    <ul>
      {items.map((x) => {
        // Importierte Buchungen haben meist keine Notiz, dafür Gegenpartei und Verwendungszweck
        const text = x.note || x.counterparty || x.purpose;
        return (
          <li key={x.id}>
            <div>
              {x.category}
              <small>
                {dayFormat.format(parseDate(x.date))}
                {text && ` – ${text}`}
              </small>
            </div>
            <span className={`amt ${x.type}`}>
              {x.type === "in" ? "+" : "−"}
              {eur.format(x.amount)}
            </span>
            <button className="del" aria-label={`Buchung löschen: ${x.category}`} onClick={() => onDelete(x.id)}>
              Löschen
            </button>
          </li>
        );
      })}
    </ul>
  );
}
