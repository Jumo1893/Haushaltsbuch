import { useState } from "react";
import { fetchDayBalances, fetchLatest, fetchMonthStats, fetchTransactions, updateTransaction } from "../api";
import AccountCard from "../components/AccountCard";
import AccountDialog from "../components/AccountDialog";
import CashflowChart from "../components/charts/CashflowChart";
import LineChart from "../components/charts/LineChart";
import EditTransactionDialog from "../components/EditTransactionDialog";
import MonthKpis from "../components/MonthKpis";
import Segmented from "../components/Segmented";
import TopPayees from "../components/TopPayees";
import TransactionList from "../components/TransactionList";
import { OFFLINE, useData, useLoad } from "../data";
import { money, monthFormat, monthName, monthsBefore, parseMonth, percent, signed, today, ym } from "../format";
import { Link, navigate, useTitle } from "../router";
import { DAILY_MONTHS, balanceCourse, balancesOf, rangesFor, totalsByMonth, type MonthTotals } from "../stats";
import type { Transaction } from "../types";

/** Wie viele Monate die kleinen Verläufe der Kontokarten zeigen */
const SPARK_MONTHS = 12;

/** Veränderung des Gesamtsaldos in den letzten zwölf Monaten, bei kürzerer Zeit seit Beginn der Daten */
function change(totals: MonthTotals[], index: number, total: number) {
  if (index < 0) return null;
  if (index >= 12) return { value: total - totals[index - 11].balance, since: "in 12 Monaten" }; // Anfang dieses Monats = Ende des Monats davor
  return { value: total - totals[0].balance, since: `seit ${monthFormat.format(parseMonth(totals[0].month))}` };
}

/** Summe über die Monate eines Zeitraums, mit Sparquote (Anteil der Einnahmen, der übrig bleibt) */
function periodSummary(rows: MonthTotals[]) {
  const income = rows.reduce((s, r) => s + r.income, 0);
  const expenses = rows.reduce((s, r) => s + r.expenses, 0);
  const parts = [`Einnahmen ${money(income)}`, `Ausgaben ${money(expenses)}`];
  if (income > 0) parts.push(`Sparquote ${percent.format((income - expenses) / income)}`);
  return `Im Zeitraum: ${parts.join(" · ")}.`;
}

