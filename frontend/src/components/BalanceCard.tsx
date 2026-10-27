import { eur } from "../format";
import type { Transaction } from "../types";

export default function BalanceCard({ items }: { items: Transaction[] }) {
  let sumIn = 0;
  let sumOut = 0;
  for (const x of items) {
    if (x.type === "in") sumIn += x.amount;
    else sumOut += x.amount;
  }

  return (
    <div className="balance">
      <small>Saldo im Monat</small>
      <strong>{eur.format(sumIn - sumOut)}</strong>
      <div className="split">
        <div>
          Einnahmen <b>{eur.format(sumIn)}</b>
        </div>
        <div>
          Ausgaben <b>{eur.format(sumOut)}</b>
        </div>
      </div>
    </div>
  );
}
