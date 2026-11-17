import { useData } from "../data";
import { KIND_LABELS, bookingLabel, effectText, isPartlyPaid, openAmount } from "../debts";
import { dateFormat, eur, parseDate, signed } from "../format";
import type { Debt } from "../types";

interface Props {
  items: Debt[];
  /** Zu einer Buchung: die Person vorne nennen; sonst der Grund und die Buchung, zu der ein Eintrag gehört */
  byPerson?: boolean;
  onEdit: (entry: Debt) => void;
  onDelete: (entry: Debt) => void;
}

/** Einträge zu Schulden; ein Klick bearbeitet einen Eintrag */
export default function DebtList({ items, byPerson = false, onEdit, onDelete }: Props) {
  const { accounts } = useData();
  const accountName = (id: number) => accounts.find((a) => a.id === id)?.name;

  return (
    <ul>
      {items.map((d) => {
        const day = dateFormat.format(parseDate(d.date));
        // Ohne Grund steht die Art vorne, dann ohne Markierung dahinter
        const title = byPerson ? d.person : d.reason || KIND_LABELS[d.kind];
        const badge = title !== KIND_LABELS[d.kind];
        const t = d.transaction;
        const booking =
          !byPerson && t
            ? `Buchung ${[accountName(t.accountId), `${t.type === "in" ? "+" : "−"}${eur.format(t.amount)}`, bookingLabel(t)]
                .filter(Boolean)
                .join(", ")}`
            : "";
        // Beglichene Schulden nennen den Tag, an dem sie ganz getilgt waren, teilweise getilgte den offenen Rest, ein
        // Ausgleich die Zahl der Schulden, die er ganz oder teilweise tilgt
        const partly = isPartlyPaid(d);
        const settled = d.settledDate && `beglichen am ${dateFormat.format(parseDate(d.settledDate))}`;
        const rest = partly && `noch ${eur.format(openAmount(d))} von ${eur.format(Math.abs(d.amount))} offen`;
        const settles = d.settlesCount > 0 && `tilgt ${d.settlesCount} ${d.settlesCount === 1 ? "Schuld" : "Schulden"}`;
        const details = [byPerson ? d.reason : day, effectText(d.person, d.amount, d.kind), booking, settled, rest, settles];
        return (
          <li key={d.id}>
            <button className="entry" aria-label={`Eintrag bearbeiten: ${title}, ${day}, ${signed(d.amount)}`} onClick={() => onEdit(d)}>
              <span>
                {title}
                {badge && <span className="badge">{KIND_LABELS[d.kind]}</span>}
                {d.settledDate && <span className="badge">beglichen</span>}
                {partly && <span className="badge">teilweise getilgt</span>}
                <small>{details.filter(Boolean).join(" · ")}</small>
              </span>
              <span className="amt">{signed(d.amount)}</span>
            </button>
            <button className="del" aria-label={`Eintrag löschen: ${title}`} onClick={() => onDelete(d)}>
              Löschen
            </button>
          </li>
        );
      })}
    </ul>
  );
}
