// Depot: Wertpapierbewegungen aus dem Import und was daraus folgt: Bestände, Einstand, Gewinne und der Depotwert im
// Zeitverlauf. Bestände werden nicht gespeichert, sondern bei jeder Abfrage aus den Bewegungen berechnet. Bewertet wird
// mit dem jüngsten Kurs aus den Bewegungen oder den abgerufenen Kursen (quotes.js).
// Das Geld bleibt im Geldkonto, dort sind Käufe und Verkäufe Umbuchungen (TRADE_BOOKING_TEXTS).
//
// Beträge rechnen hier in Cent mit dem Vorzeichen des Geldkontos: negativ heißt, Geld geht ins Depot.

const crypto = require("node:crypto");
const { loadPrices } = require("./quotes");

/** Buchungsarten, bei denen Geld zwischen Geldkonto und Depot wechselt */
const TRADE_BOOKING_TEXTS = ["BUY", "SELL", "PRIVATE_MARKET_BUY", "IPO_SUBSCRIPTION", "REDEMPTION", "EARLY_REDEMPTION"];

/** Bereich der Zeilen, die nur Geld bewegen. Alle anderen Bereiche ändern den Bestand um die Stückzahl der Zeile. */
const CASH_SECTION = "CASH";
/** Bereich der Einlieferungen ins Depot und Auslieferungen aus dem Depot */
const DELIVERY_SECTION = "DELIVERY";
/** Bereich der Kapitalmaßnahmen */
const CORPORATE_SECTION = "CORPORATE_ACTION";

/** Vorauszahlungen: Das Geld geht jetzt weg, die Anteile kommen später als Kauf ohne Betrag */
const PREPAYMENTS = ["PRIVATE_MARKET_BUY", "IPO_SUBSCRIPTION"];
/** Prämien von Trade Republic: Geld fürs Geldkonto, das dann ein normaler Kauf anlegt, also kein Ertrag des Wertpapiers */
const REWARDS = ["BENEFITS_SAVEBACK", "STOCKPERK"];
/** Kapitalmaßnahmen, bei denen sich nur die Stückzahl ändert, der Einstand bleibt */
const SPLITS = ["SPLIT", "REVERSE_SPLIT"];

/** Kleinere Stückzahlen sind Rundungsreste von Gleitkommazahlen; der Export hat höchstens zehn Nachkommastellen */
const tidy = (shares) => (Math.abs(shares) < 1e-8 ? 0 : shares);

/** Cent als Euro */
const euros = (cents) => Math.round(cents) / 100;

/** Art einer Bewegung, daran hängt ihre Wirkung auf die Position */
function kindOf({ section, type, shares }) {
  if (section === CORPORATE_SECTION && SPLITS.includes(type)) return "split";
  if (section !== CASH_SECTION) return shares < 0 ? "sell" : "buy";
  if (PREPAYMENTS.includes(type)) return "prepayment";
  if (REWARDS.includes(type)) return "reward";
  if (TRADE_BOOKING_TEXTS.includes(type)) return "proceeds";
  return "income"; // Dividende, Ausschüttung, Zinsen; ohne Betrag nur die Steuer, z. B. die Vorabpauschale
}

/** Wertpapierbewegung aus einem gelesenen Datensatz, null ohne Wertpapier */
function readMovement(record) {
  const { isin, assetClass = "", shares = null, price = null, bookingText: type = "" } = record.details;
  if (!isin) return null;
  const fee = Math.round((record.details.fee ?? 0) * 100);
  const tax = Math.round((record.details.tax ?? 0) * 100);
  const amount = record.cents - fee - tax;
  const movement = {
    date: record.date,
    timestamp: record.timestamp ?? null,
    section: record.section ?? "",
    type,
    isin,
    name: record.assetName ?? "",
    assetClass,
    shares,
    price,
    amount,
    fee,
    tax,
  };
  // Am Inhalt erkannt, nicht an der Transaktions-ID: Exporte ohne diese Spalte treffen so dieselben Bewegungen
  const key = [record.date, type, isin, shares ?? "", price ?? "", amount, fee, tax].join("\u001f");
  return { ...movement, hash: crypto.createHash("sha256").update(key).digest("hex") };
}

