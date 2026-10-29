import { useWidth } from "./layout";

const HEIGHT = 36;
const PAD = 6; // Platz für den Endpunkt

/** Kleiner Verlauf ohne Achsen, z. B. der Kontostand der letzten zwölf Monate; der Punkt ist der aktuelle Wert */
export default function Sparkline({ values, color }: { values: number[]; color: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const lo = Math.min(...values);
  const span = Math.max(...values) - lo;
  const x = (i: number) => PAD + (i * (width - 2 * PAD)) / (values.length - 1);
  const y = (v: number) => (span ? PAD + (1 - (v - lo) / span) * (HEIGHT - 2 * PAD) : HEIGHT / 2);
  const last = values.length - 1;

  return (
    <div ref={ref} className="spark" aria-hidden="true">
      {width > 0 && values.length > 1 && (
        <svg width={width} height={HEIGHT}>
          <path className="line" style={{ stroke: color }} d={values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("")} />
          <circle className="dot" cx={x(last)} cy={y(values[last])} r={4} style={{ fill: color }} />
        </svg>
      )}
    </div>
  );
}
