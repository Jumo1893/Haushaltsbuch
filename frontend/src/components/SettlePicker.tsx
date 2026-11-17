import { useEffect } from "react";
import { fetchDebts } from "../api";
import { useLoad } from "../data";
import { bookingLabel, isOpenDebt } from "../debts";
import { dateFormat, eur, parseDate } from "../format";
import type { Debt, Person } from "../types";
import Segmented from "./Segmented";

/** Wie ein Ausgleich verrechnet wird: nur vom Stand abziehen oder bestimmte Schulden als beglichen markieren */
export type SettleMode = "total" | "items";

const MODES: [SettleMode, string][] = [
  ["total", "Vom Gesamtbetrag"],
  ["items", "Bestimmte Schulden"],
];

interface Props {
  id: string;
  /** Bekannte Person; ohne (neu oder noch kein Name) gibt es nichts auszuwählen */
  person: Person | undefined;
  /** Vorzeichen des Ausgleichs: −1 zahlt die Person (ihre Schulden bei dir), 1 zahlst du (deine bei ihr) */
  direction: 1 | -1;
  /** Gezahlter Betrag in Cent, für den Vergleich mit den ausgewählten Schulden */
  paidCents: number;
  mode: SettleMode;
  onModeChange: (mode: SettleMode) => void;
  /** Ausgewählte Schulden */
  picked: Debt[];
  onPick: (debts: Debt[]) => void;
}

const day = (date: string) => dateFormat.format(parseDate(date));

/**
 * Wahl, ob ein Ausgleich nur den Stand senkt oder bestimmte offene Schulden begleicht, mit der Liste dieser Schulden
 * und dem Unterschied zwischen ihrer Summe und dem gezahlten Betrag. Der Unterschied dient nur der Information.
 */
export default function SettlePicker({ id, person, direction, paidCents, mode, onModeChange, picked, onPick }: Props) {
  const personId = person?.id ?? null;
  const debts = useLoad(() => (personId ? fetchDebts({ person: personId }) : Promise.resolve([] as Debt[])), [personId]);

  // Eine andere Person oder Richtung hat andere offene Schulden
  useEffect(() => onPick([]), [personId, direction]);

  // Älteste zuerst
  const open = (debts.data ?? [])
    .filter((d) => isOpenDebt(d, direction))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const pickedIds = new Set(picked.map((d) => d.id));
  const cents = (d: Debt) => Math.round(Math.abs(d.amount) * 100);
  const selectedCents = picked.reduce((sum, d) => sum + cents(d), 0);
  const delta = paidCents - selectedCents;
  const paid = paidCents > 0;
  const theirs = direction === -1;

  const toggle = (debt: Debt, on: boolean) =>
    onPick(on ? [...picked, debt] : picked.filter((d) => d.id !== debt.id));

  /** Die ältesten offenen Schulden, solange sie zusammen in den gezahlten Betrag passen */
  const pickOldest = () => {
    const next: Debt[] = [];
    let sum = 0;
    for (const d of open) {
      if (sum + cents(d) > paidCents) break;
      sum += cents(d);
      next.push(d);
    }
    onPick(next);
  };

  return (
    <>
      <div className="full">
        <span className="label">Verrechnen</span>
        <Segmented className="seg" label="Verrechnen" options={MODES} value={mode} onChange={onModeChange} />
        <small className="hint">
          {mode === "total"
            ? `Der Betrag wird von dem abgezogen, was ${theirs ? "die Person dir" : "du der Person"} insgesamt ${theirs ? "schuldet" : "schuldest"}.`
            : "Wähle die Schulden, die damit beglichen sind, z. B. alte Rechnungen. Sie gelten danach als beglichen."}
        </small>
      </div>
      {mode === "items" && (
        <div className="full">
          {!person ? (
            <p className="hint">Für eine neue Person gibt es noch keine Schulden. Erst eine bekannte Person wählen.</p>
          ) : debts.data && !open.length ? (
            <p className="hint">
              {theirs ? `Bei ${person.name} ist keine Schuld offen.` : `Bei ${person.name} hast du keine offenen Schulden.`}
            </p>
          ) : (
            <>
              <div className="row-actions">
                <button type="button" className="ghost small" disabled={!paid} onClick={pickOldest}>
                  Älteste bis {paid ? eur.format(paidCents / 100) : "zum Betrag"}
                </button>
                <button type="button" className="ghost small" onClick={() => onPick(open)}>
                  Alle
                </button>
                <button type="button" className="ghost small" onClick={() => onPick([])}>
                  Keine
                </button>
              </div>
              <ul
                className="settle-items"
                aria-label={theirs ? `Offene Schulden von ${person.name}` : `Deine offenen Schulden bei ${person.name}`}
              >
                {open.map((d) => (
                  <li key={d.id}>
                    <label className="settle-item">
                      <input
                        id={`${id}-debt-${d.id}`}
                        type="checkbox"
                        checked={pickedIds.has(d.id)}
                        onChange={(e) => toggle(d, e.target.checked)}
                      />
                      <span>
                        {d.reason || "Schuld"}
                        <small>
                          {day(d.date)}
                          {d.transaction && ` · Buchung ${bookingLabel(d.transaction)}, ${eur.format(d.transaction.amount)}`}
                        </small>
                      </span>
                      <span className="amt">{eur.format(Math.abs(d.amount))}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <dl className="kpis settle-sum" role="status">
                <div>
                  <dt>Ausgewählt</dt>
                  <dd>
                    {eur.format(selectedCents / 100)}
                    <small>
                      {picked.length} {picked.length === 1 ? "Schuld" : "Schulden"}
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>Gezahlt</dt>
                  <dd>{paid ? eur.format(paidCents / 100) : "–"}</dd>
                </div>
                <div>
                  <dt>{delta > 0 ? "Überschuss" : delta < 0 ? "Fehlbetrag" : "Differenz"}</dt>
                  <dd className={delta > 0 ? "in" : delta < 0 ? "out" : undefined}>
                    {paid ? eur.format(Math.abs(delta) / 100) : "–"}
                  </dd>
                </div>
              </dl>
              <small className="hint">
                Nur zur Information: Der Stand ändert sich um den gezahlten Betrag, nicht um die ausgewählten Schulden.
              </small>
            </>
          )}
        </div>
      )}
    </>
  );
}
