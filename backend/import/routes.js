// REST-API für den CSV-Import. Die hochgeladene Datei wird nur im Arbeitsspeicher verarbeitet
// und weder auf der Platte noch in der Datenbank abgelegt.

const express = require("express");
const { ImportError, analyzeFile, markDuplicates, countStatuses, buildPreview } = require("./analyze");

const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Kategorie für importierte Umsätze, bis es eine Kategorisierung gibt */
const IMPORT_CATEGORY = "Sonstiges";

const asyncRoute = (fn) => (req, res, next) => fn(req, res).catch(next);

const centsToDecimal = (cents) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

/** Prüft Profil, Dateiname und Inhalt der Anfrage und liest die Datei. */
function readUpload(req, profiles) {
  const profile = profiles.get(String(req.query.profile ?? ""));
  if (!profile) throw new ImportError(400, "Bitte ein gültiges Importprofil auswählen.");
  let fileName = "";
  try {
    fileName = decodeURIComponent(req.get("X-File-Name") ?? "").trim();
  } catch {
    // ungültig kodierter Name, wird unten abgelehnt
  }
  if (!fileName) throw new ImportError(400, "Der Dateiname fehlt.");
  if (!/\.csv$/i.test(fileName)) throw new ImportError(415, "Nur CSV-Dateien (Endung .csv) können importiert werden.");
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new ImportError(400, "Die Datei ist leer.");
  return { profile, fileName: fileName.slice(0, 255), rows: analyzeFile(req.body, profile) };
}

/** Wie oft jeder Fingerabdruck schon in der Datenbank vorkommt */
async function countExisting(db, rows) {
  const hashes = [...new Set(rows.filter((r) => r.record).map((r) => r.record.hash))];
  if (!hashes.length) return new Map();
  const { rows: found } = await db.query(
    "SELECT import_hash, count(*)::int AS n FROM transactions WHERE import_hash = ANY($1) GROUP BY import_hash",
    [hashes],
  );
  return new Map(found.map((f) => [f.import_hash, f.n]));
}

async function insertTransactions(db, importId, records) {
  const column = (fn) => records.map(fn);
  await db.query(
    `INSERT INTO transactions (type, amount, category, date, counterparty, purpose, details, import_id, import_hash)
     SELECT t.type, t.amount, $1, t.date, t.counterparty, t.purpose, t.details::jsonb, $2, t.hash
     FROM unnest($3::text[], $4::numeric[], $5::date[], $6::text[], $7::text[], $8::text[], $9::text[])
       AS t(type, amount, date, counterparty, purpose, details, hash)`,
    [
      IMPORT_CATEGORY,
      importId,
      column((r) => (r.cents < 0 ? "out" : "in")),
      column((r) => centsToDecimal(Math.abs(r.cents))),
      column((r) => r.date),
      column((r) => r.counterparty),
      column((r) => r.purpose),
      column((r) => JSON.stringify(r.details)),
      column((r) => r.hash),
    ],
  );
}

function handleError(err, _req, res, _next) {
  if (err instanceof ImportError) return res.status(err.status).json({ error: err.message, ...err.details });
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: `Die Datei ist zu groß. Erlaubt sind höchstens ${MAX_FILE_BYTES / 1024 / 1024} MB.` });
  }
  if (err.type) return res.status(err.status || 400).json({ error: "Die Datei konnte nicht empfangen werden." });
  // Keine Meldungstexte protokollieren: Fehler der Datenbank können Werte aus der Datei enthalten.
  console.error("Import fehlgeschlagen:", err.code ?? err.name, (err.stack ?? "").split("\n").slice(1, 4).join("\n"));
  res.status(500).json({ error: "Serverfehler beim Import." });
}

function createImportRouter(pool, profiles) {
  const router = express.Router();
  const fileBody = express.raw({ type: () => true, limit: MAX_FILE_BYTES });

  router.get("/import-profiles", (_req, res) => {
    res.json({
      maxFileBytes: MAX_FILE_BYTES,
      profiles: [...profiles.values()].map(({ id, name, description }) => ({ id, name, description })),
    });
  });

  // Vorschau: liest die Datei und meldet, was ein Import übernehmen würde. Speichert nichts.
  router.post("/imports/preview", fileBody, asyncRoute(async (req, res) => {
    const { profile, fileName, rows } = readUpload(req, profiles);
    markDuplicates(rows, await countExisting(pool, rows));
    res.json({ profile: { id: profile.id, name: profile.name }, fileName, ...buildPreview(rows) });
  }));

  // Import: liest die Datei erneut und speichert alle gültigen Umsätze in einer Transaktion.
  router.post("/imports", fileBody, asyncRoute(async (req, res) => {
    const { profile, fileName, rows } = readUpload(req, profiles);
    const includeDuplicates = req.query.duplicates === "include";
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Gleichzeitige Importe nacheinander ausführen, damit die Duplikatprüfung verlässlich ist
      await client.query("SELECT pg_advisory_xact_lock(hashtext('csv-import'))");
      markDuplicates(rows, await countExisting(client, rows));
      const counts = countStatuses(rows);
      const toSave = rows.filter((r) => r.status === "new" || (includeDuplicates && r.status === "duplicate"));
      const duplicatesSkipped = includeDuplicates ? 0 : counts.duplicate;
      const { rows: [run] } = await client.query(
        `INSERT INTO imports (profile_id, profile_name, file_name, imported_count, duplicate_count, skipped_count, invalid_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [profile.id, profile.name, fileName, toSave.length, duplicatesSkipped, counts.skipped, counts.invalid],
      );
      if (toSave.length) await insertTransactions(client, run.id, toSave.map((r) => r.record));
      await client.query("COMMIT");
      res.status(201).json({
        importId: run.id,
        imported: toSave.length,
        duplicatesSkipped,
        skipped: counts.skipped,
        invalid: counts.invalid,
        category: IMPORT_CATEGORY,
      });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }));

  router.use(handleError);
  return router;
}

module.exports = { MAX_FILE_BYTES, createImportRouter };
