export const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
export const monthFormat = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
export const dayFormat = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });
export const dateFormat = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Datum (YYYY-MM-DD) als lokales Date-Objekt */
export const parseDate = (date: string) => new Date(`${date}T00:00:00`);

/** Dateigröße in MB, z. B. "5 MB" */
export const megabytes = (bytes: number) =>
  `${(bytes / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;

const pad = (n: number) => String(n).padStart(2, "0");

/** Monat als YYYY-MM */
export const ym = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

/** Heutiges Datum als YYYY-MM-DD */
export const today = () => {
  const t = new Date();
  return `${ym(t)}-${pad(t.getDate())}`;
};

/** Erster Tag des Monats, in dem das Datum (YYYY-MM-DD) liegt */
export const monthOf = (date: string) => new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, 1);

export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
