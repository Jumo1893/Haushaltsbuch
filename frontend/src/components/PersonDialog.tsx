import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api";
import type { Person } from "../types";

interface Props {
  person: Person;
  /** Speichert den neuen Namen; wirft bei einem Fehler. */
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}

/** Eine Person umbenennen; ihre Einträge bleiben, wie sie sind */
export default function PersonDialog({ person, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [name, setName] = useState(person.name);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => ref.current?.close();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(name.trim());
      close();
    } catch (err) {
      setError(err instanceof ApiError && err.body?.error ? err.body.error : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  };

  return (
    <dialog ref={ref} className="edit" aria-labelledby={`${id}-title`} onClose={onClose}>
      <h2 id={`${id}-title`}>Person umbenennen</h2>
      {error && (
        <p className="errbox" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={handleSubmit}>
        <div className="full">
          <label htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          <small className="hint">Ein Name kommt nur einmal vor, Groß- und Kleinschreibung zählen dabei nicht.</small>
        </div>
        <div className="full actions">
          <button className="add" type="submit" disabled={saving}>
            {saving ? "Wird gespeichert …" : "Umbenennen"}
          </button>
          <button className="ghost" type="button" onClick={close}>
            Abbrechen
          </button>
        </div>
      </form>
    </dialog>
  );
}
