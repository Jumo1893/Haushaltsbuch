import { money, monthFormat, parseMonth } from "../../format";

export interface Column {
  key: string | number;
  name: string;
  values: (number | null)[];
  format?: (value: number) => string;
}

/** Die Werte eines Diagramms als Tabelle, neuester Monat zuerst (für Screenreader und zum Nachlesen) */
export default function ChartTable({ months, columns }: { months: string[]; columns: Column[] }) {
  return (
    <details className="table-view">
      <summary>Werte als Tabelle</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Monat</th>
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
                  <th scope="row">{monthFormat.format(parseMonth(m))}</th>
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
