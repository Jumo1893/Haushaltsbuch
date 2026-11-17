// Datensicherung: Bereiche aus der Datenbank lesen und aus Sicherungen wiederherstellen

const { AREAS, TABLES, BackupError, selectSql } = require("./format");
const { FALLBACK_CATEGORY } = require("../categories");
const { KIND } = require("../stats");
const { matchKey, applyRules } = require("../rules");
const { SEED_AUTO_KEYS, autoCategorize } = require("../autocategories");
const { linkTransfers } = require("../paypal");
const { bookingProblem } = require("../debts");

/** Liest die Tabellen eines Bereichs so, wie writeBackup sie schreibt. In einer Transaktion mit festem Stand aufrufen. */
async function exportArea(db, area) {
  const tables = {};
  for (const table of AREAS[area].tables) tables[table] = (await db.query(selectSql(table))).rows;
  return tables;
}

/**
 * Fügt Zeilen in einem Schritt ein. columns: [Spalte, Typ in Postgres, Wert je Zeile (ohne Angabe row[Spalte]), SQL
 * für die Spalte aus diesem Wert (ohne Angabe der Wert selbst)]; suffix z. B. ON CONFLICT …
 */
async function insertRows(db, table, rows, columns, suffix = "") {
  if (!rows.length) return;
  const names = columns.map(([name]) => name);
  await db.query(
    `INSERT INTO ${table} (${names.join(", ")})
     SELECT ${columns.map(([name, , , sql]) => (sql ? sql(`u.${name}`) : `u.${name}`)).join(", ")}
     FROM unnest(${columns.map(([, type], i) => `$${i + 1}::${type}[]`).join(", ")}) AS u(${names.join(", ")}) ${suffix}`,
    columns.map(([name, , value]) => rows.map((row) => (value ? value(row) : row[name]))),
  );
}

/** Setzt Verweise innerhalb einer Tabelle, sobald alle Zeilen da sind */
async function setReferences(db, table, column, rows) {
  const set = rows.filter((row) => row[column] !== null);
  if (!set.length) return;
  await db.query(
    `UPDATE ${table} x SET ${column} = u.target FROM unnest($1::int[], $2::int[]) AS u(id, target) WHERE x.id = u.id`,
    [set.map((row) => row.id), set.map((row) => row[column])],
  );
}

/**
 * Ersetzt Konten, Importe, Buchungen und Wertpapierbewegungen, mit den IDs der Sicherung. Abgerufene Kurse kommen dazu,
 * vorhandene bleiben: Sie gelten für jedes Depot mit dem Wertpapier. Buchungen kommen ohne gemerkte Zuordnung, die
 * findet relinkRules; Schulden verlieren ihre Buchung, die findet linkDebts.
 */
async function restoreTransactions(db, tables) {
  await db.query("DELETE FROM transactions");
  await db.query("DELETE FROM depot_movements");
  await db.query("DELETE FROM accounts");
  await db.query("DELETE FROM imports");
  await insertRows(db, "accounts", tables.accounts, [
    ["id", "int"],
    ["name", "text"],
    ["kind", "text"],
    ["institution", "text"],
    ["iban", "text"],
    ["extra_ibans", "text", (a) => a.extra_ibans.join(" "), (v) => `COALESCE(string_to_array(NULLIF(${v}, ''), ' '), '{}')`],
    ["bank_balance", "numeric"],
    ["bank_balance_date", "date"],
    ["auto_prices_since", "timestamptz"],
    ["created_at", "timestamptz"],
  ]);
  await setReferences(db, "accounts", "cash_account_id", tables.accounts);
  await insertRows(db, "imports", tables.imports, [
    ["id", "int"],
    ["profile_id", "text"],
    ["profile_name", "text"],
    ["file_name", "text"],
    ["imported_count", "int"],
    ["depot_count", "int"],
    ["duplicate_count", "int"],
    ["skipped_count", "int"],
    ["invalid_count", "int"],
    ["created_at", "timestamptz"],
  ]);
  await insertRows(db, "transactions", tables.transactions, [
    ["id", "int"],
    ["account_id", "int"],
    ["date", "date"],
    ["type", "text"],
    ["amount", "numeric"],
    ["category", "text"],
    ["category_manual", "boolean"],
    ["note", "text"],
    ["counterparty", "text"],
    ["purpose", "text"],
    ["rhythm", "text"],
    ["transfer_override", "boolean"],
    ["import_id", "int"],
    ["import_hash", "text"],
    ["details", "jsonb"],
    ["created_at", "timestamptz"],
  ]);
  await setReferences(db, "transactions", "linked_id", tables.transactions);
  await insertRows(db, "depot_movements", tables.depot_movements, [
    ["id", "int"],
    ["account_id", "int"],
    ["import_id", "int"],
    ["import_hash", "text"],
    ["date", "date"],
    ["occurred_at", "timestamptz"],
    ["section", "text"],
    ["type", "text"],
    ["isin", "text"],
    ["name", "text"],
    ["asset_class", "text"],
    ["shares", "numeric"],
    ["price", "numeric"],
    ["amount", "numeric"],
    ["fee", "numeric"],
    ["tax", "numeric"],
  ]);
  await insertRows(
    db,
    "depot_prices",
    tables.depot_prices,
    [
      ["isin", "text"],
      ["date", "date"],
      ["price", "numeric"],
      ["source", "text"],
      ["fetched_at", "timestamptz"],
    ],
    "ON CONFLICT (isin, date) DO NOTHING",
  );
}

