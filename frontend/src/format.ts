export const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
/** Ganze Euro, z. B. "1.235 €", für Achsen und Kennzahlen */
export const eurWhole = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
export const monthFormat = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
export const monthName = new Intl.DateTimeFormat("de-DE", { month: "long" });
const monthShort = new Intl.DateTimeFormat("de-DE", { month: "short" });
export const dayFormat = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });
export const dateFormat = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
export const dateTimeFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
export const percent = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 0 });

/** Auf Cent gerundet und ohne −0, für Summen aus Gleitkommazahlen */
export const roundCents = (x: number) => Math.round(x * 100) / 100 || 0;

/** Betrag in Euro, auf Cent gerundet */
export const money = (x: number) => eur.format(roundCents(x));

/** Betrag mit Vorzeichen, z. B. "+1.234,56 €" oder "−12,00 €" */
export const signed = (x: number, format: Intl.NumberFormat = eur) => {
  const value = roundCents(x);
  return `${value < 0 ? "−" : "+"}${format.format(Math.abs(value))}`;
};

/** Datum (YYYY-MM-DD) als lokales Date-Objekt */
export const parseDate = (date: string) => new Date(`${date}T00:00:00`);

/** Monat (YYYY-MM) als erster Tag des Monats */
export const parseMonth = (month: string) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);

/** Kurzer Monat für Achsen, z. B. "Okt", im Januar mit Jahr: "Jan 26" */
export const axisMonth = (month: string) => {
  const d = parseMonth(month);
  const name = monthShort.format(d).replace(".", "");
  return d.getMonth() === 0 ? `${name} ${String(d.getFullYear()).slice(2)}` : name;
};

/** IBAN in Vierergruppen, z. B. "DE89 3704 0044 0532 0130 00" */
export const formatIban = (iban: string) => iban.replace(/(.{4})(?=.)/g, "$1 ");

/** z. B. "1 Buchung", "5 Buchungen" */
export const bookings = (n: number) => `${n} ${n === 1 ? "Buchung" : "Buchungen"}`;

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

/** Datum (YYYY-MM-DD) n Monate früher; gibt es den Tag dort nicht, der letzte Tag des Monats */
export const monthsBefore = (date: string, n: number) => {
  const d = parseDate(date);
  const last = new Date(d.getFullYear(), d.getMonth() - n + 1, 0);
  return `${ym(last)}-${pad(Math.min(d.getDate(), last.getDate()))}`;
};

export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

/** Ganze Tage von Datum a bis Datum b (YYYY-MM-DD) */
export const daysBetween = (a: string, b: string) =>
  Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000);
