// Automatische Kategorien für Ausgaben: an der Händlerart (MCC) einer Kartenzahlung und an bekannten Supermärkten

const { FALLBACK_CATEGORY } = require("./categories");
const { KIND } = require("./stats");

/**
 * Gruppen von Ausgaben, die eine Kategorie automatisch bekommt. Der Schlüssel steht bei der Kategorie in
 * categories.auto_key, so bleibt die Zuordnung beim Umbenennen erhalten. category: Standardkategorie, die den Schlüssel
 * bekommt; label: was dazugehört, für die Oberfläche; mcc: Händlerarten (Merchant Category Codes nach ISO 18245), wie
 * sie z. B. Trade Republic bei jeder Kartenzahlung mitliefert. Codes, die zu mehreren Kategorien passen (Abos, App-Stores,
 * Software, Bildung, Kaufhäuser), fehlen absichtlich, solche Zahlungen bleiben in „Sonstiges“.
 */
const AUTO_GROUPS = {
  food: {
    category: "Lebensmittel",
    label: "Supermärkte, Bäcker, Metzger, Restaurants und Imbisse",
    // Supermärkte, Metzger, Süßwaren, Molkereien, Bäcker, Feinkost und Kioske, Caterer, Restaurants, Imbisse, Getränke
    mcc: ["5411", "5422", "5441", "5451", "5462", "5499", "5811", "5812", "5814", "5921"],
  },
  mobility: {
    category: "Mobilität",
    label: "Tankstellen, Ladesäulen, Bahn, Bus, Taxi, Mietwagen, Parken und Werkstätten",
    // Nahverkehr, Bahn, Taxi, Bus, Maut, sonstige Beförderung, Reifen, Autoteile, Tankstellen, Tankautomaten,
    // Ladesäulen, Mietwagen, Parken, Karosserie, Reifendienst, Lackierer, Werkstätten, Waschanlagen, Abschleppdienste
    mcc: [
      "4111", "4112", "4121", "4131", "4784", "4789", "5532", "5533", "5541", "5542",
      "5552", "7512", "7523", "7531", "7534", "7535", "7538", "7542", "7549",
    ],
  },
  leisure: {
    category: "Freizeit",
    label: "Kino, Konzerte, Sport, Bars, Streaming und Spiele",
    // Pay-TV und Streaming, Bars, digitale Medien und Spiele, Sportgeschäfte, Spielwaren, Kinos, Tanzschulen, Theater und
    // Tickets, Musiker, Billard, Bowling, Sportvereine, Sehenswürdigkeiten, Golf, Spielhallen, Freizeitparks,
    // Fitnessstudios, Zoos, sonstige Freizeit
    mcc: [
      "4899", "5813", "5815", "5816", "5941", "5945", "7832", "7911", "7922", "7929",
      "7932", "7933", "7941", "7991", "7992", "7994", "7996", "7997", "7998", "7999",
    ],
  },
  health: {
    category: "Gesundheit",
    label: "Ärzte, Apotheken, Optiker und Kliniken",
    // Krankentransport, Apotheken, Hörgeräte, Orthopädie, Ärzte, Zahnärzte, Osteopathen, Chiropraktiker, Augenärzte,
    // Optiker, Fußpflege, Pflege, Kliniken, Labore, sonstige Heilberufe
    mcc: [
      "4119", "5912", "5975", "5976", "8011", "8021", "8031", "8041", "8042", "8043",
      "8049", "8050", "8062", "8071", "8099",
    ],
  },
  housing: {
    category: "Wohnen",
    label: "Strom, Gas, Wasser, Möbel und Baumärkte",
    // Versorger, Baumärkte, Baustoffe, Farben und Tapeten, Eisenwaren, Gärtnereien, Möbel, Bodenbeläge, Gardinen,
    // Wohnaccessoires, Haushaltsgeräte, Vermietung
    mcc: ["4900", "5200", "5211", "5231", "5251", "5261", "5712", "5713", "5714", "5719", "5722", "6513"],
  },
  insurance: {
    category: "Versicherung",
    label: "Versicherungen",
    mcc: ["5960", "6300", "6381", "6399"],
  },
};

/** Händlerart → Gruppe */
const MCC_GROUPS = new Map(Object.entries(AUTO_GROUPS).flatMap(([key, group]) => group.mcc.map((code) => [code, key])));

/**
 * Bekannte Supermarktketten, Bio-Supermärkte und Lieferdienste für Lebensmittel. Sie müssen im Namen der Gegenpartei
 * als eigenes Wort stehen, nur Ziffern dürfen direkt anschließen (Filialnummer, z. B. „REWE4711“).
 */
