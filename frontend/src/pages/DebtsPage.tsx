import { useState } from "react";
import { fetchPeople } from "../api";
import DebtDialog from "../components/DebtDialog";
import SplitDialog from "../components/SplitDialog";
import { OFFLINE, useData, useLoad } from "../data";
import { dateFormat, money, parseDate, roundCents, signed } from "../format";
import { Link, useTitle } from "../router";
import type { DebtKind, Person } from "../types";

/** z. B. „3 Einträge · zuletzt 02.11.2026“ */
const entriesText = (p: Person) =>
  [
    `${p.entryCount} ${p.entryCount === 1 ? "Eintrag" : "Einträge"}`,
    p.lastDate && `zuletzt ${dateFormat.format(parseDate(p.lastDate))}`,
  ]
    .filter(Boolean)
    .join(" · ");

function PersonRows({ people }: { people: Person[] }) {
  return (
    <ul>
      {people.map((p) => {
        const balance = roundCents(p.balance);
        return (
          <li key={p.id}>
            <Link className="entry" to={`/schulden/${p.id}`}>
              <span>
                {p.name}
                <small>{entriesText(p)}</small>
              </span>
              <span className={`amt ${balance > 0 ? "in" : balance < 0 ? "out" : "transfer"}`}>
                {balance > 0 ? "schuldet dir " : balance < 0 ? "du schuldest " : ""}
                {balance ? money(Math.abs(balance)) : "ausgeglichen"}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Übersicht der Schulden: wer dir wie viel schuldet und wem du etwas schuldest */
export default function DebtsPage() {
  const { refresh } = useData();
  const people = useLoad(fetchPeople, []);
  const [dialog, setDialog] = useState<DebtKind | "split" | null>(null);
  useTitle("Schulden");

  const list = people.data ?? [];
  const open = list
    .filter((p) => roundCents(p.balance) !== 0)
    // Wer dir etwas schuldet zuerst, jeweils die größten Beträge vorne
    .sort((a, b) => Number(b.balance > 0) - Number(a.balance > 0) || Math.abs(b.balance) - Math.abs(a.balance));
  const settled = list.filter((p) => roundCents(p.balance) === 0);
  const owed = list.reduce((sum, p) => sum + Math.max(p.balance, 0), 0);
  const owing = list.reduce((sum, p) => sum + Math.max(-p.balance, 0), 0);
  const close = () => setDialog(null);

  return (
    <>
      <div className="page-head">
        <h1>Schulden</h1>
        <div className="head-actions">
          <button className="add" onClick={() => setDialog("debt")}>
            <span aria-hidden="true">+ </span>Schuld eintragen
          </button>
          <button className="ghost" onClick={() => setDialog("settlement")}>
            Ausgleich eintragen
          </button>
          <button className="ghost" onClick={() => setDialog("split")}>
            Ausgabe aufteilen
          </button>
        </div>
      </div>
      {people.failed && (
        <p className="errbox" role="alert">
          {OFFLINE}
        </p>
      )}

      <section>
        <dl className="kpis">
          <div>
            <dt>Dir geschuldet</dt>
            <dd className={roundCents(owed) ? "in" : undefined}>{people.data ? money(owed) : "–"}</dd>
          </div>
          <div>
            <dt>Du schuldest</dt>
            <dd className={roundCents(owing) ? "out" : undefined}>{people.data ? money(owing) : "–"}</dd>
          </div>
          <div>
            <dt>Saldo</dt>
            <dd>{people.data ? signed(owed - owing) : "–"}</dd>
          </div>
        </dl>
        <small className="hint">
          Schulden stehen neben den Buchungen: Sie ändern weder Kontostände noch Einnahmen und Ausgaben. Eine Buchung teilst
          du auf, indem du sie öffnest und unter „Schulden“ „Aufteilen“ wählst, z. B. auf der Seite{" "}
          <Link to="/buchungen">Buchungen</Link>.
        </small>
      </section>

      {people.data && (
        <>
          <section>
            <h2>Offen</h2>
            {open.length ? (
              <PersonRows people={open} />
            ) : (
              <p className="empty">
                {list.length ? "Alles ausgeglichen." : "Noch keine Schulden. Trag eine ein oder teile eine Ausgabe auf."}
              </p>
            )}
          </section>
          {settled.length > 0 && (
            <section>
              <h2>Ausgeglichen</h2>
              <PersonRows people={settled} />
            </section>
          )}
        </>
      )}

      {(dialog === "debt" || dialog === "settlement") && <DebtDialog kind={dialog} onSaved={refresh} onClose={close} />}
      {dialog === "split" && <SplitDialog onSaved={refresh} onClose={close} />}
    </>
  );
}
