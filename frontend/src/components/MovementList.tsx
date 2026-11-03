import { useState } from "react";
import { dateFormat, money, movements as countMovements, parseDate, priceText, roundCents, shareCount, signed } from "../format";
import { movementLabel, type DepotMovement, type Position } from "../types";

/** So viele Bewegungen zeigt die Liste auf einmal */
const PAGE_SIZE = 50;

/** Geld, das zwischen Geldkonto und Depot wechselt, steht grau wie andere Umbuchungen */
const TRADES: DepotMovement["kind"][] = ["buy", "sell", "prepayment", "proceeds"];

/** Rechte Spalte: was die Bewegung im Geldkonto bewirkt, ohne Geld die Änderung der Stückzahl */
function Effect({ movement: m }: { movement: DepotMovement }) {
  const cash = roundCents(m.amount + m.fee + m.tax);
  if (cash) return <span className={`amt ${TRADES.includes(m.kind) ? "transfer" : cash < 0 ? "out" : "in"}`}>{signed(cash)}</span>;
  if (!m.shares) return <span className="amt transfer">{money(0)}</span>;
  return (
    <span className="amt">
      {m.shares < 0 ? "−" : "+"}
      {shareCount.format(Math.abs(m.shares))} Stück
    </span>
  );
}

/** Zweite Zeile: Tag, Stückzahl und Kurs sowie Gebühr und Steuer, soweit es sie gibt */
function info(m: DepotMovement) {
  const parts = [dateFormat.format(parseDate(m.date))];
  if (m.shares && m.price !== null) {
    parts.push(`${shareCount.format(Math.abs(m.shares))} Stück zu ${priceText(m.price, m.assetClass)}`);
  }
  else if (m.shares && m.kind === "income") parts.push(`${shareCount.format(m.shares)} Stück`);
  if (m.fee) parts.push(`Gebühr ${money(Math.abs(m.fee))}`);
  if (m.tax) parts.push(`Steuer ${money(Math.abs(m.tax))}${m.tax > 0 ? " erstattet" : ""}`);
  return parts.join(" · ");
}

interface Props {
  movements: DepotMovement[];
  /** Offene und geschlossene Positionen für den Filter */
  positions: Position[];
  /** Gewähltes Wertpapier, leer: alle */
  isin: string;
  onIsinChange: (isin: string) => void;
}

/** Bewegungen des Depots, neueste zuerst, wahlweise nur die eines Wertpapiers */
export default function MovementList({ movements, positions, isin, onIsinChange }: Props) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const items = isin ? movements.filter((m) => m.isin === isin) : movements;
  const options = [...positions].sort((a, b) => a.name.localeCompare(b.name, "de") || a.isin.localeCompare(b.isin));

  return (
    <>
      <div className="filters movements">
        <select
          aria-label="Wertpapier"
          value={isin}
          onChange={(e) => {
            onIsinChange(e.target.value);
            setShown(PAGE_SIZE);
          }}
        >
          <option value="">Alle Wertpapiere</option>
          {options.map((p) => (
            <option key={p.isin} value={p.isin}>
              {p.name} ({p.isin})
            </option>
          ))}
        </select>
        <span className="count">{countMovements(items.length)}</span>
      </div>
      <ul>
        {items.slice(0, shown).map((m) => (
          <li key={m.id}>
            <div>
              {movementLabel(m)}
              {!isin && <span className="muted"> · {m.name}</span>}
              <small>{info(m)}</small>
            </div>
            <Effect movement={m} />
          </li>
        ))}
      </ul>
      {items.length > shown && (
        <div className="actions">
          <button className="ghost" onClick={() => setShown((n) => n + PAGE_SIZE)}>
            Weitere anzeigen ({items.length - shown})
          </button>
        </div>
      )}
    </>
  );
}
