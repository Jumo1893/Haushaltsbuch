import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api";
import { bookings } from "../format";
import type { Category } from "../types";

interface Props {
  category: Category;
  /** Kategorien derselben Art, in die die Buchungen wandern können */
  targets: Category[];
  /** Löscht die Kategorie und verschiebt ihre Buchungen; wirft bei einem Fehler. */
  onDelete: (moveTo: number) => Promise<void>;
  onClose: () => void;
}

export default function DeleteCategoryDialog({ category, targets, onDelete, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  // Vorauswahl ist die feste Kategorie „Sonstiges“
  const [moveTo, setMoveTo] = useState(targets.find((c) => c.fixed)?.id ?? targets[0].id);
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
      await onDelete(moveTo);
      close();
    } catch (err) {
      setError(err instanceof ApiError && err.body?.error ? err.body.error : "Löschen fehlgeschlagen.");
      setSaving(false);
    }
  };

  return (
    <dialog ref={ref} className="edit" aria-labelledby={`${id}-title`} onClose={onClose}>
      <h2 id={`${id}-title`}>Kategorie „{category.name}“ löschen</h2>
      {error && (
        <p className="errbox" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={handleSubmit}>
        {category.transactionCount > 0 ? (
          <div className="full">
            <label htmlFor={`${id}-target`}>{bookings(category.transactionCount)} verschieben nach</label>
            <select id={`${id}-target`} value={moveTo} onChange={(e) => setMoveTo(Number(e.target.value))}>
              {targets.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="full empty">Keine Buchung nutzt diese Kategorie.</p>
        )}
        <div className="full actions">
          <button className="add" type="submit" disabled={saving}>
            {saving ? "Wird gelöscht …" : "Kategorie löschen"}
          </button>
          <button className="ghost" type="button" onClick={close}>
            Abbrechen
          </button>
        </div>
      </form>
    </dialog>
  );
}
