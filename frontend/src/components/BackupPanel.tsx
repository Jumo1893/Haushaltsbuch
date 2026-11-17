import { useEffect, useRef, useState, type DragEvent } from "react";
import { ApiError, downloadBackup, previewRestore, restoreBackup } from "../api";
import { dateTimeFormat } from "../format";
import type { BackupArea, RestoreSummary } from "../types";

/** Die Bereiche, je Bereich eine Datei */
const AREAS: { area: BackupArea; label: string; hint: string }[] = [
  { area: "transactions", label: "Buchungen und Konten", hint: "Konten, Buchungen, Importe, Depot mit Kursen" },
  { area: "debts", label: "Schulden", hint: "Personen und ihre Einträge" },
  { area: "settings", label: "Einstellungen", hint: "Kategorien und gemerkte Zuordnungen" },
];

type Step =
  | { kind: "select" }
  | { kind: "checking" }
  | { kind: "preview"; summary: RestoreSummary }
  | { kind: "restoring"; summary: RestoreSummary }
  | { kind: "done"; summary: RestoreSummary };

/** Meldung des Servers; ist der Upload so groß, dass schon nginx ablehnt, fehlt sie */
function errorText(e: unknown, fallback: string) {
  if (!(e instanceof ApiError)) return fallback;
  if (e.body?.error) return e.body.error;
  return e.status === 413 ? "Die Dateien sind zu groß. Erlaubt sind zusammen höchstens 50 MB." : fallback;
}

const count = (n: number) => n.toLocaleString("de-DE");

