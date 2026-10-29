import MonthBookings from "../components/MonthBookings";
import MonthNav from "../components/MonthNav";
import { addMonths, parseMonth, ym } from "../format";
import { useMonthParam, useTitle } from "../router";

/** Alle Buchungen eines Monats über alle Konten */
export default function BookingsPage() {
  const [month, setMonth] = useMonthParam();
  useTitle("Buchungen");

  return (
    <>
      <div className="page-head">
        <h1>Buchungen</h1>
        <MonthNav month={parseMonth(month)} onChange={(n) => setMonth(ym(addMonths(parseMonth(month), n)))} />
      </div>
      <MonthBookings month={month} onMonthChange={setMonth} />
    </>
  );
}
