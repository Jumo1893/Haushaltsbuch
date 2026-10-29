import { useState } from "react";
import type { Account, NewAccount } from "../types";
import NewAccountDialog from "./NewAccountDialog";

/** Wert der Option, die den Dialog „Neues Konto“ öffnet */
const NEW_ACCOUNT = "new";

interface Props {
  id: string;
  accounts: Account[];
  value: number | null;
  disabled?: boolean;
  onChange: (id: number) => void;
  /** Legt ein Konto an; es wird danach ausgewählt. */
  onCreate: (account: NewAccount) => Promise<Account>;
}

/** Auswahl eines Kontos, mit der Möglichkeit, direkt ein neues anzulegen */
export default function AccountSelect({ id, accounts, value, disabled, onChange, onCreate }: Props) {
  const [creating, setCreating] = useState(false);

  return (
    <>
      <select
        id={id}
        required
        disabled={disabled}
        value={value ?? ""}
        onChange={(e) => (e.target.value === NEW_ACCOUNT ? setCreating(true) : onChange(Number(e.target.value)))}
      >
        {value === null && <option value="">Bitte wählen …</option>}
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
        <option value={NEW_ACCOUNT}>Neues Konto anlegen …</option>
      </select>
      {creating && (
        <NewAccountDialog
          onCreate={async (account) => onChange((await onCreate(account)).id)}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}
