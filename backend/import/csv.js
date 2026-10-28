// CSV-Parser nach RFC 4180: Felder in Anführungszeichen dürfen Trennzeichen,
// Zeilenumbrüche und verdoppelte Anführungszeichen ("") enthalten.

class CsvError extends Error {}

/**
 * Zerlegt CSV-Text in Datensätze. Zu jedem Datensatz wird die Zeile gemerkt, in der er
 * beginnt (gezählt ab `firstLine`). Zeilen ohne Inhalt werden übersprungen.
 * @returns {{ line: number, fields: string[] }[]}
 */
function parseCsv(text, delimiter, firstLine = 1) {
  const records = [];
  let fields = [];
  let field = "";
  let quoted = false;
  let line = firstLine;
  let start = firstLine;
  let quoteLine = 0;

  const endRecord = () => {
    fields.push(field);
    if (fields.some((f) => f.trim() !== "")) records.push({ line: start, fields });
    fields = [];
    field = "";
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) line++;
        field += c;
      }
    } else if (c === '"' && field === "") {
      quoted = true;
      quoteLine = line;
    } else if (c === delimiter) {
      fields.push(field);
      field = "";
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      start = ++line;
    } else {
      field += c;
    }
  }
  if (quoted) throw new CsvError(`Das Anführungszeichen in Zeile ${quoteLine} wird nicht geschlossen.`);
  if (field !== "" || fields.length) endRecord();
  return records;
}

/** Entfernt die ersten `count` Zeilen (z. B. Kontoinformationen vor der Spaltenüberschrift). */
function dropLines(text, count) {
  const lineBreak = /\r\n|\r|\n/g;
  for (let i = 0; i < count; i++) {
    if (!lineBreak.exec(text)) return "";
  }
  return text.slice(count ? lineBreak.lastIndex : 0);
}

module.exports = { CsvError, parseCsv, dropLines };
