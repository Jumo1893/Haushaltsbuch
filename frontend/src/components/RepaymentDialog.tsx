import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ApiError, createDebts, fetchPeople } from "../api";
import { useData, useLoad } from "../data";
import {
  allocate,
  balanceText,
  bookingLabel,
  cleanName,
  findPerson,
  isRepayable,
  openAmount,
  openCents,
  personInText,
  usedOf,
} from "../debts";
import { bookings as bookingCount, dateFormat, eur, parseDate, roundCents } from "../format";
import type { Debt, NewDebt, Transaction } from "../types";
import PersonInput from "./PersonInput";
import Segmented from "./Segmented";
import SettlePicker, { type SettleMode } from "./SettlePicker";

/** Was mit den bisherigen Einträgen der Buchungen passiert: wegfallen oder bleiben, die neuen kommen dazu */
type Existing = "replace" | "add";

const EXISTING: [Existing, string][] = [
  ["replace", "Ersetzen"],
  ["add", "Ergänzen"],
];

interface Props {
  /** Einnahmen, mit denen jemand Schulden zurückzahlt; Ausgaben und Umbuchungen bleiben, wie sie sind */
  bookings: Transaction[];
  /** Nach dem Speichern, mit der Zahl der verrechneten Buchungen */
  onSaved: (count: number) => void;
  onClose: () => void;
}

const day = (date: string) => dateFormat.format(parseDate(date));
const cents = (amount: number) => Math.round(amount * 100);
/** Was von einer Buchung schon mit Schulden verrechnet ist, in Cent */
const usedCents = (b: Transaction) => b.debts.reduce((sum, d) => sum + cents(Math.abs(d.amount)), 0);
const bookingText = (b: Transaction) => [b.counterparty, b.purpose, b.note].join(" ");

/**
 * Eine oder mehrere Einnahmen als Tilgung verrechnen: Was die Person gezahlt hat, senkt, was sie dir schuldet. Wahlweise
 * gelten bestimmte Schulden danach als beglichen, z. B. alte Rechnungen; bei mehreren Zahlungen die ältesten Schulden
 * mit den ältesten Zahlungen. Die Differenz zum gezahlten Betrag steht nur zur Information da.
 */
