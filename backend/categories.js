// Kategorien: Standardliste und Prüfung der Eingaben

/** Arten, für die es je eine Liste von Kategorien gibt: Ausgaben, Einnahmen und Umbuchungen */
const KINDS = ["out", "in", "transfer"];

/**
 * Kategorie, die es für jede Art immer gibt. Importierte Buchungen landen hier, und beim Löschen einer
 * Kategorie wandern die Buchungen ohne andere Wahl hierher. Deshalb lässt sie sich nicht ändern oder löschen.
 */
const FALLBACK_CATEGORY = "Sonstiges";

/** Kategorien einer neuen Datenbank */
const DEFAULT_CATEGORIES = {
  out: ["Wohnen", "Lebensmittel", "Mobilität", "Freizeit", "Versicherung", "Gesundheit", FALLBACK_CATEGORY],
  in: ["Gehalt", "Nebenverdienst", "Erstattung", FALLBACK_CATEGORY],
  transfer: ["Sparen", "Investieren", "Bargeld", FALLBACK_CATEGORY],
};

/**
 * Prüft die Felder einer Kategorie und liefert { values } für die Datenbank oder { error } mit dem Grund.
 * Beim Anlegen braucht es name und kind. Mit partial (Umbenennen) nur name, die Art bleibt immer dieselbe.
 */
function readCategory(body, partial = false) {
  if (typeof body.name !== "string" || !body.name.trim()) {
    return { error: "Bitte einen Namen für die Kategorie angeben." };
  }
  const values = { name: body.name.trim().slice(0, 40) };
  if (partial) return { values };
  if (!KINDS.includes(body.kind)) return { error: "Unbekannte Art." };
  return { values: { ...values, kind: body.kind } };
}

module.exports = { KINDS, FALLBACK_CATEGORY, DEFAULT_CATEGORIES, readCategory };
