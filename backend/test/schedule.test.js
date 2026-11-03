const test = require("node:test");
const assert = require("node:assert/strict");
const { latestSlot, nextSlot, isDue, runDue, autoPriceState, setAutoPrices } = require("../schedule");

const at = (iso) => Date.parse(iso);
const iso = (time) => new Date(time).toISOString();

test("Termine: werktags 22:30 Uhr deutscher Zeit", () => {
  // 2026-11-04 ist ein Mittwoch, im Winter gilt UTC+1
  assert.deepEqual(latestSlot(at("2026-11-04T22:00:00Z")), { day: "2026-11-04", time: at("2026-11-04T21:30:00Z") });
  assert.equal(latestSlot(at("2026-11-04T09:00:00Z")).day, "2026-11-03", "vormittags gilt der Termin vom Vortag");
  assert.equal(latestSlot(at("2026-11-07T11:00:00Z")).day, "2026-11-06", "samstags der vom Freitag");
  assert.equal(latestSlot(at("2026-11-09T07:00:00Z")).day, "2026-11-06", "montags früh auch");
  assert.equal(iso(latestSlot(at("2026-07-15T21:00:00Z")).time), "2026-07-15T20:30:00.000Z", "im Sommer UTC+2");
});

test("Termine: genau zum Termin zählt er als fällig, der nächste ist am folgenden Werktag", () => {
  const slot = at("2026-11-04T21:30:00Z");
  assert.equal(latestSlot(slot).time, slot);
  assert.equal(nextSlot(slot).day, "2026-11-05");
  assert.equal(nextSlot(at("2026-11-04T09:00:00Z")).day, "2026-11-04");
  assert.equal(nextSlot(at("2026-11-06T22:00:00Z")).day, "2026-11-09", "nach Freitag kommt Montag");
});

test("Termine: Die Umstellung auf Sommerzeit am Wochenende verschiebt die Uhrzeit in UTC", () => {
  // Die Uhr springt am Sonntag, 29.03.2026
  assert.equal(iso(nextSlot(at("2026-03-27T12:00:00Z")).time), "2026-03-27T21:30:00.000Z");
  assert.equal(iso(nextSlot(at("2026-03-28T12:00:00Z")).time), "2026-03-30T20:30:00.000Z");
});

const slot = { day: "2026-11-04", time: at("2026-11-04T21:30:00Z") };
const minutes = (n) => slot.time + n * 60_000;
const since = new Date("2026-10-01T10:00:00Z");
const failedAttempt = (n) => ({ ranAt: iso(minutes(n)), updated: 0, failed: [{ name: "A", error: "Quelle nicht erreichbar" }] });

test("Fällig: ohne Versuch ja, nach dem Einschalten erst zum nächsten Termin", () => {
  assert.equal(isDue({ since, attempts: [] }, slot, minutes(1)), true);
  assert.equal(isDue({ since: new Date(minutes(10)), attempts: [] }, slot, minutes(20)), false);
});

test("Fällig: Ein Versuch mit Kursen oder ohne etwas abzurufen genügt", () => {
  assert.equal(isDue({ since, attempts: [{ ranAt: iso(minutes(1)), updated: 3, failed: [] }] }, slot, minutes(60)), false);
  assert.equal(isDue({ since, attempts: [{ ranAt: iso(minutes(1)), updated: 0, failed: [] }] }, slot, minutes(60)), false);
  const partly = { ranAt: iso(minutes(1)), updated: 2, failed: [{ name: "B", error: "bei Lang & Schwarz nicht gefunden" }] };
  assert.equal(isDue({ since, attempts: [partly] }, slot, minutes(60)), false, "einzelne Lücken holt kein neuer Versuch");
});

test("Fällig: ohne jeden Kurs nach 30 Minuten erneut, höchstens dreimal", () => {
  assert.equal(isDue({ since, attempts: [failedAttempt(1)] }, slot, minutes(20)), false);
  assert.equal(isDue({ since, attempts: [failedAttempt(1)] }, slot, minutes(31)), true);
  assert.equal(isDue({ since, attempts: [failedAttempt(1), failedAttempt(31)] }, slot, minutes(62)), true);
  assert.equal(isDue({ since, attempts: [failedAttempt(1), failedAttempt(31), failedAttempt(62)] }, slot, minutes(200)), false);
});

/** Datenbank-Attrappe für runDue: liefert die Depots und merkt sich die festgehaltenen Versuche */
function fakeDb(depots) {
  const db = {
    inserts: [],
    query: async (sql, params) => {
      if (sql.includes("LEFT JOIN auto_price_runs")) {
        db.day = params[0];
        return { rows: depots };
      }
      if (sql.startsWith("INSERT INTO auto_price_runs")) {
        db.inserts.push(params);
        return { rows: [] };
      }
      throw new Error(`unerwartete Abfrage ${sql}`);
    },
  };
  return db;
}

test("Nur fällige Depots werden abgerufen, jeder Versuch wird festgehalten", async (t) => {
  t.mock.method(console, "log", () => {});
  const db = fakeDb([
    { id: 4, since, attempts: [] },
    { id: 5, since, attempts: [{ ranAt: iso(minutes(1)), updated: 2, failed: [] }] },
  ]);
  const called = [];
  await runDue(db, minutes(5), async (_db, id) => {
    called.push(id);
    return [
      { isin: "A", name: "A AG", source: "ls", price: 12.5, date: "2026-11-04" },
      { isin: "B", name: "B AG", source: "ls", error: "bei Lang & Schwarz nicht gefunden" },
      { isin: "C", name: "Fonds", source: null },
    ];
  });
  assert.equal(db.day, "2026-11-04");
  assert.deepEqual(called, [4]);
  assert.deepEqual(db.inserts, [[4, "2026-11-04", 1, JSON.stringify([{ name: "B AG", error: "bei Lang & Schwarz nicht gefunden" }])]]);
});

test("Ein Fehler beim Abruf zählt als Versuch ohne Kurs", async (t) => {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});
  const db = fakeDb([{ id: 4, since, attempts: [] }]);
  await runDue(db, minutes(5), async () => {
    throw new TypeError("kaputt");
  });
  assert.deepEqual(db.inserts, [[4, "2026-11-04", 0, JSON.stringify([{ name: "", error: "Abruf fehlgeschlagen" }])]]);
});

test("Stand für die Seite: eingeschaltet, nächster Termin, letzter Versuch", async () => {
  const last = { ranAt: "2026-11-03T21:31:02+00:00", updated: 29, failed: [] };
  const db = { query: async () => ({ rows: [{ enabled: true, last }] }) };
  assert.deepEqual(await autoPriceState(db, 4, at("2026-11-04T09:00:00Z")), {
    enabled: true,
    next: "2026-11-04T21:30:00.000Z",
    last,
  });
});

test("Einschalten behält den ersten Zeitpunkt, ausschalten leert ihn", async () => {
  const queries = [];
  const db = { query: async (sql, params) => (queries.push({ sql, params }), { rowCount: params[0] === 4 ? 1 : 0 }) };
  assert.equal(await setAutoPrices(db, 4, true), true);
  assert.equal(await setAutoPrices(db, 99, false), false);
  assert.match(queries[0].sql, /CASE WHEN \$2 THEN COALESCE\(auto_prices_since, now\(\)\) END/);
  assert.deepEqual(queries.map((q) => q.params), [[4, true], [99, false]]);
});
