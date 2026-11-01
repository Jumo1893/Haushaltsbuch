import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "../api";

interface Props {
  /** Bisheriger Name zum Umbenennen; ohne wird eine neue Kategorie angelegt. */
  name?: string;
  /** Speichert den Namen; wirft bei einem Fehler. */
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}

export default function CategoryDialog({ name: current, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [name, setName] = useState(current ?? "");
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
      await onSave(name.trim());
      close();
    } catch (err) {
      setError(err instanceof ApiError && err.body?.error ? err.body.error : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  };

  // Wie beim Konto: Im Body liegt das Formular nicht im Formular der Buchung, React reicht submit und close aber
  // trotzdem an die umgebenden Komponenten weiter, deshalb stoppen beide hier.
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
      <h2 id={`${id}-title`}>{current ? "Kategorie umbenennen" : "Neue Kategorie"}</h2>
      {current && <p className="hint">Die Buchungen dieser Kategorie ändern sich mit.</p>}
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
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="full actions">
          <button className="add" type="submit" disabled={saving}>
            {saving ? "Wird gespeichert …" : current ? "Umbenennen" : "Kategorie anlegen"}
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
