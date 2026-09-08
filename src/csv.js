// One CSV cell escaper, for every export that writes one.
//
// There were three, and they already disagreed. The publication export rendered
// a null cell as empty and guarded against formula injection; the metrics export
// wrote the literal text "null" into the cell and had no guard; the comparison
// export rendered null as empty and also had no guard. Whichever one a reader
// happened to download decided what they got.
//
// The formula guard is opt-in per column rather than blanket, because a cell
// beginning with `-` is a negative number far more often than it is an attack,
// and prefixing an apostrophe to a number breaks the column for everyone. The
// caller knows which of its columns hold free text.

/**
 * Escape one value for a CSV cell.
 *
 * @param {unknown} value the cell value; null and undefined render as empty
 * @param {{ preventFormula?: boolean }} [options] set preventFormula on text
 *   columns, where a leading =, +, - or @ would be read as a formula by Excel,
 *   Google Sheets and LibreOffice
 */
export function csvEscape(value, { preventFormula = false } = {}) {
  let cell = value == null ? '' : String(value);
  if (preventFormula && /^\s*[=+\-@]/.test(cell)) {
    cell = `'${cell}`;
  }
  // \r as well as \n: a lone carriage return inside an unquoted cell ends the
  // record for a strict RFC 4180 reader.
  if (/[",\r\n]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}
