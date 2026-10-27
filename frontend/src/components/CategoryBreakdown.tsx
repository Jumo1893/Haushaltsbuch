import { eur } from "../format";
import type { Transaction } from "../types";

export default function CategoryBreakdown({ items }: { items: Transaction[] }) {
  const byCat: Record<string, number> = {};
  let total = 0;
  for (const x of items) {
    if (x.type !== "out") continue;
    byCat[x.category] = (byCat[x.category] ?? 0) + x.amount;
    total += x.amount;
  }
  const names = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);

  if (!names.length) return <p className="empty">Noch keine Ausgaben in diesem Monat.</p>;

  return (
    <div>
      {names.map((n) => (
        <div className="bar" key={n}>
          <span>{n}</span>
          <div className="track">
            <div className="fill" style={{ width: `${(byCat[n] / total) * 100}%` }} />
          </div>
          <span className="amt">{eur.format(byCat[n])}</span>
        </div>
      ))}
    </div>
  );
}
