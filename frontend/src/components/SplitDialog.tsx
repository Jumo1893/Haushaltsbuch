import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ApiError, createDebts, fetchPeople } from "../api";
import { useData, useLoad } from "../data";
import { SPLIT_MODES, balanceText, bookingLabel, cleanName, findPerson, splitCents, type SplitMode } from "../debts";
import { dateFormat, eur, parseDate, roundCents, today } from "../format";
import type { DebtBooking, NewDebt } from "../types";
import PersonInput from "./PersonInput";
import Segmented from "./Segmented";

const PAYERS: ["me" | "other", string][] = [
  ["me", "Ich"],
  ["other", "Jemand anderes"],
];

/** Weitere beteiligte Person mit ihrem Anteil, wie eingegeben (Prozent oder Euro) */
interface Row {
  key: number;
  name: string;
  share: string;
}

interface Props {
  /** Abbuchung, die aufgeteilt wird: Betrag und Datum stehen dann fest, bezahlt hast du */
  booking?: DebtBooking;
  /** Was von der Buchung noch nicht mit Schulden verrechnet ist */
  available?: number;
  /** Vorausgewählte weitere Person, z. B. auf ihrer Seite */
  person?: string;
  onSaved: () => void;
  onClose: () => void;
}

/**
 * Eine Ausgabe auf mehrere Personen aufteilen. Hast du bezahlt, schuldet dir jede andere Person ihren Anteil. Hat
 * jemand anderes bezahlt, wird nur dein Anteil bei dieser Person festgehalten: Was sie dir schuldet, sinkt um ihn.
 */
