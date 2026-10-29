import { useEffect, useRef, useState, type DragEvent } from "react";
import { ApiError, fetchImportOptions, previewImport, runImport } from "../api";
import { megabytes } from "../format";
import { Link } from "../router";
import type { Account, ImportOptions, ImportPreview as Preview, ImportResult, NewAccount, ProfileMismatch } from "../types";
import ImportPreview, { Stat } from "./ImportPreview";

type Step =
  | { kind: "select" }
  | { kind: "checking" }
  | { kind: "preview"; preview: Preview }
  | { kind: "importing"; preview: Preview }
  | { kind: "done"; result: ImportResult };

interface Problem {
  message: string;
  mismatch?: ProfileMismatch;
}

const toProblem = (e: unknown, fallback: string): Problem =>
  e instanceof ApiError && e.body?.error ? { message: e.body.error, mismatch: e.body.mismatch } : { message: fallback };

interface Props {
  accounts: Account[];
  /** Vorausgewähltes Konto für Datensätze ohne eigene IBAN, z. B. wenn der Import von einer Kontoseite kommt */
  defaultAccountId?: number | null;
  onCreateAccount: (account: NewAccount) => Promise<Account>;
  /** Wird nach einem erfolgreichen Import aufgerufen, z. B. um Buchungen und Konten neu zu laden. */
  onImported: () => void;
}

/** z. B. „1 Umsatz“, „5 Umsätze“ */
const bookings = (n: number) => `${n} ${n === 1 ? "Umsatz" : "Umsätze"}`;

