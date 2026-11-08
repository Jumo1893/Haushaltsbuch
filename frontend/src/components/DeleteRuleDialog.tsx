import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api";
import type { Rule } from "../types";

interface Props {
  rule: Rule;
  /** Kurzbeschreibung der Zuordnung, wie in der Liste */
  summary: string;
  /** Löscht die gemerkte Zuordnung; wirft bei einem Fehler. */
  onDelete: () => Promise<void>;
  onClose: () => void;
}

/** Was mit den Buchungen passiert, die der Zuordnung folgen */
function consequence(count: number) {
  if (!count) return "Gerade folgt ihr keine Buchung.";
  const subject = count === 1 ? "Die Buchung, die ihr folgt, geht" : `Die ${count} Buchungen, die ihr folgen, gehen`;
  return `${subject} zurück nach „Sonstiges“, ohne Rhythmus. Passt eine automatische Kategorie, gilt diese.`;
}

export default function DeleteRuleDialog({ rule, summary, onDelete, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
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
      await onDelete();
      close();
    } catch (err) {
      setError(err instanceof ApiError && err.body?.error ? err.body.error : "Löschen fehlgeschlagen.");
      setSaving(false);
    }
  };

  return (
    <dialog ref={ref} className="edit" aria-labelledby={`${id}-title`} onClose={onClose}>
      <h2 id={`${id}-title`}>Gemerkte Zuordnung löschen</h2>
      {error && (
        <p className="errbox" role="alert">
          {error}
        </p>
      )}
      <dl className="source">
        <div>
          <dt>Gegenpartei</dt>
          <dd>{rule.counterparty}</dd>
        </div>
        <div>
          <dt>Zuordnung</dt>
          <dd>{summary}</dd>
        </div>
      </dl>
      <p className="hint">
        {consequence(rule.transactionCount)} Von Hand zugeordnete Buchungen bleiben, wie sie sind.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="full actions">
          <button className="add" type="submit" disabled={saving}>
            {saving ? "Wird gelöscht …" : "Zuordnung löschen"}
          </button>
          <button className="ghost" type="button" onClick={close}>
            Abbrechen
          </button>
        </div>
      </form>
    </dialog>
  );
}
