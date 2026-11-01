import { useEffect, useState } from "react";
import { useData } from "../data";
import { NO_FILTERS, isFiltered, type Account, type TransactionFilters, type TxKind } from "../types";
import Segmented from "./Segmented";

/** So lange (ms) muss die Eingabe ruhen, bevor gesucht wird */
const TYPING_PAUSE = 250;

const TYPES: [TxKind | "", string][] = [
  ["", "Alle"],
  ["out", "Ausgaben"],
  ["in", "Einnahmen"],
  ["transfer", "Umbuchungen"],
];

interface Props {
  filters: TransactionFilters;
  accounts: Account[];
  onChange: (filters: TransactionFilters) => void;
}

/** Suchfeld und Filter über der Buchungsliste */
export default function BookingFilters({ filters, accounts, onChange }: Props) {
  const { categoryNames } = useData();
  const [text, setText] = useState(filters.text);

  // Geänderte Adresse übernehmen, z. B. ein Klick auf „Buchungen“ in der Navigation
  useEffect(() => setText(filters.text), [filters.text]);

  useEffect(() => {
    if (text === filters.text) return;
    const timer = setTimeout(() => onChange({ ...filters, text }), TYPING_PAUSE);
    return () => clearTimeout(timer);
    // onChange ändert sich mit filters, deshalb steht es nicht in der Liste
  }, [text, filters]);

  const reset = () => {
    setText("");
    onChange(NO_FILTERS);
  };

  return (
    <div className="filters" role="search">
      <input
        type="search"
        aria-label="Buchungen suchen"
        placeholder="Alle Monate und Konten durchsuchen"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {accounts.length > 1 && (
        <select
          aria-label="Konto"
          value={filters.account ?? ""}
          onChange={(e) => onChange({ ...filters, account: Number(e.target.value) || null })}
        >
          <option value="">Alle Konten</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
      <select
        aria-label="Kategorie"
        value={filters.category}
        onChange={(e) => onChange({ ...filters, category: e.target.value })}
      >
        <option value="">Alle Kategorien</option>
        {[...new Set(Object.values(categoryNames).flat())].map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <Segmented label="Art" options={TYPES} value={filters.type} onChange={(type) => onChange({ ...filters, type })} />
      {isFiltered({ ...filters, text }) && (
        <button className="ghost small" onClick={reset}>
          Zurücksetzen
        </button>
      )}
    </div>
  );
}
