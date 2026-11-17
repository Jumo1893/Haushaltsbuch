import { useEffect } from "react";
import { fetchDebts } from "../api";
import { useLoad } from "../data";
import { bookingLabel, isOpenDebt, isPartlyPaid, openAmount } from "../debts";
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
  // Was von einer Schuld noch offen ist; eine teilweise getilgte zählt nur mit dem Rest
  const cents = (d: Debt) => Math.round(openAmount(d) * 100);
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

  /**
   * Was ein Ausgleich vom Gesamtbetrag tilgt: die ältesten offenen Schulden ganz, mit dem Rest die nächste teilweise,
   * so wie es das Backend aus den Einträgen rechnet
   */
  const preview = (() => {
    if (mode !== "total" || !person || !debts.data || !paid) return "";
    if (!open.length) return "Gerade ist keine Schuld offen, der Betrag senkt nur den Stand.";
    let left = paidCents;
    let full = 0;
    let part = "";
    for (const d of open) {
      if (left <= 0) break;
      if (left >= cents(d)) {
        full++;
        left -= cents(d);
      } else {
        part = `${eur.format(left / 100)} von „${d.reason || "Schuld"}“ vom ${day(d.date)}, danach ${eur.format((cents(d) - left) / 100)} offen`;
        left = 0;
      }
    }
    const whole = full === 1 ? "die älteste offene Schuld ganz" : `die ${full} ältesten offenen Schulden ganz`;
    const text = [full > 0 && whole, part].filter(Boolean).join(" und ");
    const rest = left > 0 ? ` ${eur.format(left / 100)} bleiben übrig, ohne Schuld.` : "";
    return `Tilgt ${text}.${rest}`;
  })();

  return (
    <>
      <div className="full">
        <span className="label">Verrechnen</span>
        <Segmented className="seg" label="Verrechnen" options={MODES} value={mode} onChange={onModeChange} />
        <small className="hint">
          {mode === "total"
            ? `Der Betrag tilgt die ältesten offenen Schulden ${theirs ? "der Person bei dir" : "bei der Person"}, was nicht mehr ganz reicht, die nächste teilweise.`
            : "Wähle die Schulden, die damit beglichen sind, z. B. alte Rechnungen. Sie gelten danach ganz als beglichen."}
        </small>
        {preview && (
          <small className="hint" role="status">
            {preview}
          </small>
        )}
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
                          {isPartlyPaid(d) && ` · teilweise getilgt, offen von ${eur.format(Math.abs(d.amount))}`}
                        </small>
                      </span>
                      <span className="amt">{eur.format(openAmount(d))}</span>
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
                {!paid || !picked.length
                  ? "Verrechnet wird höchstens, was die ausgewählten Schulden ausmachen."
                  : delta > 0
                    ? `Verrechnet werden nur die ${eur.format(selectedCents / 100)} der ausgewählten Schulden. Der Überschuss von ${eur.format(delta / 100)} bleibt außen vor und zählt nicht zu den Schulden.`
                    : delta < 0
                      ? `Verrechnet werden die gezahlten ${eur.format(paidCents / 100)}. Die ausgewählten Schulden gelten trotzdem ganz als beglichen, der Fehlbetrag dient nur der Information.`
                      : "Die Zahlung deckt die ausgewählten Schulden genau."}
              </small>
            </>
          )}
        </div>
      )}
    </>
  );
}
