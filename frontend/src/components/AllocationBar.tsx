import { money, percent } from "../format";
import { assetClassLabel, assetClassRank, type DepotAllocation } from "../types";

/** Farbe einer Anlageklasse: Sie hängt an der Klasse, nicht an ihrem Anteil */
const colorOf = (assetClass: string) => {
  const rank = assetClassRank(assetClass);
  return rank < 8 ? `var(--c${rank + 1})` : "var(--muted)";
};

/** Anteile der Anlageklassen am Depot als gestapelter Balken, die Zahlen stehen in der Legende darunter */
export default function AllocationBar({ allocation }: { allocation: DepotAllocation[] }) {
  if (!allocation.length) return <p className="empty">Keine offenen Positionen.</p>;
  const rows = [...allocation].sort((a, b) => assetClassRank(a.assetClass) - assetClassRank(b.assetClass));

  return (
    <>
      <div className="stack" aria-hidden="true">
        {rows.map((r) => (
          <span
            key={r.assetClass}
            style={{ flexGrow: r.share, background: colorOf(r.assetClass) }}
            title={`${assetClassLabel(r.assetClass)}: ${money(r.value)}`}
          />
        ))}
      </div>
      <ul className="allocation">
        {rows.map((r) => (
          <li key={r.assetClass}>
            <span className="swatch" style={{ background: colorOf(r.assetClass) }} />
            <span>{assetClassLabel(r.assetClass)}</span>
            <span className="count">{percent.format(r.share)}</span>
            <span className="amt">{money(r.value)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
