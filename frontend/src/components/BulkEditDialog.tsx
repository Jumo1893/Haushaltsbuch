import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api";
import { useData } from "../data";
import { bookings, dateFormat, eur, parseDate } from "../format";
import { CATEGORIES, type BulkChanges, type Transaction, type TxType } from "../types";

/** Dieselbe Änderung für mehrere Buchungen */
export interface BulkUpdate {
  ids: number[];
  changes: BulkChanges;
}

interface Props {
  items: Transaction[];
  /** Speichert die Änderungen; wirft bei einem Fehler. */
  onSave: (updates: BulkUpdate[]) => Promise<void>;
  onClose: () => void;
}

const TYPE_NAMES: Record<TxType, [string, string]> = {
  out: ["Ausgabe", "Ausgaben"],
  in: ["Einnahme", "Einnahmen"],
};

/** Kategorie und Notiz mehrerer Buchungen auf einmal ändern */
export default function BulkEditDialog({ items, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const { accounts } = useData();
  // Je Art eine Kategorie, weil Einnahmen und Ausgaben verschiedene haben; leer heißt nicht ändern
  const [categories, setCategories] = useState<Record<TxType, string>>({ out: "", in: "" });
  const [note, setNote] = useState("");
  const [removeNotes, setRemoveNotes] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => ref.current?.close();

  const groups = (["out", "in"] as const)
    .map((type) => ({ type, ids: items.filter((x) => x.type === type).map((x) => x.id) }))
    .filter((group) => group.ids.length);
  const noteChange: BulkChanges = removeNotes ? { note: "" } : note.trim() ? { note: note.trim() } : {};
  const updates = groups
    .map(({ type, ids }) => ({
      ids,
      changes: categories[type] ? { ...noteChange, category: categories[type] } : noteChange,
    }))
    .filter((update) => Object.keys(update.changes).length);
  const changing = updates.reduce((sum, update) => sum + update.ids.length, 0);
  const withNote = items.filter((x) => x.note).length;
  const accountNames = new Map(accounts.length > 1 ? accounts.map((a) => [a.id, a.name]) : []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(updates);
      close();
    } catch (err) {
      setError(err instanceof ApiError && err.body?.error ? err.body.error : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  };

  return (
    <dialog ref={ref} className="edit" aria-labelledby={`${id}-title`} onClose={onClose}>
      <h2 id={`${id}-title`}>{bookings(items.length)} bearbeiten</h2>
      <p className="hint">
        Gilt für alle ausgewählten Buchungen, auch importierte, und lässt sich nicht rückgängig machen.
      </p>
      {error && (
        <p className="errbox" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={handleSubmit}>
        {groups.map(({ type, ids }) => (
          <div className="full" key={type}>
            <label htmlFor={`${id}-${type}`}>
              {groups.length > 1
                ? `Kategorie für ${ids.length} ${TYPE_NAMES[type][ids.length === 1 ? 0 : 1]}`
                : "Kategorie"}
            </label>
            <select
              id={`${id}-${type}`}
              value={categories[type]}
              onChange={(e) => setCategories({ ...categories, [type]: e.target.value })}
            >
              <option value="">Nicht ändern</option>
              {CATEGORIES[type].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        ))}
        <div className="full">
          <label htmlFor={`${id}-note`}>Notiz</label>
          <input
            id={`${id}-note`}
            type="text"
            maxLength={60}
            placeholder={removeNotes ? "Wird entfernt" : "Nicht ändern"}
            disabled={removeNotes}
            value={removeNotes ? "" : note}
            onChange={(e) => setNote(e.target.value)}
          />
          {withNote > 0 && (
            <>
              {note.trim() && !removeNotes && (
                <small className="hint">Ersetzt die vorhandene Notiz von {bookings(withNote)}.</small>
              )}
              <label className="check">
                <input type="checkbox" checked={removeNotes} onChange={(e) => setRemoveNotes(e.target.checked)} />
                Vorhandene Notizen entfernen
              </label>
            </>
          )}
        </div>
        <details className="full">
          <summary>Ausgewählte Buchungen ansehen</summary>
          <ul className="rows table-scroll">
            {[...items]
              .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
              .map((x) => {
                const source = x.counterparty || x.purpose;
                const info = [
                  dateFormat.format(parseDate(x.date)),
                  accountNames.get(x.accountId),
                  x.category,
                  source && x.note,
                ];
                return (
                  <li key={x.id}>
                    <div>
                      {source || x.note || "Ohne Beschreibung"}
                      <small>{info.filter(Boolean).join(" · ")}</small>
                    </div>
                    <span className={`amt ${x.transfer ? "transfer" : x.type}`}>
                      {x.type === "in" ? "+" : "−"}
                      {eur.format(x.amount)}
                    </span>
                  </li>
                );
              })}
          </ul>
        </details>
        <div className="full actions">
          <button className="add" type="submit" disabled={saving || !changing}>
            {saving ? "Wird gespeichert …" : `${bookings(changing)} ändern`}
          </button>
          <button className="ghost" type="button" onClick={close}>
            Abbrechen
          </button>
        </div>
      </form>
    </dialog>
  );
}
