import { useId } from "react";
import { dateFormat, eur, formatIban, parseDate } from "../format";
import type { Account, ImportAccount, ImportPreview as Preview, ImportRow, NewAccount } from "../types";
import AccountSelect from "./AccountSelect";

interface Props {
  preview: Preview;
  accounts: Account[];
  /** Konto für Datensätze ohne eigene IBAN */
  accountId: number | null;
  onAccountChange: (id: number) => void;
  onCreateAccount: (account: NewAccount) => Promise<Account>;
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

/** z. B. „1 Datensatz“, „5 Datensätze“ */
const records = (n: number) => `${n} ${n === 1 ? "Datensatz" : "Datensätze"}`;

function AccountRow({ account }: { account: ImportAccount & { iban: string } }) {
  const iban = formatIban(account.iban);
  const isNew = account.accountId === null;
  // Die IBAN nur nennen, wenn sie nicht ohnehin der Name des Kontos ist
  const info = [account.accountName !== iban && iban, isNew && "wird beim Import angelegt"].filter(Boolean).join(" · ");
  return (
    <li>
      <div>
        {account.accountName}
        {isNew && <span className="badge">Neues Konto</span>}
        {info && <small>{info}</small>}
      </div>
      <span className="count">{records(account.new + account.duplicate)}</span>
    </li>
  );
}

export default function ImportPreview({
  preview,
  accounts,
  accountId,
  onAccountChange,
  onCreateAccount,
  includeDuplicates,
  onIncludeDuplicates,
  importing,
  onConfirm,
  onCancel,
}: Props) {
  const selectId = useId();
  const { counts, sample, duplicates, errors, skipped } = preview;
  const toImport = counts.new + (includeDuplicates ? counts.duplicate : 0);
  const withIban = preview.accounts.filter((a): a is ImportAccount & { iban: string } => a.iban !== null);
  const withoutIban = preview.accounts.find((a) => a.iban === null);
  // Für Datensätze ohne IBAN muss ein Konto gewählt sein, sofern welche importiert werden
  const needsAccount = !!withoutIban && withoutIban.new + (includeDuplicates ? withoutIban.duplicate : 0) > 0;

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

      {withIban.length > 0 && (
        <>
          <h3>{withIban.length === 1 ? "Konto" : "Konten"}</h3>
          <ul className="rows">
            {withIban.map((a) => (
              <AccountRow key={a.iban} account={a} />
            ))}
          </ul>
        </>
      )}

      {withoutIban && (
        <div className="import-account">
          <label htmlFor={selectId}>
            {withIban.length ? `Konto für ${records(withoutIban.new + withoutIban.duplicate)} ohne IBAN` : "Konto"}
          </label>
          <AccountSelect
            id={selectId}
            accounts={accounts}
            value={accountId}
            disabled={importing}
            onChange={onAccountChange}
            onCreate={onCreateAccount}
          />
          {!withIban.length && (
            <small className="hint">
              Die Datei enthält keine IBAN des eigenen Kontos. Bitte wähle, zu welchem Konto die Umsätze gehören.
            </small>
          )}
        </div>
      )}

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
        <button className="add" disabled={importing || toImport === 0 || (needsAccount && accountId === null)} onClick={onConfirm}>
          {importing ? "Wird importiert …" : `${records(toImport)} importieren`}
        </button>
        <button className="ghost" disabled={importing} onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}