export default function RepaymentDialog({ bookings, onSaved, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const { accounts } = useData();
  const people = useLoad(fetchPeople, []);
  // Älteste zuerst, so werden beglichene Schulden den Zahlungen zugeordnet
  const targets = bookings.filter(isRepayable).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const skipped = bookings.length - targets.length;
  const withEntries = targets.filter((b) => b.debts.length > 0);
  const single = targets.length === 1 ? targets[0] : null;
  const [existing, setExisting] = useState<Existing>("replace");
  /** Was von einer Buchung verrechnet werden kann, in Cent: ersetzt alles, ergänzt nur der Rest */
  const maxOf = (b: Transaction, mode: Existing = existing) => cents(b.amount) - (mode === "replace" ? 0 : usedCents(b));
  const [name, setName] = useState("");
  const [amountText, setAmountText] = useState(() => (single ? String(maxOf(single) / 100) : ""));
  const [reason, setReason] = useState("Rückzahlung");
  const [mode, setMode] = useState<SettleMode>("total");
  const [picked, setPicked] = useState<Debt[]>([]);
  const guessed = useRef(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // Nennen die Buchungen genau eine bekannte Person, ist sie vorausgewählt
  useEffect(() => {
    if (guessed.current || !people.data) return;
    guessed.current = true;
    const hits = new Set(targets.map((b) => personInText(people.data ?? [], bookingText(b))?.name).filter(Boolean));
    if (hits.size === 1) setName((current) => current || [...hits][0]!);
  }, [people.data]);

  const close = () => ref.current?.close();

  const list = people.data ?? [];
  const person = findPerson(list, name);
  const who = person?.name ?? cleanName(name);
  const before = person?.balance ?? 0;
  // Die Zahlungen: eine Buchung mit dem eingegebenen Betrag, mehrere mit allem, was von ihnen noch übrig ist
  const payments = single
    ? [{ booking: single, cents: Math.round(parseFloat(amountText) * 100) }]
    : targets.map((booking) => ({ booking, cents: maxOf(booking) })).filter((p) => p.cents > 0);
  const totalCents = payments.reduce((sum, p) => sum + (p.cents > 0 ? p.cents : 0), 0);
  const exhausted = single ? 0 : targets.length - payments.length;
  // Bei bestimmten Schulden zählt höchstens ihre Summe, die Zahlungen der Reihe nach; der Überschuss bleibt außen vor
  const settled = [...picked].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const amounts = payments.map((p) => Math.max(p.cents, 0));
  const used = mode === "items" ? usedOf(amounts, openCents(settled)) : amounts;
  const countedCents = used.reduce((sum, c) => sum + c, 0);
  // Ersetzte Einträge derselben Person fallen aus ihrem Stand heraus
  const replacedCents =
    existing === "replace" && person
      ? withEntries
          .flatMap((b) => b.debts)
          .filter((d) => d.personId === person.id)
          .reduce((sum, d) => sum + cents(d.amount), 0)
      : 0;

  const problem = !targets.length
    ? "Keine der Buchungen ist eine Einnahme."
    : !who
      ? "Bitte angeben, wer zurückgezahlt hat."
      : single && !(payments[0].cents > 0)
        ? "Bitte den Betrag angeben."
        : single && payments[0].cents > maxOf(single)
          ? `Höchstens ${eur.format(maxOf(single) / 100)}, mehr ist von der Buchung nicht übrig.`
          : !payments.length
            ? "Von den Buchungen ist nichts mehr übrig."
            : mode === "items" && !picked.length
              ? "Bitte mindestens eine Schuld auswählen."
              : "";

  const changeExisting = (value: Existing) => {
    setExisting(value);
    // Bei einer Buchung passt der vorgeschlagene Betrag zu dem, was jetzt verrechnet werden kann
    if (single) setAmountText(String(maxOf(single, value) / 100));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation(); // nicht an ein umgebendes Formular weitergeben, siehe AccountDialog
    if (problem) {
      setError(problem);
      return;
    }
    // Ausgewählte Schulden, älteste zuerst, je Zahlung; Zahlungen ohne verrechneten Betrag bleiben normale Einnahmen.
    // Bei bestimmten Schulden begleicht jede verrechnete Zahlung nur diese, auch ohne eigene (siehe settles im Backend).
    const owner = mode === "items" ? allocate(used, settled.map((d) => Math.round(openAmount(d) * 100))) : [];
    const entries = payments.flatMap(({ booking }, k): NewDebt[] => {
      if (used[k] <= 0) return [];
      const settles = settled.filter((_, i) => owner[i] === k).map((d) => d.id);
      return [
        {
          person: who,
          date: booking.date,
          amount: -used[k] / 100,
          kind: "settlement",
          reason: reason.trim(),
          transactionId: booking.id,
          ...(mode === "items" ? { settles } : {}),
        },
      ];
    });
    setSaving(true);
    try {
      await createDebts(entries, existing === "replace" ? withEntries.map((b) => b.id) : []);
      onSaved(entries.length);
      close();
    } catch (err) {
      setError(err instanceof ApiError && err.body?.error ? err.body.error : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  };

  // Wer dir etwas schuldet, zum Anklicken, die größten Beträge zuerst
  const debtors = list
    .filter((p) => roundCents(p.balance) > 0 && p.id !== person?.id)
    .sort((a, b) => b.balance - a.balance);
  const accountName = (accountId: number) => accounts.find((a) => a.id === accountId)?.name;
  const many = targets.length > 1;

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
      <h2 id={`${id}-title`}>{many ? `${targets.length} Einnahmen als Tilgung verrechnen` : "Als Tilgung verrechnen"}</h2>
      {single && (
        <dl className="source">
          <div>
            <dt>Buchung</dt>
            <dd>
              {[day(single.date), accountName(single.accountId), `+${eur.format(single.amount)}`, bookingLabel(single)]
                .filter(Boolean)
                .join(" · ")}
            </dd>
          </div>
        </dl>
      )}
      {many && (
        <details className="split-bookings">
          <summary>
            {targets.length} Einnahmen vom {day(targets[0].date)} bis {day(targets[targets.length - 1].date)}, verrechnet
            werden {eur.format(countedCents / 100)}
          </summary>
          <ul>
            {[...targets].reverse().map((b) => (
              <li key={b.id}>
                <span>
                  {bookingLabel(b)}
                  <small>
                    {[day(b.date), accountName(b.accountId)].filter(Boolean).join(" · ")}
                    {b.debts.length > 0 && " · hat schon Einträge"}
                  </small>
                </span>
                <span className="amt">+{eur.format(b.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {skipped > 0 && (
        <p className="hint">
          {skipped === 1 ? "Eine ausgewählte Buchung bleibt" : `${skipped} ausgewählte Buchungen bleiben`} unverändert:
          Als Tilgung lassen sich nur Einnahmen verrechnen, keine Ausgaben oder Umbuchungen.
        </p>
      )}
      {exhausted > 0 && (
        <p className="hint">
          {exhausted === 1 ? "Eine Einnahme ist" : `${exhausted} Einnahmen sind`} schon ganz mit Schulden verrechnet und
          {exhausted === 1 ? " bleibt" : " bleiben"}, wie sie {exhausted === 1 ? "ist" : "sind"}.
        </p>
      )}
      {error && (
        <p className="errbox" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={handleSubmit}>
        <div className="full">
          <label htmlFor={`${id}-person`}>Wer hat zurückgezahlt?</label>
          <PersonInput id={`${id}-person`} value={name} people={list} onChange={setName} />
          {who && (
            <small className="hint">
              {person ? `Bisher: ${balanceText(person.name, before)}` : "Neue Person, wird beim Speichern angelegt."}
            </small>
          )}
          {debtors.length > 0 && (
            <div className="picks">
              <span className="label" id={`${id}-debtors`}>
                Schulden bei dir
              </span>
              <div className="chips" role="group" aria-labelledby={`${id}-debtors`}>
                {debtors.map((p) => (
                  <button key={p.id} type="button" className="chip" onClick={() => setName(p.name)}>
                    {p.name} · {eur.format(p.balance)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {withEntries.length > 0 && (
          <div className="full">
            <span className="label">
              {many
                ? `Bisherige Einträge (${bookingCount(withEntries.length)} ${withEntries.length === 1 ? "hat" : "haben"} schon welche)`
                : "Bisherige Einträge der Buchung"}
            </span>
            <Segmented className="seg" label="Bisherige Einträge" options={EXISTING} value={existing} onChange={changeExisting} />
            <small className="hint">
              {existing === "replace"
                ? "Sie werden gelöscht und durch die Tilgung ersetzt. Schulden, die sie beglichen haben, sind dann wieder offen."
                : "Sie bleiben, verrechnet wird nur, was von der Buchung noch übrig ist."}
            </small>
          </div>
        )}
        {single && (
          <>
            <div>
              <label htmlFor={`${id}-amount`}>Zurückgezahlt in €</label>
              <input
                id={`${id}-amount`}
                type="number"
                step="0.01"
                min="0.01"
                max={maxOf(single) / 100}
                required
                inputMode="decimal"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor={`${id}-date`}>Datum</label>
              <input id={`${id}-date`} type="date" readOnly value={single.date} />
            </div>
          </>
        )}
        <SettlePicker
          id={id}
          person={person}
          direction={-1}
          paidCents={totalCents}
          mode={mode}
          onModeChange={setMode}
          picked={picked}
          onPick={setPicked}
        />
        {many && mode === "items" && picked.length > 0 && (
          <small className="hint full">
            Die ältesten ausgewählten Schulden gelten mit den ältesten Zahlungen als beglichen.
          </small>
        )}
        <div className="full">
          <label htmlFor={`${id}-reason`}>Grund</label>
          <input id={`${id}-reason`} maxLength={100} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {who && totalCents > 0 && !problem.startsWith("Höchstens") && (
          <p className="hint full" role="status">
            Danach: {balanceText(who, before - (replacedCents + countedCents) / 100)}
          </p>
        )}
        <div className="full actions">
          <button className="add" type="submit" disabled={saving || !!problem}>
            {saving ? "Wird gespeichert …" : "Verrechnen"}
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
