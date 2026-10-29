import { useState, type MouseEvent } from "react";
import { axisMonth, eurWhole, money, monthFormat, parseMonth, signed } from "../../format";
import { navigate } from "../../router";
import type { MonthTotals } from "../../stats";
import ChartTable from "./ChartTable";
import { axisWidth, isLabeled, monthLabelStep, niceTicks, tipPosition, useWidth } from "./layout";

interface Props {
  rows: MonthTotals[];
  /** Ziel beim Klick auf einen Monat, z. B. seine Buchungen */
  hrefOf: (month: string) => string;
  /** Statt zur Adresse zu wechseln, z. B. um auf derselben Seite den Monat zu zeigen */
  onSelect?: (month: string) => void;
}

const TOP = 10;
const PLOT = 200;
const AXIS = 26;
const RIGHT = 8;

/** Säule von der Nulllinie y0 bis y1, an der Datenseite mit 4 px gerundet, an der Nulllinie eckig */
function bar(cx: number, width: number, y0: number, y1: number) {
  const height = Math.abs(y1 - y0);
  if (height < 0.5) return "";
  const r = Math.min(4, width / 2, height);
  const left = cx - width / 2;
  const right = cx + width / 2;
  const toward = y1 < y0 ? r : -r; // Rundung beginnt r vor dem Ende der Säule
  return `M${left},${y0}V${y1 + toward}Q${left},${y1} ${left + r},${y1}H${right - r}Q${right},${y1} ${right},${y1 + toward}V${y0}Z`;
}

/** Normaler Klick bleibt in der App, Strg- oder Mittelklick öffnen wie gewohnt einen neuen Tab */
function follow(e: MouseEvent, open: () => void) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  open();
}

/**
 * Einnahmen (nach oben) und Ausgaben (nach unten) je Monat, ohne Umbuchungen, dazu der Saldo als Punkt.
 * Jeder Monat ist ein Link, z. B. zu seinen Buchungen.
 */
export default function CashflowChart({ rows, hrefOf, onSelect }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = rows.length;

  const ticks = niceTicks(
    Math.min(0, ...rows.map((r) => Math.min(-r.expenses, r.net))),
    Math.max(0, ...rows.map((r) => Math.max(r.income, r.net))),
  );
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  // Ausgaben zeigen nach unten, die Achse nennt trotzdem Beträge ohne Vorzeichen
  const tickLabels = ticks.map((t) => eurWhole.format(Math.abs(t)));
  const left = axisWidth(tickLabels);
  const plotWidth = Math.max(1, width - left - RIGHT);
  const slot = plotWidth / Math.max(1, n);
  const barWidth = Math.min(24, Math.max(2, slot * 0.56));
  const cx = (i: number) => left + slot * (i + 0.5);
  const y = (v: number) => TOP + ((hi - v) / (hi - lo)) * PLOT;
  const labelStep = monthLabelStep(n, plotWidth);
  const current = active === null ? null : rows[active];

  return (
    <>
      <ul className="legend" aria-hidden="true">
        <li>
          <span className="swatch" style={{ background: "var(--bar-in)" }} />
          Einnahmen
        </li>
        <li>
          <span className="swatch" style={{ background: "var(--bar-out)" }} />
          Ausgaben
        </li>
        <li>
          <span className="swatch round" style={{ background: "var(--ink)" }} />
          Saldo
        </li>
      </ul>
      <div ref={ref} className="chart" style={{ height: TOP + PLOT + AXIS }}>
        {width > 0 && n > 0 && (
          <svg
            width={width}
            height={TOP + PLOT + AXIS}
            role="group"
            aria-label="Einnahmen und Ausgaben je Monat"
            onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
          >
            {ticks.map((t, i) => (
              <g key={t} aria-hidden="true">
                {t !== 0 && <line className="gridline" x1={left} x2={width - RIGHT} y1={y(t)} y2={y(t)} />}
                <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                  {tickLabels[i]}
                </text>
              </g>
            ))}
            {rows.map(
              (r, i) =>
                isLabeled(r.month, labelStep) && (
                  <text key={r.month} x={cx(i)} y={TOP + PLOT + 19} textAnchor="middle" aria-hidden="true">
                    {axisMonth(r.month)}
                  </text>
                ),
            )}
            {rows.map((r, i) => {
              const href = hrefOf(r.month);
              return (
                <a
                  key={r.month}
                  href={href}
                  className={active === null || active === i ? "slot" : "slot dim"}
                  aria-label={`${monthFormat.format(parseMonth(r.month))}: Einnahmen ${money(r.income)}, Ausgaben ${money(r.expenses)}, Saldo ${signed(r.net)}. Buchungen anzeigen`}
                  onClick={(e) => follow(e, () => (onSelect ? onSelect(r.month) : navigate(href)))}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                >
                  <rect className="hit" x={cx(i) - slot / 2} y={TOP} width={slot} height={PLOT} />
                  <path style={{ fill: "var(--bar-in)" }} d={bar(cx(i), barWidth, y(0), y(r.income))} />
                  <path style={{ fill: "var(--bar-out)" }} d={bar(cx(i), barWidth, y(0), y(-r.expenses))} />
                  <circle className="dot" cx={cx(i)} cy={y(r.net)} r={4} style={{ fill: "var(--ink)" }} />
                </a>
              );
            })}
            <line className="zero" x1={left} x2={width - RIGHT} y1={y(0)} y2={y(0)} aria-hidden="true" />
          </svg>
        )}
        {current && active !== null && width > 0 && (
          <div className="tip" style={tipPosition(cx(active), width)}>
            <b>{monthFormat.format(parseMonth(current.month))}</b>
            <div>
              <span className="key" style={{ background: "var(--bar-in)" }} />
              <b>{money(current.income)}</b> Einnahmen
            </div>
            <div>
              <span className="key" style={{ background: "var(--bar-out)" }} />
              <b>{money(current.expenses)}</b> Ausgaben
            </div>
            {current.transfers !== 0 && (
              <div className="tip-detail">
                <b>{signed(current.transfers)}</b> Umbuchungen
              </div>
            )}
            <div>
              <span className="key" style={{ background: "var(--ink)" }} />
              <b>{signed(current.net)}</b> Saldo
            </div>
          </div>
        )}
      </div>
      <ChartTable
        months={rows.map((r) => r.month)}
        columns={[
          { key: "income", name: "Einnahmen", values: rows.map((r) => r.income) },
          { key: "expenses", name: "Ausgaben", values: rows.map((r) => r.expenses) },
          { key: "transfers", name: "Umbuchungen", values: rows.map((r) => r.transfers), format: signed },
          { key: "net", name: "Saldo", values: rows.map((r) => r.net), format: signed },
        ]}
      />
    </>
  );
}
