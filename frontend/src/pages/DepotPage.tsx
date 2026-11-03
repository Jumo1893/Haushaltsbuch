import { useState } from "react";
import { ApiError, deleteAccount, fetchDepot, refreshPrices, updateAccount } from "../api";
import AccountDialog from "../components/AccountDialog";
import AllocationBar from "../components/AllocationBar";
import BookingsView from "../components/BookingsView";
import LineChart from "../components/charts/LineChart";
import ClosedPositions from "../components/ClosedPositions";
import MonthNav from "../components/MonthNav";
import MovementList from "../components/MovementList";
import PositionList from "../components/PositionList";
import Segmented from "../components/Segmented";
import { OFFLINE, useData, useLoad } from "../data";
import {
  addMonths,
  dateFormat,
  dateTimeFormat,
  daysBetween,
  money,
  movements,
  parseDate,
  parseMonth,
  signed,
  signedPercent,
  today,
  ym,
} from "../format";
import { Link, navigate, useMonthParam } from "../router";
import { RANGES } from "../stats";
import {
  kindLabel,
  type Account,
  type AccountChanges,
  type Depot,
  type DepotTotals,
  type Position,
  type PriceResult,
} from "../types";

/** Ab so vielen Tagen gilt ein Kurs als alt */
const STALE_DAYS = 30;

/** Zeiträume des Verlaufs: Er hat einen Wert je Monat, kürzere Zeiträume sagen nichts aus */
const DEPOT_RANGES = RANGES.filter(([months]) => months === 0 || months >= 12);

const VALUE_COLOR = "var(--ink)";
const INVESTED_COLOR = "var(--muted)";

const isStale = (p: Position) => p.priceDate !== null && daysBetween(p.priceDate, today()) > STALE_DAYS;

/** Was der Kursabruf gebracht hat, in einem Satz je Ergebnis */
function priceSummary(results: PriceResult[]) {
  const updated = results.filter((r) => r.price !== undefined).length;
  const without = results.filter((r) => r.source === null).length;
  const failed = results.filter((r) => r.error);
  const parts = [`${updated} ${updated === 1 ? "Kurs" : "Kurse"} aktualisiert.`];
  if (without) parts.push(`Keine öffentlichen Kurse für ${without} Private-Markets-Fonds, dort gilt der Export.`);
  if (failed.length) parts.push(`Nicht abrufbar: ${failed.map((r) => `${r.name} (${r.error})`).join(", ")}.`);
  return parts.join(" ");
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value}
        {note && <small>{note}</small>}
      </dd>
    </div>
  );
}

/** Was im Depot steckt und was es eingebracht hat. Gewinne sind nach Gebühren und vor Steuern. */
function DepotKpis({ totals }: { totals: DepotTotals | null }) {
  const show = (pick: (t: DepotTotals) => number, format: (v: number) => string) => (totals ? format(pick(totals)) : "–");
  return (
    <section>
      <h2>Ergebnis</h2>
      <dl className="kpis">
        <Kpi label="Einstand" value={show((t) => t.invested, money)} />
        <Kpi label="Offener Gewinn" value={show((t) => t.unrealized, signed)} />
        <Kpi label="Realisiert" value={show((t) => t.realized, signed)} />
        <Kpi label="Erträge" value={show((t) => t.income, money)} />
        <Kpi label="Steuern" value={show((t) => t.taxes, money)} />
        <Kpi label="Gebühren" value={show((t) => t.fees, money)} />
      </dl>
      <small className="hint">
        {totals && `Gesamt nach Steuern ${signed(totals.result)}. `}
        Gewinne sind nach Gebühren und vor Steuern. Der Einstand ist ein gleitender Durchschnitt mit Kaufgebühren.
        {totals && totals.received > 0 && ` Darin ${money(totals.received)} Gratis-Eingänge zum Kurs des Tages.`}
      </small>
    </section>
  );
}

interface HeroProps {
  account: Account;
  depot: Depot | undefined;
  /** Ergebnis des letzten Kursabrufs auf dieser Seite */
  note: string;
  refreshing: boolean;
  onRefresh: () => void;
}

