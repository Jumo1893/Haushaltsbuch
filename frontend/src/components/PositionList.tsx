import { dateFormat, money, parseDate, priceText, shareCount, signed, signedPercent } from "../format";
import { PRICE_SOURCES, assetClassLabel, assetClassRank, type Position } from "../types";

interface Props {
  positions: Position[];
  /** Zeigt die Bewegungen eines Wertpapiers */
  onSelect: (isin: string) => void;
}

/** Stückzahl und Kurs einer offenen Position, mit Tag und Herkunft des Kurses */
function holding(p: Position) {
  const shares = `${shareCount.format(p.shares)} Stück`;
  if (p.price === null || !p.priceDate) return shares;
  const source = p.priceSource ? `, ${PRICE_SOURCES[p.priceSource]}` : "";
  return `${shares} · Kurs ${priceText(p.price, p.assetClass)} vom ${dateFormat.format(parseDate(p.priceDate))}${source}`;
}

function Row({ position: p, onSelect }: { position: Position; onSelect: Props["onSelect"] }) {
  const stake = p.invested - p.pending; // Einstand der Stücke, offene Vorauszahlungen haben noch keinen Gewinn
  return (
    <li>
      <button className="entry" aria-label={`Bewegungen zeigen: ${p.name}, ${money(p.value)}`} onClick={() => onSelect(p.isin)}>
        <span>
          {p.name}
          {p.pending > 0 && <span className="badge">{money(p.pending)} in Abwicklung</span>}
          <small>{holding(p)}</small>
          <small>
            Einstand {money(p.invested)} · {p.isin}
          </small>
        </span>
        <span className="position-value">
          <span className="amt">{money(p.value)}</span>
          <small className={p.unrealized < 0 ? "out" : "in"}>
            {signed(p.unrealized)}
            {stake > 0 && ` (${signedPercent(p.unrealized / stake)})`}
          </small>
        </span>
      </button>
    </li>
  );
}

/** Offene Positionen je Anlageklasse, darin die wertvollsten zuerst */
export default function PositionList({ positions, onSelect }: Props) {
  if (!positions.length) return <p className="empty">Keine offenen Positionen.</p>;
  const classes = [...new Set(positions.map((p) => p.assetClass))].sort((a, b) => assetClassRank(a) - assetClassRank(b));

  return (
    <>
      {classes.map((assetClass) => {
        const items = positions.filter((p) => p.assetClass === assetClass);
        return (
          <div className="position-group" key={assetClass}>
            <h3>
              {assetClassLabel(assetClass)} <span className="muted">{money(items.reduce((sum, p) => sum + p.value, 0))}</span>
            </h3>
            <ul>
              {items.map((p) => (
                <Row key={p.isin} position={p} onSelect={onSelect} />
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}