/** Aufzählung, z. B. „A“, „B“ und „C“ */
const listOf = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} und ${items[items.length - 1]}` : (items[0] ?? "");

/** Je Bereich der Dateien die Zahl der Einträge je Tabelle vorher und nachher, dazu Warnungen und Hinweise */
function Changes({ summary, done }: { summary: RestoreSummary; done: boolean }) {
  const restored = new Set(summary.areas.map((a) => a.area));
  const unchanged = AREAS.filter((a) => !restored.has(a.area)).map((a) => `„${a.label}“`);
  return (
    <>
      {summary.areas.map((a) => (
        <div key={a.area} className="restore-area">
          <h4>{a.label}</h4>
          <small className="hint">
            {a.fileName} · gesichert am {dateTimeFormat.format(new Date(a.created))}
          </small>
          <ul className="rows">
            {a.tables.map((t) => (
              <li key={t.name}>
                <span>{t.label}</span>
                <span className="count">
                  {done ? "vorher" : "jetzt"} {count(t.before)} · {done ? "jetzt" : "danach"} <b>{count(t.after)}</b>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {unchanged.length > 0 && (
        <p className="hint">
          {done ? "Unverändert geblieben" : "Bleibt unverändert"}: {listOf(unchanged)}.
        </p>
      )}
      {(summary.warnings.length > 0 || summary.notes.length > 0) && (
        <ul className="issues">
          {summary.warnings.map((w) => (
            <li key={w}>
              <b>Abweichung:</b> {w}
            </li>
          ))}
          {summary.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </>
  );
}

interface Props {
  /** Nach einer Wiederherstellung, z. B. um Konten und Seiten neu zu laden */
  onRestored: () => void;
}

/** Bereiche als CSV-Datei herunterladen und aus solchen Dateien wiederherstellen, mit Vorschau */
export default function BackupPanel({ onRestored }: Props) {
  const [downloading, setDownloading] = useState<BackupArea | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [step, setStep] = useState<Step>({ kind: "select" });
  const [problem, setProblem] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0); // verwirft Antworten auf überholte Anfragen

  const busy = step.kind === "checking" || step.kind === "restoring";
  const summary = step.kind === "preview" || step.kind === "restoring" ? step.summary : null;

  // Dateien, die neben dem Ablagefeld losgelassen werden, nicht im Browser öffnen
  useEffect(() => {
    const block = (e: globalThis.DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  const download = async (area: BackupArea) => {
    setDownloading(area);
    setDownloadError("");
    try {
      await downloadBackup(area);
    } catch (e) {
      setDownloadError(errorText(e, "Die Sicherung konnte nicht erstellt werden."));
    } finally {
      setDownloading(null);
    }
  };

  const reset = () => {
    requestRef.current++;
    setFiles([]);
    setStep({ kind: "select" });
    setProblem("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const chooseFiles = async (list: FileList | null) => {
    const chosen = [...(list ?? [])];
    if (!chosen.length) return;
    reset();
    if (chosen.length > AREAS.length) return setProblem("Bitte höchstens drei Dateien wählen, eine je Bereich.");
    const wrong = chosen.find((f) => !/\.csv$/i.test(f.name));
    if (wrong) return setProblem(`${wrong.name}: Bitte CSV-Dateien (Endung .csv) wählen.`);
    setFiles(chosen);
    const request = ++requestRef.current;
    setStep({ kind: "checking" });
    try {
      const result = await previewRestore(chosen);
      if (request === requestRef.current) setStep({ kind: "preview", summary: result });
    } catch (e) {
      if (request !== requestRef.current) return;
      setStep({ kind: "select" });
      setProblem(errorText(e, "Die Dateien konnten nicht geprüft werden."));
    }
  };

  const confirm = async () => {
    if (step.kind !== "preview") return;
    setStep({ kind: "restoring", summary: step.summary });
    setProblem("");
    try {
      const result = await restoreBackup(files);
      reset();
      setStep({ kind: "done", summary: result });
      onRestored();
    } catch (e) {
      setStep({ kind: "preview", summary: step.summary });
      setProblem(errorText(e, "Die Wiederherstellung ist fehlgeschlagen."));
    }
  };

  const handleDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    if (!busy) chooseFiles(e.dataTransfer.files);
  };

  const replaced = listOf(summary?.areas.map((a) => `„${a.label}“`) ?? []);

  return (
    <div className="backup">
      <h3>Herunterladen</h3>
      <ul className="rows">
        {AREAS.map(({ area, label, hint }) => (
          <li key={area}>
            <div>
              {label}
              <small>{hint}</small>
            </div>
            <button className="ghost small" disabled={downloading !== null} onClick={() => download(area)}>
              {downloading === area ? "Wird erstellt …" : "Herunterladen"}
            </button>
          </li>
        ))}
      </ul>
      {downloadError && (
        <p className="errbox import-error" role="alert">
          {downloadError}
        </p>
      )}

      <h3>Wiederherstellen</h3>
      {step.kind === "done" ? (
        <div role="status">
          <p className="ok">Wiederhergestellt.</p>
          <Changes summary={step.summary} done />
          <div className="actions">
            <button className="ghost" onClick={reset}>
              Weitere Sicherung hochladen
            </button>
          </div>
        </div>
      ) : (
        <>
          {!summary && (
            <label
              className={`drop${dragging ? " over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
              }}
              onDrop={handleDrop}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                multiple
                disabled={busy}
                onChange={(e) => chooseFiles(e.target.files)}
              />
              <strong>{step.kind === "checking" ? "Dateien werden geprüft …" : "Sicherungen hierher ziehen"}</strong>
              <span>oder klicken, um Dateien auszuwählen, eine je Bereich, am besten alle drei zusammen</span>
            </label>
          )}

          {problem && (
            <div className="errbox import-error" role="alert">
              <p>{problem}</p>
            </div>
          )}

          {summary && (
            <div className="preview">
              <Changes summary={summary} done={false} />
              <p className="hint">
                Die Wiederherstellung ersetzt alles in {replaced} durch den Stand der Sicherung und lässt sich nicht
                rückgängig machen. Wer den jetzigen Stand behalten will, lädt ihn vorher oben herunter.
              </p>
              <div className="actions">
                <button className="add" disabled={step.kind === "restoring"} onClick={confirm}>
                  {step.kind === "restoring" ? "Wird wiederhergestellt …" : "Wiederherstellen"}
                </button>
                <button className="ghost" disabled={step.kind === "restoring"} onClick={reset}>
                  Abbrechen
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
