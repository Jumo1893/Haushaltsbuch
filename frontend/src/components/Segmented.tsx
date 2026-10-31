import { useId } from "react";

interface Props<T extends string | number> {
  /** Name der Auswahl für Screenreader */
  label: string;
  options: [T, string][];
  value: T;
  onChange: (value: T) => void;
  /** Darstellung; ohne die kleine Umschaltung */
  className?: string;
  /** Möglichkeiten, die sich gerade nicht wählen lassen */
  isDisabled?: (option: T) => boolean;
}

/** Umschaltung zwischen wenigen Möglichkeiten, z. B. dem Zeitraum der Diagramme */
export default function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  className = "seg small",
  isDisabled,
}: Props<T>) {
  const name = useId();
  return (
    <div className={className} role="radiogroup" aria-label={label}>
      {options.map(([option, text]) => (
        <label key={option}>
          <input
            type="radio"
            name={name}
            checked={option === value}
            disabled={isDisabled?.(option)}
            onChange={() => onChange(option)}
          />
          <span>{text}</span>
        </label>
      ))}
    </div>
  );
}
