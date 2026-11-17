import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ApiError, createDebts, fetchPeople, updateDebt } from "../api";
import { useData, useLoad } from "../data";
import { balanceText, bookingLabel, cleanName, findPerson } from "../debts";
import { dateFormat, eur, parseDate, roundCents, today } from "../format";
import type { Debt, DebtBooking, DebtKind } from "../types";
import PersonInput from "./PersonInput";
import Segmented from "./Segmented";
import SettlePicker, { type SettleMode } from "./SettlePicker";

const KINDS: [DebtKind, string][] = [
  ["debt", "Schuld"],
  ["settlement", "Ausgleich"],
];

/** Richtung eines Eintrags: 1 erhöht, was die Person dir schuldet (bzw. senkt deine Schulden), −1 umgekehrt */
type Sign = 1 | -1;

interface Props {
  /** Vorhandener Eintrag zum Bearbeiten; ohne wird ein neuer angelegt */
  entry?: Debt;
  /** Art eines neuen Eintrags */
  kind?: DebtKind;
  /** Vorausgewählte Person eines neuen Eintrags */
  person?: string;
  /** Buchung, zu der ein neuer Eintrag gehört: Datum und Richtung stehen dann fest */
  booking?: DebtBooking;
  /** Vorgeschlagener Betrag eines neuen Eintrags, z. B. was von der Buchung noch nicht verrechnet ist */
  amount?: number;
  onSaved: () => void;
  onClose: () => void;
}

