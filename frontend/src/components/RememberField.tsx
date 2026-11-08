import { previewRule } from "../api";
import { useLoad } from "../data";
import { eur } from "../format";
import { rhythmLabel, type RememberMode, type Rhythm, type RulePreview, type Transaction, type TxKind } from "../types";

/** Auswahl im Formular: merken nur mit Betrag, bei jedem Betrag oder leer: nicht */
export type RememberChoice = RememberMode | "";

/** Lässt sich die Zuordnung der Buchung merken? Dafür braucht sie eine Gegenpartei. */
export const canRemember = (tx: Transaction | undefined): tx is Transaction => !!tx?.counterparty.trim();

/** Was eine gemerkte Zuordnung aus der Buchung bewirken würde, wenn sie die Art kind hat; null, solange unbekannt */
export function useRulePreview(tx: Transaction | undefined, kind: TxKind) {
  const id = canRemember(tx) ? tx.id : null;
  const { data } = useLoad(() => (id === null ? Promise.resolve(null) : previewRule(id, kind)), [id, kind]);
  return data ?? null;
}

/**
 * Vorauswahl: Merken lohnt nur, wenn Kategorie oder Rhythmus geändert sind. Folgt die Buchung einer gemerkten Zuordnung,
 * wird diese ersetzt. Sonst merkt sich eine wiederkehrende Buchung ihren Betrag, eine einmalige nichts.
 */
export function defaultChoice(
  tx: Transaction,
  category: string,
  rhythm: Rhythm | null,
  preview: RulePreview | null,
): RememberChoice {
  if (category === tx.category && rhythm === tx.rhythm) return "";
  const followed = preview?.rules.find((r) => r.id === tx.ruleId);
  if (followed) return followed.amount === null ? "any" : "amount";
  return rhythm ? "amount" : "";
}

/** z. B. „Freizeit, monatlich“ */
const assignment = (category: string, rhythm: Rhythm | null) =>
  `${category}, ${rhythm ? rhythmLabel(rhythm).toLowerCase() : "einmalig"}`;

interface Props {
  id: string;
  tx: Transaction;
  preview: RulePreview | null;
  /** Kategorie und Rhythmus, wie sie im Formular gewählt sind */
  category: string;
  rhythm: Rhythm | null;
  value: RememberChoice;
  onChange: (value: RememberChoice) => void;
}

/** Auswahl, ob künftige und bisherige Buchungen derselben Gegenpartei dieselbe Kategorie und denselben Rhythmus bekommen */
export default function RememberField({ id, tx, preview, category, rhythm, value, onChange }: Props) {
  const hints: string[] = [];
  if (!value) {
    if (tx.ruleId !== null) hints.push("Folgt einer gemerkten Zuordnung. Eine Änderung gilt so nur für diese Buchung.");
  } else if (preview) {
    const count = value === "amount" ? preview.sameAmount : preview.anyAmount;
    hints.push(
      count
        ? `Gilt sofort auch für ${count} bisherige ${count === 1 ? "Buchung" : "Buchungen"}. Von Hand zugeordnete bleiben, wie sie sind.`
        : "Gilt für künftige Buchungen.",
    );
    const existing = preview.rules.find((r) => (value === "amount") === (r.amount !== null));
    if (existing) {
      hints.push(
        existing.category === category && existing.rhythm === rhythm
          ? "So ist es schon gemerkt."
          : `Ersetzt die bisher gemerkte Zuordnung (${assignment(existing.category, existing.rhythm)}).`,
      );
    }
  }

  return (
    <div className="full remember">
      <label htmlFor={id}>Künftige Buchungen von „{tx.counterparty}“</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as RememberChoice)}>
        <option value="">Nicht übernehmen</option>
        <option value="amount">Nur bei {eur.format(tx.amount)} übernehmen</option>
        <option value="any">Bei jedem Betrag übernehmen</option>
      </select>
      {hints.length > 0 && <small className="hint">{hints.join(" ")}</small>}
    </div>
  );
}
