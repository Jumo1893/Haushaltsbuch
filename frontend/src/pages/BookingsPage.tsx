import BookingFilters from "../components/BookingFilters";
import BookingsView from "../components/BookingsView";
import MonthNav from "../components/MonthNav";
import Segmented from "../components/Segmented";
import { useData } from "../data";
import { addMonths, parseMonth, ym } from "../format";
import { ALL_MONTHS, useFilterParams, useLocation, useMonthParam, useTitle } from "../router";
import { isFiltered } from "../types";

type Period = "month" | "all";

const PERIODS: [Period, string][] = [
  ["month", "Monatsweise"],
  ["all", "Alle Monate"],
];

/** Buchungen über alle Konten, ein Monat oder alle; mit Filtern die Treffer aus allen Monaten */
export default function BookingsPage() {
  const { accounts } = useData();
  const { query } = useLocation();
  const [month, setMonth] = useMonthParam();
  const [filters, setFilters] = useFilterParams();
  const searching = isFiltered(filters);
  const allMonths = searching || query.get("monat") === ALL_MONTHS;
  useTitle("Buchungen");

  return (
    <>
      <div className="page-head">
        <h1>Buchungen</h1>
        <div className="period">
          {!allMonths && (
            <MonthNav month={parseMonth(month)} onChange={(n) => setMonth(ym(addMonths(parseMonth(month), n)))} />
          )}
          {/* Die Suche geht immer über alle Monate */}
          <Segmented
            label="Zeitraum"
            options={PERIODS}
            value={allMonths ? "all" : "month"}
            onChange={(period) => setMonth(period === "all" ? ALL_MONTHS : ym(new Date()))}
            isDisabled={(period) => searching && period === "month"}
          />
        </div>
      </div>
      <BookingFilters filters={filters} accounts={accounts} onChange={setFilters} />
      <BookingsView month={month} onMonthChange={setMonth} filters={allMonths ? filters : undefined} />
    </>
  );
}