/** Depotwert, wie er zustande kommt und woher die Kurse stammen */
function Hero({ account, depot, note, refreshing, onRefresh }: HeroProps) {
  const totals = depot?.totals;
  const stake = totals ? totals.invested - totals.pending : 0;
  const stale = depot?.positions.filter(isStale).length ?? 0;
  return (
    <div className="balance hero">
      <small>Depotwert</small>
      <strong>{totals ? money(totals.value) : "–"}</strong>
      {totals && (
        <span className="delta">
          {signed(totals.unrealized)}
          {stake > 0 && ` (${signedPercent(totals.unrealized / stake)})`} gegenüber dem Einstand
        </span>
      )}
      {account.firstDate && account.lastDate && (
        <span className="reconcile">
          {movements(account.movementCount)} vom {dateFormat.format(parseDate(account.firstDate))} bis{" "}
          {dateFormat.format(parseDate(account.lastDate))}
        </span>
      )}
      {totals && totals.pending > 0 && (
        <span className="reconcile">Darin {money(totals.pending)} in Abwicklung: bezahlt, aber noch keine Anteile gebucht.</span>
      )}
      {depot && (
        <span className="reconcile">
          {depot.pricesFetchedAt
            ? `Kurse von Lang & Schwarz und Kraken, zuletzt abgerufen ${dateTimeFormat.format(new Date(depot.pricesFetchedAt))}. ` +
              "Ohne abgerufenen Kurs gilt der letzte aus dem Export."
            : "Bewertet mit dem letzten Kurs aus dem Export. Aktuelle Kurse holt „Kurse aktualisieren“ bei Lang & Schwarz " +
              "und Kraken; dorthin gehen nur die ISINs und Krypto-Kürzel, keine Stückzahlen oder Beträge."}
          {stale > 0 && ` Bei ${stale} von ${depot.positions.length} Positionen ist der Kurs älter als ${STALE_DAYS} Tage.`}
        </span>
      )}
      {note && (
        <span className="reconcile" role="status">
          {note}
        </span>
      )}
      {depot && depot.positions.length > 0 && (
        <button className="on-accent" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? "Kurse werden abgerufen …" : "Kurse aktualisieren"}
        </button>
      )}
    </div>
  );
}

