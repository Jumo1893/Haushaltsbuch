// PayPal: Geld zwischen PayPal und eigenen Konten erkennen und mit der Buchung im anderen Konto verbinden.
// Reicht das Guthaben für eine Zahlung nicht, holt PayPal den Rest per Lastschrift vom Bankkonto. Im Export steht dafür
// eine Bankgutschrift, im Bankkonto die Lastschrift. Beide sind eine Umbuchung, die Ausgabe ist die Zahlung bei PayPal.

const { TRADE_BOOKING_TEXTS } = require("./depot");
const { FALLBACK_CATEGORY } = require("./categories");

/**
 * Arten im PayPal-Export, bei denen Geld zwischen PayPal und einem eigenen Konto, einer Karte oder dem PayPal-Kredit
 * wandert. Sie sind Umbuchungen (siehe TRANSFER in stats.js).
 */
const PAYPAL_TRANSFER_TYPES = [
  "Bankgutschrift auf PayPal-Konto", // vom Bankkonto, meist für eine Zahlung, die das Guthaben übersteigt
  "Überweisung als Zahlungsquelle", // Überweisung vom Bankkonto auf das Guthaben
  "Allgemeine Gutschrift auf Kreditkarte", // von der Kreditkarte für eine Zahlung
  "Zahlung per PayPal-Käuferkredit", // PayPal-Kredit, z. B. „Später bezahlen“; die Rückzahlung kommt vom Bankkonto
  "Von Nutzer eingeleitete Abbuchung", // Auszahlung auf das Bankkonto
  "Allgemeine Abbuchung", // Auszahlung auf das Bankkonto
  "Rückbuchung von ACH-Gutschrift", // Die Bank hat eine Lastschrift zurückgegeben
  "Rückbuchung von ACH-Abbuchung", // Eine Auszahlung wurde abgelehnt, das Geld ist zurück bei PayPal
];

/** PayPal-Kredit: Die Rückzahlung kommt erst nach rund 30 Tagen */
const CREDIT_TYPE = "Zahlung per PayPal-Käuferkredit";

/**
 * Wie viele Tage die Buchung im anderen Konto vor (negativ) und nach der bei PayPal liegen darf. Die Lastschrift bucht
 * die Bank meist 1 bis 4 Tage später. Gibt sie eine Lastschrift zurück oder holt PayPal Geld für ein Minus im
 * Guthaben, bucht die Bank auch schon vor PayPal.
 */
const WINDOW = [-3, 7];
const CREDIT_WINDOW = [0, 45];

/** Gläubiger-ID von PayPal Europe in Lastschriften */
const PAYPAL_CREDITOR_ID = "LU96ZZZ0000000000000000058";

const literal = (text) => `'${text.replace(/'/g, "''")}'`;

/** Tage von `from` bis `to` (YYYY-MM-DD) */
const daysBetween = (from, to) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

