import type { Person } from "../types";

interface Props {
  id: string;
  value: string;
  people: Person[];
  onChange: (name: string) => void;
  required?: boolean;
  placeholder?: string;
  /** Name für Screenreader, wenn es kein sichtbares Label gibt */
  label?: string;
}

/**
 * Name einer Person, mit den bekannten Personen als Vorschlag. Ein neuer Name legt beim Speichern eine Person an,
 * Groß- und Kleinschreibung zählen dabei nicht.
 */
export default function PersonInput({ id, value, people, onChange, required = true, placeholder, label }: Props) {
  const listId = `${id}-people`;
  return (
    <>
      <input
        id={id}
        list={listId}
        required={required}
        maxLength={40}
        autoComplete="off"
        placeholder={placeholder ?? "Name"}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {people.map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
    </>
  );
}