/** Seite eines Depots: Wert, Ergebnis, Anlageklassen, Verlauf, Positionen und Bewegungen */
export default function DepotPage({ account }: { account: Account }) {
  const { accounts, colorOf, refresh } = useData();
  const { id } = account;
  const current = ym(new Date());
  const { data: depot, failed, loading } = useLoad(() => fetchDepot(id, current), [id, current]);
  const [month, setMonth] = useMonthParam();
  const [editing, setEditing] = useState(false);
  const [range, setRange] = useState(0);
  const [isin, setIsin] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [priceNote, setPriceNote] = useState("");

  const cashAccount = accounts.find((a) => a.id === account.cashAccountId);
  const history = depot?.history ?? [];
  const shown = range ? history.slice(-range) : history;

  // Fehler beim Speichern zeigt der Dialog selbst an
  const save = async (changes: AccountChanges) => {
    await updateAccount(id, changes);
    refresh();
  };

  const remove = async () => {
    const question =
      `Depot „${account.name}“ mit ${movements(account.movementCount)} löschen? ` +
      "Die Buchungen im Geldkonto bleiben. Ein neuer Import stellt die Bewegungen wieder her.";
    if (!window.confirm(question)) return;
    try {
      await deleteAccount(id);
      refresh();
      navigate(cashAccount ? `/konten/${cashAccount.id}` : "/");
    } catch (e) {
      setError(e instanceof ApiError && e.body?.error ? e.body.error : "Löschen fehlgeschlagen.");
    }
  };

  const updatePrices = async () => {
    setRefreshing(true);
    setError("");
    setPriceNote("");
    try {
      const { results } = await refreshPrices(id);
      setPriceNote(priceSummary(results));
      refresh();
    } catch (e) {
      setError(e instanceof ApiError && e.body?.error ? e.body.error : "Die Kurse konnten nicht abgerufen werden.");
    } finally {
      setRefreshing(false);
    }
  };

  const showMovements = (next: string) => {
    setIsin(next);
    document.getElementById("bewegungen")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
            {[kindLabel(account.kind), account.institution].filter(Boolean).join(" · ")}
            {cashAccount && (
              <>
                {" · Geldkonto "}
                <Link to={`/konten/${cashAccount.id}`}>{cashAccount.name}</Link>
              </>
            )}
          </p>
        </div>
        <div className="head-actions">
          <button className="ghost" onClick={() => setEditing(true)}>
            Bearbeiten
          </button>
          <Link className="ghost" to={`/import?konto=${account.cashAccountId ?? id}`}>
            Umsätze importieren
          </Link>
          {account.transactionCount === 0 && (
            <button className="ghost danger" onClick={remove}>
              Depot löschen
            </button>
          )}
        </div>
      </div>
      {(error || failed) && (
        <p className="errbox" role="alert">
          {error || OFFLINE}
        </p>
      )}

      <div className="grid top-row">
        <Hero account={account} depot={depot} note={priceNote} refreshing={refreshing} onRefresh={updatePrices} />
        <DepotKpis totals={depot?.totals ?? null} />
      </div>

      <section>
        <h2>Anlageklassen</h2>
        <AllocationBar allocation={depot?.allocation ?? []} />
      </section>

      {history.length > 1 && (
        <>
          <div className="section-head">
            <h2>Verlauf</h2>
            {history.length > 12 && <Segmented label="Zeitraum" options={DEPOT_RANGES} value={range} onChange={setRange} />}
          </div>
          <section className={loading ? "stale" : undefined}>
            <h3 className="h2">Depotwert und Einstand am Monatsanfang</h3>
            <ul className="legend">
              <li>
                <span className="swatch line" style={{ background: VALUE_COLOR }} />
                Depotwert <b>{money(shown[shown.length - 1]?.value ?? 0)}</b>
              </li>
              <li>
                <span className="swatch line" style={{ background: INVESTED_COLOR }} />
                Einstand <b>{money(shown[shown.length - 1]?.invested ?? 0)}</b>
              </li>
            </ul>
            <LineChart
              label={`Depotwert und Einstand ${account.name}`}
              months={shown.map((h) => h.month)}
              series={[
                { key: "value", name: "Depotwert", color: VALUE_COLOR, values: shown.map((h) => h.value) },
                { key: "invested", name: "Einstand", color: INVESTED_COLOR, values: shown.map((h) => h.invested) },
              ]}
            />
            <p className="hint">
              Jeder Monat ist mit den Kursen bewertet, die bis dahin bekannt waren: aus eigenen Käufen, Verkäufen und
              Eingängen und aus abgerufenen Kursen. Der Verlauf zeigt daher nicht jede Bewegung am Markt.
            </p>
          </section>
        </>
      )}

      <section>
        <h2>Positionen</h2>
        <PositionList positions={depot?.positions ?? []} onSelect={showMovements} />
        <ClosedPositions positions={depot?.closed ?? []} onSelect={showMovements} />
      </section>

      <section id="bewegungen">
        <h2>Bewegungen</h2>
        {depot && (
          <MovementList
            movements={depot.movements}
            positions={[...depot.positions, ...depot.closed]}
            isin={isin}
            onIsinChange={setIsin}
          />
        )}
      </section>

      {account.transactionCount > 0 && (
        <>
          <div className="section-head" id="monat">
            <h2>Buchungen</h2>
            <MonthNav month={parseMonth(month)} onChange={(n) => setMonth(ym(addMonths(parseMonth(month), n)))} />
          </div>
          <BookingsView month={month} onMonthChange={setMonth} accountId={id} nested />
        </>
      )}

      {editing && <AccountDialog account={account} onSave={save} onClose={() => setEditing(false)} />}
    </>
  );
}