/** Schuld oder Ausgleich frei eintragen, zu einer Buchung festhalten oder einen Eintrag bearbeiten */
export default function DebtDialog({ entry, kind: initialKind = "debt", person = "", booking, amount, onSaved, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const { accounts } = useData();
  const people = useLoad(fetchPeople, []);
  const linked = entry ? entry.transaction : (booking ?? null);
  // Geld, das du ausgibst, erhöht, was andere dir schulden; Geld, das du bekommst, senkt es
  const fixedSign: Sign | null = linked ? (linked.type === "out" ? 1 : -1) : null;
  const [kind, setKind] = useState<DebtKind>(entry?.kind ?? initialKind);
  const [name, setName] = useState(entry?.person ?? person);
  const [chosenSign, setChosenSign] = useState<Sign | null>(entry ? (entry.amount > 0 ? 1 : -1) : fixedSign);
  const [date, setDate] = useState(entry?.date ?? booking?.date ?? today());
  const [amountText, setAmountText] = useState(() => {
    const initial = entry ? Math.abs(entry.amount) : amount;
    return initial ? String(roundCents(initial)) : "";
  });
  const [reason, setReason] = useState(entry?.reason ?? (booking ? bookingLabel(booking) : ""));
  // Ein neuer Ausgleich kann bestimmte Schulden begleichen (siehe SettlePicker)
  const [settleMode, setSettleMode] = useState<SettleMode>("total");
  const [picked, setPicked] = useState<Debt[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => ref.current?.close();

  const who = cleanName(name) || "Person";
  const known = findPerson(people.data ?? [], name);
  // Stand ohne diesen Eintrag, beim Bearbeiten also ohne seinen bisherigen Betrag
  const before = (known?.balance ?? 0) - (entry && known?.id === entry.personId ? entry.amount : 0);
  // Ein Ausgleich ohne Wahl der Richtung senkt den Stand, der gerade offen ist
  const sign: Sign = chosenSign ?? (kind === "settlement" && before >= 0 ? -1 : 1);
  const cents = Math.round(parseFloat(amountText) * 100);
  const valid = cents > 0;
  const after = before + (valid ? (sign * cents) / 100 : 0);
  const open = roundCents(Math.abs(before));
  // Den offenen Betrag vorschlagen, wenn der Ausgleich in seine Richtung geht, höchstens so viel wie die Buchung zulässt
  const suggested = kind === "settlement" && open > 0 && sign === -Math.sign(before) ? Math.min(open, amount ?? open) : 0;

  const directions: [Sign, string][] =
    kind === "debt"
      ? [
          [1, `${who} schuldet mir`],
          [-1, `Ich schulde ${who}`],
        ]
      : [
          [-1, `${who} zahlt mir zurück`],
          [1, `Ich zahle ${who} zurück`],
        ];

  // Bestimmte Schulden begleichen lässt sich nur beim Anlegen eines Ausgleichs mit einer bekannten Person
  const settling = !entry && kind === "settlement" && !!known;
  const settles = settling && settleMode === "items" ? picked.map((d) => d.id) : [];

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation(); // nicht an ein umgebendes Formular weitergeben, siehe AccountDialog
    const personName = cleanName(name);
    if (!valid || !personName) return;
    if (settling && settleMode === "items" && !settles.length) {
      setError("Bitte mindestens eine Schuld auswählen.");
      return;
    }
    const values = { person: personName, date, amount: (sign * cents) / 100, kind, reason: reason.trim() };
    setSaving(true);
    try {
      if (entry) await updateDebt(entry.id, values);
      else await createDebts([{ ...values, transactionId: booking?.id ?? null, ...(settles.length ? { settles } : {}) }]);
      onSaved();
      close();
    } catch (err) {
      setError(err instanceof ApiError && err.body?.error ? err.body.error : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  };

  const accountName = linked && accounts.find((a) => a.id === linked.accountId)?.name;
  const title = entry ? "Eintrag bearbeiten" : kind === "debt" ? "Schuld eintragen" : "Ausgleich eintragen";

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
      {linked && (
        <dl className="source">
          <div>
            <dt>Buchung</dt>
            <dd>
              {[
                dateFormat.format(parseDate(linked.date)),
                accountName,
                `${linked.type === "in" ? "+" : "−"}${eur.format(linked.amount)}`,
                bookingLabel(linked),
              ]
                .filter(Boolean)
                .join(" · ")}
            </dd>
          </div>
        </dl>
      )}
      {error && (
        <p className="errbox" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={handleSubmit}>
        <Segmented
          className="full seg"
          label="Art"
          options={KINDS}
          value={kind}
          onChange={(k) => {
            setKind(k);
            // Die Richtungen heißen je Art anders, ohne feste Richtung gilt wieder die Vorauswahl
            if (fixedSign === null) setChosenSign(null);
          }}
        />
        <div className="full">
          <label htmlFor={`${id}-person`}>Person</label>
          <PersonInput id={`${id}-person`} value={name} people={people.data ?? []} onChange={setName} />
          {cleanName(name) && (
            <small className="hint">
              {known ? `Bisher: ${balanceText(known.name, before)}` : "Neue Person, wird beim Speichern angelegt."}
            </small>
          )}
        </div>
        <Segmented
          className="full seg"
          label="Richtung"
          options={directions}
          value={sign}
          isDisabled={(option) => fixedSign !== null && option !== fixedSign}
          onChange={setChosenSign}
        />
        {fixedSign !== null && (
          <small className="hint full">
            {fixedSign === 1
              ? "Bei einer Abbuchung geht Geld von dir an andere: Sie schulden dir danach mehr oder du ihnen weniger."
              : "Bei einer Gutschrift bekommst du Geld: Andere schulden dir danach weniger oder du ihnen mehr."}
          </small>
        )}
        <div>
          <label htmlFor={`${id}-amount`}>Betrag in €</label>
          <input
            id={`${id}-amount`}
            type="number"
            step="0.01"
            min="0.01"
            required
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${id}-date`}>Datum</label>
          <input
            id={`${id}-date`}
            type="date"
            required
            readOnly={linked !== null}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        {suggested > 0 && roundCents(suggested) !== roundCents(cents / 100) && (
          <small className="hint full">
            <button type="button" className="link" onClick={() => setAmountText(String(suggested))}>
              {eur.format(suggested)} übernehmen
            </button>
            {suggested < open ? " (so viel lässt die Buchung zu)" : " (der ganze offene Betrag)"}
          </small>
        )}
        {settling && (
          <SettlePicker
            id={id}
            person={known}
            direction={sign}
            paidCents={valid ? cents : 0}
            mode={settleMode}
            onModeChange={setSettleMode}
            picked={picked}
            onPick={setPicked}
          />
        )}
        <div className="full">
          <label htmlFor={`${id}-reason`}>Grund</label>
          <input
            id={`${id}-reason`}
            maxLength={100}
            placeholder={kind === "debt" ? "z. B. Konzertkarten" : "z. B. Überweisung"}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        {cleanName(name) && valid && (
          <p className="hint full" role="status">
            Danach: {balanceText(known?.name ?? who, after)}
          </p>
        )}
        <div className="full actions">
          <button className="add" type="submit" disabled={saving}>
            {saving ? "Wird gespeichert …" : entry ? "Änderungen speichern" : "Speichern"}
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
