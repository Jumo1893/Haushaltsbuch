const path = require("node:path");
const express = require("express");
const { Pool } = require("pg");
const { loadProfiles } = require("./import/profiles");
const { createImportRouter } = require("./import/routes");
const { readTransaction, lockedFields } = require("./transactions");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const profiles = loadProfiles(path.join(__dirname, "import-profiles"));
const app = express();
app.use(express.json());

const SELECT = `SELECT id, type, amount::float8 AS amount, category,
  to_char(date, 'YYYY-MM-DD') AS date, note, counterparty, purpose, import_id AS "importId" FROM transactions`;

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
];

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
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api", createImportRouter(pool, profiles));

app.get("/api/transactions", async (req, res) => {
  const month = String(req.query.month || "");
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "month=YYYY-MM erforderlich" });
  try {
    const { rows } = await pool.query(
      `${SELECT} WHERE to_char(date,'YYYY-MM') = $1 ORDER BY date DESC, id DESC`, [month]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Serverfehler" }); }
});

app.post("/api/transactions", async (req, res) => {
  const tx = readTransaction(req.body || {});
  if (!tx) return res.status(400).json({ error: "Ungültige Eingabe" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO transactions (type, amount, category, date, note)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tx.type, tx.amount, tx.category, tx.date, tx.note]);
    const r = await pool.query(`${SELECT} WHERE id = $1`, [rows[0].id]);
    res.status(201).json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: "Serverfehler" }); }
});

// Ändert nur die übergebenen Felder. Bei importierten Buchungen bleiben Art, Betrag und Datum wie von der Bank.
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
    const r = await pool.query(`${SELECT} WHERE id = $1`, [id]);
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: "Serverfehler" }); }
});

app.delete("/api/transactions/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Ungültige ID" });
  try {
    await pool.query("DELETE FROM transactions WHERE id = $1", [id]);
    res.status(204).end();
  } catch (e) { console.error(e); res.status(500).json({ error: "Serverfehler" }); }
});

init().then(() => app.listen(3000, () => console.log("API läuft auf :3000")))
  .catch((e) => { console.error(e); process.exit(1); });