/**
 * Ersetzt Kategorien und gemerkte Zuordnungen, mit den IDs der Sicherung. Kategorien, die Buchungen verwenden, bleiben
 * auch, wenn sie in der Sicherung fehlen, damit die Liste zu den Buchungen passt; liefert sie.
 */
async function restoreSettings(db, { categories, rules }) {
  await db.query("DELETE FROM rules");
  await db.query(
    `WITH used AS MATERIALIZED (SELECT DISTINCT t.category AS name, ${KIND} AS kind FROM transactions t)
     DELETE FROM categories c
     WHERE (c.kind, c.name) IN (SELECT * FROM unnest($1::text[], $2::text[]))
       OR NOT EXISTS (SELECT 1 FROM used u WHERE u.name = c.name AND u.kind = c.kind)`,
    [categories.map((c) => c.kind), categories.map((c) => c.name)],
  );
  const { rows: kept } = await db.query("SELECT id, kind, name FROM categories ORDER BY id");
  // Die gebliebenen machen den IDs der Sicherung Platz und stehen danach hinter ihnen
  const ids = categories.map((c) => c.id);
  await db.query(
    `UPDATE categories c SET id = $2 + k.n
     FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM categories WHERE id = ANY($1)) k WHERE c.id = k.id`,
    [ids, Math.max(0, ...ids, ...kept.map((c) => c.id))],
  );
  // Die automatischen Zuordnungen der Sicherung gehen vor
  await db.query("UPDATE categories SET auto_key = NULL WHERE auto_key = ANY($1)", [
    categories.map((c) => c.auto_key).filter((key) => key !== null),
  ]);
  await insertRows(db, "categories", categories, [
    ["id", "int"],
    ["kind", "text"],
    ["name", "text"],
    ["auto_key", "text"],
  ]);
  await insertRows(db, "rules", rules, [
    ["id", "int"],
    ["kind", "text"],
    ["type", "text"],
    ["counterparty", "text"],
    ["match_key", "text", (r) => r.counterparty, matchKey],
    ["amount", "numeric"],
    ["category_id", "int"],
    ["rhythm", "text"],
    ["created_at", "timestamptz"],
  ]);
  // Wie beim Start: Standardkategorien bekommen ihren Schlüssel zurück, wenn ihn keine andere hat
  await db.query(SEED_AUTO_KEYS);
  return kept;
}

/** Ersetzt Personen und Einträge, mit den IDs der Sicherung. Ihre Buchungen findet linkDebts. */
async function restoreDebts(db, { people, debts }) {
  await db.query("DELETE FROM people");
  await insertRows(db, "people", people, [
    ["id", "int"],
    ["name", "text"],
    ["created_at", "timestamptz"],
  ]);
  await insertRows(db, "debts", debts, [
    ["id", "int"],
    ["person_id", "int"],
    ["date", "date"],
    ["amount", "numeric"],
    ["kind", "text"],
    ["reason", "text"],
    ["settles_selected", "boolean"],
    ["created_at", "timestamptz"],
  ]);
  await setReferences(db, "debts", "settled_by", debts);
}