/**
 * Bereitet Bewegungen und abgerufene Kurse (siehe quotes.js) für den Durchlauf auf. Wechselt ein Wertpapier die ISIN,
 * steht das im Export als zwei Zeilen desselben Tages und derselben Art: die alte ISIN mit negativer, die neue mit
 * positiver Stückzahl. Sie werden hier zu einem Umtausch (into). Ein abgerufener Kurs gilt ab seinem Tag, nach den
 * Bewegungen dieses Tages.
 */
function toEvents(movements, prices = []) {
  const actions = movements.filter((m) => m.section === CORPORATE_SECTION && m.shares);
  const replacements = new Map();
  const taken = new Set();
  for (const out of actions.filter((m) => m.shares < 0)) {
    const into = actions.find(
      (m) => m.shares > 0 && !taken.has(m) && m.date === out.date && m.type === out.type && m.isin !== out.isin,
    );
    if (!into) continue;
    replacements.set(out, into);
    taken.add(into);
  }
  const events = movements.filter((m) => !taken.has(m)).map((m) => ({ date: m.date, movement: m, into: replacements.get(m) }));
  if (!prices.length) return events;
  // Die Sortierung ist stabil, Bewegungen eines Tages behalten ihre Reihenfolge
  return [...events, ...prices.map((quote) => ({ date: quote.date, quote }))]
    .sort((a, b) => a.date.localeCompare(b.date) || !!a.quote - !!b.quote);
}

function positionOf(positions, { isin, name, assetClass, date }) {
  const position = positions.get(isin) ?? {
    isin,
    name,
    assetClass,
    shares: 0,
    cost: 0, // Einstand der vorhandenen Stücke, mit Kaufgebühren
    pending: 0, // bezahlt, aber noch keine Anteile
    realized: 0, // vor Steuern, nach Gebühren
    income: 0,
    taxes: 0,
    fees: 0,
    received: 0, // ohne Geldfluss eingebucht, zum Kurs des Tages
    price: null,
    priceDate: null,
    priceSource: null, // "export" oder die Quelle eines abgerufenen Kurses
    lastDate: date,
  };
  positions.set(isin, position);
  if (name) position.name = name;
  position.lastDate = date;
  return position;
}

function buy(p, m) {
  if (m.amount) {
    p.cost -= m.amount + m.fee;
  } else {
    // Ohne Betrag: Anteile aus einer Vorauszahlung oder ein Gratis-Eingang. Beides zählt zum Kurs des Tages.
    const worth = Math.round((m.shares ?? 0) * (m.price ?? 0) * 100);
    const prepaid = Math.min(p.pending, worth);
    p.pending -= prepaid;
    p.received += worth - prepaid;
    p.cost += worth;
  }
  p.shares = tidy(p.shares + (m.shares ?? 0));
}

/** Gleitender Durchschnitt: Verkaufte Stücke nehmen den durchschnittlichen Einstand aller Stücke mit */
function sell(p, m) {
  const sold = Math.min(-m.shares, Math.max(p.shares, 0));
  const removed = p.shares > 0 ? (p.cost * sold) / p.shares : 0;
  // Fehlen ältere Käufe im Export, bleibt der Bestand bei 0 statt negativ zu werden
  p.shares = Math.max(tidy(p.shares + m.shares), 0);
  p.cost = p.shares ? p.cost - removed : 0;
  if (m.section !== DELIVERY_SECTION) p.realized += m.amount + m.fee - removed;
}

/** Der Einstand bleibt, der letzte Kurs gilt ab jetzt für die neue Stückzahl */
function split(p, m) {
  const before = p.shares;
  p.shares = tidy(before + m.shares);
  if (p.price !== null && before > 0 && p.shares > 0) p.price *= before / p.shares;
}

/** Umtausch in eine neue ISIN: Der Einstand zieht mit um, ein Gewinn entsteht nicht */
function convert(from, to, out, into) {
  const moved = from.shares > 0 ? (from.cost * Math.min(-out.shares, from.shares)) / from.shares : 0;
  to.shares = tidy(to.shares + into.shares);
  to.cost += moved;
  if (from.price !== null) {
    to.price = (from.price * -out.shares) / into.shares;
    to.priceDate = from.priceDate;
    to.priceSource = from.priceSource;
  }
  from.shares = Math.max(tidy(from.shares + out.shares), 0);
  from.cost = from.shares ? from.cost - moved : 0;
}

