import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ApiError, createDebts, fetchPeople } from "../api";
import { useData, useLoad } from "../data";
import {
  SPLIT_MODES,
  balanceText,
  bookingLabel,
  cleanName,
  findPerson,
  isSplittable,
  splitCents,
  type SplitMode,
  type SplitResult,
} from "../debts";
import { bookings as bookingCount, dateFormat, eur, parseDate, roundCents, today } from "../format";
import type { NewDebt, Transaction } from "../types";
import PersonInput from "./PersonInput";
import Segmented from "./Segmented";

const PAYERS: ["me" | "other", string][] = [
  ["me", "Ich"],
  ["other", "Jemand anderes"],
];

/** Was mit den bisherigen Einträgen der Buchungen passiert: wegfallen oder bleiben, die neuen kommen dazu */
type Existing = "replace" | "add";

const EXISTING: [Existing, string][] = [
  ["replace", "Ersetzen"],
  ["add", "Ergänzen"],
];

/** Weitere beteiligte Person mit ihrem Anteil, wie eingegeben (Prozent oder Euro) */
interface Row {
  key: number;
  name: string;
  share: string;
}

type Shares = Exclude<SplitResult, { error: string }>;

interface Props {
  /**
   * Buchungen, die aufgeteilt werden: Bezahlt hast du, Betrag und Datum stehen je Buchung fest. Aufgeteilt werden nur
   * Ausgaben, Einnahmen und Umbuchungen bleiben, wie sie sind. Ohne: eine Ausgabe ohne Buchung.
   */
  bookings?: Transaction[];
  /** Vorausgewählte weitere Person, z. B. auf ihrer Seite */
  person?: string;
  /** Nach dem Speichern, mit der Zahl der aufgeteilten Buchungen (ohne Buchung 1) */
  onSaved: (count: number) => void;
  onClose: () => void;
}

const day = (date: string) => dateFormat.format(parseDate(date));

/**
 * Eine Ausgabe oder mehrere Buchungen auf mehrere Personen aufteilen, jede Buchung mit denselben Anteilen. Hast du
 * bezahlt, schuldet dir jede andere Person ihren Anteil. Hat jemand anderes bezahlt (nur ohne Buchung), wird nur dein
 * Anteil bei dieser Person festgehalten: Was sie dir schuldet, sinkt um ihn.
 */
