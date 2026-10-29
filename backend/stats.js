// Auswertungen für Übersicht und Kontoseiten: Umbuchungen, Kontostände und Werte je Monat

/** Kategorie, mit der sich eine Buchung von Hand als Umbuchung zwischen eigenen Konten kennzeichnen lässt */
const TRANSFER_CATEGORY = "Umbuchung";

/** Betrag der Buchung t mit Vorzeichen: Einnahmen positiv, Ausgaben negativ */
const SIGNED = "CASE WHEN t.type = 'in' THEN t.amount ELSE -t.amount END";

/**
 * true, wenn die Buchung t eine Umbuchung zwischen eigenen Konten ist: Kategorie „Umbuchung“ oder die
 * IBAN der Gegenpartei gehört zu einem anderen eigenen Konto. Umbuchungen zählen in den Auswertungen
 * weder als Einnahme noch als Ausgabe.
 */
const TRANSFER = `(t.category = '${TRANSFER_CATEGORY}' OR EXISTS (
  SELECT 1 FROM accounts own WHERE own.id <> t.account_id
    AND own.iban = upper(regexp_replace(t.details->>'counterpartyIban', '\\s', '', 'g'))))`;

/**
 * Kontostand des Kontos a vor seiner ersten Buchung. Ist ein Kontostand laut Bank an einem Tag
 * hinterlegt, ergibt er sich daraus und aus den Buchungen bis zu diesem Tag, sonst ist er 0.
 * Später importierte ältere Buchungen ändern so nur die früheren Kontostände, nicht den aktuellen.
 */
const OPENING = `COALESCE(a.bank_balance - (SELECT COALESCE(sum(${SIGNED}), 0) FROM transactions t
  WHERE t.account_id = a.id AND t.date <= a.bank_balance_date), 0)`;

/** Konten mit Kontostand (alle Buchungen), Anzahl der Buchungen sowie erstem und letztem Buchungstag */
const ACCOUNTS = `SELECT a.id, a.name, a.kind, a.institution, a.iban,
  a.bank_balance::float8 AS "bankBalance", to_char(a.bank_balance_date, 'YYYY-MM-DD') AS "bankBalanceDate",
  (${OPENING} + COALESCE(s.total, 0))::float8 AS balance, s.count::int AS "transactionCount",
  to_char(s.first, 'YYYY-MM-DD') AS "firstDate", to_char(s.last, 'YYYY-MM-DD') AS "lastDate"
  FROM accounts a LEFT JOIN LATERAL (
    SELECT sum(${SIGNED}) AS total, count(*) AS count, min(t.date) AS first, max(t.date) AS last
    FROM transactions t WHERE t.account_id = a.id) s ON true`;

/**
 * Einnahmen, Ausgaben (beide ohne Umbuchungen) und Umbuchungen (mit Vorzeichen) je Konto und Monat
 * sowie der Kontostand am Monatsende. Lückenlos vom ersten Monat mit Buchungen bis zum Monat `until`
 * (YYYY-MM) bzw. bis zum letzten Monat mit Buchungen, falls der später liegt.
 * Mit `accountId` nur für dieses Konto; ohne für alle Konten, auch solche ohne Buchungen.
 */
async function monthlyStats(db, until, accountId = null) {
  const { rows } = await db.query(
    // MATERIALIZED: Umbuchung und Anfangsstand je Buchung bzw. Konto nur einmal berechnen
    `WITH tx AS MATERIALIZED (
       SELECT t.account_id, date_trunc('month', t.date)::date AS month, ${SIGNED} AS signed, ${TRANSFER} AS transfer
       FROM transactions t WHERE $2::int IS NULL OR t.account_id = $2
     ), flows AS (
       SELECT account_id, month, sum(signed) AS net,
         sum(signed) FILTER (WHERE NOT transfer AND signed > 0) AS income,
         -sum(signed) FILTER (WHERE NOT transfer AND signed < 0) AS expenses,
         sum(signed) FILTER (WHERE transfer) AS transfers
       FROM tx GROUP BY account_id, month
     ), months AS (
       SELECT g.month::date AS month
       FROM (SELECT min(month) AS first, greatest(max(month), to_date($1, 'YYYY-MM')) AS last FROM flows) r,
         generate_series(r.first::timestamp, r.last::timestamp, interval '1 month') AS g(month)
     ), opening AS MATERIALIZED (
       SELECT a.id, ${OPENING} AS amount FROM accounts a WHERE $2::int IS NULL OR a.id = $2
     )
     SELECT to_char(m.month, 'YYYY-MM') AS month, o.id AS "accountId",
       COALESCE(f.income, 0)::float8 AS income, COALESCE(f.expenses, 0)::float8 AS expenses,
       COALESCE(f.transfers, 0)::float8 AS transfers,
       (o.amount + sum(COALESCE(f.net, 0)) OVER (PARTITION BY o.id ORDER BY m.month))::float8 AS balance
     FROM months m CROSS JOIN opening o
     LEFT JOIN flows f ON f.account_id = o.id AND f.month = m.month
     ORDER BY m.month, o.id`,
    [until, accountId],
  );
  return rows;
}

module.exports = { TRANSFER_CATEGORY, SIGNED, TRANSFER, OPENING, ACCOUNTS, monthlyStats };
