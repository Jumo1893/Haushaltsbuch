import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "../api";
import { formatIban } from "../format";
import { ACCOUNT_KINDS, type Account, type AccountKind, type NewAccount } from "../types";

interface Props {
  /** Vorhandenes Konto zum Bearbeiten; ohne wird ein neues angelegt. */
  account?: Account;
  /** Speichert das Konto; wirft bei einem Fehler. */
  onSave: (account: NewAccount) => Promise<void>;
  onClose: () => void;
}

export default function AccountDialog({ account, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? "giro");
  const [institution, setInstitution] = useState(account?.institution ?? "");
  const [iban, setIban] = useState(account?.iban ? formatIban(account.iban) : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => ref.current?.close();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation(); // siehe unten: nicht an ein umgebendes Formular weitergeben
    setSaving(true);
    try {
      await onSave({ name: name.trim(), kind, institution: institution.trim(), iban: iban.replace(/\s+/g, "") || null });
      close();
    } catch (err) {
      setError(err instanceof ApiError && err.body?.error ? err.body.error : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  };

  // Der Dialog wird oft aus einem Formular heraus geöffnet (Kontoauswahl beim Erfassen). Im Body liegt sein
  // Formular nicht in einem anderen. React reicht submit und close aber trotzdem an die umgebenden
  // Komponenten weiter, deshalb stoppen beide hier.
  return createPortal(
    <dialog
      ref={ref}
      className="edit"
      aria-labelledby={`${id}-title`}
      onClose={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <h2 id={`${id}-title`}>{account ? "Konto bearbeiten" : "Neues Konto"}</h2>
      {error && (
        <p className="errbox" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={handleSubmit}>
        <div className="full">
          <label htmlFor={`${id}-name`}>Name</label>
          <input
            id={`${id}-name`}
            required
            maxLength={60}
            placeholder="z. B. Girokonto"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${id}-kind`}>Art</label>
          <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
            {ACCOUNT_KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-institution`}>Bank</label>
          <input
            id={`${id}-institution`}
            maxLength={60}
            placeholder="optional"
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
          />
        </div>
        <div className="full">
          <label htmlFor={`${id}-iban`}>IBAN</label>
          <input
            id={`${id}-iban`}
            maxLength={42}
            autoComplete="off"
            spellCheck={false}
            placeholder="optional"
            value={iban}
            onChange={(e) => setIban(e.target.value)}
          />
          <small className="hint">
            Umsätze mit dieser IBAN ordnet der CSV-Import automatisch diesem Konto zu. Überweisungen anderer eigener
            Konten an diese IBAN gelten als Umbuchung.
          </small>
        </div>
        <div className="full actions">
          <button className="add" type="submit" disabled={saving}>
            {saving ? "Wird gespeichert …" : account ? "Änderungen speichern" : "Konto anlegen"}
          </button>
          <button className="ghost" type="button" onClick={close}>
            Abbrechen
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
