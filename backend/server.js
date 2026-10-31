const path = require("node:path");
const express = require("express");
const { Pool } = require("pg");
const { loadProfiles } = require("./import/profiles");
const { createImportRouter } = require("./import/routes");
const { readTransaction, lockedFields, isDate, isMonth, accountParam, readListQuery } = require("./transactions");
const { KINDS, normalizeIban, readAccount, accountsForIbans } = require("./accounts");
const { TRANSFER, ACCOUNTS, monthlyStats, dailyBalances } = require("./stats");

// Ohne JIT: Bei den kleinen Abfragen dieser App dauert das Kompilieren länger (bis zu einer Sekunde)
// als die Abfrage selbst. Der Planer schätzt z. B. die Monatsreihe der Auswertungen viel zu groß.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: "-c jit=off" });
const profiles = loadProfiles(path.join(__dirname, "import-profiles"));
const app = express();
app.use(express.json());

const SELECT = `SELECT t.id, t.type, t.amount::float8 AS amount, t.category,
  to_char(t.date, 'YYYY-MM-DD') AS date, t.note, t.counterparty, t.purpose, t.import_id AS "importId",
  t.account_id AS "accountId", ${TRANSFER} AS transfer FROM transactions t`;

// Fehlercodes von Postgres
const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('in','out')),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    category TEXT NOT NULL,
    date DATE NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date)",
  // Importvorgänge: welches Profil, welche Datei, was übernommen wurde
  `CREATE TABLE IF NOT EXISTS imports (
    id SERIAL PRIMARY KEY,
    profile_id TEXT NOT NULL,
    profile_name TEXT NOT NULL,
    file_name TEXT NOT NULL,
    imported_count INTEGER NOT NULL,
    duplicate_count INTEGER NOT NULL,
    skipped_count INTEGER NOT NULL,
    invalid_count INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS counterparty TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS details JSONB,
    ADD COLUMN IF NOT EXISTS import_id INTEGER REFERENCES imports(id),
    ADD COLUMN IF NOT EXISTS import_hash TEXT`,
  "CREATE INDEX IF NOT EXISTS idx_tx_import_id ON transactions(import_id)",
  "CREATE INDEX IF NOT EXISTS idx_tx_import_hash ON transactions(import_hash)",
  // Konten: Jede Buchung gehört zu genau einem Konto. Über die IBAN erkennt der Import das Konto.
  `CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN (${KINDS.map((k) => `'${k}'`).join(",")})),
    institution TEXT NOT NULL DEFAULT '',
    iban TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES accounts(id)",
  "CREATE INDEX IF NOT EXISTS idx_tx_account_id ON transactions(account_id)",
  // Kontostand laut Bank an einem Tag (beides oder nichts), daraus ergeben sich die Kontostände
  `ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS bank_balance NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS bank_balance_date DATE`,
];

/**
 * Ordnet Buchungen aus der Zeit vor den Konten einem Konto zu und legt die Konten dafür an:
 * importierte mit eigener IBAN ein Konto je IBAN, importierte ohne IBAN ein Konto je Importprofil
 * (benannt nach dem Profil), von Hand erfasste das Konto „Bargeld“.
 */
async function assignLegacyAccounts(db) {
  const { rows: [legacy] } = await db.query("SELECT count(*)::int AS n FROM transactions WHERE account_id IS NULL");
  if (!legacy.n) return;
  let created = 0;

  const { rows: ibans } = await db.query(
    `SELECT DISTINCT details->>'account' AS value FROM transactions
     WHERE account_id IS NULL AND import_id IS NOT NULL AND details->>'account' <> ''`);
  const byIban = await accountsForIbans(db, [...new Set(ibans.map((r) => normalizeIban(r.value)))], true);
  created += [...byIban.values()].filter((a) => a.isNew).length;
  for (const { value } of ibans) {
    await db.query(
      `UPDATE transactions SET account_id = $1
       WHERE account_id IS NULL AND import_id IS NOT NULL AND details->>'account' = $2`,
      [byIban.get(normalizeIban(value)).id, value]);
  }

  const { rows: withoutIban } = await db.query(
    `SELECT DISTINCT ON (i.profile_id) i.profile_id AS "profileId", i.profile_name AS "profileName"
     FROM transactions t JOIN imports i ON i.id = t.import_id
     WHERE t.account_id IS NULL ORDER BY i.profile_id, i.id DESC`);
  for (const { profileId, profileName } of withoutIban) {
    const { rows: [account] } = await db.query(
      "INSERT INTO accounts (name, kind) VALUES ($1, 'other') RETURNING id", [profileName]);
    created++;
    await db.query(
      `UPDATE transactions t SET account_id = $1 FROM imports i
       WHERE i.id = t.import_id AND t.account_id IS NULL AND i.profile_id = $2`,
      [account.id, profileId]);
  }

  const { rowCount: manual } = await db.query("SELECT 1 FROM transactions WHERE account_id IS NULL LIMIT 1");
  if (manual) {
    const { rows: [cash] } = await db.query("INSERT INTO accounts (name, kind) VALUES ('Bargeld', 'cash') RETURNING id");
    created++;
    await db.query("UPDATE transactions SET account_id = $1 WHERE account_id IS NULL", [cash.id]);
  }
  console.log(`Konten eingerichtet: ${legacy.n} bestehende Buchungen zugeordnet, ${created} Konten angelegt.`);
}

async function init() {
  for (let i = 0; ; i++) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch (e) {
      if (i === 19) throw new Error("Datenbank nicht erreichbar");
      console.log("Datenbank noch nicht bereit, neuer Versuch ...");
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  for (const statement of SCHEMA) await pool.query(statement);
  // Buchungen ohne Konto zuordnen, danach ist das Konto Pflicht
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assignLegacyAccounts(client);
    await client.query("ALTER TABLE transactions ALTER COLUMN account_id SET NOT NULL");
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api", createImportRouter(pool, profiles));

// Buchungen eines Monats (month) oder die neuesten (limit), neueste zuerst
app.get("/api/transactions", async (req, res) => {
  const { month, limit, account, error } = readListQuery(req.query);
  if (error) return res.status(400).json({ error });
  try {
    const { rows } = month
      ? await pool.query(
        `${SELECT} WHERE to_char(t.date,'YYYY-MM') = $1 AND ($2::int IS NULL OR t.account_id = $2)
         ORDER BY t.date DESC, t.id DESC`, [month, account])
      : await pool.query(
        `${SELECT} WHERE $2::int IS NULL OR t.account_id = $2 ORDER BY t.date DESC, t.id DESC LIMIT $1`,
        [limit, account]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Serverfehler" }); }
});

app.post("/api/transactions", async (req, res) => {
  const tx = readTransaction(req.body || {});
  if (!tx) return res.status(400).json({ error: "Ungültige Eingabe" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO transactions (type, amount, category, date, note, account_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tx.type, tx.amount, tx.category, tx.date, tx.note, tx.account_id]);
    const r = await pool.query(`${SELECT} WHERE t.id = $1`, [rows[0].id]);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === FOREIGN_KEY_VIOLATION) return res.status(400).json({ error: "Das gewählte Konto gibt es nicht." });
    console.error(e); res.status(500).json({ error: "Serverfehler" });
  }
});

// Ändert nur die übergebenen Felder. Bei importierten Buchungen bleiben Art, Betrag, Datum und Konto wie beim Import.
app.patch("/api/transactions/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Ungültige ID" });
  const changes = readTransaction(req.body || {}, true);
  if (!changes || !Object.keys(changes).length) return res.status(400).json({ error: "Ungültige Eingabe" });
  try {
    const { rows } = await pool.query("SELECT import_id FROM transactions WHERE id = $1", [id]);
    if (!rows.length) return res.status(404).json({ error: "Buchung nicht gefunden" });
    if (rows[0].import_id !== null && lockedFields(changes).length)
      return res.status(409).json({ error: "Bei importierten Buchungen lassen sich nur Kategorie und Notiz ändern." });
    // Spaltennamen stammen aus readTransaction, nicht aus der Anfrage
    const fields = Object.keys(changes);
    await pool.query(
      `UPDATE transactions SET ${fields.map((f, i) => `${f} = $${i + 2}`).join(", ")} WHERE id = $1`,
      [id, ...fields.map((f) => changes[f])]);
    const r = await pool.query(`${SELECT} WHERE t.id = $1`, [id]);
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === FOREIGN_KEY_VIOLATION) return res.status(400).json({ error: "Das gewählte Konto gibt es nicht." });
    console.error(e); res.status(500).json({ error: "Serverfehler" });
  }
});

app.delete("/api/transactions/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Ungültige ID" });
  try {
    await pool.query("DELETE FROM transactions WHERE id = $1", [id]);
    res.status(204).end();
  } catch (e) { console.error(e); res.status(500).json({ error: "Serverfehler" }); }
});

/** Ein Konto wie in GET /api/accounts, mit Kontostand */
const findAccount = async (id) => (await pool.query(`${ACCOUNTS} WHERE a.id = $1`, [id])).rows[0];

app.get("/api/accounts", async (_req, res) => {
  try {
    const { rows } = await pool.query(`${ACCOUNTS} ORDER BY lower(a.name), a.id`);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Serverfehler" }); }
});

app.post("/api/accounts", async (req, res) => {
  const { values, error } = readAccount(req.body || {});
  if (error) return res.status(400).json({ error });
  try {
    const { rows } = await pool.query(
      `INSERT INTO accounts (name, kind, institution, iban, bank_balance, bank_balance_date)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [values.name, values.kind, values.institution, values.iban, values.bank_balance ?? null, values.bank_balance_date ?? null]);
    res.status(201).json(await findAccount(rows[0].id));
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) return res.status(409).json({ error: "Es gibt schon ein Konto mit dieser IBAN." });
    console.error(e); res.status(500).json({ error: "Serverfehler" });
  }
});

