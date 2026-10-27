import { monthFormat } from "../format";

interface Props {
  month: Date;
  onChange: (delta: number) => void;
}

export default function MonthNav({ month, onChange }: Props) {
  return (
    <div className="month">
      <button className="icon" aria-label="Voriger Monat" onClick={() => onChange(-1)}>
        ‹
      </button>
      <span>{monthFormat.format(month)}</span>
      <button className="icon" aria-label="Nächster Monat" onClick={() => onChange(1)}>
        ›
      </button>
    </div>
  );
}
