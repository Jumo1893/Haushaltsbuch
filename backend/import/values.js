// Umwandlung von Dateiinhalten: Zeichenkodierung, Datum, Betrag und Text.

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pad2 = (n) => String(n).padStart(2, "0");

/**
 * Dekodiert die Datei mit der ersten Kodierung, in der sie fehlerfrei lesbar ist.
 * Ein UTF-8-BOM am Dateianfang hat Vorrang. Liefert null, wenn keine Kodierung passt.
 */
function decode(buffer, encodings) {
  const hasBom = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  for (const encoding of hasBom ? ["utf-8"] : encodings) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(buffer);
    } catch {
      // nächste Kodierung versuchen
    }
  }
  return null;
}

const DATE_TOKENS = { YYYY: "(\\d{4})", YY: "(\\d{2})", MM: "(\\d{2})", DD: "(\\d{2})" };

/**
 * Erzeugt aus einem Datumsformat wie "DD.MM.YYYY" eine Funktion, die ein ISO-Datum
 * (YYYY-MM-DD) oder null liefert. Zweistellige Jahre (YY) werden als 20YY gelesen.
 * Liefert null, wenn das Format ungültig ist.
 */
function compileDateFormat(format) {
  if (typeof format !== "string") return null;
  const tokens = [];
  let source = "";
  for (const [part] of format.matchAll(/YYYY|YY|MM|DD|./gs)) {
    if (part in DATE_TOKENS) {
      tokens.push(part);
      source += DATE_TOKENS[part];
    } else {
      source += escapeRegExp(part);
    }
  }
  const sorted = [...tokens].sort().join();
  if (sorted !== "DD,MM,YYYY" && sorted !== "DD,MM,YY") return null;

  const pattern = new RegExp(`^${source}$`);
  return (value) => {
    const match = pattern.exec(value);
    if (!match) return null;
    const v = Object.fromEntries(tokens.map((t, i) => [t, Number(match[i + 1])]));
    const year = v.YYYY ?? 2000 + v.YY;
    const d = new Date(Date.UTC(year, v.MM - 1, v.DD));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== v.MM - 1 || d.getUTCDate() !== v.DD) return null;
    return `${year}-${pad2(v.MM)}-${pad2(v.DD)}`;
  };
}

/** Zahl mit Vorzeichen, Tausendertrennzeichen nur an den richtigen Stellen, Nachkommastellen optional */
function numberPattern(decimalSeparator, thousandsSeparator) {
  const t = escapeRegExp(thousandsSeparator);
  const integer = thousandsSeparator ? `\\d{1,3}(?:${t}\\d{3})+|\\d+` : "\\d+";
  return new RegExp(`^([+-]?)(${integer})(?:${escapeRegExp(decimalSeparator)}(\\d+))?$`);
}

/**
 * Erzeugt eine Funktion, die einen Betrag wie "-1.234,56" in Cent umrechnet (-123456).
 * Mehr als zwei Nachkommastellen sind nur erlaubt, wenn sie 0 sind (z. B. "-99.000000").
 * Liefert null, wenn der Text kein Betrag ist.
 */
function compileAmountFormat(decimalSeparator, thousandsSeparator) {
  const pattern = numberPattern(decimalSeparator, thousandsSeparator);
  return (value) => {
    const match = pattern.exec(value.trim());
    const fraction = match?.[3] ?? "";
    if (!match || /[^0]/.test(fraction.slice(2))) return null;
    const euros = thousandsSeparator ? match[2].split(thousandsSeparator).join("") : match[2];
    const cents = Number(euros) * 100 + Number(fraction.slice(0, 2).padEnd(2, "0"));
    return match[1] === "-" ? -cents : cents;
  };
}

/** Wie compileAmountFormat, aber für beliebige Zahlen wie Stückzahl oder Kurs. Liefert eine Zahl oder null. */
function compileNumberFormat(decimalSeparator, thousandsSeparator) {
  const pattern = numberPattern(decimalSeparator, thousandsSeparator);
  return (value) => {
    const match = pattern.exec(value.trim());
    if (!match) return null;
    const integer = thousandsSeparator ? match[2].split(thousandsSeparator).join("") : match[2];
    return Number(`${match[1]}${integer}.${match[3] ?? "0"}`);
  };
}

/** Ersetzt Steuerzeichen und Folgen von Leerraum durch ein Leerzeichen. */
const cleanText = (s) => s.replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, " ").trim();

/**
 * Schutz vor CSV-/Formel-Injection: Text, den eine Tabellenkalkulation als Formel lesen würde
 * (beginnt mit =, +, -, @), wird mit vorangestelltem ' gespeichert und bleibt so reiner Text.
 */
const neutralizeFormula = (s) => (/^[=+\-@]/.test(s) ? `'${s}` : s);

module.exports = { decode, compileDateFormat, compileAmountFormat, compileNumberFormat, cleanText, neutralizeFormula };
