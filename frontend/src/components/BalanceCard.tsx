import { money, signed } from "../format";
import { summarize } from "../stats";
import type { Transaction } from "../types";

/** Saldo im Monat: Einnahmen − Ausgaben, dazu Umbuchungen zwischen eigenen Konten, wenn es welche gab */
export default function BalanceCard({ items }: { items: Transaction[] }) {
  const { income, expenses, transfers, transferCount, net } = summarize(items);

  return (
    <div className="balance">
      <small>Saldo im Monat</small>
      <strong>{money(net)}</strong>
      <div className="split">
        <div>
          Einnahmen <b>{money(income)}</b>
        </div>
        <div>
          Ausgaben <b>{money(expenses)}</b>
        </div>
        {transferCount > 0 && (
          <div>
            Umbuchungen <b>{signed(transfers)}</b>
          </div>
        )}
      </div>
    </div>
  );
}