export default function DashboardPage() {
  const { accounts, loaded, colorOf, createAccount, refresh } = useData();
  const current = ym(new Date());
  const day = today();
  const stats = useLoad(() => fetchMonthStats(current), [current]);
  const days = useLoad(() => fetchDayBalances(monthsBefore(day, DAILY_MONTHS), day), [day]);
  const monthItems = useLoad(() => fetchTransactions(current), [current]);
  const latest = useLoad(() => fetchLatest(6), []);
  const [range, setRange] = useState(12);
  const [view, setView] = useState<"total" | "accounts">("total");
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [creating, setCreating] = useState(false);
  useTitle("Übersicht");

  const totals = totalsByMonth(stats.data ?? []);
  const shown = range ? totals.slice(-range) : totals;
  const course = balanceCourse(range, stats.data ?? [], days.data ?? [], day);
  const sparkMonths = totals.slice(-SPARK_MONTHS).map((t) => t.month);
  const total = accounts.reduce((sum, a) => sum + a.balance, 0);
  const delta = change(totals, totals.findIndex((t) => t.month === current), total);
  const failed = stats.failed || days.failed || monthItems.failed || latest.failed;

  const newAccount = (
    <AccountDialog
      onSave={async (values) => navigate(`/konten/${(await createAccount(values)).id}`)}
      onClose={() => setCreating(false)}
    />
  );

  if (loaded && !accounts.length) {
    return (
      <>
        <div className="page-head">
          <h1>Übersicht</h1>
        </div>
        <section className="welcome">
          <h2>Willkommen im Haushaltsbuch</h2>
          <p>
            Leg dein erstes Konto an oder importiere Umsätze aus einer CSV-Datei deiner Bank. Konten mit IBAN legt der
            Import selbst an.
          </p>
          <div className="actions">
            <button className="add" onClick={() => setCreating(true)}>
              Konto anlegen
            </button>
            <Link className="ghost" to="/import">
              Umsätze importieren
            </Link>
          </div>
        </section>
        {creating && newAccount}
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Übersicht</h1>
      </div>
      {failed && (
        <p className="errbox" role="alert">
          {OFFLINE}
        </p>
      )}

      <div className="grid top-row">
        <div className="balance hero">
          <small>Alle Konten</small>
          <strong>{money(total)}</strong>
          {delta && (
            <span className="delta">
              {signed(delta.value)} {delta.since}
            </span>
          )}
        </div>
        <MonthKpis totals={stats.data ? totals : null} month={current} />
      </div>

      <section className="bare">
        <div className="section-head">
          <h2>Konten</h2>
          <button className="ghost small" onClick={() => setCreating(true)}>
            + Konto anlegen
          </button>
        </div>
        <div className="cards">
          {accounts.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              color={colorOf(a.id)}
              balances={balancesOf(stats.data ?? [], a.id, sparkMonths).filter((v): v is number => v !== null)}
            />
          ))}
        </div>
      </section>

      {totals.length > 0 && (
        <>
          <div className="section-head">
            <h2>Verlauf</h2>
            <Segmented label="Zeitraum" options={rangesFor(totals.length)} value={range} onChange={setRange} />
          </div>
          <div className={stats.loading || days.loading ? "stale" : undefined}>
            <section>
              <div className="section-head">
                <h3 className="h2">Kontostand {course.when}</h3>
                {accounts.length > 1 && (
                  <Segmented
                    label="Darstellung"
                    options={[
                      ["total", "Gesamt"],
                      ["accounts", "Je Konto"],
                    ]}
                    value={view}
                    onChange={setView}
                  />
                )}
              </div>
              {view === "total" || accounts.length < 2 ? (
                <LineChart
                  label={`Kontostand aller Konten ${course.when}`}
                  months={course.points}
                  unit={course.unit}
                  series={[{ key: "total", name: "Alle Konten", color: "var(--ink)", values: course.total }]}
                  details={accounts.map((a) => ({ key: a.id, name: a.name, values: course.of(a.id) }))}
                  area
                />
              ) : (
                <>
                  <ul className="legend">
                    {accounts.map((a) => (
                      <li key={a.id}>
                        <span className="swatch line" style={{ background: colorOf(a.id) }} />
                        {a.name} <b>{money(a.balance)}</b>
                      </li>
                    ))}
                  </ul>
                  <LineChart
                    label={`Kontostand je Konto ${course.when}`}
                    months={course.points}
                    unit={course.unit}
                    series={accounts.map((a) => ({
                      key: a.id,
                      name: a.name,
                      color: colorOf(a.id),
                      values: course.of(a.id),
                    }))}
                  />
                </>
              )}
            </section>
            <section>
              <h3 className="h2">Einnahmen und Ausgaben</h3>
              <CashflowChart rows={shown} hrefOf={(m) => `/buchungen?monat=${m}`} />
              <p className="hint">
                {periodSummary(shown)} Umbuchungen zwischen eigenen Konten sind nicht enthalten. Ein Klick auf einen Monat
                zeigt seine Buchungen.
              </p>
            </section>
          </div>
        </>
      )}

      <div className="grid two">
        <section>
          <h2>Größte Ausgaben im {monthName.format(parseMonth(current))}</h2>
          <TopPayees items={monthItems.data ?? []} />
          <Link className="more" to="/buchungen">
            Alle Buchungen im {monthName.format(parseMonth(current))} →
          </Link>
        </section>
        <section>
          <h2>Letzte Buchungen</h2>
          <TransactionList
            items={latest.data ?? []}
            accounts={accounts}
            onEdit={setEditing}
            emptyText="Noch keine Buchungen."
          />
          <Link className="more" to="/buchungen">
            Alle Buchungen →
          </Link>
        </section>
      </div>

      {creating && newAccount}
      {editing && (
        <EditTransactionDialog
          key={editing.id}
          tx={editing}
          accounts={accounts}
          onCreateAccount={createAccount}
          onSave={async (changes) => {
            await updateTransaction(editing.id, changes);
            refresh();
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