// Ändert nur die übergebenen Felder
app.patch("/api/accounts/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Ungültige ID" });
  const { values, error } = readAccount(req.body || {}, true);
  if (error) return res.status(400).json({ error });
  // Spaltennamen stammen aus readAccount, nicht aus der Anfrage
  const fields = Object.keys(values);
  if (!fields.length) return res.status(400).json({ error: "Ungültige Eingabe" });
  try {
    const { rowCount } = await pool.query(
      `UPDATE accounts SET ${fields.map((f, i) => `${f} = $${i + 2}`).join(", ")} WHERE id = $1`,
      [id, ...fields.map((f) => values[f])]);
    if (!rowCount) return res.status(404).json({ error: "Konto nicht gefunden" });
    res.json(await findAccount(id));
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) return res.status(409).json({ error: "Es gibt schon ein Konto mit dieser IBAN." });
    console.error(e); res.status(500).json({ error: "Serverfehler" });
  }
});

// Nur leere Konten lassen sich löschen
app.delete("/api/accounts/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Ungültige ID" });
  try {
    await pool.query("DELETE FROM accounts WHERE id = $1", [id]);
    res.status(204).end();
  } catch (e) {
    if (e.code === FOREIGN_KEY_VIOLATION) return res.status(409).json({ error: "Das Konto enthält noch Buchungen." });
    console.error(e); res.status(500).json({ error: "Serverfehler" });
  }
});

