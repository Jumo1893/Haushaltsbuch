import { money, signed } from "../format";
import { summarize } from "../stats";
import type { Transaction } from "../types";

/** Saldo der Buchungen: Einnahmen − Ausgaben, dazu Umbuchungen zwischen eigenen Konten, wenn es welche gab */
export default function BalanceCard({ items, label }: { items: Transaction[]; label: string }) {
  const { income, expenses, transfers, transferCount, net } = summarize(items);

  return (
    <div className="balance">
      <small>{label}</small>
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
