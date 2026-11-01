import { useState } from "react";
import { useData } from "../data";
import type { TxKind } from "../types";
import CategoryDialog from "./CategoryDialog";

/** Wert der Option, die den Dialog „Neue Kategorie“ öffnet; Namen beginnen nie mit einem Leerzeichen */
const NEW_CATEGORY = " new";

interface Props {
  id: string;
  kind: TxKind;
  value: string;
  /** Text einer zusätzlichen ersten Option mit leerem Wert, z. B. „Nicht ändern“ */
  emptyLabel?: string;
  onChange: (name: string) => void;
}

/** Auswahl einer Kategorie, mit der Möglichkeit, direkt eine neue anzulegen */
export default function CategorySelect({ id, kind, value, emptyLabel, onChange }: Props) {
  const { categoryNames, createCategory } = useData();
  const [creating, setCreating] = useState(false);
  const names = categoryNames[kind];

  return (
    <>
      <select
        id={id}
        value={value}
        onChange={(e) => (e.target.value === NEW_CATEGORY ? setCreating(true) : onChange(e.target.value))}
      >
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {/* Eine Kategorie, die nicht (mehr) in der Liste steht, bleibt auswählbar */}
        {value && !names.includes(value) && <option>{value}</option>}
        {names.map((name) => (
          <option key={name}>{name}</option>
        ))}
        <option value={NEW_CATEGORY}>Neue Kategorie anlegen …</option>
      </select>
      {creating && (
        <CategoryDialog
          onSave={async (name) => onChange((await createCategory({ kind, name })).name)}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}
