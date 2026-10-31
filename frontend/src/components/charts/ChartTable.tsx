import { dateFormat, money, monthFormat, parseDate, parseMonth } from "../../format";

export interface Column {
  key: string | number;
  name: string;
  values: (number | null)[];
  format?: (value: number) => string;
}

interface Props {
  /** Monate (YYYY-MM), mit unit "day" Tage (YYYY-MM-DD) */
  months: string[];
  columns: Column[];
  unit?: "month" | "day";
}

/** Die Werte eines Diagramms als Tabelle, neuester Monat zuerst (für Screenreader und zum Nachlesen) */
export default function ChartTable({ months, columns, unit = "month" }: Props) {
  return (
    <details className="table-view">
      <summary>Werte als Tabelle</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">{unit === "day" ? "Tag" : "Monat"}</th>
              {columns.map((c) => (
                <th scope="col" key={c.key}>
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {months
              .map((m, i) => (
                <tr key={m}>
                  <th scope="row">{unit === "day" ? dateFormat.format(parseDate(m)) : monthFormat.format(parseMonth(m))}</th>
                  {columns.map((c) => {
                    const value = c.values[i];
                    return <td key={c.key}>{value === null ? "–" : (c.format ?? money)(value)}</td>;
                  })}
                </tr>
              ))
              .reverse()}
          </tbody>
        </table>
      </div>
    </details>
  );
}
