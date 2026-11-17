import { useState } from "react";
import { ApiError, deleteDebt, deletePerson, fetchDebts, fetchPeople, renamePerson } from "../api";
import DebtDialog from "../components/DebtDialog";
import DebtList from "../components/DebtList";
import PersonDialog from "../components/PersonDialog";
import Segmented from "../components/Segmented";
import SplitDialog from "../components/SplitDialog";
import { OFFLINE, useData, useLoad } from "../data";
import { isUnsettled, openAmount } from "../debts";
import { eur, money, roundCents } from "../format";
import { Link, navigate, useLocation, useTitle } from "../router";
import type { Debt, DebtKind } from "../types";

/** Welche Einträge die Liste zeigt */
type View = "all" | "open";

/** Schulden mit einer Person: Stand, Einträge, neue Schulden und Ausgleich */
export default function PersonPage({ id }: { id: number }) {
  const { refresh } = useData();
  const people = useLoad(fetchPeople, []);
  const entries = useLoad(() => fetchDebts({ person: id }), [id]);
  const [dialog, setDialog] = useState<DebtKind | "split" | "rename" | Debt | null>(null);
  const [error, setError] = useState("");
  const person = people.data?.find((p) => p.id === id);
  useTitle(person?.name ?? "Schulden");
  // Alle Einträge oder nur die offenen Schulden; die Wahl steht in der Adresse (?ansicht=offen)
  const { query } = useLocation();
  const view: View = query.get("ansicht") === "offen" ? "open" : "all";
  const setView = (next: View) => navigate(next === "open" ? `/schulden/${id}?ansicht=offen` : `/schulden/${id}`, { replace: true });

  if (!people.data) {
    return people.failed ? (
      <p className="errbox" role="alert">
        {OFFLINE}
      </p>
    ) : null;
  }
  if (!person) {
    return (
      <>
        <div className="page-head">
          <h1>Person nicht gefunden</h1>
        </div>
        <p>
          Diese Person gibt es nicht (mehr). <Link to="/schulden">Zu den Schulden</Link>
        </p>
      </>
    );
  }

  const balance = roundCents(person.balance);
  const close = () => setDialog(null);
  const all = entries.data ?? [];
  // Offen: Schulden in beide Richtungen, von denen noch etwas nicht getilgt ist, teilweise getilgte mit dem Rest
  const open = all.filter(isUnsettled);
  const shown = view === "open" ? open : all;
  const theirs = roundCents(open.filter((d) => d.amount > 0).reduce((sum, d) => sum + openAmount(d), 0));
  const mine = roundCents(open.filter((d) => d.amount < 0).reduce((sum, d) => sum + openAmount(d), 0));
  // Summe der offenen Schulden je Richtung; weicht sie vom Stand ab, sagt der Text warum
  const sums = [
    theirs > 0 && `${person.name} schuldet dir daraus ${eur.format(theirs)}`,
    mine > 0 && `${theirs > 0 ? "du" : "Du"} schuldest ${person.name} daraus ${eur.format(mine)}`,
  ].filter(Boolean);
  const openText = [
    `${sums.join(", ")}.`,
    roundCents(theirs - mine) !== balance &&
      "Der Stand weicht davon ab: Beim Begleichen bestimmter Schulden gelten sie ganz als beglichen, auch wenn mehr " +
        "oder weniger gezahlt wurde, und was über alle offenen Schulden hinaus gezahlt wurde, tilgt keine Schuld.",
  ]
    .filter(Boolean)
    .join(" ");

  const remove = async () => {
    const what = person.entryCount
      ? `mit ${person.entryCount === 1 ? "ihrem Eintrag" : `allen ${person.entryCount} Einträgen`} löschen`
      : "löschen";
    if (!window.confirm(`„${person.name}“ ${what}? Das lässt sich nicht rückgängig machen.`)) return;
    try {
      await deletePerson(id);
      refresh();
      navigate("/schulden");
    } catch (e) {
      setError(e instanceof ApiError && e.body?.error ? e.body.error : "Löschen fehlgeschlagen.");
    }
  };

  const removeEntry = async (entry: Debt) => {
    try {
      await deleteDebt(entry.id);
      setError("");
      refresh();
    } catch {
      setError("Löschen fehlgeschlagen.");
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <Link className="crumb" to="/schulden">
            ‹ Schulden
          </Link>
          <h1>{person.name}</h1>
        </div>
        <div className="head-actions">
          <button className="ghost" onClick={() => setDialog("rename")}>
            Umbenennen
          </button>
          <button className="ghost danger" onClick={remove}>
            Person löschen
          </button>
        </div>
      </div>
      {(error || entries.failed) && (
        <p className="errbox" role="alert">
          {error || OFFLINE}
        </p>
      )}

      <div className="grid top-row">
        <div className="balance hero">
          <small>{balance > 0 ? `${person.name} schuldet dir` : balance < 0 ? `Du schuldest ${person.name}` : "Ausgeglichen"}</small>
          <strong>{money(Math.abs(balance))}</strong>
          <span className="delta">
            {person.entryCount} {person.entryCount === 1 ? "Eintrag" : "Einträge"}
          </span>
          <div className="hero-actions">
            <button className="on-accent" onClick={() => setDialog("debt")}>
              Schuld eintragen
            </button>
            <button className="on-accent" onClick={() => setDialog("settlement")}>
              Ausgleich eintragen
            </button>
            <button className="on-accent" onClick={() => setDialog("split")}>
              Ausgabe aufteilen
            </button>
          </div>
        </div>
        <section>
          <h2>So funktioniert der Stand</h2>
          <p className="hint">
            Jeder Eintrag ändert, was {person.name} dir schuldet: Ein Plus erhöht es (oder senkt, was du {person.name}{" "}
            schuldest), ein Minus senkt es. Eine Schuld und ihr Ausgleich zählen dabei gleich, die Art dient nur der
            Übersicht.
          </p>
          <p className="hint">
            Einträge zu einer Buchung entstehen beim Bearbeiten der Buchung unter „Schulden“. Wird die Buchung gelöscht,
            bleibt der Eintrag ohne Buchung stehen.
          </p>
        </section>
      </div>

      <section className={entries.loading ? "stale" : undefined}>
        <div className="section-head">
          <h2>{view === "open" ? "Offene Schulden" : "Einträge"}</h2>
          <Segmented
            label="Anzeigen"
            options={[
              ["all", entries.data ? `Alle (${all.length})` : "Alle"],
              ["open", entries.data ? `Offene Schulden (${open.length})` : "Offene Schulden"],
            ]}
            value={view}
            onChange={setView}
          />
        </div>
        {view === "open" && entries.data && open.length > 0 && (
          <p className="hint open-sum">{openText}</p>
        )}
        {entries.data &&
          (shown.length ? (
            <DebtList items={shown} onEdit={setDialog} onDelete={removeEntry} />
          ) : (
            <p className="empty">{view === "open" ? "Keine offenen Schulden." : "Keine Einträge."}</p>
          ))}
      </section>

      {(dialog === "debt" || dialog === "settlement") && (
        <DebtDialog kind={dialog} person={person.name} onSaved={refresh} onClose={close} />
      )}
      {dialog === "split" && <SplitDialog person={person.name} onSaved={refresh} onClose={close} />}
      {dialog === "rename" && (
        <PersonDialog
          person={person}
          onSave={async (name) => {
            await renamePerson(id, name);
            refresh();
          }}
          onClose={close}
        />
      )}
      {typeof dialog === "object" && dialog !== null && <DebtDialog entry={dialog} onSaved={refresh} onClose={close} />}
    </>
  );
}