export default function SplitDialog({ bookings, person = "", onSaved, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const { accounts } = useData();
  const people = useLoad(fetchPeople, []);
  const fromBookings = bookings !== undefined;
  // Neueste zuerst, wie in den Listen; die Auswahl kann in beliebiger Reihenfolge entstanden sein
  const targets = (bookings ?? []).filter(isSplittable).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const skipped = (bookings?.length ?? 0) - targets.length;
  const withEntries = targets.filter((b) => b.debts.length > 0);
  const single = targets.length === 1 ? targets[0] : null;
  const [payerIsMe, setPayerIsMe] = useState(true);
  const [payer, setPayer] = useState("");
  const [totalText, setTotalText] = useState(single ? String(single.amount) : "");
  const [date, setDate] = useState(single?.date ?? today());
  // Haben alle Buchungen denselben Text, steht er als Grund da; leer bekommt jede Buchung ihren eigenen
  const [reason, setReason] = useState(() => {
    const labels = new Set(targets.map(bookingLabel));
    return labels.size === 1 ? [...labels][0] : "";
  });
  const [existing, setExisting] = useState<Existing>("replace");
  const [mode, setMode] = useState<SplitMode>("equal");
  const [payerIncluded, setPayerIncluded] = useState(true);
  const [rows, setRows] = useState<Row[]>([{ key: 0, name: person, share: "" }]);
  const [myShare, setMyShare] = useState(""); // dein Anteil, wenn jemand anderes bezahlt hat
  const nextKey = useRef(1);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => ref.current?.close();

  const list = people.data ?? [];
  const payerName = payerIsMe ? "Ich" : cleanName(payer);
  // Die anderen Beteiligten; hat jemand anderes bezahlt, bist du der erste davon
  const others: (Row & { me?: boolean })[] = payerIsMe ? rows : [{ key: -1, name: "Ich", share: myShare, me: true }, ...rows];
  const inputs = others.map(({ share }) => {
    const value = parseFloat(share);
    return mode === "amount" ? Math.round(value * 100) : value;
  });
  // Aufgeteilt wird jede Buchung für sich, ohne Buchung der eingegebene Betrag
  const totals = fromBookings ? targets.map((b) => Math.round(b.amount * 100)) : [Math.round(parseFloat(totalText) * 100)];
  const results = totals.map((total) => splitCents(total, mode, payerIncluded, mode === "equal" ? others.map(() => 0) : inputs));
  const failedAt = results.findIndex((r) => "error" in r);
  const shares = failedAt < 0 && results.length ? (results as Shares[]) : null;
  // Anteile zusammen über alle Buchungen, in Cent: wer bezahlt hat und je anderem Beteiligten
  const sumOf = (pick: (s: Shares) => number) => (shares ?? []).reduce((sum, s) => sum + pick(s), 0);
  const payerBalance = payerIsMe ? 0 : (findPerson(list, payer)?.balance ?? 0);
  const replaced = existing === "replace" && withEntries.length > 0;

  /** Die Einträge, die das Aufteilen anlegt, oder der Grund, warum es noch nicht geht */
  function entries(): NewDebt[] | string {
    if (fromBookings && !targets.length) return "Keine der Buchungen lässt sich aufteilen.";
    if (!shares) {
      const failure = results[failedAt] as { error: string } | undefined;
      if (!failure) return "";
      return targets.length > 1 ? `Buchung vom ${day(targets[failedAt].date)}: ${failure.error}` : failure.error;
    }
    if (payerIsMe) {
      const names = rows.map((r) => cleanName(r.name));
      if (names.some((name) => !name)) return "Bitte für jede Person einen Namen angeben.";
      if (new Set(names.map((name) => name.toLowerCase())).size < names.length) return "Bitte jede Person nur einmal angeben.";
      const sources = fromBookings
        ? targets.map((b) => ({ date: b.date, reason: reason.trim() || bookingLabel(b), transactionId: b.id }))
        : [{ date, reason: reason.trim(), transactionId: null }];
      const created = sources
        .flatMap((source, k) =>
          names.map((name, i): NewDebt => ({ ...source, person: name, amount: shares[k].others[i] / 100, kind: "debt" })),
        )
        .filter((e) => e.amount > 0);
      return created.length ? created : "Außer dir hat niemand einen Anteil.";
    }
    if (!payerName) return "Bitte angeben, wer bezahlt hat.";
    if (rows.some((r) => cleanName(r.name).toLowerCase() === payerName.toLowerCase())) {
      return `${payerName} hat bezahlt und steht deshalb schon oben.`;
    }
    const mine = shares[0].others[0];
    if (!mine) return "Dein Anteil ist 0,00 €.";
    // Schuldet die Person dir etwas, gleicht dein Anteil das aus, sonst schuldest du ihr den Anteil
    const kind = payerBalance > 0 ? "settlement" : "debt";
    return [{ date, reason: reason.trim(), transactionId: null, person: payerName, amount: -mine / 100, kind }];
  }

  const planned = entries();
  const problem = typeof planned === "string" ? planned : "";

  const updateRow = (key: number, change: Partial<Row>) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...change } : r)));

  // Bekannte Personen zum Anklicken, die zuletzt verwendeten zuerst; wer schon beteiligt ist oder bezahlt hat, fehlt
  const taken = new Set([...rows.map((r) => cleanName(r.name).toLowerCase()), payerIsMe ? "" : payerName.toLowerCase()]);
  const suggestions = list
    .filter((p) => !taken.has(p.name.toLowerCase()))
    .sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? "") || a.name.localeCompare(b.name, "de"));

  /** Trägt eine bekannte Person in die erste leere Zeile ein, ohne leere Zeile in eine neue */
  const pick = (name: string) =>
    setRows((current) => {
      const empty = current.find((r) => !cleanName(r.name));
      return empty
        ? current.map((r) => (r.key === empty.key ? { ...r, name } : r))
        : [...current, { key: nextKey.current++, name, share: "" }];
    });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation(); // nicht an ein umgebendes Formular weitergeben, siehe AccountDialog
    if (typeof planned === "string") {
      setError(planned);
      return;
    }
    setSaving(true);
    try {
      await createDebts(planned, replaced ? withEntries.map((b) => b.id) : []);
      onSaved(fromBookings ? targets.length : 1);
      close();
    } catch (err) {
      setError(err instanceof ApiError && err.body?.error ? err.body.error : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  };

  // Anteil des Zahlenden: der Rest, in Prozent oder Euro wie die Eingaben
  const rest = (() => {
    if (!shares || !payerIncluded) return "–";
    if (mode === "percent") {
      const percent = 100 - inputs.reduce((s, x) => s + x, 0);
      return `${roundCents(percent).toLocaleString("de-DE")} %`;
    }
    return "Rest";
  })();

  /** Je Person, was sie dir aus allen Buchungen schuldet, und aus wie vielen */
  const perPerson = new Map<string, { cents: number; count: number }>();
  if (typeof planned !== "string" && payerIsMe) {
    for (const e of planned) {
      const sum = perPerson.get(e.person) ?? { cents: 0, count: 0 };
      perPerson.set(e.person, { cents: sum.cents + Math.round(e.amount * 100), count: sum.count + 1 });
    }
  }
  const many = targets.length > 1;
  const accountName = (accountId: number) => accounts.find((a) => a.id === accountId)?.name;
  const title = !fromBookings ? "Ausgabe aufteilen" : many ? `${targets.length} Buchungen aufteilen` : "Buchung aufteilen";

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
      <h2 id={`${id}-title`}>{title}</h2>
      {!fromBookings && (
        <p className="hint">
          Für Ausgaben ohne Buchung, z. B. bar bezahlt oder von jemand anderem. Buchungen teilst du auf der Seite
          „Buchungen“ auf: eine über „Bearbeiten“ bei der Buchung, mehrere über die Auswahl.
        </p>
      )}
      {single && (
        <dl className="source">
          <div>
            <dt>Buchung</dt>
            <dd>
              {[day(single.date), accountName(single.accountId), `−${eur.format(single.amount)}`, bookingLabel(single)]
                .filter(Boolean)
                .join(" · ")}
            </dd>
          </div>
        </dl>
      )}
      {many && (
        <details className="split-bookings">
          <summary>
            {targets.length} Ausgaben vom {day(targets[targets.length - 1].date)} bis {day(targets[0].date)}, zusammen{" "}
            {eur.format(totals.reduce((s, t) => s + t, 0) / 100)}
          </summary>
          <ul>
            {targets.map((b) => (
              <li key={b.id}>
                <span>
                  {bookingLabel(b)}
                  <small>
                    {[day(b.date), accountName(b.accountId)].filter(Boolean).join(" · ")}
                    {b.debts.length > 0 && " · hat schon Einträge"}
                  </small>
                </span>
                <span className="amt">−{eur.format(b.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {skipped > 0 && (
        <p className="hint">
          {skipped === 1 ? "Eine ausgewählte Buchung bleibt" : `${skipped} ausgewählte Buchungen bleiben`} unverändert:
          Aufteilen lassen sich nur Ausgaben, keine Einnahmen oder Umbuchungen.
        </p>
      )}
      {error && (
        <p className="errbox" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={handleSubmit}>
        {!fromBookings && (
          <>
            <div className="full">
              <span className="label">Bezahlt hat</span>
              <Segmented
                className="seg"
                label="Bezahlt hat"
                options={PAYERS}
                value={payerIsMe ? "me" : "other"}
                onChange={(value) => setPayerIsMe(value === "me")}
              />
            </div>
            {!payerIsMe && (
              <div className="full">
                <PersonInput
                  id={`${id}-payer`}
                  label="Wer hat bezahlt?"
                  placeholder="Wer hat bezahlt?"
                  value={payer}
                  people={list}
                  onChange={setPayer}
                />
                {payerName && (
                  <small className="hint">
                    Festgehalten wird nur dein Anteil: {balanceText(payerName, payerBalance)}. Was andere {payerName}{" "}
                    schulden, zählt hier nicht.
                  </small>
                )}
              </div>
            )}
          </>
        )}
        {withEntries.length > 0 && (
          <div className="full">
            <span className="label">
              {many
                ? `Bisherige Einträge (${bookingCount(withEntries.length)} ${withEntries.length === 1 ? "hat" : "haben"} schon welche)`
                : "Bisherige Einträge der Buchung"}
            </span>
            <Segmented className="seg" label="Bisherige Einträge" options={EXISTING} value={existing} onChange={setExisting} />
            <small className="hint">
              {existing === "replace"
                ? "Sie werden gelöscht, auch ein Ausgleich, und durch die neue Aufteilung ersetzt."
                : "Sie bleiben, die neuen Anteile kommen dazu. Zusammen dürfen sie den Betrag einer Buchung nicht übersteigen."}
            </small>
          </div>
        )}
        {(!fromBookings || single) && (
          <>
            <div>
              <label htmlFor={`${id}-total`}>Betrag in €</label>
              <input
                id={`${id}-total`}
                type="number"
                step="0.01"
                min="0.01"
                required
                inputMode="decimal"
                readOnly={fromBookings}
                value={totalText}
                onChange={(e) => setTotalText(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor={`${id}-date`}>Datum</label>
              <input
                id={`${id}-date`}
                type="date"
                required
                readOnly={fromBookings}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </>
        )}
        <div className="full">
          <label htmlFor={`${id}-reason`}>Grund</label>
          <input
            id={`${id}-reason`}
            maxLength={100}
            placeholder={fromBookings ? "Leer: der Text der Buchung" : "z. B. Pizza"}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="full">
          <span className="label">Aufteilen</span>
          <Segmented className="seg" label="Aufteilen" options={SPLIT_MODES} value={mode} onChange={setMode} />
          {many && mode !== "equal" && (
            <small className="hint">
              {mode === "percent" ? "Die Prozente" : "Die Beträge"} gelten für jede Buchung, rechts stehen die Summen.
            </small>
          )}
        </div>
        <div className="full">
          <ul className={`shares${mode === "equal" ? " equal" : ""}`} aria-label="Anteile">
            {payerIncluded && (
              <li>
                <span className="who">
                  {payerName || "Wer bezahlt hat"} <small>{payerIsMe ? "habe bezahlt" : "hat bezahlt"}</small>
                </span>
                {mode !== "equal" && <span className="rest">{rest}</span>}
                <span className="amt">{shares ? eur.format(sumOf((s) => s.payer) / 100) : "–"}</span>
                <span />
              </li>
            )}
            {others.map((row, i) => (
              <li key={row.key}>
                {row.me ? (
                  <span className="who">Ich</span>
                ) : (
                  <PersonInput
                    id={`${id}-row-${row.key}`}
                    label={`Name der ${i + 1}. Person`}
                    required={payerIsMe}
                    placeholder={payerIsMe ? "Name" : "Name (optional)"}
                    value={row.name}
                    people={list}
                    onChange={(name) => updateRow(row.key, { name })}
                  />
                )}
                {mode !== "equal" && (
                  <input
                    type="number"
                    min="0"
                    step={mode === "percent" ? "any" : "0.01"}
                    inputMode="decimal"
                    required
                    aria-label={`Anteil von ${row.me ? "mir" : cleanName(row.name) || `Person ${i + 1}`} in ${mode === "percent" ? "Prozent" : "Euro"}`}
                    placeholder={mode === "percent" ? "%" : "€"}
                    value={row.share}
                    onChange={(e) => (row.me ? setMyShare(e.target.value) : updateRow(row.key, { share: e.target.value }))}
                  />
                )}
                <span className="amt">{shares ? eur.format(sumOf((s) => s.others[i]) / 100) : "–"}</span>
                {row.me || rows.length === 1 ? (
                  <span />
                ) : (
                  <button
                    type="button"
                    className="del"
                    aria-label={`${cleanName(row.name) || "Person"} entfernen`}
                    onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="ghost small"
            onClick={() => setRows((current) => [...current, { key: nextKey.current++, name: "", share: "" }])}
          >
            + Person
          </button>
          {suggestions.length > 0 && (
            <div className="picks">
              <span className="label" id={`${id}-picks`}>
                Bekannte Personen
              </span>
              <div className="chips" role="group" aria-labelledby={`${id}-picks`}>
                {suggestions.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="chip"
                    aria-label={`${p.name} hinzufügen`}
                    onClick={() => pick(p.name)}
                  >
                    + {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={payerIncluded} onChange={(e) => setPayerIncluded(e.target.checked)} />
            {payerIsMe ? "Ich bin selbst beteiligt" : `${payerName || "Wer bezahlt hat"} ist selbst beteiligt`}
          </label>
          <small className="hint">Rundungscents trägt, wer bezahlt hat.</small>
        </div>
        <div className="full" role="status">
          {problem ? (
            (fromBookings || totalText) && <p className="hint">{problem}</p>
          ) : (
            <ul className="split-result">
              {payerIsMe
                ? [...perPerson].map(([name, { cents, count }]) => {
                    const before = findPerson(list, name)?.balance ?? 0;
                    // Der Stand danach ist nur sicher, wenn keine bisherigen Einträge wegfallen
                    const after = !replaced && roundCents(before) !== 0;
                    return (
                      <li key={name}>
                        {name} schuldet dir {eur.format(cents / 100)}
                        {many && ` aus ${bookingCount(count)}`}
                        {after && `. Danach: ${balanceText(name, before + cents / 100)}`}
                      </li>
                    );
                  })
                : typeof planned !== "string" &&
                  planned.map((e) => (
                    <li key={e.person}>
                      Dein Anteil: {eur.format(Math.abs(e.amount))}. Danach: {balanceText(e.person, payerBalance + e.amount)}
                    </li>
                  ))}
              {payerIsMe && shares && payerIncluded && (
                <li>
                  {many ? "Dein Anteil zusammen" : "Dein Anteil"}: {eur.format(sumOf((s) => s.payer) / 100)}
                </li>
              )}
            </ul>
          )}
        </div>
        <div className="full actions">
          <button className="add" type="submit" disabled={saving || !!problem}>
            {saving ? "Wird gespeichert …" : "Aufteilen"}
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
