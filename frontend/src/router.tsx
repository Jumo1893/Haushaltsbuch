import { useEffect, useMemo, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { ym } from "./format";
import { RHYTHMS, type TransactionFilters } from "./types";

// Kleiner Router über die History-API: Seite und Monat stehen in der Adresse, ein Link lädt die App
// nicht neu. nginx (try_files) und der Vite-Dev-Server liefern für jeden Pfad index.html aus.

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

const currentHref = () => window.location.pathname + window.location.search;

/** Wechselt die Seite. Mit replace ohne neuen Eintrag im Verlauf, z. B. beim Blättern zwischen Monaten. */
export function navigate(to: string, { replace = false } = {}) {
  if (to === currentHref()) return;
  if (replace) {
    history.replaceState(null, "", to);
  } else {
    history.pushState(null, "", to);
    window.scrollTo(0, 0);
  }
  listeners.forEach((listener) => listener());
}

/** Pfad und Query-Parameter der aktuellen Seite */
export function useLocation() {
  const href = useSyncExternalStore(subscribe, currentHref);
  return useMemo(() => {
    const url = new URL(href, window.location.origin);
    return { path: url.pathname, query: url.searchParams };
  }, [href]);
}

/** Link innerhalb der App; Strg- oder Mittelklick öffnen wie gewohnt einen neuen Tab. */
export function Link({ to, onClick, ...props }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string }) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || props.target) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handleClick} {...props} />;
}

/** Titel des Browser-Tabs für die aktuelle Seite */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Haushaltsbuch`;
  }, [title]);
}

/** Monat aus ?monat=YYYY-MM, ohne Angabe der aktuelle. Wechseln ersetzt den Eintrag im Verlauf. */
export function useMonthParam(): [string, (month: string) => void] {
  const { path, query } = useLocation();
  const param = query.get("monat");
  const month = param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param) ? param : ym(new Date());
  return [month, (m: string) => navigate(`${path}?monat=${m}`, { replace: true })];
}

/**
 * Filter aus ?suche=, ?konto=, ?kategorie=, ?art= und ?rhythmus=. Ändern ersetzt den Eintrag im Verlauf, der Monat
 * bleibt.
 */
export function useFilterParams(): [TransactionFilters, (filters: TransactionFilters) => void] {
  const { path, query } = useLocation();
  const filters = useMemo<TransactionFilters>(() => {
    const type = query.get("art");
    const rhythm = RHYTHMS.find(([value]) => value === query.get("rhythmus"))?.[0];
    return {
      text: query.get("suche") ?? "",
      account: Number(/^\d+$/.exec(query.get("konto") ?? "")?.[0]) || null,
      category: query.get("kategorie") ?? "",
      type: type === "in" || type === "out" || type === "transfer" ? type : "",
      rhythm: rhythm ?? "",
    };
  }, [query]);

  const setFilters = ({ text, account, category, type, rhythm }: TransactionFilters) => {
    const next = new URLSearchParams(query);
    const konto = account ? String(account) : "";
    const params = { suche: text, konto, kategorie: category, art: type, rhythmus: rhythm };
    for (const [name, value] of Object.entries(params)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    const search = next.toString();
    navigate(search ? `${path}?${search}` : path, { replace: true });
  };

  return [filters, setFilters];
}
