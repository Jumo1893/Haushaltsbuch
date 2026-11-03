// Täglicher Kursabruf: An Werktagen um 22:30 Uhr deutscher Zeit, nach Handelsschluss bei Lang & Schwarz, holt das Backend
// die Kurse der Depots, bei denen er eingeschaltet ist (accounts.auto_prices_since). Alle fünf Minuten prüft es, ob ein
// Termin fällig ist, so holt es nach dem Start oder dem Aufwachen des Rechners einen verpassten Termin nach. Für mehrere
// verpasste Termine genügt ein Abruf, ältere Kurse liefern die Quellen ohnehin nicht. Bekommt ein Abruf keinen einzigen
// Kurs, z. B. ohne Netz, folgt nach 30 Minuten ein neuer Versuch, höchstens drei je Termin. Jeder Versuch steht in
// auto_price_runs. Feiertage kennt der Plan nicht: Ohne Handel liefern die Quellen den Kurs des letzten Handelstags.

const { refreshDepot } = require("./depot");

const SLOT_HOUR = 22;
const SLOT_MINUTE = 30;
const CHECK_MS = 5 * 60_000;
const RETRY_MS = 30 * 60_000;
const MAX_ATTEMPTS = 3;
const DAY_MS = 86_400_000;

const berlinParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Vorsprung der deutschen Zeit vor UTC zum Zeitpunkt `time`, in ms */
function berlinOffset(time) {
  const p = Object.fromEntries(berlinParts.formatToParts(new Date(time)).map(({ type, value }) => [type, Number(value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(time / 1000) * 1000;
}

/** Tag (YYYY-MM-DD) in Deutschland zum Zeitpunkt `time` */
const berlinDay = (time) => new Date(time).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

const pad = (n) => String(n).padStart(2, "0");
const shiftDay = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const isWeekday = (day) => [1, 2, 3, 4, 5].includes(new Date(`${day}T12:00:00Z`).getUTCDay());

/** Termin eines Tages: 22:30 Uhr deutscher Zeit. Die Uhr wird nachts umgestellt, nie um diese Zeit. */
function slotOf(day) {
  const wall = Date.parse(`${day}T${pad(SLOT_HOUR)}:${pad(SLOT_MINUTE)}:00Z`);
  return { day, time: wall - berlinOffset(wall) };
}

/** Letzter Termin bis `now`: { day, time } */
function latestSlot(now) {
  for (let day = berlinDay(now); ; day = shiftDay(day, -1)) {
    const slot = slotOf(day);
    if (isWeekday(day) && slot.time <= now) return slot;
  }
}

/** Nächster Termin nach `now`: { day, time } */
function nextSlot(now) {
  for (let day = berlinDay(now); ; day = shiftDay(day, 1)) {
    const slot = slotOf(day);
    if (isWeekday(day) && slot.time > now) return slot;
  }
}

/** Ein Versuch ist geglückt, wenn er mindestens einen Kurs bekam oder es nichts abzurufen gab */
const succeeded = ({ updated, failed }) => updated > 0 || failed.length === 0;

/**
 * true, wenn für ein Depot zum Termin `slot` ein Abruf fällig ist. `since`: eingeschaltet seit, `attempts`: die Versuche
 * zu diesem Termin, ältester zuerst. Wer nach dem Termin einschaltet, wartet auf den nächsten.
 */
function isDue({ since, attempts }, slot, now) {
  if (new Date(since).getTime() > slot.time) return false;
  if (attempts.length >= MAX_ATTEMPTS || attempts.some(succeeded)) return false;
  const last = attempts[attempts.length - 1];
  return !last || now - new Date(last.ranAt).getTime() >= RETRY_MS;
}

/** Holt die Kurse aller Depots, bei denen ein Abruf fällig ist, und hält jeden Versuch fest */
async function runDue(db, now = Date.now(), refresh = refreshDepot) {
  const slot = latestSlot(now);
  const { rows } = await db.query(
    `SELECT a.id, a.auto_prices_since AS since,
       COALESCE(json_agg(json_build_object('ranAt', r.ran_at, 'updated', r.updated, 'failed', r.failed)
         ORDER BY r.ran_at) FILTER (WHERE r.id IS NOT NULL), '[]') AS attempts
     FROM accounts a LEFT JOIN auto_price_runs r ON r.account_id = a.id AND r.due = $1
     WHERE a.auto_prices_since IS NOT NULL
     GROUP BY a.id ORDER BY a.id`,
    [slot.day],
  );
  for (const depot of rows.filter((d) => isDue(d, slot, now))) {
    let updated = 0;
    let failed;
    try {
      const results = await refresh(db, depot.id);
      updated = results.filter((r) => r.price).length;
      failed = results.filter((r) => r.error).map(({ name, error }) => ({ name, error }));
    } catch (e) {
      // Ohne Meldungstext: Fehler der Datenbank können Inhalte enthalten
      console.error("Automatischer Kursabruf fehlgeschlagen:", e.code ?? e.name);
      failed = [{ name: "", error: "Abruf fehlgeschlagen" }];
    }
    await db.query("INSERT INTO auto_price_runs (account_id, due, updated, failed) VALUES ($1, $2, $3, $4)", [
      depot.id,
      slot.day,
      updated,
      JSON.stringify(failed),
    ]);
    console.log(`Kurse automatisch abgerufen für Depot ${depot.id}: ${updated} Kurse, ${failed.length} ohne Kurs.`);
  }
}

/** Prüft gleich nach dem Start und danach alle fünf Minuten, ob Abrufe fällig sind */
function startSchedule(db) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDue(db);
    } catch (e) {
      console.error("Prüfung des täglichen Kursabrufs fehlgeschlagen:", e.code ?? e.name);
    } finally {
      running = false;
    }
  };
  tick();
  return setInterval(tick, CHECK_MS);
}

/** Stand des täglichen Abrufs eines Depots: eingeschaltet, nächster Termin und letzter Versuch (null: noch keiner) */
async function autoPriceState(db, accountId, now = Date.now()) {
  const { rows: [row] } = await db.query(
    `SELECT a.auto_prices_since IS NOT NULL AS enabled,
       (SELECT json_build_object('ranAt', r.ran_at, 'updated', r.updated, 'failed', r.failed)
        FROM auto_price_runs r WHERE r.account_id = a.id ORDER BY r.ran_at DESC, r.id DESC LIMIT 1) AS last
     FROM accounts a WHERE a.id = $1`,
    [accountId],
  );
  return { enabled: row.enabled, next: new Date(nextSlot(now).time).toISOString(), last: row.last };
}

/** Schaltet den täglichen Abruf ein oder aus; false, wenn es das Konto nicht gibt */
async function setAutoPrices(db, accountId, enabled) {
  const { rowCount } = await db.query(
    "UPDATE accounts SET auto_prices_since = CASE WHEN $2 THEN COALESCE(auto_prices_since, now()) END WHERE id = $1",
    [accountId, enabled],
  );
  return rowCount > 0;
}

module.exports = { latestSlot, nextSlot, isDue, runDue, startSchedule, autoPriceState, setAutoPrices };
