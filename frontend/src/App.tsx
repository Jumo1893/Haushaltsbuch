import { useEffect, useRef, useState, type ReactNode } from "react";
import NewTransactionDialog from "./components/NewTransactionDialog";
import { DataProvider, useData } from "./data";
import AccountPage from "./pages/AccountPage";
import BookingsPage from "./pages/BookingsPage";
import CategoriesPage from "./pages/CategoriesPage";
import DashboardPage from "./pages/DashboardPage";
import ImportPage from "./pages/ImportPage";
import { Link, navigate, useLocation, useTitle } from "./router";
import type { Transaction } from "./types";

const NAV: [string, string][] = [
  ["/", "Übersicht"],
  ["/buchungen", "Buchungen"],
  ["/kategorien", "Kategorien"],
  ["/import", "Import"],
];

function NotFound() {
  useTitle("Seite nicht gefunden");
  return (
    <>
      <div className="page-head">
        <h1>Seite nicht gefunden</h1>
      </div>
      <p>
        Diese Seite gibt es nicht. <Link to="/">Zur Übersicht</Link>
      </p>
    </>
  );
}

function Shell() {
  const { path } = useLocation();
  const { error, refresh } = useData();
  const [adding, setAdding] = useState(false);
  const lastAccount = useRef<number | null>(null); // Konto der zuletzt erfassten Buchung
  const mainRef = useRef<HTMLElement>(null);
  const shownPath = useRef(path);
  const accountId = Number(/^\/konten\/(\d+)$/.exec(path)?.[1]) || null;

  // Nach einem Seitenwechsel beginnt die Tastatur- und Screenreader-Navigation beim neuen Inhalt
  useEffect(() => {
    if (path === shownPath.current) return;
    shownPath.current = path;
    mainRef.current?.focus({ preventScroll: true });
  }, [path]);

  let page: ReactNode;
  if (path === "/") page = <DashboardPage />;
  else if (path === "/buchungen") page = <BookingsPage />;
  else if (path === "/kategorien") page = <CategoriesPage />;
  else if (path === "/import") page = <ImportPage />;
  else if (accountId) page = <AccountPage key={accountId} id={accountId} />;
  else page = <NotFound />;

  const handleSaved = (tx: Transaction) => {
    lastAccount.current = tx.accountId;
    refresh();
    // In einer Monatsansicht zum Monat der Buchung wechseln, damit sie zu sehen ist
    if (path === "/buchungen" || accountId) navigate(`${path}?monat=${tx.date.slice(0, 7)}`, { replace: true });
  };

  return (
    <>
      <header className="top">
        <div className="top-in">
          <Link className="brand" to="/">
            Haushaltsbuch
          </Link>
          <nav aria-label="Hauptnavigation">
            {NAV.map(([to, label]) => (
              <Link key={to} to={to} aria-current={path === to ? "page" : undefined}>
                {label}
              </Link>
            ))}
          </nav>
          <button className="add" onClick={() => setAdding(true)}>
            <span aria-hidden="true">+ </span>Neue Buchung
          </button>
        </div>
      </header>
      <main ref={mainRef} tabIndex={-1}>
        {error && (
          <p className="errbox" role="alert">
            {error}
          </p>
        )}
        {page}
      </main>
      {adding && (
        <NewTransactionDialog
          defaultAccountId={accountId ?? lastAccount.current}
          onSaved={handleSaved}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  );
}