const SUPERMARKETS = [
  "aldi", "alnatura", "bio company", "denn['’]?s", "e[ -]?center", "edeka", "famila", "flink", "globus", "kaufland",
  "knuspr", "lidl", "marktkauf", "mix markt", "nah\\s*(?:&|und)\\s*gut", "nahkauf", "netto", "norma", "penny", "picnic",
  "rewe", "superbiomarkt", "tegut", "wasgau",
];

/** Angebote dieser Ketten, die keine Lebensmittel sind, z. B. ALDI TALK, Lidl Connect, Penny Reisen, Globus Baumarkt */
const NOT_GROCERIES = [
  "baumarkt", "connect", "fotos?", "life", "mobile?", "photos?", "reisen", "smart", "strom", "talk", "tankstelle",
];

const SUPERMARKET = new RegExp(
  `(?<!\\p{L})(?:${SUPERMARKETS.join("|")})(?!\\p{L})(?![\\s.\\-]*(?:${NOT_GROCERIES.join("|")})(?!\\p{L}))`,
  "iu",
);

/**
 * Gruppe einer Ausgabe: zuerst nach der Händlerart, sonst Lebensmittel, wenn die Gegenpartei ein bekannter Supermarkt
 * ist. Ohne Treffer null.
 */
function autoGroup({ counterparty, mcc }) {
  const group = MCC_GROUPS.get(String(mcc ?? "").trim());
  if (group) return group;
  return SUPERMARKET.test(counterparty ?? "") ? "food" : null;
}

/** Text als SQL-Literal */
const literal = (text) => `'${text.replace(/'/g, "''")}'`;

/**
 * Gibt den Standardkategorien der Ausgaben ihren Schlüssel, solange keine andere Kategorie ihn hat. So bekommt auch eine
 * später gleichnamig neu angelegte Kategorie den Schlüssel zurück, wenn die alte gelöscht wurde.
 */
const SEED_AUTO_KEYS = `UPDATE categories c SET auto_key = d.key
  FROM (VALUES ${Object.entries(AUTO_GROUPS).map(([key, g]) => `(${literal(key)}, ${literal(g.category)})`).join(", ")})
    AS d(key, name)
  WHERE c.kind = 'out' AND c.name = d.name AND c.auto_key IS NULL
    AND NOT EXISTS (SELECT 1 FROM categories o WHERE o.auto_key = d.key)`;

/** SQL: was die Kategorie mit dem Schlüssel in `column` automatisch bekommt, sonst NULL */
const autoLabelSql = (column) =>
  `CASE ${column} ${Object.entries(AUTO_GROUPS)
    .map(([key, g]) => `WHEN ${literal(key)} THEN ${literal(g.label)}`)
    .join(" ")} END`;

/**
 * Ordnet Ausgaben in „Sonstiges“ automatisch zu, deren Kategorie niemand von Hand gewählt hat und die keiner gemerkten
 * Zuordnung folgen (siehe rules.js), mit importId nur die dieses Imports. Gruppen ohne Kategorie mit ihrem Schlüssel
 * (gelöscht) bleiben aus. Liefert die Zahl der zugeordneten Buchungen je Kategorie, die meisten zuerst: [{ name, count }].
 */
async function autoCategorize(db, importId = null) {
  const { rows: targets } = await db.query(
    "SELECT auto_key AS key, name FROM categories WHERE kind = 'out' AND auto_key IS NOT NULL");
  if (!targets.length) return [];
  const names = new Map(targets.map((t) => [t.key, t.name]));
  const { rows } = await db.query(
    `SELECT t.id, t.counterparty, t.details->>'mcc' AS mcc FROM transactions t
     WHERE t.category = $1 AND NOT t.category_manual AND t.rule_id IS NULL AND ${KIND} = 'out'
       AND ($2::int IS NULL OR t.import_id = $2)`,
    [FALLBACK_CATEGORY, importId]);
  const ids = new Map();
  for (const row of rows) {
    const name = names.get(autoGroup(row));
    if (!name) continue;
    if (!ids.has(name)) ids.set(name, []);
    ids.get(name).push(row.id);
  }
  for (const [name, list] of ids) {
    await db.query("UPDATE transactions SET category = $1 WHERE id = ANY($2)", [name, list]);
  }
  return [...ids]
    .map(([name, list]) => ({ name, count: list.length }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

module.exports = { AUTO_GROUPS, SUPERMARKETS, autoGroup, SEED_AUTO_KEYS, autoLabelSql, autoCategorize };