/**
 * Verbindet Einträge zu Schulden mit ihrer Buchung: links [{ id, transactionId, date, type, amount }], die Buchung mit
 * ID, Tag, Richtung und Betrag. Gibt es sie so nicht, z. B. in einer anderen Instanz, bleibt der Eintrag ohne Buchung.
 * Liefert die Zahl der verbundenen Einträge.
 */
async function linkDebts(db, links) {
  if (!links.length) return 0;
  const { rowCount } = await db.query(
    `UPDATE debts d SET transaction_id = t.id
     FROM unnest($1::int[], $2::int[], $3::date[], $4::text[], $5::numeric[]) AS u(id, transaction_id, date, type, amount)
     JOIN transactions t ON t.id = u.transaction_id AND t.date = u.date AND t.type = u.type AND t.amount = u.amount
     WHERE d.id = u.id`,
    ["id", "transactionId", "date", "type", "amount"].map((key) => links.map((link) => link[key])),
  );
  return rowCount;
}

/** Löst Einträge von Buchungen, zu denen sie nicht passen (siehe bookingProblem); liefert die Zahl der Einträge */
async function releaseMismatches(db) {
  const { rows } = await db.query(
    `SELECT t.id, t.type, t.amount::text AS amount, array_agg(d.amount::text) AS amounts
     FROM debts d JOIN transactions t ON t.id = d.transaction_id GROUP BY t.id`,
  );
  const ids = rows.filter((row) => bookingProblem(row, row.amounts)).map((row) => row.id);
  if (!ids.length) return 0;
  const { rowCount } = await db.query("UPDATE debts SET transaction_id = NULL WHERE transaction_id = ANY($1)", [ids]);
  return rowCount;
}

/**
 * Verbindet Buchungen wieder mit der gemerkten Zuordnung, die am besten passt (Art, Richtung, Gegenpartei, die mit
 * ihrem Betrag vor der für jeden Betrag, wie in applyRules); danach haben sie deren Kategorie und Rhythmus. Passt
 * keine, behalten sie Kategorie und Rhythmus, mit forget gehen sie wie beim Löschen ihrer Zuordnung (siehe forgetRule)
 * zurück in die Auffangkategorie, ohne Rhythmus. Liefert die Zahl der Buchungen ohne passende Zuordnung.
 */
async function relinkRules(db, ids, forget) {
  if (!ids.length) return 0;
  const { rows } = await db.query(
    `UPDATE transactions t SET rule_id = (
       SELECT r.id FROM rules r
       WHERE r.kind = ${KIND} AND r.type = t.type AND r.match_key = ${matchKey("t.counterparty")}
         AND (r.amount = t.amount OR r.amount IS NULL)
       ORDER BY r.amount IS NULL LIMIT 1)
     WHERE t.id = ANY($1) AND NOT t.category_manual
     RETURNING t.id, t.rule_id AS "ruleId"`,
    [ids],
  );
  const orphans = rows.filter((row) => row.ruleId === null).map((row) => row.id);
  if (forget && orphans.length) {
    await db.query("UPDATE transactions SET category = $2, rhythm = NULL WHERE id = ANY($1)", [
      orphans,
      FALLBACK_CATEGORY,
    ]);
  }
  await applyRules(db, { ids });
  return orphans.length;
}

