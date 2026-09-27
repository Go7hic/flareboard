/**
 * One CSV cell. Quotes values containing separators, quotes, or line breaks, and
 * neutralizes spreadsheet formulas: paths, referrers, and event names come from
 * visitors, and a cell like `=HYPERLINK(...)` would run when the export is opened.
 */
export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',');
}
