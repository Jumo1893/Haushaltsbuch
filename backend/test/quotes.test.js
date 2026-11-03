const test = require("node:test");
const assert = require("node:assert/strict");
const { sourceOf, fetchQuotes, savePrices } = require("../quotes");

/** Antwort wie von fetch */
const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => (typeof body === "string" ? JSON.parse(body) : body),
});

/** fetch-Attrappe: antwortet je nach Teil der Adresse und merkt sich die Aufrufe */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    for (const [part, answer] of routes) if (url.includes(part)) return typeof answer === "function" ? answer(url) : answer;
    throw new Error(`unerwartete Anfrage ${url}`);
  };
  fn.calls = calls;
  return fn;
}

const at = (iso) => Date.parse(iso);
const search = (isin, id, categorySymbol = "STK") => reply([{ isin, instrumentId: id, categorySymbol }]);
const chart = (series, data) => reply({ info: {}, series: { [series]: { id: "x", data } } });
const position = (isin, assetClass = "STOCK") => ({ isin, name: `Name ${isin}`, assetClass });

test("Quelle je Anlageklasse", () => {
  assert.deepEqual(["STOCK", "FUND", "BOND", "CRYPTO", "PRIVATE_FUND", ""].map(sourceOf), ["ls", "ls", "ls", "kraken", null, "ls"]);
});

test("Lang & Schwarz: Suche nach ISIN, dann der letzte Mittelkurs des Tages", async () => {
  const fetchFn = fakeFetch([
    ["search/main?q=XX0000000001", search("XX0000000001", 7)],
    ["instrumentId=7&quotetype=mid&series=intraday", chart("intraday", [[at("2026-11-03T08:00:00Z"), 10], [at("2026-11-03T15:00:00Z"), 12.5]])],
  ]);
  const [result] = await fetchQuotes([position("XX0000000001")], { fetchFn });
  assert.deepEqual(result, { isin: "XX0000000001", name: "Name XX0000000001", source: "ls", price: 12.5, date: "2026-11-03" });
  assert.equal(fetchFn.calls.length, 2);
  assert.equal(fetchFn.calls[0].init.headers["User-Agent"], "Haushaltsbuch", "ehrliche Kennung statt Browser");
});

test("Lang & Schwarz: Der Schlusspunkt um Mitternacht gehört zum Handelstag davor", async () => {
  const fetchFn = fakeFetch([
    ["search/main?q=XX0000000002", search("XX0000000002", 8)],
    ["instrumentId=8&", chart("intraday", [[at("2026-11-03T23:00:00Z"), 20]])], // 00:00 Uhr in Deutschland
  ]);
  const [result] = await fetchQuotes([position("XX0000000002")], { fetchFn });
  assert.equal(result.date, "2026-11-03");
});

test("Lang & Schwarz: Anleihen notieren in Prozent, gespeichert wird der Anteil wie im Export", async () => {
  const fetchFn = fakeFetch([
    ["search/main?q=XS0000000003", search("XS0000000003", 9, "BND")],
    ["instrumentId=9&", chart("intraday", [[at("2026-11-03T15:00:00Z"), 91.9]])],
  ]);
  const [result] = await fetchQuotes([position("XS0000000003", "BOND")], { fetchFn });
  assert.equal(result.price, 0.919);
});

test("Lang & Schwarz: ohne Handel am Tag der letzte Kurs der Historie", async () => {
  const fetchFn = fakeFetch([
    ["search/main?q=XX0000000004", search("XX0000000004", 10)],
    ["series=intraday", chart("intraday", [])],
    ["series=history", chart("history", [[at("2026-10-30T12:00:00Z"), 30], [at("2026-10-31T12:00:00Z"), 31]])],
  ]);
  const [result] = await fetchQuotes([position("XX0000000004")], { fetchFn });
  assert.deepEqual([result.price, result.date], [31, "2026-10-31"]);
});

test("Lang & Schwarz: unbekannte ISIN und Treffer zu einer anderen ISIN", async () => {
  const fetchFn = fakeFetch([
    ["q=XX0000000005", reply([])],
    ["q=XX0000000006", search("XX9999999999", 11)],
  ]);
  const results = await fetchQuotes([position("XX0000000005"), position("XX0000000006")], { fetchFn });
  assert.deepEqual(results.map((r) => r.error), ["bei Lang & Schwarz nicht gefunden", "bei Lang & Schwarz nicht gefunden"]);
  assert.ok(results.every((r) => r.price === undefined));
});

