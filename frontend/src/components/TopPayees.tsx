import { money } from "../format";
import { topPayees } from "../stats";
import type { Transaction } from "../types";

/** Die größten Ausgaben nach Empfänger, als Balken im Verhältnis zur größten */
export default function TopPayees({ items }: { items: Transaction[] }) {
  const top = topPayees(items, 5);
  if (!top.length) return <p className="empty">Noch keine Ausgaben in diesem Monat.</p>;

  return (
    <div className="payees">
      {top.map((p) => (
        <div className="payee" key={p.label}>
          <span title={p.label}>
            {p.label}
            {p.bookings > 1 && <small> · {p.bookings}×</small>}
          </span>
          <span className="amt">{money(p.amount)}</span>
          <div className="track">
            <div className="fill" style={{ width: `${(p.amount / top[0].amount) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