// Werte je Monat und Konto für Verlauf und Übersicht, bis zum Monat until (der aktuelle Monat des Browsers)
app.get("/api/stats/months", async (req, res) => {
  if (!isMonth(req.query.until)) return res.status(400).json({ error: "until=YYYY-MM erforderlich" });
  const account = accountParam(req.query.account);
  if (Number.isNaN(account)) return res.status(400).json({ error: "Ungültiges Konto" });
  try {
    res.json(await monthlyStats(pool, req.query.until, account));
  } catch (e) { console.error(e); res.status(500).json({ error: "Serverfehler" }); }
});

// Kontostand je Tag und Konto für die kurzen Zeiträume des Verlaufs
app.get("/api/stats/days", async (req, res) => {
  if (!isDate(req.query.from) || !isDate(req.query.until)) {
    return res.status(400).json({ error: "from=YYYY-MM-DD und until=YYYY-MM-DD erforderlich" });
  }
  const account = accountParam(req.query.account);
  if (Number.isNaN(account)) return res.status(400).json({ error: "Ungültiges Konto" });
  try {
    res.json(await dailyBalances(pool, req.query.from, req.query.until, account));
  } catch (e) { console.error(e); res.status(500).json({ error: "Serverfehler" }); }
});

init().then(() => app.listen(3000, () => console.log("API läuft auf :3000")))
  .catch((e) => { console.error(e); process.exit(1); });