function apply(positions, { movement: m, into, quote }) {
  if (quote) {
    const p = positions.get(quote.isin);
    if (p) Object.assign(p, { price: quote.price, priceDate: quote.date, priceSource: quote.source });
    return;
  }
  const p = positionOf(positions, m);
  p.fees -= m.fee;
  p.taxes -= m.tax;
  if (into) return convert(p, positionOf(positions, into), m, into);
  const kind = kindOf(m);
  if (kind === "buy") buy(p, m);
  else if (kind === "sell") sell(p, m);
  else if (kind === "split") split(p, m);
  else if (kind === "proceeds") p.realized += m.amount + m.fee;
  else if (kind === "income") p.income += m.amount;
  else if (kind === "prepayment") {
    p.pending -= m.amount;
    p.cost -= m.fee;
  }
  if (m.section !== CASH_SECTION && m.price !== null) {
    p.price = m.price;
    p.priceDate = m.date;
    p.priceSource = "export";
  }
}

/** Wert der Stücke zum letzten bekannten Kurs, in Cent */
const marketValue = (p) => Math.round(p.shares * (p.price ?? 0) * 100);

function positionView(p) {
  const market = marketValue(p);
  return {
    isin: p.isin,
    name: p.name,
    assetClass: p.assetClass,
    shares: p.shares,
    price: p.price,
    priceDate: p.priceDate,
    priceSource: p.priceSource,
    lastDate: p.lastDate,
    invested: euros(p.cost + p.pending),
    pending: euros(p.pending),
    value: euros(market + p.pending),
    unrealized: euros(market - p.cost),
    realized: euros(p.realized),
    income: euros(p.income),
    taxes: euros(p.taxes),
    fees: euros(p.fees),
    received: euros(p.received),
  };
}

/**
 * Bestand des Depots nach allen Bewegungen (nach Zeit sortiert): offene und geschlossene Positionen, Anlageklassen und
 * Summen, alle Beträge in Euro. Bewertet wird mit dem jüngsten Kurs aus den Bewegungen oder aus `prices`, den
 * abgerufenen Kursen (nach Tag sortiert, siehe quotes.js).
 */
function portfolio(movements, prices = []) {
  const positions = new Map();
  for (const event of toEvents(movements, prices)) apply(positions, event);
  const all = [...positions.values()];
  const sum = (pick) => all.reduce((total, p) => total + pick(p), 0);
  const value = euros(sum((p) => marketValue(p) + p.pending));
  const invested = euros(sum((p) => p.cost + p.pending));
  const unrealized = euros(sum((p) => marketValue(p) - p.cost));
  const realized = euros(sum((p) => p.realized));
  const income = euros(sum((p) => p.income));
  const taxes = euros(sum((p) => p.taxes));

  const views = all.map(positionView);
  const positionsOpen = views.filter((p) => p.shares > 0 || p.pending > 0).sort((a, b) => b.value - a.value);
  const classes = new Map();
  for (const p of positionsOpen) classes.set(p.assetClass, (classes.get(p.assetClass) ?? 0) + p.value);

  return {
    totals: {
      value,
      invested,
      pending: euros(sum((p) => p.pending)),
      unrealized,
      realized,
      income,
      taxes,
      fees: euros(sum((p) => p.fees)),
      received: euros(sum((p) => p.received)),
      result: euros((unrealized + realized + income - taxes) * 100),
    },
    positions: positionsOpen,
    closed: views
      .filter((p) => !positionsOpen.includes(p))
      .sort((a, b) => b.lastDate.localeCompare(a.lastDate)),
    allocation: [...classes]
      .map(([assetClass, amount]) => ({ assetClass, value: euros(amount * 100), share: value ? amount / value : 0 }))
      .sort((a, b) => b.value - a.value),
  };
}

/**
 * Wert und Einstand des Depots an aufsteigenden Tagen (YYYY-MM-DD), jeweils vor allen Bewegungen des Tages.
 * Bewertet wird mit dem letzten Kurs, der bis dahin bekannt war, aus den Bewegungen oder aus `prices`.
 */
function standAt(movements, days, prices = []) {
  const events = toEvents(movements, prices);
  const positions = new Map();
  let next = 0;
  return days.map((day) => {
    while (next < events.length && events[next].date < day) apply(positions, events[next++]);
    const all = [...positions.values()];
    return {
      value: euros(all.reduce((total, p) => total + marketValue(p) + p.pending, 0)),
      invested: euros(all.reduce((total, p) => total + p.cost + p.pending, 0)),
    };
  });
}

