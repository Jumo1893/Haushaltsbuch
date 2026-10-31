import BookingFilters from "../components/BookingFilters";
import BookingsView from "../components/BookingsView";
import MonthNav from "../components/MonthNav";
import { useData } from "../data";
import { addMonths, parseMonth, ym } from "../format";
import { useFilterParams, useMonthParam, useTitle } from "../router";
import { isFiltered } from "../types";

/** Alle Buchungen eines Monats über alle Konten; mit Filtern die Treffer aus allen Monaten */
export default function BookingsPage() {
  const { accounts } = useData();
  const [month, setMonth] = useMonthParam();
  const [filters, setFilters] = useFilterParams();
  const searching = isFiltered(filters);
  useTitle("Buchungen");

  return (
    <>
      <div className="page-head">
        <h1>Buchungen</h1>
        {searching ? (
          <p className="meta">Alle Monate</p>
        ) : (
          <MonthNav month={parseMonth(month)} onChange={(n) => setMonth(ym(addMonths(parseMonth(month), n)))} />
        )}
      </div>
      <BookingFilters filters={filters} accounts={accounts} onChange={setFilters} />
      <BookingsView month={month} onMonthChange={setMonth} filters={searching ? filters : undefined} />
    </>
  );
}
