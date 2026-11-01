import { dateFormat, parseDate, signed } from "../format";
import type { Position } from "../types";

interface Props {
  positions: Position[];
  /** Zeigt die Bewegungen eines Wertpapiers */
  onSelect: (isin: string) => void;
}

/** Vollständig verkaufte, zurückgezahlte oder umgetauschte Wertpapiere mit ihrem Gewinn */
export default function ClosedPositions({ positions, onSelect }: Props) {
  if (!positions.length) return null;
  return (
    <details>
      <summary>Geschlossene Positionen ({positions.length})</summary>
      <ul>
        {positions.map((p) => (
          <li key={p.isin}>
            <button className="entry" aria-label={`Bewegungen zeigen: ${p.name}`} onClick={() => onSelect(p.isin)}>
              <span>
                {p.name}
                <small>
                  {p.isin} · Letzte Bewegung {dateFormat.format(parseDate(p.lastDate))}
                </small>
              </span>
              <span className={`amt ${p.realized < 0 ? "out" : "in"}`}>{signed(p.realized)}</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
