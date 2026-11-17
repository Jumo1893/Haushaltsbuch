import { useState } from "react";
import { deleteDebt, fetchDebts } from "../api";
import { OFFLINE, useData, useLoad } from "../data";
import { isRepayable, isSplittable } from "../debts";
import { roundCents } from "../format";
import type { Debt, Transaction } from "../types";
import DebtDialog from "./DebtDialog";
import DebtList from "./DebtList";
import RepaymentDialog from "./RepaymentDialog";
import SplitDialog from "./SplitDialog";

/**
 * Schulden zu einer Buchung, im Dialog „Buchung bearbeiten“: eine Ausgabe aufteilen oder festhalten, dass sie Schulden
 * ausgleicht. Alles wird sofort gespeichert, unabhängig von den Änderungen an der Buchung.
 */
export default function TransactionDebts({ tx }: { tx: Transaction }) {
  const { refresh } = useData();
  const { data, failed } = useLoad(() => fetchDebts({ transaction: tx.id }), [tx.id]);
  const [dialog, setDialog] = useState<"split" | "repay" | "settle" | Debt | null>(null);
  const [error, setError] = useState("");
  const entries = data ?? [];
  // Was von der Buchung noch nicht mit Schulden verrechnet ist
  const available = roundCents(tx.amount - entries.reduce((sum, e) => sum + Math.abs(e.amount), 0));
  // Die Buchung mit den gerade geladenen Einträgen; die aus der Liste kennt neue noch nicht
  const fresh = { ...tx, debts: entries.map(({ id, personId, person, amount, kind }) => ({ id, personId, person, amount, kind })) };

  const remove = async (entry: Debt) => {
    try {
      await deleteDebt(entry.id);
      setError("");
      refresh();
    } catch {
      setError("Löschen fehlgeschlagen.");
    }
  };

  const close = () => setDialog(null);

  return (
    <div className="debts">
      <h3>Schulden</h3>
      {(error || failed) && (
        <p className="errbox" role="alert">
          {error || OFFLINE}
        </p>
      )}
      {data &&
        (entries.length ? (
          <DebtList items={entries} byPerson onEdit={setDialog} onDelete={remove} />
        ) : (
          <p className="hint">
            {tx.type === "in"
              ? `${isRepayable(tx) ? "Zahlt dir damit jemand Schulden zurück, verrechne die Buchung als Tilgung. " : ""}Leiht dir jemand Geld, verrechne sie mit der Person.`
              : `${isSplittable(tx) ? "Hast du für andere mitbezahlt, teile die Buchung auf. " : ""}Zahlst du damit Schulden zurück oder leihst Geld aus, verrechne sie mit der Person.`}
          </p>
        ))}
      <div className="row-actions">
        {isSplittable(tx) && (
          // Erst mit den geladenen Einträgen, sonst fehlt im Dialog die Wahl, was mit ihnen passiert
          <button type="button" className="ghost small" disabled={!data} onClick={() => setDialog("split")}>
            {entries.length ? "Neu aufteilen …" : "Aufteilen …"}
          </button>
        )}
        {isRepayable(tx) && (
          <button type="button" className="ghost small" disabled={!data} onClick={() => setDialog("repay")}>
            Als Tilgung verrechnen …
          </button>
        )}
        <button type="button" className="ghost small" disabled={!data || available <= 0} onClick={() => setDialog("settle")}>
          Mit Person verrechnen …
        </button>
      </div>
      <small className="hint">
        Wird sofort gespeichert. Kontostände, Einnahmen und Ausgaben ändern sich dadurch nicht.
      </small>
      {dialog === "split" && <SplitDialog bookings={[fresh]} onSaved={refresh} onClose={close} />}
      {dialog === "repay" && <RepaymentDialog bookings={[fresh]} onSaved={refresh} onClose={close} />}
      {dialog === "settle" && (
        <DebtDialog kind="settlement" booking={tx} amount={available} onSaved={refresh} onClose={close} />
      )}
      {typeof dialog === "object" && dialog !== null && <DebtDialog entry={dialog} onSaved={refresh} onClose={close} />}
    </div>
  );
}
