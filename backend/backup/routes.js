// REST-API für die Datensicherung: Bereiche als CSV-Datei herunterladen, Sicherungen prüfen und wiederherstellen.
// Hochgeladene Dateien werden nur im Arbeitsspeicher verarbeitet und nirgends abgelegt.

const express = require("express");
const { AREAS, BackupError, fileNameFor, readBackup, writeBackup } = require("./format");
const { exportArea, restoreBackups, advanceSequences } = require("./store");

/** Höchstens eine Datei je Bereich und zusammen so viele Bytes */
const MAX_FILES = Object.keys(AREAS).length;
const MAX_BYTES = 50 * 1024 * 1024;

const asyncRoute = (fn) => (req, res, next) => fn(req, res).catch(next);

/**
 * Liest die hochgeladenen Dateien. Der Body enthält sie hintereinander, der Header X-Files Name und Größe jeder Datei
 * als URI-kodiertes JSON: [{ "name": "…", "size": 123 }]. So behält jede Datei ihre Zeichenkodierung.
 */
function readUploads(req) {
  let files = null;
  try {
    files = JSON.parse(decodeURIComponent(req.get("X-Files") ?? ""));
  } catch {
    // unten abgelehnt
  }
  const valid =
    Array.isArray(files) &&
    files.length >= 1 &&
    files.length <= MAX_FILES &&
    files.every((f) => typeof f?.name === "string" && Number.isInteger(f.size) && f.size >= 0);
  if (!valid) throw new BackupError("Bitte eine bis drei Dateien auswählen, eine je Bereich.");
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (files.reduce((sum, f) => sum + f.size, 0) !== body.length) {
    throw new BackupError("Die Dateien sind nicht vollständig angekommen. Bitte noch einmal versuchen.");
  }
  let offset = 0;
  return files.map(({ name, size }) => {
    const fileName = name.trim().slice(0, 255) || "Datei";
    const buffer = body.subarray(offset, (offset += size));
    if (!/\.csv$/i.test(fileName)) throw new BackupError(`${fileName}: Bitte eine CSV-Datei (Endung .csv) wählen.`, 415);
    if (!size) throw new BackupError(`${fileName}: Die Datei ist leer.`);
    return readBackup(buffer, fileName);
  });
}

/**
 * Stellt die Sicherungen in einer Datenbanktransaktion wieder her und liefert die Zusammenfassung (siehe restoreBackups).
 * Mit dryRun wird alles zurückgerollt: Die Vorschau zeigt so genau, was die Wiederherstellung täte.
 */
async function restore(pool, backups, dryRun) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Nacheinander mit CSV-Importen und anderen Wiederherstellungen
    await client.query("SELECT pg_advisory_xact_lock(hashtext('csv-import'))");
    const summary = await restoreBackups(client, backups);
    if (dryRun) {
      await client.query("ROLLBACK");
    } else {
      await advanceSequences(client, summary.areas.map((a) => a.area));
      await client.query("COMMIT");
    }
    return summary;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Doppelte Werte, die erst die Datenbank bemerkt */
const DUPLICATES = {
  accounts_iban_key: "Zwei Konten haben dieselbe IBAN.",
  rules_kind_type_match_key_amount_key: "Zwei gemerkte Zuordnungen gelten für dieselbe Gegenpartei und denselben Betrag.",
  idx_people_name: "Zwei Personen haben denselben Namen.",
};

function handleError(err, _req, res, _next) {
  if (err instanceof BackupError) return res.status(err.status).json({ error: err.message });
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: `Die Dateien sind zu groß. Erlaubt sind zusammen höchstens ${MAX_BYTES / 1024 / 1024} MB.` });
  }
  if (err.type) return res.status(err.status || 400).json({ error: "Die Dateien konnten nicht empfangen werden." });
  if (err.code === "23505") {
    return res.status(400).json({ error: `Die Sicherung passt nicht: ${DUPLICATES[err.constraint] ?? "Ein Eintrag kommt doppelt vor."}` });
  }
  if (err.code === "23514") return res.status(400).json({ error: "Die Sicherung enthält ungültige Werte." });
  // Keine Meldungstexte protokollieren: Fehler der Datenbank können Werte aus den Dateien enthalten
  console.error("Datensicherung fehlgeschlagen:", err.code ?? err.name, (err.stack ?? "").split("\n").slice(1, 4).join("\n"));
  res.status(500).json({ error: "Serverfehler bei der Datensicherung." });
}

function createBackupRouter(pool) {
  const router = express.Router();
  const filesBody = express.raw({ type: () => true, limit: MAX_BYTES });

  // Sicherung eines Bereichs als CSV-Datei zum Herunterladen
  router.get("/backup/:area", asyncRoute(async (req, res) => {
    const { area } = req.params;
    if (!Object.hasOwn(AREAS, area)) throw new BackupError("Diesen Bereich gibt es nicht.", 404);
    const client = await pool.connect();
    let tables;
    try {
      // Ein Stand für alle Tabellen, auch wenn sich währenddessen etwas ändert
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      tables = await exportArea(client, area);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    const created = new Date().toISOString();
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileNameFor(area, created)}"`,
      "Cache-Control": "no-store",
    });
    res.send(writeBackup(area, tables, created));
  }));

  // Vorschau: was die Wiederherstellung ändern würde. Speichert nichts.
  router.post("/backup/preview", filesBody, asyncRoute(async (req, res) => {
    res.json(await restore(pool, readUploads(req), true));
  }));

  // Wiederherstellung: ersetzt die Bereiche der Dateien
  router.post("/backup/restore", filesBody, asyncRoute(async (req, res) => {
    res.json(await restore(pool, readUploads(req), false));
  }));

  router.use(handleError);
  return router;
}

module.exports = { MAX_BYTES, createBackupRouter };