export default function SplitDialog({ booking, available, person = "", onSaved, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const { accounts } = useData();
  const people = useLoad(fetchPeople, []);
  const [payerIsMe, setPayerIsMe] = useState(true);
  const [payer, setPayer] = useState("");
  const [totalText, setTotalText] = useState(booking ? String(booking.amount) : "");
  const [date, setDate] = useState(booking?.date ?? today());
  const [reason, setReason] = useState(booking ? bookingLabel(booking) : "");
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
  const total = Math.round(parseFloat(totalText) * 100);
  // Die anderen Beteiligten; hat jemand anderes bezahlt, bist du der erste davon
  const others: (Row & { me?: boolean })[] = payerIsMe ? rows : [{ key: -1, name: "Ich", share: myShare, me: true }, ...rows];
  const inputs = others.map(({ share }) => {
    const value = parseFloat(share);
    return mode === "amount" ? Math.round(value * 100) : value;
  });
  const result = splitCents(total, mode, payerIncluded, mode === "equal" ? others.map(() => 0) : inputs);
  const shares = "error" in result ? null : result;
  const payerBalance = payerIsMe ? 0 : (findPerson(list, payer)?.balance ?? 0);

  /** Die Einträge, die das Aufteilen anlegt, oder der Grund, warum es noch nicht geht */
  function entries(): NewDebt[] | string {
    if (!shares) return "error" in result ? result.error : "";
    const common = { date, reason: reason.trim(), transactionId: booking?.id ?? null };
    if (payerIsMe) {
      const names = rows.map((r) => cleanName(r.name));
      if (names.some((name) => !name)) return "Bitte für jede Person einen Namen angeben.";
      if (new Set(names.map((name) => name.toLowerCase())).size < names.length) return "Bitte jede Person nur einmal angeben.";
      const created = names
        .map((person, i): NewDebt => ({ ...common, person, amount: shares.others[i] / 100, kind: "debt" }))
        .filter((e) => e.amount > 0);
      return created.length ? created : "Außer dir hat niemand einen Anteil.";
    }
    if (!payerName) return "Bitte angeben, wer bezahlt hat.";
    if (rows.some((r) => cleanName(r.name).toLowerCase() === payerName.toLowerCase())) {
      return `${payerName} hat bezahlt und steht deshalb schon oben.`;
    }
    const mine = shares.others[0];
    if (!mine) return "Dein Anteil ist 0,00 €.";
    // Schuldet die Person dir etwas, gleicht dein Anteil das aus, sonst schuldest du ihr den Anteil
    const kind = payerBalance > 0 ? "settlement" : "debt";
    return [{ ...common, person: payerName, amount: -mine / 100, kind }];
  }

  const planned = entries();
  const problem = typeof planned === "string" ? planned : "";

  const updateRow = (key: number, change: Partial<Row>) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation(); // nicht an ein umgebendes Formular weitergeben, siehe AccountDialog
    if (typeof planned === "string") {
      setError(planned);
      return;
    }
    setSaving(true);
    try {
      await createDebts(planned);
      onSaved();
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
  const accountName = booking && accounts.find((a) => a.id === booking.accountId)?.name;
  const mine = shares ? (payerIsMe ? shares.payer : shares.others[0]) : null;

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
      <h2 id={`${id}-title`}>{booking ? "Buchung aufteilen" : "Ausgabe aufteilen"}</h2>
      {booking ? (
        <dl className="source">
          <div>
            <dt>Buchung</dt>
            <dd>
              {[dateFormat.format(parseDate(booking.date)), accountName, `−${eur.format(booking.amount)}`, bookingLabel(booking)]
                .filter(Boolean)
                .join(" · ")}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="hint">
          Für Ausgaben ohne Buchung, z. B. bar bezahlt oder von jemand anderem. Eine Buchung teilst du über „Bearbeiten“ bei
          der Buchung auf.
        </p>
      )}
      {available !== undefined && booking && available < booking.amount && (
        <p className="hint">
          Davon sind schon {eur.format(roundCents(booking.amount - available))} mit Schulden verrechnet, aufteilen lassen
          sich noch {eur.format(available)}.
        </p>
      )}
      {error && (
        <p className="errbox" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={handleSubmit}>
        {!booking && (
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
        <div>
          <label htmlFor={`${id}-total`}>Betrag in €</label>
          <input
            id={`${id}-total`}
            type="number"
            step="0.01"
            min="0.01"
            required
            inputMode="decimal"
            readOnly={!!booking}
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
            readOnly={!!booking}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="full">
          <label htmlFor={`${id}-reason`}>Grund</label>
          <input
            id={`${id}-reason`}
            maxLength={100}
            placeholder="z. B. Pizza"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="full">
          <span className="label">Aufteilen</span>
          <Segmented className="seg" label="Aufteilen" options={SPLIT_MODES} value={mode} onChange={setMode} />
        </div>
        <div className="full">
          <ul className={`shares${mode === "equal" ? " equal" : ""}`} aria-label="Anteile">
            {payerIncluded && (
              <li>
                <span className="who">
                  {payerName || "Wer bezahlt hat"} <small>{payerIsMe ? "habe bezahlt" : "hat bezahlt"}</small>
                </span>
                {mode !== "equal" && <span className="rest">{rest}</span>}
                <span className="amt">{shares ? eur.format(shares.payer / 100) : "–"}</span>
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
                <span className="amt">{shares ? eur.format(shares.others[i] / 100) : "–"}</span>
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
          <label className="check">
            <input type="checkbox" checked={payerIncluded} onChange={(e) => setPayerIncluded(e.target.checked)} />
            {payerIsMe ? "Ich bin selbst beteiligt" : `${payerName || "Wer bezahlt hat"} ist selbst beteiligt`}
          </label>
          <small className="hint">Rundungscents trägt, wer bezahlt hat.</small>
        </div>
        <div className="full" role="status">
          {problem ? (
            totalText && <p className="hint">{problem}</p>
          ) : (
            <ul className="split-result">
              {typeof planned !== "string" &&
                (payerIsMe
                  ? planned.map((e) => {
                      const before = findPerson(list, e.person)?.balance ?? 0;
                      return (
                        <li key={e.person}>
                          {e.person} schuldet dir {eur.format(e.amount)}
                          {roundCents(before) !== 0 && `. Danach: ${balanceText(e.person, before + e.amount)}`}
                        </li>
                      );
                    })
                  : planned.map((e) => (
                      <li key={e.person}>
                        Dein Anteil: {eur.format(Math.abs(e.amount))}. Danach: {balanceText(e.person, payerBalance + e.amount)}
                      </li>
                    )))}
              {payerIsMe && mine !== null && payerIncluded && <li>Dein Anteil: {eur.format(mine / 100)}</li>}
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
