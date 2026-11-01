// Auswertungen für Übersicht und Kontoseiten: Umbuchungen, Kontostände und Werte je Monat

/**
 * Buchungsarten von Trade Republic für Geld von und zu Konten bei anderen Banken. Ältere Exporte nennen dafür
 * keine IBAN, die Art ist dann der einzige Hinweis auf eine Umbuchung.
 */
const TRANSFER_BOOKING_TEXTS = [
  "CUSTOMER_INPAYMENT",
  "TRANSFER_INBOUND",
  "TRANSFER_INSTANT_INBOUND",
  "TRANSFER_INSTANT_OUTBOUND",
];

/** Betrag der Buchung t mit Vorzeichen: Einnahmen positiv, Ausgaben negativ */
const SIGNED = "CASE WHEN t.type = 'in' THEN t.amount ELSE -t.amount END";

/** IBAN der Gegenpartei der Buchung t ohne Leerraum, leer oder NULL ohne Angabe */
const COUNTERPARTY_IBAN = "upper(regexp_replace(t.details->>'counterpartyIban', '\\s', '', 'g'))";

/**
 * true, wenn die Buchung t eine Umbuchung zwischen eigenen Konten ist. Was von Hand festgelegt ist
 * (transfer_override), gilt immer. Sonst wird bei jeder Abfrage neu erkannt, eine später eingetragene IBAN gilt
 * also auch für alte Buchungen: Die IBAN der Gegenpartei gehört zu einem anderen eigenen Konto oder, wenn der
 * Export keine IBAN nennt, die Buchungsart steht für Geld von und zu einer anderen Bank.
 * Umbuchungen zählen in den Auswertungen weder als Einnahme noch als Ausgabe.
 */
const TRANSFER = `COALESCE(t.transfer_override, EXISTS (
  SELECT 1 FROM accounts own WHERE own.id <> t.account_id AND ${COUNTERPARTY_IBAN} = ANY(own.extra_ibans || own.iban))
  OR (COALESCE(${COUNTERPARTY_IBAN}, '') = ''
    AND t.details->>'bookingText' IN (${TRANSFER_BOOKING_TEXTS.map((text) => `'${text}'`).join(",")})), false)`;

/** Art der Buchung t: `transfer` bei einer Umbuchung, sonst `in` oder `out` */
const KIND = `CASE WHEN ${TRANSFER} THEN 'transfer' ELSE t.type END`;

/**
 * Kontostand des Kontos a vor seiner ersten Buchung. Ist ein Kontostand laut Bank an einem Tag
 * hinterlegt, ergibt er sich daraus und aus den Buchungen bis zu diesem Tag, sonst ist er 0.
 * Später importierte ältere Buchungen ändern so nur die früheren Kontostände, nicht den aktuellen.
 */
const OPENING = `COALESCE(a.bank_balance - (SELECT COALESCE(sum(${SIGNED}), 0) FROM transactions t
  WHERE t.account_id = a.id AND t.date <= a.bank_balance_date), 0)`;

/**
 * Für Round-Ups vorgemerkter Betrag des Kontos a. Trade Republic rundet jede Kartenzahlung auf den nächsten
 * vollen Euro auf (volle Beträge um 1,00 €), zieht die Differenz gleich vom Guthaben ab und investiert sie erst
 * mit den Sparplänen. Vorgemerkt sind also die Aufrundungen aller Kartenzahlungen nach dem letzten Sparplan-Kauf.
 */
const PENDING_ROUND_UPS = `SELECT sum(1 - t.amount % 1) AS total FROM transactions t
  WHERE t.account_id = a.id AND t.type = 'out' AND t.details->>'bookingText' LIKE 'CARD_TRANSACTION%'
    AND t.date > (SELECT max(p.date) FROM transactions p
      WHERE p.account_id = a.id AND p.purpose LIKE 'Savings plan execution%')`;

/**
 * Konten mit Kontostand (alle Buchungen), vorgemerkten Round-Ups, Anzahl der Buchungen sowie erstem und
 * letztem Buchungstag
 */
const ACCOUNTS = `SELECT a.id, a.name, a.kind, a.institution, a.iban, a.extra_ibans AS "extraIbans",
  a.bank_balance::float8 AS "bankBalance", to_char(a.bank_balance_date, 'YYYY-MM-DD') AS "bankBalanceDate",
  (${OPENING} + COALESCE(s.total, 0))::float8 AS balance, COALESCE(r.total, 0)::float8 AS "pendingRoundUps",
  s.count::int AS "transactionCount",
  to_char(s.first, 'YYYY-MM-DD') AS "firstDate", to_char(s.last, 'YYYY-MM-DD') AS "lastDate"
  FROM accounts a LEFT JOIN LATERAL (
    SELECT sum(${SIGNED}) AS total, count(*) AS count, min(t.date) AS first, max(t.date) AS last
    FROM transactions t WHERE t.account_id = a.id) s ON true
  LEFT JOIN LATERAL (${PENDING_ROUND_UPS}) r ON true`;

/**
 * Einnahmen, Ausgaben (beide ohne Umbuchungen) und Umbuchungen (mit Vorzeichen) je Konto und Monat
 * sowie der Kontostand am Monatsanfang, also vor allen Buchungen des Monats. Lückenlos vom ersten
 * Monat mit Buchungen bis zum Monat `until` (YYYY-MM) bzw. bis zum letzten Monat mit Buchungen,
 * falls der später liegt.
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
       (o.amount + COALESCE(sum(COALESCE(f.net, 0)) OVER (PARTITION BY o.id ORDER BY m.month
         ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0))::float8 AS balance
     FROM months m CROSS JOIN opening o
     LEFT JOIN flows f ON f.account_id = o.id AND f.month = m.month
     ORDER BY m.month, o.id`,
    [until, accountId],
  );
  return rows;
}

/**
 * Kontostand je Konto am Ende jedes Tages (nach allen Buchungen des Tages), lückenlos von `from` bis
 * `until` (YYYY-MM-DD), aber frühestens ab der ersten Buchung.
 * Mit `accountId` nur für dieses Konto; ohne für alle Konten, auch solche ohne Buchungen.
 */
async function dailyBalances(db, from, until, accountId = null) {
  const { rows } = await db.query(
    `WITH flows AS (
       SELECT t.account_id, t.date, sum(${SIGNED}) AS net
       FROM transactions t WHERE t.date <= $2 AND ($3::int IS NULL OR t.account_id = $3)
       GROUP BY t.account_id, t.date
     ), days AS (
       SELECT g.day::date AS day
       FROM generate_series(greatest($1::date, (SELECT min(date) FROM flows))::timestamp, $2::date::timestamp,
         interval '1 day') AS g(day)
     ), opening AS MATERIALIZED (
       SELECT a.id, ${OPENING} + COALESCE((SELECT sum(f.net) FROM flows f
         WHERE f.account_id = a.id AND f.date < $1), 0) AS amount
       FROM accounts a WHERE $3::int IS NULL OR a.id = $3
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS date, o.id AS "accountId",
       (o.amount + sum(COALESCE(f.net, 0)) OVER (PARTITION BY o.id ORDER BY d.day))::float8 AS balance
     FROM days d CROSS JOIN opening o
     LEFT JOIN flows f ON f.account_id = o.id AND f.date = d.day
     ORDER BY d.day, o.id`,
    [from, until, accountId],
  );
  return rows;
}

module.exports = { SIGNED, TRANSFER, KIND, OPENING, ACCOUNTS, monthlyStats, dailyBalances };