export default function CsvImport({ accounts, defaultAccountId = null, onCreateAccount, onImported }: Props) {
  const [options, setOptions] = useState<ImportOptions>({ maxFileBytes: 0, profiles: [] });
  const [profileId, setProfileId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>({ kind: "select" });
  const [problem, setProblem] = useState<Problem | null>(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [accountId, setAccountId] = useState<number | null>(null); // für Datensätze ohne eigene IBAN
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0); // verwirft Antworten auf überholte Anfragen

  const busy = step.kind === "checking" || step.kind === "importing";
  const preview = step.kind === "preview" || step.kind === "importing" ? step.preview : null;
  const profile = options.profiles.find((p) => p.id === profileId);

  useEffect(() => {
    fetchImportOptions()
      .then((o) => {
        setOptions(o);
        if (o.profiles.length === 1) setProfileId(o.profiles[0].id);
      })
      .catch(() => setProblem({ message: "Die Importprofile konnten nicht geladen werden." }));
  }, []);

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

  const check = async (f: File, id: string) => {
    const request = ++requestRef.current;
    setStep({ kind: "checking" });
    setProblem(null);
    setIncludeDuplicates(false);
    setAccountId(accounts.some((a) => a.id === defaultAccountId) ? defaultAccountId : null);
    try {
      const result = await previewImport(id, f);
      if (request === requestRef.current) setStep({ kind: "preview", preview: result });
    } catch (e) {
      if (request !== requestRef.current) return;
      setStep({ kind: "select" });
      setProblem(toProblem(e, "Die Datei konnte nicht geprüft werden."));
    }
  };

  const reset = () => {
    requestRef.current++;
    setFile(null);
    setStep({ kind: "select" });
    setProblem(null);
    setIncludeDuplicates(false);
    setAccountId(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const chooseFiles = (files: FileList | null) => {
    const f = files?.[0];
    const count = files?.length ?? 0;
    if (!f) return;
    reset();
    if (count > 1) return setProblem({ message: "Bitte nur eine Datei auf einmal importieren." });
    if (!/\.csv$/i.test(f.name)) return setProblem({ message: "Bitte eine CSV-Datei (Endung .csv) auswählen." });
    if (f.size === 0) return setProblem({ message: "Die Datei ist leer." });
    if (options.maxFileBytes && f.size > options.maxFileBytes)
      return setProblem({ message: `Die Datei ist zu groß. Erlaubt sind höchstens ${megabytes(options.maxFileBytes)}.` });
    setFile(f);
    if (profileId) check(f, profileId);
  };

  const chooseProfile = (id: string) => {
    setProfileId(id);
    if (file && id) check(file, id);
  };

  const confirm = async () => {
    if (step.kind !== "preview" || !file) return;
    setStep({ kind: "importing", preview: step.preview });
    setProblem(null);
    try {
      const result = await runImport(profileId, file, includeDuplicates, accountId);
      reset();
      setStep({ kind: "done", result });
      onImported();
    } catch (e) {
      setStep({ kind: "preview", preview: step.preview });
      setProblem(toProblem(e, "Der Import ist fehlgeschlagen."));
    }
  };

  const handleDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    if (!busy) chooseFiles(e.dataTransfer.files);
  };

  if (step.kind === "done") {
    const { result } = step;
    return (
      <div role="status">
        <p className="ok">Import abgeschlossen.</p>
        <dl className="stats">
          <Stat label="Importiert" value={result.imported} />
          <Stat label="Duplikate übersprungen" value={result.duplicatesSkipped} />
          {result.skipped > 0 && <Stat label="Nicht übernommen" value={result.skipped} />}
          <Stat label="Fehlerhaft" value={result.invalid} />
        </dl>
        {result.accounts.length > 0 && (
          <ul className="rows">
            {result.accounts.map((a) => (
              <li key={a.id}>
                <div>
                  <Link to={`/konten/${a.id}`}>{a.name}</Link>
                  {a.created && <span className="badge">Neues Konto</span>}
                </div>
                <span className="count">{bookings(a.imported)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">Die Umsätze stehen in der Kategorie „{result.category}“ im Monat ihres Buchungstags.</p>
        {result.accounts.some((a) => a.created) && (
          <p className="hint">
            Auf der Seite eines neuen Kontos lassen sich Name und Art ändern und der Kontostand mit der Bank abgleichen.
          </p>
        )}
        <div className="actions">
          <button className="ghost" onClick={reset}>
            Weitere Datei importieren
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor="profile">Institut / Format</label>
      <select id="profile" value={profileId} disabled={busy} onChange={(e) => chooseProfile(e.target.value)}>
        {!profileId && <option value="">Bitte wählen …</option>}
        {options.profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {profile?.description && <small className="hint">{profile.description}</small>}

      {!preview && (
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
            disabled={busy}
            onChange={(e) => chooseFiles(e.target.files)}
          />
          <strong>{step.kind === "checking" ? "Datei wird geprüft …" : "CSV-Datei hierher ziehen"}</strong>
          <span>
            {file && !profileId
              ? `${file.name}: Bitte zuerst Institut / Format wählen.`
              : `oder klicken, um eine Datei auszuwählen${options.maxFileBytes ? ` (höchstens ${megabytes(options.maxFileBytes)})` : ""}`}
          </span>
        </label>
      )}

      {problem && (
        <div className="errbox import-error" role="alert">
          <p>{problem.message}</p>
          {problem.mismatch && (
            <dl>
              <dt>Fehlende Spalten</dt>
              <dd>{problem.mismatch.missing.join(", ")}</dd>
              <dt>Erwartete Spalten</dt>
              <dd>{problem.mismatch.expected.join(", ")}</dd>
              <dt>Gefundene Spalten</dt>
              <dd>{problem.mismatch.found.join(", ") || "keine"}</dd>
            </dl>
          )}
        </div>
      )}

      {preview && (
        <ImportPreview
          preview={preview}
          accounts={accounts}
          accountId={accountId}
          onAccountChange={setAccountId}
          onCreateAccount={onCreateAccount}
          includeDuplicates={includeDuplicates}
          onIncludeDuplicates={setIncludeDuplicates}
          importing={step.kind === "importing"}
          onConfirm={confirm}
          onCancel={reset}
        />
      )}
    </div>
  );
}
