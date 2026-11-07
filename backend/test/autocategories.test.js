const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_CATEGORIES, FALLBACK_CATEGORY } = require("../categories");
const { AUTO_GROUPS, autoGroup, SEED_AUTO_KEYS, autoLabelSql, autoCategorize } = require("../autocategories");

test("Tabelle: jede Händlerart hat vier Ziffern und gehört zu genau einer Gruppe", () => {
  const seen = new Map();
  for (const [key, group] of Object.entries(AUTO_GROUPS)) {
    for (const code of group.mcc) {
      assert.match(code, /^\d{4}$/, `${key}: ${code}`);
      assert.equal(seen.get(code), undefined, `${code} steht in ${seen.get(code)} und ${key}`);
      seen.set(code, key);
    }
  }
});

test("Tabelle: jede Gruppe zielt auf eine Standardkategorie der Ausgaben und hat eine Beschreibung", () => {
  for (const [key, group] of Object.entries(AUTO_GROUPS)) {
    assert.ok(DEFAULT_CATEGORIES.out.includes(group.category), key);
    assert.notEqual(group.category, FALLBACK_CATEGORY, key);
    assert.ok(group.label.trim(), key);
  }
});

test("Händlerart: Kartenzahlungen landen in ihrer Gruppe", () => {
  const cases = {
    5411: "food", // Supermarkt
    5462: "food", // Bäcker
    5814: "food", // Imbiss
    5541: "mobility", // Tankstelle
    4112: "mobility", // Bahn
    7997: "leisure", // Fitnessstudio
    4899: "leisure", // Streaming
    5912: "health", // Apotheke
    8021: "health", // Zahnarzt
    4900: "housing", // Strom
    5712: "housing", // Möbel
    6300: "insurance",
  };
  for (const [mcc, group] of Object.entries(cases)) {
    assert.equal(autoGroup({ counterparty: "Muster GmbH", mcc }), group, mcc);
  }
  assert.equal(autoGroup({ counterparty: "", mcc: " 5411 " }), "food", "Leerraum zählt nicht");
});

test("Händlerart: mehrdeutige oder unbekannte Codes ordnen nichts zu", () => {
  for (const mcc of ["5968", "5818", "5734", "8299", "5999", "0000", "", null, undefined]) {
    assert.equal(autoGroup({ counterparty: "Muster GmbH", mcc }), null, String(mcc));
  }
});

test("Supermärkte: bekannte Ketten im Namen der Gegenpartei sind Lebensmittel", () => {
  const names = [
    "REWE Markt GmbH",
    "REWE.Markt.GmbH-Zw-Nl Ost//Musterstadt/DE",
    "PENNY.4711//Musterstadt/DE",
    "REWE4711",
    "ALDI SUED SAGT DANKE",
    "Lidl sagt Danke",
    "EDEKA Mustermann",
    "E-Center Musterstadt",
    "Netto Marken-Discount",
    "Kaufland Musterstadt",
    "denn's Biomarkt",
    "nah & gut Mustermann",
    "tegut... gute Lebensmittel",
  ];
  for (const counterparty of names) {
    assert.equal(autoGroup({ counterparty, mcc: "" }), "food", counterparty);
  }
});

test("Supermärkte: andere Angebote der Ketten und Wörter, die den Namen nur enthalten, zählen nicht", () => {
  const names = [
    "ALDI TALK",
    "Lidl Connect",
    "Penny Reisen",
    "Kaufland Mobil",
    "EDEKA smart",
    "Globus Baumarkt",
    "Globus-Tankstelle",
    "Musterbrauerei Brewery",
    "NettoKom",
    "Rinaldi Trattoria",
    "Max Mustermann",
    "",
  ];
  for (const counterparty of names) {
    assert.equal(autoGroup({ counterparty, mcc: "" }), null, counterparty);
  }
  assert.equal(autoGroup({ counterparty: undefined, mcc: undefined }), null, "ohne Angaben");
});

test("Händlerart geht vor Name: die Tankstelle eines Supermarkts ist Mobilität", () => {
  assert.equal(autoGroup({ counterparty: "Globus SB-Warenhaus", mcc: "5541" }), "mobility");
  assert.equal(autoGroup({ counterparty: "REWE", mcc: "5999" }), "food", "unbekannter Code: Name entscheidet");
});

test("SQL: Schlüssel für die Standardkategorien und Beschreibungen je Schlüssel", () => {
  for (const [key, group] of Object.entries(AUTO_GROUPS)) {
    assert.ok(SEED_AUTO_KEYS.includes(`('${key}', '${group.category}')`), key);
    assert.ok(autoLabelSql("c.auto_key").includes(`WHEN '${key}' THEN '${group.label}'`), key);
  }
  assert.ok(autoLabelSql("c.auto_key").startsWith("CASE c.auto_key "));
});

/** Datenbank zum Mitschreiben: liefert Kategorien mit Schlüssel und Kandidaten, merkt sich die Änderungen */
function fakeDb(targets, candidates) {
  const updates = [];
  const queries = [];
  return {
    updates,
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.startsWith("SELECT auto_key")) return { rows: targets };
      if (sql.startsWith("SELECT t.id")) return { rows: candidates };
      if (sql.startsWith("UPDATE")) {
        updates.push({ name: params[0], ids: params[1] });
        return { rowCount: params[1].length };
      }
      throw new Error(`unerwartete Abfrage: ${sql}`);
    },
  };
}

test("Zuordnen: Kandidaten wandern gesammelt in die Kategorie ihres Schlüssels, auch nach dem Umbenennen", async () => {
  const db = fakeDb(
    [{ key: "food", name: "Verpflegung" }, { key: "mobility", name: "Mobilität" }],
    [
      { id: 1, counterparty: "REWE Markt GmbH", mcc: null },
      { id: 2, counterparty: "Bäckerei Muster", mcc: "5462" },
      { id: 3, counterparty: "Tankstelle Muster", mcc: "5541" },
      { id: 4, counterparty: "Max Mustermann", mcc: null },
      { id: 5, counterparty: "Kino Muster", mcc: "7832" }, // Freizeit hat hier keinen Schlüssel
    ],
  );
  const result = await autoCategorize(db, 7);
  assert.deepEqual(result, [{ name: "Verpflegung", count: 2 }, { name: "Mobilität", count: 1 }]);
  assert.deepEqual(db.updates, [{ name: "Verpflegung", ids: [1, 2] }, { name: "Mobilität", ids: [3] }]);
  const select = db.queries.find((q) => q.sql.startsWith("SELECT t.id"));
  assert.deepEqual(select.params, [FALLBACK_CATEGORY, 7], "nur Auffangkategorie und dieser Import");
  assert.match(select.sql, /NOT t\.category_manual/, "von Hand gewählte bleiben");
});

test("Zuordnen: ohne Kategorien mit Schlüssel wird nichts gelesen oder geändert", async () => {
  const db = fakeDb([], [{ id: 1, counterparty: "REWE", mcc: null }]);
  assert.deepEqual(await autoCategorize(db), []);
  assert.equal(db.queries.length, 1);
  assert.deepEqual(db.updates, []);
});
