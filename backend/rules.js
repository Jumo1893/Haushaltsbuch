// Gemerkte Zuordnungen: Kategorie und Rhythmus einer Buchung für alle Buchungen derselben Gegenpartei

const { KINDS, FALLBACK_CATEGORY } = require("./categories");
const { KIND } = require("./stats");

/** SQL: Gegenpartei in `column` zum Vergleichen, ohne Unterschied bei Groß- und Kleinschreibung und Leerraum */
const matchKey = (column) => `lower(btrim(regexp_replace(${column}, '\\s+', ' ', 'g')))`;

/**
 * SQL: Die Buchung t darf einer gemerkten Zuordnung folgen. Ihre Kategorie hat niemand von Hand gewählt, und ein
 * Rhythmus stammt, wenn sie einen hat, von einer gemerkten Zuordnung. Den Rhythmus setzt sonst nur, wer die Buchung von
 * Hand bearbeitet, denn der Import setzt keinen.
 */
const FREE = "NOT t.category_manual AND (t.rule_id IS NOT NULL OR t.rhythm IS NULL)";

/** Gemerkte Zuordnungen wie in GET /api/rules, mit der Zahl der Buchungen, die ihnen gerade folgen */
const RULES = `SELECT r.id, r.kind, r.type, r.counterparty, r.amount::float8 AS amount, c.name AS category, r.rhythm,
  (SELECT count(*) FROM transactions t WHERE t.rule_id = r.id)::int AS "transactionCount"
  FROM rules r JOIN categories c ON c.id = r.category_id`;

