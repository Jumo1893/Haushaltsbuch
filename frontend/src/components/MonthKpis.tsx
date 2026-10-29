import { eurWhole, monthName, parseMonth, signed } from "../format";
import { average, type MonthTotals } from "../stats";

/** Vergleichszeitraum für den Durchschnitt: so viele volle Monate vor dem aktuellen */
const AVERAGE_MONTHS = 12;

function Kpi({ label, value, avg }: { label: string; value: string; avg: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value}
        {avg && <small>Ø {avg}</small>}
      </dd>
    </div>
  );
}

interface Props {
  /** Werte je Monat; null, solange sie laden */
  totals: MonthTotals[] | null;
  month: string; // YYYY-MM
}

/** Einnahmen, Ausgaben und Saldo des aktuellen Monats, verglichen mit dem Durchschnitt der Monate davor */
export default function MonthKpis({ totals, month }: Props) {
  const index = totals ? totals.findIndex((t) => t.month === month) : -1;
  const now = totals && index >= 0 ? totals[index] : null;
  const before = totals && index > 0 ? totals.slice(Math.max(0, index - AVERAGE_MONTHS), index) : [];
  const avg = average(before);
  // Bis die Werte da sind, Striche statt Nullen
  const show = (value: number, format: (v: number) => string) => (totals ? format(value) : "–");
  const plain = (v: number) => eurWhole.format(v);
  const withSign = (v: number) => signed(v, eurWhole);

  return (
    <section>
      <h2>
        {monthName.format(parseMonth(month))} <span className="muted">bis heute</span>
      </h2>
      <dl className="kpis">
        <Kpi label="Einnahmen" value={show(now?.income ?? 0, plain)} avg={avg && plain(avg.income)} />
        <Kpi label="Ausgaben" value={show(now?.expenses ?? 0, plain)} avg={avg && plain(avg.expenses)} />
        <Kpi label="Saldo" value={show(now?.net ?? 0, withSign)} avg={avg && withSign(avg.net)} />
      </dl>
      <small className="hint">
        {avg && `Ø: Durchschnitt ${before.length === 1 ? "des Vormonats" : `der ${before.length} Monate davor`}. `}
        Umbuchungen zwischen eigenen Konten zählen nicht als Einnahme oder Ausgabe.
      </small>
    </section>
  );
}
