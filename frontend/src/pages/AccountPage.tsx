import { useState } from "react";
import { ApiError, deleteAccount, fetchDayBalances, fetchMonthStats, updateAccount } from "../api";
import AccountDialog from "../components/AccountDialog";
import BookingsView from "../components/BookingsView";
import CashflowChart from "../components/charts/CashflowChart";
import LineChart from "../components/charts/LineChart";
import MonthKpis from "../components/MonthKpis";
import MonthNav from "../components/MonthNav";
import ReconcileDialog from "../components/ReconcileDialog";
import Segmented from "../components/Segmented";
import { OFFLINE, useData, useLoad } from "../data";
import { addMonths, dateFormat, formatIban, money, monthsBefore, parseDate, parseMonth, today, ym } from "../format";
import { Link, navigate, useMonthParam, useTitle } from "../router";
import { DAILY_MONTHS, balanceCourse, rangesFor, totalsByMonth } from "../stats";
import { kindLabel, type AccountChanges } from "../types";

/** Seite eines Kontos: Kontostand, Verlauf, Buchungen je Monat und Einstellungen des Kontos */
export default function AccountPage({ id }: { id: number }) {
  const { accounts, loaded, colorOf, refresh } = useData();
  const account = accounts.find((a) => a.id === id);
  const current = ym(new Date());
  const day = today();
  const stats = useLoad(() => fetchMonthStats(current, id), [id, current]);
  const days = useLoad(() => fetchDayBalances(monthsBefore(day, DAILY_MONTHS), day, id), [id, day]);
  const [month, setMonth] = useMonthParam();
  const [dialog, setDialog] = useState<"edit" | "reconcile" | null>(null);
  const [range, setRange] = useState(12);
  const [error, setError] = useState("");
  useTitle(account?.name ?? "Konto");

  if (!loaded) return null;
  if (!account) {
    return (
      <>
        <div className="page-head">
          <h1>Konto nicht gefunden</h1>
        </div>
        <p>
          Dieses Konto gibt es nicht (mehr). <Link to="/">Zur Übersicht</Link>
        </p>
      </>
    );
  }

  const totals = totalsByMonth(stats.data ?? []);
  const shown = range ? totals.slice(-range) : totals;
  const course = balanceCourse(range, stats.data ?? [], days.data ?? [], day);

  // Fehler beim Speichern zeigen die Dialoge selbst an
  const save = async (changes: AccountChanges) => {
    await updateAccount(id, changes);
    refresh();
  };

  const remove = async () => {
    if (!window.confirm(`Konto „${account.name}“ löschen? Es enthält keine Buchungen.`)) return;
    try {
      await deleteAccount(id);
      refresh();
      navigate("/");
    } catch (e) {
      setError(e instanceof ApiError && e.body?.error ? e.body.error : "Löschen fehlgeschlagen.");
    }
  };

  // Klick auf einen Monat im Diagramm: zu den Buchungen dieses Monats weiter unten
  const showMonth = (m: string) => {
    setMonth(m);
    document.getElementById("monat")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <Link className="crumb" to="/">
            ‹ Übersicht
          </Link>
          <h1>
            <span className="dot-key" style={{ background: colorOf(id) }} />
            {account.name}
          </h1>
          <p className="meta">
            {[kindLabel(account.kind), account.institution, account.iban && formatIban(account.iban)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="head-actions">
          <button className="ghost" onClick={() => setDialog("edit")}>
            Bearbeiten
          </button>
          <Link className="ghost" to={`/import?konto=${id}`}>
            Umsätze importieren
          </Link>
          {account.transactionCount === 0 && (
            <button className="ghost danger" onClick={remove}>
              Konto löschen
            </button>
          )}
        </div>
      </div>
      {(error || stats.failed || days.failed) && (
        <p className="errbox" role="alert">
          {error || OFFLINE}
        </p>
      )}

      <div className="grid top-row">
        <div className="balance hero">
          <small>Kontostand</small>
          <strong>{money(account.balance)}</strong>
          <span className="delta">
            {account.transactionCount} {account.transactionCount === 1 ? "Buchung" : "Buchungen"}
            {account.firstDate && account.lastDate && (
              <>
                {" "}
                vom {dateFormat.format(parseDate(account.firstDate))} bis {dateFormat.format(parseDate(account.lastDate))}
              </>
            )}
          </span>
          <span className="reconcile">
            {account.bankBalance !== null && account.bankBalanceDate
              ? `Mit der Bank abgeglichen: ${money(account.bankBalance)} am ${dateFormat.format(parseDate(account.bankBalanceDate))}`
              : "Noch nicht mit der Bank abgeglichen. Der Kontostand ist die Summe aller Buchungen."}
          </span>
          {account.pendingRoundUps > 0 && (
            <span className="reconcile">
              {money(account.pendingRoundUps)} für Round-Ups vorgemerkt, noch nicht gebucht. Trade Republic zeigt deshalb{" "}
              {money(account.balance - account.pendingRoundUps)}.
            </span>
          )}
          <button className="on-accent" onClick={() => setDialog("reconcile")}>
            Kontostand abgleichen
          </button>
        </div>
        <MonthKpis totals={stats.data ? totals : null} month={current} />
      </div>

      {totals.length > 0 && (
        <>
          <div className="section-head">
            <h2>Verlauf</h2>
            <Segmented label="Zeitraum" options={rangesFor(totals.length)} value={range} onChange={setRange} />
          </div>
          <div className={stats.loading || days.loading ? "stale" : undefined}>
            <section>
              <h3 className="h2">Kontostand {course.when}</h3>
              <LineChart
                label={`Kontostand ${account.name} ${course.when}`}
                months={course.points}
                unit={course.unit}
                series={[{ key: id, name: account.name, color: "var(--ink)", values: course.total }]}
                area
              />
            </section>
            <section>
              <h3 className="h2">Einnahmen und Ausgaben</h3>
              <CashflowChart rows={shown} hrefOf={(m) => `/konten/${id}?monat=${m}`} onSelect={showMonth} />
              <p className="hint">
                Umbuchungen von und zu eigenen Konten sind nicht enthalten, zählen aber zum Saldo. Ein Klick auf einen
                Monat zeigt seine Buchungen.
              </p>
            </section>
          </div>
        </>
      )}

      <div className="section-head" id="monat">
        <h2>Buchungen</h2>
        <MonthNav month={parseMonth(month)} onChange={(n) => setMonth(ym(addMonths(parseMonth(month), n)))} />
      </div>
      <BookingsView month={month} onMonthChange={setMonth} accountId={id} nested />

      {dialog === "edit" && <AccountDialog account={account} onSave={save} onClose={() => setDialog(null)} />}
      {dialog === "reconcile" && (
        <ReconcileDialog
          account={account}
          onSave={(bankBalance, bankBalanceDate) => save({ bankBalance, bankBalanceDate })}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
