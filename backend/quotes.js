// Aktuelle Kurse von außen, nur auf Knopfdruck auf der Seite eines Depots: Wertpapiere von Lang & Schwarz Exchange,
// dem Handelsplatz von Trade Republic, Krypto von Kraken. Beide ohne Konto. Lang & Schwarz hat keine offizielle
// Schnittstelle, abgerufen wird, was die Website für ihre Kursgrafik lädt. Ändert sich das, schlägt der Abruf fehl
// und es gilt weiter der letzte bekannte Kurs. Nach außen gehen nur ISINs und Krypto-Kürzel, nie Stückzahlen oder Beträge.

const LS = "https://www.ls-tc.de/_rpc/json";
const KRAKEN = "https://api.kraken.com/0/public/Ticker";
const HEADERS = { "User-Agent": "Haushaltsbuch", Accept: "application/json" };
const TIMEOUT_MS = 10_000;
/** So viele Abrufe laufen gleichzeitig, mehr würde die Quellen nur belasten */
const PARALLEL = 3;

/** Fehler beim Abruf eines Kurses, die Meldung steht so in der Oberfläche */
class QuoteError extends Error {}

/** Quelle je Anlageklasse. Private-Markets-Fonds haben keine öffentlichen Kurse, nur einen Wert je Monat. */
function sourceOf(assetClass) {
  if (assetClass === "CRYPTO") return "kraken";
  if (assetClass === "PRIVATE_FUND") return null;
  return "ls";
}

async function getJson(fetchFn, url) {
  let res;
  try {
    res = await fetchFn(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new QuoteError("Quelle nicht erreichbar");
  }
  if (!res.ok) throw new QuoteError(`Quelle antwortet mit ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new QuoteError("Antwort der Quelle nicht lesbar");
  }
}

/** Tag (YYYY-MM-DD) eines Zeitpunkts in Deutschland */
const berlinDay = (time) => new Date(time).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

/** Instrumente bei Lang & Schwarz je ISIN, bis zum Neustart gemerkt: Das spart beim nächsten Abruf die Suche */
const lsInstruments = new Map();

async function lsInstrument(fetchFn, isin) {
  if (!lsInstruments.has(isin)) {
    const list = await getJson(fetchFn, `${LS}/.lstc/instrument/search/main?q=${encodeURIComponent(isin)}&localeId=2`);
    const hit = Array.isArray(list) ? list.find((x) => x.isin === isin) : null;
    if (!hit) throw new QuoteError("bei Lang & Schwarz nicht gefunden");
    lsInstruments.set(isin, { id: hit.instrumentId, bond: hit.categorySymbol === "BND" });
  }
  return lsInstruments.get(isin);
}

/** Letzter Mittelkurs bei Lang & Schwarz; ohne Handel am Tag der letzte aus der Kurshistorie */
async function lsQuote(fetchFn, isin) {
  const { id, bond } = await lsInstrument(fetchFn, isin);
  const points = async (series) => {
    const url = `${LS}/instrument/chart/dataForInstrument?instrumentId=${id}&quotetype=mid&series=${series}&localeId=2`;
    return (await getJson(fetchFn, url))?.series?.[series]?.data ?? [];
  };
  let data = await points("intraday");
  if (!data.length) data = await points("history");
  const [time, price] = data[data.length - 1] ?? [];
  if (!(price > 0)) throw new QuoteError("kein Kurs bei Lang & Schwarz");
  return {
    // Anleihen notieren in Prozent vom Nennwert, der Export rechnet mit dem Anteil (98 % = 0,98)
    price: bond ? price / 100 : price,
    // Der letzte Punkt eines Handelstags steht auf Mitternacht und gehört noch zu diesem Tag
    date: berlinDay(time - 1),
  };
}

/** Letzter Preis in Euro bei Kraken. Das Kürzel aus dem Export (BTC, ETH, …) versteht Kraken auch. */
async function krakenQuote(fetchFn, symbol, now) {
  const body = await getJson(fetchFn, `${KRAKEN}?pair=${encodeURIComponent(symbol)}EUR`);
  const [ticker] = Object.values(body?.result ?? {});
  const price = Number(ticker?.c?.[0]);
  if (body?.error?.length || !(price > 0)) throw new QuoteError("bei Kraken nicht gefunden");
  return { price, date: berlinDay(now) };
}

/**
 * Holt Kurse für Positionen [{ isin, name, assetClass }], höchstens PARALLEL Abrufe gleichzeitig. Liefert in derselben
 * Reihenfolge { isin, name, source, price, date }, bei einem Fehler { isin, name, source, error } und für Wertpapiere
 * ohne Quelle { isin, name, source: null }.
 */
async function fetchQuotes(positions, { fetchFn = fetch, now = Date.now() } = {}) {
  const results = new Array(positions.length);
  let next = 0;
  const work = async () => {
    while (next < positions.length) {
      const i = next++;
      const { isin, name, assetClass } = positions[i];
      const source = sourceOf(assetClass);
      if (!source) {
        results[i] = { isin, name, source };
        continue;
      }
      try {
        const quote = source === "kraken" ? await krakenQuote(fetchFn, isin, now) : await lsQuote(fetchFn, isin);
        results[i] = { isin, name, source, ...quote };
      } catch (e) {
        if (!(e instanceof QuoteError)) throw e;
        results[i] = { isin, name, source, error: e.message };
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, work));
  return results;
}

/** Gespeicherte Kurse, nach Tag sortiert: [{ isin, date, price, source, fetchedAt }] */
async function loadPrices(db) {
  const { rows } = await db.query(
    `SELECT isin, to_char(date, 'YYYY-MM-DD') AS date, price::float8 AS price, source, fetched_at AS "fetchedAt"
     FROM depot_prices ORDER BY date, isin`,
  );
  return rows;
}

/** Speichert Kurse, je Wertpapier einen je Tag: Ein späterer Abruf am selben Tag ersetzt den früheren */
async function savePrices(db, quotes) {
  if (!quotes.length) return;
  await db.query(
    `INSERT INTO depot_prices (isin, date, price, source)
     SELECT * FROM unnest($1::text[], $2::date[], $3::numeric[], $4::text[])
     ON CONFLICT (isin, date) DO UPDATE SET price = EXCLUDED.price, source = EXCLUDED.source, fetched_at = now()`,
    [quotes.map((q) => q.isin), quotes.map((q) => q.date), quotes.map((q) => q.price), quotes.map((q) => q.source)],
  );
}

module.exports = { sourceOf, fetchQuotes, loadPrices, savePrices };
