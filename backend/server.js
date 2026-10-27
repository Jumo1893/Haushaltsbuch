const express = require("express");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();
app.use(express.json());

const SELECT = `SELECT id, type, amount::float8 AS amount, category,
  to_char(date, 'YYYY-MM-DD') AS date, note FROM transactions`;

async function init() {
  for (let i = 0; i < 20; i++) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('in','out')),
        amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
        category TEXT NOT NULL,
        date DATE NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await pool.query("CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date)");
      return;
    } catch (e) {
      console.log("Datenbank noch nicht bereit, neuer Versuch ...");
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error("Datenbank nicht erreichbar");
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

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
  const { type, amount, category, date, note } = req.body || {};
  const amt = Number(amount);
  if (!["in", "out"].includes(type) || !(amt > 0) || !category || !/^\d{4}-\d{2}-\d{2}$/.test(date || ""))
    return res.status(400).json({ error: "Ungültige Eingabe" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO transactions (type, amount, category, date, note)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [type, amt.toFixed(2), String(category).slice(0, 40), date, String(note || "").slice(0, 60)]);
    const r = await pool.query(`${SELECT} WHERE id = $1`, [rows[0].id]);
    res.status(201).json(r.rows[0]);
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
