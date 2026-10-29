import { useId } from "react";

interface Props<T extends string | number> {
  /** Name der Auswahl für Screenreader */
  label: string;
  options: [T, string][];
  value: T;
  onChange: (value: T) => void;
}

/** Kleine Umschaltung zwischen wenigen Möglichkeiten, z. B. dem Zeitraum der Diagramme */
export default function Segmented<T extends string | number>({ label, options, value, onChange }: Props<T>) {
  const name = useId();
  return (
    <div className="seg small" role="radiogroup" aria-label={label}>
      {options.map(([option, text]) => (
        <label key={option}>
          <input type="radio" name={name} checked={option === value} onChange={() => onChange(option)} />
          <span>{text}</span>
        </label>
      ))}
    </div>
  );
}
