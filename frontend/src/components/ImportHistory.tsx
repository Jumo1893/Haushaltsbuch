import { Fragment } from "react";
import { fetchImports } from "../api";
import { useLoad } from "../data";
import { dateTimeFormat } from "../format";
import { Link } from "../router";

/** Die bisherigen Importe, neueste zuerst, mit Links zu den Konten, in die sie Umsätze übernommen haben */
export default function ImportHistory() {
  const { data, failed } = useLoad(fetchImports, []);

  if (failed) return <p className="empty">Die bisherigen Importe konnten nicht geladen werden.</p>;
  if (!data) return null;
  if (!data.length) return <p className="empty">Noch keine Importe.</p>;

  return (
    <ul className="imports">
      {data.map((run) => {
        const counts = [
          `${run.imported} importiert`,
          run.duplicatesSkipped > 0 && `${run.duplicatesSkipped} Duplikate übersprungen`,
          run.skipped > 0 && `${run.skipped} nicht übernommen`,
          run.invalid > 0 && `${run.invalid} fehlerhaft`,
        ];
        return (
          <li key={run.id}>
            <span className="file">{run.fileName}</span>
            <small>
              {dateTimeFormat.format(new Date(run.createdAt))} · {run.profileName}
            </small>
            <small>{counts.filter(Boolean).join(" · ")}</small>
            {run.accounts.length > 0 && (
              <small>
                {run.accounts.map((a, i) => (
                  <Fragment key={a.id}>
                    {i > 0 && ", "}
                    <Link to={`/konten/${a.id}`}>{a.name}</Link>
                  </Fragment>
                ))}
              </small>
            )}
          </li>
        );
      })}
    </ul>
  );
}
