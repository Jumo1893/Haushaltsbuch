import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { axisMonth, dateFormat, dayFormat, eurWhole, money, monthFormat, parseDate, parseMonth } from "../../format";
import ChartTable from "./ChartTable";
import { axisWidth, dayLabelStep, isLabeled, lastIndex, monthLabelStep, niceTicks, tipPosition, useWidth } from "./layout";

export interface LineSeries {
  key: string | number;
  name: string;
  color: string; // CSS-Farbe, z. B. "var(--c1)"
  values: (number | null)[]; // je Monat, null: kein Wert
}

interface Props {
  /** Name des Diagramms für Screenreader */
  label: string;
  /** Monate (YYYY-MM), mit unit "day" Tage (YYYY-MM-DD) */
  months: string[];
  unit?: "month" | "day";
  series: LineSeries[];
  /** Fläche unter der Linie bis zur Nulllinie, für eine einzelne Reihe */
  area?: boolean;
  /** Werte, die nur im Tooltip und in der Tabelle stehen, z. B. die Konten zum Gesamtsaldo */
  details?: Omit<LineSeries, "color">[];
}

const TOP = 10;
const PLOT = 200; // Höhe der Zeichenfläche
const AXIS = 26; // Platz für die Monate darunter
const RIGHT = 14;

const format = (v: number | null) => (v === null ? "–" : money(v));

/** Verlauf je Monat oder Tag als Linien. Ein Fadenkreuz mit Tooltip folgt Maus, Finger und Pfeiltasten. */
export default function LineChart({ label, months, unit = "month", series, area = false, details = [] }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = months.length;

  const values = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const tickLabels = ticks.map((t) => eurWhole.format(t));
  const left = axisWidth(tickLabels);
  const plotWidth = Math.max(1, width - left - RIGHT);
  const x = (i: number) => left + (n > 1 ? (i * plotWidth) / (n - 1) : plotWidth / 2);
  const y = (v: number) => TOP + ((hi - v) / (hi - lo)) * PLOT;
  const daily = unit === "day";
  const labelStep = daily ? dayLabelStep(n, plotWidth) : monthLabelStep(n, plotWidth);

  const path = (line: (number | null)[]) => {
    let d = "";
    let drawing = false;
    line.forEach((v, i) => {
      if (v !== null) d += `${drawing ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      drawing = v !== null;
    });
    return d;
  };

  const indexAt = (e: PointerEvent<SVGSVGElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    return n > 1 ? Math.min(n - 1, Math.max(0, Math.round(((px - left) / plotWidth) * (n - 1)))) : 0;
  };

  const handleKey = (e: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -n, End: n };
    if (!(e.key in moves)) return;
    e.preventDefault();
    setActive((i) => Math.min(n - 1, Math.max(0, (i ?? n - 1) + moves[e.key])));
  };

  const filled = area && series.length === 1 && series[0].values.every((v) => v !== null);

  return (
    <>
      <div
        ref={ref}
        className="chart"
        style={{ height: TOP + PLOT + AXIS }}
        tabIndex={0}
        role="group"
        aria-label={`${label}. Mit den Pfeiltasten einen ${daily ? "Tag" : "Monat"} wählen.`}
        onKeyDown={handleKey}
        onFocus={() => setActive((i) => i ?? n - 1)}
        onBlur={() => setActive(null)}
      >
        {width > 0 && n > 0 && (
          <svg
            width={width}
            height={TOP + PLOT + AXIS}
            aria-hidden="true"
            onPointerDown={(e) => setActive(indexAt(e))}
            onPointerMove={(e) => setActive(indexAt(e))}
            onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
          >
            {ticks.map((t, i) => (
              <g key={t}>
                <line className={t === 0 ? "zero" : "gridline"} x1={left} x2={width - RIGHT} y1={y(t)} y2={y(t)} />
                <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                  {tickLabels[i]}
                </text>
              </g>
            ))}
            {months.map(
              (m, i) =>
                (daily ? i % labelStep === 0 : isLabeled(m, labelStep)) && (
                  <text key={m} x={x(i)} y={TOP + PLOT + 19} textAnchor="middle">
                    {daily ? dayFormat.format(parseDate(m)) : axisMonth(m)}
                  </text>
                ),
            )}
            {filled && (
              <path
                className="area"
                style={{ fill: series[0].color }}
                d={`${path(series[0].values)}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`}
              />
            )}
            {series.map((s) => (
              <path key={s.key} className="line" style={{ stroke: s.color }} d={path(s.values)} />
            ))}
            {active === null
              ? series.map((s) => {
                  const i = lastIndex(s.values);
                  return i >= 0 && <circle key={s.key} className="dot" cx={x(i)} cy={y(s.values[i]!)} r={4} style={{ fill: s.color }} />;
                })
              : (
                <>
                  <line className="crosshair" x1={x(active)} x2={x(active)} y1={TOP} y2={TOP + PLOT} />
                  {series.map((s) => {
                    const v = s.values[active];
                    return v !== null && <circle key={s.key} className="dot" cx={x(active)} cy={y(v)} r={4} style={{ fill: s.color }} />;
                  })}
                </>
              )}
          </svg>
        )}
        {active !== null && width > 0 && (
          <div className="tip" style={tipPosition(x(active), width)}>
            <b>{daily ? dateFormat.format(parseDate(months[active])) : monthFormat.format(parseMonth(months[active]))}</b>
            {series.map((s) => (
              <div key={s.key}>
                <span className="key" style={{ background: s.color }} />
                <b>{format(s.values[active])}</b> {s.name}
              </div>
            ))}
            {details.map((d) => (
              <div key={d.key} className="tip-detail">
                <b>{format(d.values[active])}</b> {d.name}
              </div>
            ))}
          </div>
        )}
      </div>
      <ChartTable months={months} unit={unit} columns={[...series, ...details]} />
    </>
  );
}