/** Zahl der Buchungen je Kategorie, die meisten zuerst; die Auffangkategorie zählt nicht als Zuordnung */
function countByName(rows) {
  const counts = new Map();
  for (const { name, count = 1 } of rows) {
    if (name !== FALLBACK_CATEGORY) counts.set(name, (counts.get(name) ?? 0) + count);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Fasst Listen [{ name, count }] zu einer zusammen, die meisten zuerst */
const mergeCounts = (...lists) => countByName(lists.flat());

/**
 * Bringt Buchungen auf den Stand der gemerkten Zuordnungen: Jede freie Buchung (siehe FREE) mit passender Art, Richtung
 * und Gegenpartei bekommt Kategorie und Rhythmus der Zuordnung. Die mit ihrem Betrag geht der für jeden Betrag vor.
 * Folgt eine Buchung einer Zuordnung, die nicht mehr passt, z. B. weil sie inzwischen als Umbuchung gilt, geht sie
 * zurück in die Auffangkategorie, ohne Rhythmus. Mit importId nur die Buchungen dieses Imports, mit key nur die dieser
 * Gegenpartei (wie matchKey). Liefert die IDs der zugeordneten Buchungen, ihre Zahl je Kategorie und die Zahl der
 * zurückgesetzten.
 */
async function applyRules(db, { importId = null, key = null } = {}) {
  const { rows } = await db.query(
    `WITH candidates AS (
       SELECT t.id, t.type, t.amount, ${KIND} AS kind, ${matchKey("t.counterparty")} AS key
       FROM transactions t
       WHERE ${FREE} AND t.counterparty <> ''
         AND ($2::int IS NULL OR t.import_id = $2) AND ($3::text IS NULL OR ${matchKey("t.counterparty")} = $3)
     ), best AS (
       SELECT c.id, (SELECT r.id FROM rules r
         WHERE r.kind = c.kind AND r.type = c.type AND r.match_key = c.key AND (r.amount = c.amount OR r.amount IS NULL)
         ORDER BY r.amount IS NULL LIMIT 1) AS rule_id
       FROM candidates c
     )
     UPDATE transactions t SET category = COALESCE(cat.name, $1), rhythm = r.rhythm, rule_id = r.id
     FROM best b LEFT JOIN rules r ON r.id = b.rule_id LEFT JOIN categories cat ON cat.id = r.category_id
     WHERE t.id = b.id AND (b.rule_id IS NOT NULL OR t.rule_id IS NOT NULL)
       AND (t.rule_id IS DISTINCT FROM r.id OR t.category IS DISTINCT FROM COALESCE(cat.name, $1)
         OR t.rhythm IS DISTINCT FROM r.rhythm)
     RETURNING t.id, t.category AS name, r.id IS NOT NULL AS assigned`,
    [FALLBACK_CATEGORY, importId, key],
  );
  const assigned = rows.filter((row) => row.assigned);
  return { ids: assigned.map((row) => row.id), counts: countByName(assigned), reverted: rows.length - assigned.length };
}

/** Eine gemerkte Zuordnung wie in GET /api/rules, sonst undefined */
const findRule = async (db, id) => (await db.query(`${RULES} WHERE r.id = $1`, [id])).rows[0];

/** Alle gemerkten Zuordnungen, nach Gegenpartei; je Gegenpartei die für jeden Betrag zuerst */
const listRules = async (db) =>
  (await db.query(`${RULES} ORDER BY lower(r.counterparty), r.kind, r.type, r.amount NULLS FIRST, r.id`)).rows;

/**
 * Merkt Kategorie und Rhythmus der Buchung für alle Buchungen derselben Art, Richtung und Gegenpartei, mit matchAmount
 * nur für die mit ihrem Betrag. Eine bisher gemerkte Zuordnung dafür wird ersetzt. Gilt sofort auch für die bisherigen
 * freien Buchungen. Liefert { rule, assigned } mit der Zahl der anderen Buchungen, die sich dadurch geändert haben,
 * oder { status, error }.
 */
async function rememberRule(db, transactionId, matchAmount) {
  const { rows: [tx] } = await db.query(
    `SELECT t.type, t.amount, t.counterparty, t.category, t.rhythm, ${KIND} AS kind FROM transactions t WHERE t.id = $1`,
    [transactionId],
  );
  if (!tx) return { status: 404, error: "Buchung nicht gefunden" };
  if (!tx.counterparty.trim()) return { status: 400, error: "Ohne Gegenpartei lässt sich die Zuordnung nicht merken." };
  const { rows: [category] } = await db.query("SELECT id FROM categories WHERE kind = $1 AND name = $2", [
    tx.kind,
    tx.category,
  ]);
  if (!category) return { status: 409, error: `Die Kategorie „${tx.category}“ gibt es für diese Art nicht.` };
  const { rows: [rule] } = await db.query(
    `INSERT INTO rules (kind, type, counterparty, match_key, amount, category_id, rhythm)
     VALUES ($1, $2, $3, ${matchKey("$3::text")}, $4, $5, $6)
     ON CONFLICT (kind, type, match_key, amount) DO UPDATE
       SET counterparty = EXCLUDED.counterparty, category_id = EXCLUDED.category_id, rhythm = EXCLUDED.rhythm
     RETURNING id, match_key AS key`,
    [tx.kind, tx.type, tx.counterparty, matchAmount ? tx.amount : null, category.id, tx.rhythm],
  );
  const { ids } = await applyRules(db, { key: rule.key });
  return { rule: await findRule(db, rule.id), assigned: ids.filter((id) => id !== transactionId).length };
}

/**
 * Löscht eine gemerkte Zuordnung. Die Buchungen, die ihr folgen, gehen zurück in die Auffangkategorie, ohne Rhythmus.
 * Danach gilt für sie, was sonst passt: eine andere gemerkte Zuordnung derselben Gegenpartei oder, nach dem Aufruf von
 * autoCategorize, die automatische Kategorie. Liefert false, wenn es die Zuordnung nicht gibt.
 */
async function forgetRule(db, id) {
  const { rows: [rule] } = await db.query("SELECT match_key AS key FROM rules WHERE id = $1", [id]);
  if (!rule) return false;
  await db.query("UPDATE transactions SET category = $2, rhythm = NULL, rule_id = NULL WHERE rule_id = $1", [
    id,
    FALLBACK_CATEGORY,
  ]);
  await db.query("DELETE FROM rules WHERE id = $1", [id]);
  await applyRules(db, { key: rule.key });
  return true;
}

/**
 * Was eine gemerkte Zuordnung aus der Buchung bewirken würde, wenn sie die Art `kind` hat (ohne Angabe ihre jetzige):
 * wie viele andere freie Buchungen sie mit gleichem Betrag bzw. bei jedem Betrag bekämen und welche bisher gemerkten
 * Zuordnungen für die Buchung gelten, die mit ihrem Betrag zuerst. Ohne Buchung null.
 */
async function previewRule(db, transactionId, kind = null) {
  const { rows: [tx] } = await db.query(
    `SELECT t.type, t.amount, ${matchKey("t.counterparty")} AS key, ${KIND} AS kind FROM transactions t WHERE t.id = $1`,
    [transactionId],
  );
  if (!tx) return null;
  const match = [kind ?? tx.kind, tx.type, tx.key, tx.amount];
  const { rows: [counts] } = await db.query(
    `WITH others AS (
       SELECT t.amount FROM transactions t
       WHERE t.id <> $5 AND ${FREE} AND t.type = $2 AND ${matchKey("t.counterparty")} = $3 AND ${KIND} = $1
     )
     SELECT count(*) FILTER (WHERE s.amount = $4)::int AS "sameAmount",
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM rules r
         WHERE r.kind = $1 AND r.type = $2 AND r.match_key = $3 AND r.amount = s.amount))::int AS "anyAmount"
     FROM others s`,
    [...match, transactionId],
  );
  const { rows: rules } = await db.query(
    `${RULES} WHERE r.kind = $1 AND r.type = $2 AND r.match_key = $3 AND (r.amount = $4 OR r.amount IS NULL)
     ORDER BY r.amount IS NULL`,
    match,
  );
  return { ...counts, rules };
}

/** Prüft { transactionId, matchAmount } für POST /api/rules; liefert die Werte oder null */
function readRuleInput(body) {
  const { transactionId, matchAmount } = body;
  if (!Number.isInteger(transactionId) || transactionId < 1 || typeof matchAmount !== "boolean") return null;
  return { transactionId, matchAmount };
}

/** Prüft die Parameter für GET /api/rules/preview: transaction (ID) und optional kind. Liefert die Werte oder null. */
function readPreviewQuery(query) {
  const transactionId = Number(query.transaction);
  if (!Number.isInteger(transactionId) || transactionId < 1) return null;
  const kind = query.kind === undefined || query.kind === "" ? null : query.kind;
  if (kind !== null && !KINDS.includes(kind)) return null;
  return { transactionId, kind };
}

module.exports = {
  matchKey,
  FREE,
  countByName,
  mergeCounts,
  applyRules,
  findRule,
  listRules,
  rememberRule,
  forgetRule,
  previewRule,
  readRuleInput,
  readPreviewQuery,
};
