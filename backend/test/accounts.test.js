const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeIban, formatIban, isIban, readAccount, accountsForIbans } = require("../accounts");

// Beispiel-IBANs aus der Dokumentation der Banken, keine echten Konten
const GIRO = "DE89370400440532013000";
const OTHER = "GB82WEST12345698765432";

test("IBAN: Leerraum und Kleinschreibung werden vereinheitlicht", () => {
  assert.equal(normalizeIban(" de89 3704 0044\t0532 0130 00 "), GIRO);
  assert.equal(normalizeIban(undefined), "");
  assert.equal(formatIban(GIRO), "DE89 3704 0044 0532 0130 00");
  assert.equal(formatIban(OTHER), "GB82 WEST 1234 5698 7654 32");
});

test("IBAN: Aufbau und Prüfziffern", () => {
  assert.equal(isIban(GIRO), true);
  assert.equal(isIban(OTHER), true);
  assert.equal(isIban("DE89370400440532013001"), false, "Tippfehler");
  assert.equal(isIban("DE88370400440532013000"), false, "falsche Prüfziffer");
  assert.equal(isIban("DE00123456780000000001"), false, "erfundene IBAN aus den Beispieldateien");
  assert.equal(isIban("DE8937040044"), false, "zu kurz");
  assert.equal(isIban("de89370400440532013000"), false, "nicht normalisiert");
});

const valid = () => ({ name: " Girokonto ", kind: "giro", institution: " BW-Bank ", iban: "de89 3704 0044 0532 0130 00" });

test("Konto anlegen: Eingaben werden für die Datenbank aufbereitet", () => {
  assert.deepEqual(readAccount(valid()), {
    values: { name: "Girokonto", kind: "giro", institution: "BW-Bank", iban: GIRO },
  });
  assert.deepEqual(readAccount({ name: "Bargeld", kind: "cash" }), {
    values: { name: "Bargeld", kind: "cash", institution: "", iban: null },
  });
  assert.equal(readAccount({ ...valid(), name: "x".repeat(80) }).values.name.length, 60);
});

test("Konto anlegen: fehlende oder ungültige Angaben werden mit Grund abgelehnt", () => {
  const cases = {
    "Name fehlt": { name: undefined },
    "Name leer": { name: "  " },
    "Name keine Zeichenkette": { name: 7 },
    "Art fehlt": { kind: undefined },
    "unbekannte Art": { kind: "bitcoin" },
    "IBAN mit Tippfehler": { iban: "DE89370400440532013001" },
    "IBAN keine IBAN": { iban: "12345678" },
  };
  for (const [name, change] of Object.entries(cases)) {
    const result = readAccount({ ...valid(), ...change });
    assert.equal(result.values, undefined, name);
    assert.ok(result.error, name);
  }
  assert.match(readAccount({ ...valid(), iban: "DE89370400440532013001" }).error, /IBAN ist ungültig/);
});

test("Konto ändern: nur übergebene Felder, eine leere IBAN entfernt sie", () => {
  assert.deepEqual(readAccount({ name: "Tagesgeld", kind: "savings" }, true), { values: { name: "Tagesgeld", kind: "savings" } });
  assert.deepEqual(readAccount({ iban: "" }, true), { values: { iban: null } });
  assert.deepEqual(readAccount({ iban: null }, true), { values: { iban: null } });
  assert.deepEqual(readAccount({ id: 3, created_at: "2026-01-01" }, true), { values: {} });
  assert.ok(readAccount({ name: "" }, true).error);
});

/** Datenbank-Attrappe: kennt das Girokonto und vergibt für neue Konten fortlaufende IDs */
function fakeDb() {
  const db = {
    queries: 0,
    inserted: [],
    async query(sql, params) {
      db.queries++;
      if (sql.startsWith("SELECT")) return { rows: params[0].includes(GIRO) ? [{ id: 1, name: "Girokonto", iban: GIRO }] : [] };
      db.inserted.push(params);
      return { rows: [{ id: 10 + db.inserted.length }] };
    },
  };
  return db;
}

test("Konten zu IBANs: bekannte werden gefunden, für die Vorschau wird nichts angelegt", async () => {
  const db = fakeDb();
  const accounts = await accountsForIbans(db, [GIRO, OTHER]);
  assert.deepEqual(accounts.get(GIRO), { id: 1, name: "Girokonto", isNew: false });
  assert.deepEqual(accounts.get(OTHER), { id: null, name: "GB82 WEST 1234 5698 7654 32", isNew: true });
  assert.deepEqual(db.inserted, []);
});

test("Konten zu IBANs: beim Import wird für jede unbekannte IBAN ein Konto angelegt", async () => {
  const db = fakeDb();
  const accounts = await accountsForIbans(db, [GIRO, OTHER], true);
  assert.deepEqual(accounts.get(GIRO), { id: 1, name: "Girokonto", isNew: false });
  assert.deepEqual(accounts.get(OTHER), { id: 11, name: "GB82 WEST 1234 5698 7654 32", isNew: true });
  assert.deepEqual(db.inserted, [["GB82 WEST 1234 5698 7654 32", OTHER]]);
});

test("Konten zu IBANs: ohne IBAN keine Abfrage", async () => {
  const db = fakeDb();
  assert.equal((await accountsForIbans(db, [], true)).size, 0);
  assert.equal(db.queries, 0);
});
