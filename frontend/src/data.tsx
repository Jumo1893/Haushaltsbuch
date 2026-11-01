import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type DependencyList,
  type ReactNode,
} from "react";
import { createAccount as postAccount, createCategory as postCategory, fetchAccounts, fetchCategories } from "./api";
import type { Account, Category, NewAccount, NewCategory, TxKind } from "./types";

export const OFFLINE = "Der Server ist nicht erreichbar. Prüfe, ob alle Container laufen.";

/** Farben der Konten in Diagrammen (--c1 … --c8 in index.css); weitere Konten werden grau */
const ACCOUNT_COLORS = 8;

interface Data {
  /** Konten mit Kontostand, nach Name sortiert */
  accounts: Account[];
  /** Kategorien aller Arten mit der Zahl ihrer Buchungen */
  categories: Category[];
  /** Namen der Kategorien je Art, für die Auswahllisten */
  categoryNames: Record<TxKind, string[]>;
  /** true, sobald die Konten einmal geladen wurden */
  loaded: boolean;
  error: string;
  /** Zählt bei jeder Änderung hoch; Seiten laden ihre Daten dann neu (siehe useLoad) */
  version: number;
  /** Nach jeder Änderung an Buchungen oder Konten aufrufen: lädt Konten und Seiten neu */
  refresh: () => void;
  /** Legt ein Konto an; Fehler zeigt der aufrufende Dialog an */
  createAccount: (account: NewAccount) => Promise<Account>;
  /** Legt eine Kategorie an; Fehler zeigt der aufrufende Dialog an */
  createCategory: (category: NewCategory) => Promise<Category>;
  /** Farbe eines Kontos in Diagrammen. Sie folgt der Reihenfolge der Anlage und bleibt so gleich. */
  colorOf: (accountId: number) => string;
}

const DataContext = createContext<Data | null>(null);

/** Konten alphabetisch, wie in den Auswahllisten */
const byName = (a: Account, b: Account) => a.name.localeCompare(b.name, "de") || a.id - b.id;

export function DataProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    Promise.all([fetchAccounts(), fetchCategories()])
      .then(([accountList, categoryList]) => {
        if (!current) return;
        setAccounts(accountList.sort(byName));
        setCategories(categoryList);
        setError("");
        setLoaded(true);
      })
      .catch(() => current && setError(OFFLINE));
    return () => {
      current = false;
    };
  }, [version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const createAccount = useCallback(
    async (account: NewAccount) => {
      const created = await postAccount(account);
      setAccounts((list) => [...list, created].sort(byName));
      refresh();
      return created;
    },
    [refresh],
  );

  const createCategory = useCallback(
    async (category: NewCategory) => {
      const created = await postCategory(category);
      setCategories((list) => [...list, created]);
      refresh();
      return created;
    },
    [refresh],
  );

  const categoryNames = useMemo(() => {
    const names = (kind: TxKind) => categories.filter((c) => c.kind === kind).map((c) => c.name);
    return { out: names("out"), in: names("in"), transfer: names("transfer") };
  }, [categories]);

  const colorOf = useMemo(() => {
    const slots = new Map([...accounts].sort((a, b) => a.id - b.id).map((a, i) => [a.id, i]));
    return (id: number) => {
      const slot = slots.get(id) ?? ACCOUNT_COLORS;
      return slot < ACCOUNT_COLORS ? `var(--c${slot + 1})` : "var(--muted)";
    };
  }, [accounts]);

  const value = useMemo(
    () => ({
      accounts,
      categories,
      categoryNames,
      loaded,
      error,
      version,
      refresh,
      createAccount,
      createCategory,
      colorOf,
    }),
    [accounts, categories, categoryNames, loaded, error, version, refresh, createAccount, createCategory, colorOf],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const data = useContext(DataContext);
  if (!data) throw new Error("useData braucht einen DataProvider");
  return data;
}

/**
 * Lädt Daten für eine Seite, neu bei geänderten deps und nach jedem refresh(). Bis neue Daten da sind,
 * bleiben die bisherigen stehen (loading ist dann true), damit nichts springt.
 */
export function useLoad<T>(load: () => Promise<T>, deps: DependencyList) {
  const { version } = useData();
  const [state, setState] = useState<{ data?: T; failed: boolean; loading: boolean }>({ failed: false, loading: true });

  useEffect(() => {
    let current = true;
    setState((s) => ({ ...s, loading: true }));
    load().then(
      (data) => current && setState({ data, failed: false, loading: false }),
      () => current && setState((s) => ({ ...s, failed: true, loading: false })),
    );
    return () => {
      current = false;
    };
    // load ändert sich mit deps, deshalb steht es nicht in der Liste
  }, [version, ...deps]);

  return state;
}
