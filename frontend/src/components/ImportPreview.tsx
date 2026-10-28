import { dateFormat, eur, parseDate } from "../format";
import type { ImportPreview as Preview, ImportRow } from "../types";

interface Props {
  preview: Preview;
  includeDuplicates: boolean;
  onIncludeDuplicates: (include: boolean) => void;
  importing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Row({ row }: { row: ImportRow }) {
  const title = row.counterparty || row.purpose || "Ohne Beschreibung";
  return (
    <li>
      <div>
        {title}
        {row.duplicate && <span className="badge">Duplikat</span>}
        <small>
          {dateFormat.format(parseDate(row.date))} · Zeile {row.line}
          {row.counterparty && row.purpose && ` · ${row.purpose}`}
        </small>
      </div>
      <span className={`amt ${row.amount < 0 ? "out" : "in"}`}>
        {row.amount < 0 ? "−" : "+"}
        {eur.format(Math.abs(row.amount))}
      </span>
    </li>
  );
}

export default function ImportPreview({ preview, includeDuplicates, onIncludeDuplicates, importing, onConfirm, onCancel }: Props) {
  const { counts, sample, duplicates, errors, skipped } = preview;
  const toImport = counts.new + (includeDuplicates ? counts.duplicate : 0);

  return (
    <div className="preview">
      <p className="file">
        {preview.fileName} · {preview.profile.name}
      </p>

      <dl className="stats">
        <Stat label="Datensätze" value={counts.total} />
        <Stat label="Neu" value={counts.new} />
        <Stat label="Mögliche Duplikate" value={counts.duplicate} />
        {counts.skipped > 0 && <Stat label="Nicht übernommen" value={counts.skipped} />}
        <Stat label="Fehlerhaft" value={counts.invalid} />
      </dl>

      {sample.length > 0 ? (
        <>
          <h3>{sample.length < counts.new + counts.duplicate ? `Die ersten ${sample.length} Datensätze` : "Datensätze"}</h3>
          <ul className="rows">
            {sample.map((r) => (
              <Row key={r.line} row={r} />
            ))}
          </ul>
        </>
      ) : (
        <p className="empty">Die Datei enthält keine gültigen Datensätze.</p>
      )}

      {skipped.map((s) => (
        <p className="hint" key={s.reason}>
          Nicht übernommen: {s.count} × {s.reason}
        </p>
      ))}

      {errors.length > 0 && (
        <details open>
          <summary>Fehlerhafte Zeilen ({counts.invalid}), werden nicht importiert</summary>
          <ul className="issues">
            {errors.map((e) => (
              <li key={e.line}>
                <b>Zeile {e.line}:</b> {e.reason}
              </li>
            ))}
          </ul>
          {counts.invalid > errors.length && <p className="hint">… und {counts.invalid - errors.length} weitere</p>}
        </details>
      )}

      {duplicates.length > 0 && (
        <>
          <details>
            <summary>Mögliche Duplikate ({counts.duplicate}), wurden bereits importiert</summary>
            <ul className="rows">
              {duplicates.map((r) => (
                <Row key={r.line} row={r} />
              ))}
            </ul>
            {counts.duplicate > duplicates.length && (
              <p className="hint">… und {counts.duplicate - duplicates.length} weitere</p>
            )}
          </details>
          <label className="check">
            <input
              type="checkbox"
              checked={includeDuplicates}
              disabled={importing}
              onChange={(e) => onIncludeDuplicates(e.target.checked)}
            />
            Mögliche Duplikate trotzdem importieren
          </label>
        </>
      )}

      <div className="actions">
        <button className="add" disabled={importing || toImport === 0} onClick={onConfirm}>
          {importing ? "Wird importiert …" : `${toImport} ${toImport === 1 ? "Datensatz" : "Datensätze"} importieren`}
        </button>
        <button className="ghost" disabled={importing} onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}