test("Lang & Schwarz: Die Suche je ISIN läuft nur beim ersten Abruf", async () => {
  const fetchFn = fakeFetch([
    ["q=XX0000000007", search("XX0000000007", 12)],
    ["instrumentId=12&", chart("intraday", [[at("2026-11-03T15:00:00Z"), 40]])],
  ]);
  await fetchQuotes([position("XX0000000007")], { fetchFn });
  await fetchQuotes([position("XX0000000007")], { fetchFn });
  assert.equal(fetchFn.calls.filter((c) => c.url.includes("search")).length, 1);
  assert.equal(fetchFn.calls.length, 3);
});

test("Kraken: Kürzel aus dem Export plus EUR, der Schlüssel der Antwort ist egal", async () => {
  const fetchFn = fakeFetch([["pair=BTCEUR", reply({ error: [], result: { XXBTZEUR: { c: ["69478.10000", "0.1"] } } })]]);
  const [result] = await fetchQuotes([position("BTC", "CRYPTO")], { fetchFn, now: at("2026-11-03T10:00:00Z") });
  assert.deepEqual(result, { isin: "BTC", name: "Name BTC", source: "kraken", price: 69478.1, date: "2026-11-03" });
});

test("Kraken: unbekanntes Kürzel", async () => {
  const fetchFn = fakeFetch([["pair=NOPEEUR", reply({ error: ["EQuery:Unknown asset pair"] })]]);
  const [result] = await fetchQuotes([position("NOPE", "CRYPTO")], { fetchFn });
  assert.equal(result.error, "bei Kraken nicht gefunden");
});

test("Private-Markets-Fonds haben keine Quelle, es geht keine Anfrage hinaus", async () => {
  const fetchFn = fakeFetch([]);
  const [result] = await fetchQuotes([position("LU0000000008", "PRIVATE_FUND")], { fetchFn });
  assert.deepEqual(result, { isin: "LU0000000008", name: "Name LU0000000008", source: null });
  assert.equal(fetchFn.calls.length, 0);
});

test("Fehler der Quelle werden zur Meldung, die übrigen Kurse kommen trotzdem", async () => {
  const fetchFn = fakeFetch([
    ["q=XX0000000009", () => Promise.reject(new TypeError("fetch failed"))],
    ["q=XX0000000010", reply({}, 503)],
    ["q=XX0000000011", reply("<html>Wartung</html>")],
    ["pair=ETHEUR", reply({ error: [], result: { XETHZEUR: { c: ["2100.5", "1"] } } })],
  ]);
  const results = await fetchQuotes(
    [position("XX0000000009"), position("XX0000000010"), position("XX0000000011"), position("ETH", "CRYPTO")],
    { fetchFn },
  );
  assert.deepEqual(results.map((r) => r.error ?? r.price), [
    "Quelle nicht erreichbar",
    "Quelle antwortet mit 503",
    "Antwort der Quelle nicht lesbar",
    2100.5,
  ]);
});

test("Höchstens drei Abrufe gleichzeitig, das Ergebnis behält die Reihenfolge", async () => {
  let open = 0;
  let most = 0;
  const fetchFn = async (url) => {
    open++;
    most = Math.max(most, open);
    await new Promise((resolve) => setTimeout(resolve, 5));
    open--;
    const coin = /pair=(\w+)EUR/.exec(url)[1];
    return reply({ error: [], result: { [coin]: { c: [String(coin.length), "1"] } } });
  };
  const coins = ["A", "BB", "CCC", "DDDD", "EEEEE", "FFFFFF", "GGGGGGG"];
  const results = await fetchQuotes(coins.map((c) => position(c, "CRYPTO")), { fetchFn });
  assert.equal(most, 3);
  assert.deepEqual(results.map((r) => r.price), [1, 2, 3, 4, 5, 6, 7]);
});

test("Kurse speichern: einer je Wertpapier und Tag, ohne Kurse keine Abfrage", async () => {
  const queries = [];
  const db = { query: async (sql, params) => queries.push({ sql, params }) };
  await savePrices(db, []);
  assert.equal(queries.length, 0);
  await savePrices(db, [
    { isin: "A", date: "2026-11-03", price: 12.5, source: "ls" },
    { isin: "BTC", date: "2026-11-03", price: 69478.1, source: "kraken" },
  ]);
  assert.match(queries[0].sql, /ON CONFLICT \(isin, date\) DO UPDATE/);
  assert.deepEqual(queries[0].params, [["A", "BTC"], ["2026-11-03", "2026-11-03"], [12.5, 69478.1], ["ls", "kraken"]]);
});