/** Text zum Vergleichen: klein geschrieben, nur Wörter aus Buchstaben und Ziffern, eingerahmt von Leerzeichen */
const words = (text) => ` ${String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

/**
 * Paart Geldbewegungen bei PayPal mit Buchungen anderer Konten. Ein Paar hat denselben Betrag in Gegenrichtung (bei
 * PayPal ohne Gebühr), und die Buchung im anderen Konto liegt im Fenster um den Tag bei PayPal (WINDOW, beim
 * Käuferkredit CREDIT_WINDOW). Unter mehreren möglichen Paaren gehen die vor, bei denen die Gegenpartei bei PayPal (der
 * Händler) im Verwendungszweck der anderen Buchung steht, dann die, bei denen die Bank nicht vor PayPal bucht, dann der
 * kleinste Abstand. Jede Buchung gehört zu höchstens einem Paar.
 * - paypal: [{ id, accountId, date, cents, type, counterparty }], cents mit Vorzeichen, type die Art bei PayPal
 * - others: [{ id, accountId, date, cents, purpose }]
 * Liefert die Paare [{ paypal, other }] mit den Einträgen der Listen.
 */
function pairTransfers(paypal, others) {
  const byCents = new Map();
  for (const o of others) {
    if (!byCents.has(o.cents)) byCents.set(o.cents, []);
    byCents.get(o.cents).push(o);
  }
  const candidates = [];
  for (const p of paypal) {
    const [from, to] = p.type === CREDIT_TYPE ? CREDIT_WINDOW : WINDOW;
    const merchant = words(p.counterparty);
    const known = merchant.trim() !== "";
    for (const o of byCents.get(-p.cents) ?? []) {
      if (o.accountId === p.accountId) continue;
      const lag = daysBetween(p.date, o.date);
      if (lag < from || lag > to) continue;
      candidates.push({ p, o, lag, named: known && words(o.purpose).includes(merchant) });
    }
  }
  candidates.sort(
    (a, b) =>
      b.named - a.named ||
      (a.lag < 0) - (b.lag < 0) ||
      Math.abs(a.lag) - Math.abs(b.lag) ||
      a.p.id - b.p.id ||
      a.o.id - b.o.id,
  );
  const used = new Set();
  const pairs = [];
  for (const { p, o } of candidates) {
    if (used.has(p) || used.has(o)) continue;
    used.add(p);
    used.add(o);
    pairs.push({ paypal: p, other: o });
  }
  return pairs;
}

/** SQL: Die Buchung t kann zu einem Paar gehören: noch nicht verbunden und nicht von Hand als „keine Umbuchung“ markiert */
const OPEN = "t.linked_id IS NULL AND t.transfer_override IS NOT FALSE";

/** SQL: Die Buchung t ist eine Geldbewegung bei PayPal von oder zu einem eigenen Konto */
const PAYPAL_SIDE = `t.details->>'bookingText' IN (${PAYPAL_TRANSFER_TYPES.map(literal).join(",")})`;

/** SQL: Die Buchung t ist von oder an PayPal, aber kein Wertpapiergeschäft (z. B. Aktien von PayPal) */
const OTHER_SIDE = `(t.counterparty ILIKE '%paypal%' OR t.details->>'creditorId' = '${PAYPAL_CREDITOR_ID}')
  AND COALESCE(t.details->>'bookingText', '') NOT IN (${[...TRADE_BOOKING_TEXTS, ...PAYPAL_TRANSFER_TYPES].map(literal).join(",")})`;

/** SQL: Betrag der Buchung t in Cent mit Vorzeichen, ohne die Gebühr aus dem Import */
const GROSS_CENTS = `round(((CASE WHEN t.type = 'in' THEN t.amount ELSE -t.amount END)
  - COALESCE((t.details->>'fee')::numeric, 0)) * 100)::bigint`;

const ITEM = `t.id, t.account_id AS "accountId", t.import_id AS "importId", to_char(t.date, 'YYYY-MM-DD') AS date`;

/** Offene Buchungen beider Seiten aus der Datenbank, für die anderen Konten nur im Zeitraum, in dem Paare möglich sind */
async function loadOpen(db) {
  const { rows: paypal } = await db.query(
    `SELECT ${ITEM}, ${GROSS_CENTS} AS cents, t.details->>'bookingText' AS type, t.counterparty
     FROM transactions t WHERE ${OPEN} AND ${PAYPAL_SIDE}`,
  );
  return { paypal: paypal.map(withNumber), others: await loadOthers(db, paypal) };
}

/** Offene Buchungen der anderen Konten, die zu den Geldbewegungen bei PayPal in `paypal` passen können */
async function loadOthers(db, paypal) {
  if (!paypal.length) return [];
  const dates = paypal.map((p) => p.date).sort();
  const { rows } = await db.query(
    `SELECT ${ITEM}, ${GROSS_CENTS} AS cents, t.purpose FROM transactions t
     WHERE ${OPEN} AND ${OTHER_SIDE} AND t.date BETWEEN $1::date + $3::int AND $2::date + $4::int`,
    [dates[0], dates.at(-1), Math.min(WINDOW[0], CREDIT_WINDOW[0]), Math.max(WINDOW[1], CREDIT_WINDOW[1])],
  );
  return rows.map(withNumber);
}

/** node-postgres liefert bigint als Text */
const withNumber = (row) => ({ ...row, cents: Number(row.cents) });

/**
 * Verbindet jede offene Geldbewegung bei PayPal mit der passenden Buchung eines anderen Kontos (siehe pairTransfers),
 * in beide Richtungen: Beide zeigen per linked_id aufeinander und gelten damit als Umbuchung. Eine automatisch
 * vergebene Kategorie für Ausgaben (siehe autocategories.js) passt dann nicht mehr und geht zurück in die
 * Auffangkategorie, eine von Hand gewählte bleibt. Läuft nach jedem Import, gleich welches Konto er betrifft, und beim
 * Start. Liefert die neuen Paare mit Konto und Import beider Seiten.
 */
async function linkTransfers(db) {
  const { paypal, others } = await loadOpen(db);
  const pairs = pairTransfers(paypal, others);
  if (!pairs.length) return [];
  const self = pairs.flatMap(({ paypal: p, other: o }) => [p.id, o.id]);
  const linked = pairs.flatMap(({ paypal: p, other: o }) => [o.id, p.id]);
  await db.query(
    `UPDATE transactions t SET linked_id = l.linked,
       category = CASE WHEN t.category_manual OR t.rule_id IS NOT NULL THEN t.category ELSE $3 END
     FROM unnest($1::int[], $2::int[]) AS l(id, linked) WHERE t.id = l.id`,
    [self, linked, FALLBACK_CATEGORY],
  );
  return pairs;
}

/**
 * Für die Zusammenfassung eines Imports: die Konten der Buchungen, mit denen neue Buchungen dieses Imports verbunden
 * wurden, mit der Zahl der Paare: [{ id, name, count }]
 */
async function linkedAccounts(db, pairs, importId) {
  const counts = new Map();
  for (const { paypal: p, other: o } of pairs) {
    const [mine, theirs] = p.importId === importId ? [p, o] : [o, p];
    if (mine.importId !== importId || theirs.importId === importId) continue;
    counts.set(theirs.accountId, (counts.get(theirs.accountId) ?? 0) + 1);
  }
  return namedCounts(db, counts);
}

/** Konten mit Namen zu einer Zählung Konto-ID → Anzahl, die meisten zuerst */
async function namedCounts(db, counts) {
  if (!counts.size) return [];
  const { rows } = await db.query("SELECT id, name FROM accounts WHERE id = ANY($1)", [[...counts.keys()]]);
  return rows
    .map(({ id, name }) => ({ id, name, count: counts.get(id) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** true, wenn ein Umsatz aus einer Datei die Gegenpartei PayPal hat und auf die andere Seite eines Paars gehört */
function isOtherSide(record) {
  const text = record.details.bookingText ?? "";
  return (
    (/paypal/i.test(record.counterparty) || record.details.creditorId === PAYPAL_CREDITOR_ID) &&
    !TRADE_BOOKING_TEXTS.includes(text) &&
    !PAYPAL_TRANSFER_TYPES.includes(text)
  );
}

/** Betrag eines Umsatzes aus einer Datei in Cent mit Vorzeichen, ohne Gebühr */
const grossCents = (record) => record.cents - Math.round((record.details.fee ?? 0) * 100);

/**
 * Für die Vorschau: Wie viele neue Umsätze der Datei ein Import mit Buchungen anderer Konten verbinden würde, je Konto
 * der anderen Seite: [{ id, name, count }]. `accountOf(record)` ist das Konto eines Umsatzes, null, wenn es noch nicht
 * feststeht (wird gewählt oder angelegt).
 */
async function previewLinks(db, rows, accountOf) {
  const fresh = rows.filter((r) => r.status === "new").map((r) => r.record);
  const item = (record, i) => ({
    id: -(i + 1), // eigene IDs der Datei, damit sie sich nicht mit gespeicherten Buchungen überschneiden
    accountId: accountOf(record),
    date: record.date,
    cents: grossCents(record),
    type: record.details.bookingText,
    counterparty: record.counterparty,
    purpose: record.purpose,
    file: true,
  });
  const items = fresh.map(item);
  const filePaypal = items.filter((x) => PAYPAL_TRANSFER_TYPES.includes(x.type));
  const fileOthers = items.filter((x, i) => isOtherSide(fresh[i]));
  if (!filePaypal.length && !fileOthers.length) return [];

  const { rows: dbPaypal } = await db.query(
    `SELECT ${ITEM}, ${GROSS_CENTS} AS cents, t.details->>'bookingText' AS type, t.counterparty
     FROM transactions t WHERE ${OPEN} AND ${PAYPAL_SIDE}`,
  );
  const paypal = [...dbPaypal.map(withNumber), ...filePaypal];
  const others = [...(await loadOthers(db, paypal)), ...fileOthers];
  const counts = new Map();
  for (const { paypal: p, other: o } of pairTransfers(paypal, others)) {
    if (p.file === o.file) continue;
    const theirs = p.file ? o : p;
    counts.set(theirs.accountId, (counts.get(theirs.accountId) ?? 0) + 1);
  }
  return namedCounts(db, counts);
}

/**
 * Löst die Verbindungen der Buchungen `ids` zu ihren Gegenbuchungen, z. B. wenn jemand eine davon von Hand zu „keine
 * Umbuchung“ macht. Die Gegenbuchung gilt dann wieder, was sonst für sie gilt. Liefert die IDs der Gegenbuchungen.
 */
async function unlink(db, ids) {
  const { rows } = await db.query(
    "UPDATE transactions SET linked_id = NULL WHERE linked_id IS NOT NULL AND (linked_id = ANY($1) OR id = ANY($1)) RETURNING id",
    [ids],
  );
  return rows.map((r) => r.id).filter((id) => !ids.includes(id));
}

module.exports = {
  PAYPAL_TRANSFER_TYPES,
  PAYPAL_CREDITOR_ID,
  WINDOW,
  CREDIT_WINDOW,
  pairTransfers,
  linkTransfers,
  linkedAccounts,
  previewLinks,
  isOtherSide,
  unlink,
};
