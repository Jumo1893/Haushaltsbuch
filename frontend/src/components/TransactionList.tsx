import { dayFormat, eur } from "../format";
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
      {items.map((x) => (
        <li key={x.id}>
          <div>
            {x.category}
            <small>
              {dayFormat.format(new Date(`${x.date}T00:00:00`))}
              {x.note && ` – ${x.note}`}
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
      ))}
    </ul>
  );
}