async function countTables(db, areas) {
  const counts = {};
  for (const area of areas) {
    for (const table of AREAS[area].tables) {
      counts[table] = (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
    }
  }
  return counts;
}

const KIND_LABELS = { out: "Ausgaben", in: "Einnahmen", transfer: "Umbuchungen" };

/** z. B. „1 Eintrag“, „5 Einträge“ */
const entries = (n) => `${n} ${n === 1 ? "Eintrag" : "Einträge"}`;
const bookings = (n) => `${n} ${n === 1 ? "Buchung" : "Buchungen"}`;

/**
 * Stellt die Bereiche der Sicherungen wieder her (siehe readBackup), jeden vollständig: Was vorher in ihm war, fällt
 * weg; nur abgerufene Kurse kommen dazu. Verweise zwischen den Bereichen entstehen über den Inhalt neu, so passen auch
 * Sicherungen aus verschiedenen Zeiten oder Instanzen zusammen: Ein Eintrag zu Schulden findet seine Buchung über ID,
 * Tag, Richtung und Betrag, eine Buchung ihre gemerkte Zuordnung über Art, Richtung, Gegenpartei und Betrag. Danach
 * gleicht es wie beim Start ab (Gegenbuchungen, gemerkte Zuordnungen, automatische Kategorien).
 * Liefert je Bereich die Zahl der Zeilen je Tabelle vorher und nachher, dazu Warnungen (was anders wird als in der
 * Sicherung) und Hinweise. In einer Datenbanktransaktion aufrufen.
 */
async function restoreBackups(db, backups) {
  const byArea = new Map();
  for (const backup of backups) {
    if (byArea.has(backup.area)) {
      throw new BackupError(`Zwei Dateien sichern „${AREAS[backup.area].label}“. Bitte nur eine davon wählen.`);
    }
    byArea.set(backup.area, backup);
  }
  const areas = Object.keys(AREAS).filter((area) => byArea.has(area));
  const transactions = byArea.get("transactions")?.tables;
  const settings = byArea.get("settings")?.tables;
  const debts = byArea.get("debts")?.tables;
  const before = await countTables(db, areas);
  const warnings = [];
  const notes = [];

  // Was die Bereiche verbindet, bevor sie ersetzt werden: Buchungen, die einer gemerkten Zuordnung folgen, und die
  // Buchungen der Einträge zu Schulden
  const followers = transactions
    ? transactions.transactions.filter((t) => t.rule_id !== null).map((t) => t.id)
    : settings
      ? (await db.query("SELECT id FROM transactions WHERE rule_id IS NOT NULL")).rows.map((row) => row.id)
      : [];
  const debtLinks = debts
    ? debts.debts
        .filter((d) => d.transaction_id !== null)
        .map((d) => ({
          id: d.id,
          transactionId: d.transaction_id,
          date: d.transaction_date,
          type: d.transaction_type,
          amount: d.transaction_amount,
        }))
    : transactions
      ? (
          await db.query(
            `SELECT d.id, d.transaction_id AS "transactionId", to_char(t.date, 'YYYY-MM-DD') AS date, t.type,
               t.amount::text AS amount
             FROM debts d JOIN transactions t ON t.id = d.transaction_id`,
          )
        ).rows
      : [];

  if (transactions) await restoreTransactions(db, transactions);
  const kept = settings ? await restoreSettings(db, settings) : [];
  if (debts) await restoreDebts(db, debts);

  const lost = debtLinks.length - (await linkDebts(db, debtLinks));
  if (lost) {
    const missing = `weil es ihre Buchungen ${transactions ? "in der Sicherung" : "hier"} nicht gibt oder nur mit anderem Tag, anderer Richtung oder anderem Betrag.`;
    warnings.push(
      debts
        ? `${entries(lost)} zu Schulden ${lost === 1 ? "bleibt" : "bleiben"} ohne Buchung, ${missing}${transactions ? "" : ` Lade „${AREAS.transactions.label}“ derselben Sicherung mit hoch, damit die Verbindung erhalten bleibt.`}`
        : `${entries(lost)} zu Schulden ${lost === 1 ? "verliert" : "verlieren"} die Buchung, ${missing}`,
    );
  }
  const mismatched = debts || transactions ? await releaseMismatches(db) : 0;
  if (mismatched) {
    warnings.push(
      `${entries(mismatched)} zu Schulden ${mismatched === 1 ? "passt" : "passen"} nicht zu Richtung oder Betrag der Buchung und ${mismatched === 1 ? "bleibt" : "bleiben"} ohne Buchung.`,
    );
  }

  // Ersetzt die Sicherung nur die Einstellungen, wirkt eine fehlende Zuordnung wie gelöscht. Kommen die Buchungen aus
  // der Sicherung, bleiben sie, wie sie dort sind.
  const forget = !transactions;
  const unfollowed = await relinkRules(db, followers, forget);
  if (unfollowed) {
    const which = `${bookings(unfollowed)} ${unfollowed === 1 ? "folgte" : "folgten"} einer gemerkten Zuordnung, die es`;
    warnings.push(
      forget
        ? `${which} danach nicht gibt. Wie beim Löschen der Zuordnung ${unfollowed === 1 ? "geht sie" : "gehen sie"} zurück nach „${FALLBACK_CATEGORY}“, ohne Rhythmus.`
        : settings
          ? `${which} in den Einstellungen der Sicherung nicht gibt. Kategorie und Rhythmus bleiben.`
          : `${which} hier nicht gibt. Kategorie und Rhythmus bleiben. Lade die Einstellungen derselben Sicherung mit hoch, damit die Zuordnung erhalten bleibt.`,
    );
  }
  if (kept.length) {
    const list = kept.map((c) => `${c.name} (${KIND_LABELS[c.kind]})`).join(", ");
    notes.push(`Diese Kategorien fehlen in der Sicherung und bleiben, weil Buchungen sie verwenden: ${list}.`);
  }

  if (transactions || settings) {
    // Wie beim Start des Backends
    const pairs = await linkTransfers(db);
    const ruled = await applyRules(db);
    const auto = (await autoCategorize(db)).reduce((sum, c) => sum + c.count, 0);
    const changes = [
      ruled.ids.length && `${bookings(ruled.ids.length)} über gemerkte Zuordnungen`,
      auto && `${bookings(auto)} automatisch`,
      ruled.reverted && `${bookings(ruled.reverted)} zurück nach „${FALLBACK_CATEGORY}“`,
      pairs.length && `${pairs.length} ${pairs.length === 1 ? "Paar" : "Paare"} mit der Gegenbuchung verbunden`,
    ].filter(Boolean);
    if (changes.length) notes.push(`Neu zugeordnet wie bei jedem Start: ${changes.join(", ")}.`);
  }
  if (transactions && !settings) {
    const { rows } = await db.query(
      `SELECT DISTINCT t.category AS name FROM transactions t
       WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.name = t.category) ORDER BY 1`,
    );
    if (rows.length) {
      warnings.push(
        `Buchungen verwenden Kategorien, die es hier nicht gibt: ${rows.map((r) => r.name).join(", ")}. Sie kommen mit der Sicherung der Einstellungen dazu.`,
      );
    }
  }
  if (transactions) {
    const depots = transactions.accounts.filter((a) => a.auto_prices_since !== null).map((a) => a.name);
    if (depots.length) notes.push(`Der tägliche Kursabruf ist danach eingeschaltet für ${depots.join(", ")}.`);
  }

  const after = await countTables(db, areas);
  return {
    areas: areas.map((area) => {
      const { fileName, created } = byArea.get(area);
      return {
        area,
        label: AREAS[area].label,
        fileName,
        created,
        tables: AREAS[area].tables.map((table) => ({
          name: table,
          label: TABLES[table].label,
          before: before[table],
          after: after[table],
        })),
      };
    }),
    warnings,
    notes,
  };
}

/**
 * Stellt die Zähler für neue IDs der Tabellen dieser Bereiche hinter die größte ID, aber nie zurück: Die
 * Wiederherstellung setzt IDs selbst. Zähler ändern sich auch, wenn die Transaktion zurückgerollt wird.
 */
async function advanceSequences(db, areas) {
  for (const area of areas) {
    for (const table of AREAS[area].tables) {
      if (!TABLES[table].columns.some(([column]) => column === "id")) continue;
      await db.query(
        `SELECT setval(s::regclass, GREATEST((SELECT COALESCE(max(id), 0) FROM ${table}),
           COALESCE(pg_sequence_last_value(s::regclass), 0), 1))
         FROM pg_get_serial_sequence('${table}', 'id') AS s`,
      );
    }
  }
}

module.exports = { exportArea, restoreBackups, advanceSequences };
