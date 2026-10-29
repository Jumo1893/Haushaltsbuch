import CsvImport from "../components/CsvImport";
import ImportHistory from "../components/ImportHistory";
import { useData } from "../data";
import { useLocation, useTitle } from "../router";

/** CSV-Import mit den bisherigen Importen; ?konto=ID wählt das Konto für Umsätze ohne eigene IBAN vor */
export default function ImportPage() {
  const { accounts, createAccount, refresh } = useData();
  const { query } = useLocation();
  const account = Number(query.get("konto")) || null;
  useTitle("Import");

  return (
    <>
      <div className="page-head">
        <h1>Import</h1>
      </div>
      <div className="grid import-layout">
        <section>
          <h2>Umsätze importieren</h2>
          <CsvImport accounts={accounts} defaultAccountId={account} onCreateAccount={createAccount} onImported={refresh} />
        </section>
        <section>
          <h2>Bisherige Importe</h2>
          <ImportHistory />
        </section>
      </div>
    </>
  );
}