/** Monate (YYYY-MM) von first bis last */
function monthRange(first, last) {
  const months = [];
  for (let d = new Date(`${first}-01T00:00:00Z`); d.toISOString().slice(0, 7) <= last; d.setUTCMonth(d.getUTCMonth() + 1)) {
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

/** Tag (YYYY-MM-DD) n Tage später */
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Tage (YYYY-MM-DD) von first bis last */
function dayRange(first, last) {
  const days = [];
  for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}

const later = (a, b) => (a > b ? a : b);

/** Monate vom ersten Monat mit Bewegungen bis `until`, bzw. bis zur letzten Bewegung, falls die später liegt */
const monthsOf = (movements, until) =>
  monthRange(movements[0].date.slice(0, 7), later(until, movements[movements.length - 1].date.slice(0, 7)));

/** Wert und Einstand je Monat am Monatsanfang, für den Verlauf des Depots */
function monthlyHistory(movements, until, prices = []) {
  if (!movements.length) return [];
  const months = monthsOf(movements, until);
  const stands = standAt(movements, months.map((month) => `${month}-01`), prices);
  return months.map((month, i) => ({ month, ...stands[i] }));
}

/** Geld, das in einem Monat ins Depot geflossen ist, mit Vorzeichen des Depots, in Cent je Monat */
function flowsByMonth(movements) {
  const flows = new Map();
  for (const m of movements) {
    if (!TRADE_BOOKING_TEXTS.includes(m.type)) continue;
    const month = m.date.slice(0, 7);
    flows.set(month, (flows.get(month) ?? 0) - (m.amount + m.fee + m.tax));
  }
  return flows;
}

const MOVEMENTS = `SELECT id, account_id AS "accountId", to_char(date, 'YYYY-MM-DD') AS date, section, type, isin, name,
  asset_class AS "assetClass", shares::float8 AS shares, price::float8 AS price,
  (amount * 100)::float8 AS amount, (fee * 100)::float8 AS fee, (tax * 100)::float8 AS tax
  FROM depot_movements`;

/** Bewegungen je Konto, nach Zeit sortiert: accountId → Bewegungen. Mit `accountId` nur für dieses Konto. */
async function loadMovements(db, accountId = null) {
  const { rows } = await db.query(
    `${MOVEMENTS} WHERE $1::int IS NULL OR account_id = $1 ORDER BY date, occurred_at NULLS LAST, id`,
    [accountId],
  );
  const byAccount = new Map();
  for (const row of rows) {
    const list = byAccount.get(row.accountId) ?? [];
    list.push(row);
    byAccount.set(row.accountId, list);
  }
  return byAccount;
}

/**
 * Das Depot zum Konto `account`: das Konto selbst, wenn es ein Depot ist, sonst das mit ihm verknüpfte.
 * Gibt es noch keins, wird es angelegt. Liefert { id, name, isNew }.
 */
async function depotOf(db, account) {
  if (account.kind === "depot") return { id: account.id, name: account.name, isNew: false };
  const { rows: [linked] } = await db.query(
    "SELECT id, name FROM accounts WHERE cash_account_id = $1 ORDER BY id LIMIT 1",
    [account.id],
  );
  if (linked) return { ...linked, isNew: false };
  const { rows: [created] } = await db.query(
    `INSERT INTO accounts (name, kind, institution, cash_account_id) VALUES ($1, 'depot', $2, $3) RETURNING id, name`,
    [`${account.name} Depot`.slice(0, 60), account.institution, account.id],
  );
  return { ...created, isNew: true };
}

/** Bewegungen je Konto (siehe loadMovements) und, wenn es welche gibt, die abgerufenen Kurse */
async function loadDepots(db, accountId = null) {
  const byAccount = await loadMovements(db, accountId);
  return { byAccount, prices: byAccount.size ? await loadPrices(db) : [] };
}

/** Konten mit Depot: Der Wert der Wertpapiere zählt zum Kontostand, die Bewegungen zu erstem und letztem Tag */
async function withDepots(db, accounts) {
  const { byAccount, prices } = await loadDepots(db, accounts.length === 1 ? accounts[0].id : null);
  return accounts.map((account) => {
    const movements = byAccount.get(account.id) ?? [];
    if (!movements.length) return { ...account, movementCount: 0 };
    const first = movements[0].date;
    const last = movements[movements.length - 1].date;
    return {
      ...account,
      balance: euros((account.balance + portfolio(movements, prices).totals.value) * 100),
      movementCount: movements.length,
      firstDate: account.firstDate && account.firstDate < first ? account.firstDate : first,
      lastDate: later(account.lastDate ?? "", last),
    };
  });
}

/** Zählt Zeilen der Depots zu den Zeilen der Konten hinzu; beides sortiert nach `point` und Konto */
function mergeRows(rows, extra, point) {
  const byKey = new Map(rows.map((r) => [`${r[point]}/${r.accountId}`, r]));
  for (const row of extra) {
    const same = byKey.get(`${row[point]}/${row.accountId}`);
    if (!same) rows.push(row);
    else {
      same.balance = euros((same.balance + row.balance) * 100);
      if (row.transfers) same.transfers = euros((same.transfers + row.transfers) * 100);
    }
  }
  return rows.sort((a, b) => a[point].localeCompare(b[point]) || a.accountId - b.accountId);
}

/**
 * Ergänzt die Werte je Monat (siehe monthlyStats) um die Depots: Ihr Kontostand am Monatsanfang ist der Depotwert, das
 * Geld von und zu den Geldkonten sind Umbuchungen. So heben sich Käufe in der Summe aller Konten auf.
 */
async function withDepotMonths(db, rows, until, accountId = null) {
  const extra = [];
  const { byAccount, prices } = await loadDepots(db, accountId);
  for (const [id, movements] of byAccount) {
    const flows = flowsByMonth(movements);
    extra.push(...monthlyHistory(movements, until, prices).map(({ month, value }) => ({
      month,
      accountId: id,
      income: 0,
      expenses: 0,
      transfers: euros(flows.get(month) ?? 0),
      balance: value,
    })));
  }
  return mergeRows(rows, extra, "month");
}

/** Ergänzt den Kontostand je Tag (siehe dailyBalances) um den Depotwert am Tagesende, frühestens ab der ersten Bewegung */
async function withDepotDays(db, rows, from, until, accountId = null) {
  const extra = [];
  const { byAccount, prices } = await loadDepots(db, accountId);
  for (const [id, movements] of byAccount) {
    const days = dayRange(later(from, movements[0].date), until);
    const stands = standAt(movements, days.map((day) => addDays(day, 1)), prices);
    extra.push(...days.map((date, i) => ({ date, accountId: id, balance: stands[i].value })));
  }
  return mergeRows(rows, extra, "date");
}

/** Bewegung für die Oberfläche, Beträge in Euro */
const movementView = (m) => ({
  id: m.id,
  date: m.date,
  type: m.type,
  kind: kindOf(m),
  isin: m.isin,
  name: m.name,
  assetClass: m.assetClass,
  shares: m.shares,
  price: m.price,
  amount: euros(m.amount),
  fee: euros(m.fee),
  tax: euros(m.tax),
});

/**
 * Alles für die Seite eines Depots: Bestand, Verlauf bis zum Monat `until`, Bewegungen (neueste zuerst) und der
 * Zeitpunkt, zu dem zuletzt Kurse für seine Wertpapiere abgerufen wurden (null: noch nie)
 */
async function depotView(db, accountId, until) {
  const { byAccount, prices } = await loadDepots(db, accountId);
  const movements = byAccount.get(accountId) ?? [];
  const isins = new Set(movements.map((m) => m.isin));
  const fetched = prices.filter((q) => isins.has(q.isin)).map((q) => q.fetchedAt.getTime());
  return {
    ...portfolio(movements, prices),
    history: monthlyHistory(movements, until, prices),
    movements: movements.map(movementView).reverse(),
    pricesFetchedAt: fetched.length ? new Date(Math.max(...fetched)).toISOString() : null,
  };
}

/** Offene Positionen eines Depots, für den Abruf ihrer Kurse */
async function openPositions(db, accountId) {
  return portfolio((await loadMovements(db, accountId)).get(accountId) ?? []).positions;
}

module.exports = {
  TRADE_BOOKING_TEXTS,
  kindOf,
  readMovement,
  portfolio,
  standAt,
  monthlyHistory,
  flowsByMonth,
  mergeRows,
  depotOf,
  withDepots,
  withDepotMonths,
  withDepotDays,
  depotView,
  openPositions,
};
