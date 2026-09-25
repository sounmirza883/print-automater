/** Flattens nested objects to `parent.child` keys (arrays are JSON-encoded). */
function flatten(value: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
      Object.assign(out, flatten(entry as Record<string, unknown>, name));
    } else {
      out[name] = entry;
    }
  }
  return out;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  let text = Array.isArray(value) ? JSON.stringify(value) : String(value);
  // CSV injection: a cell a spreadsheet would evaluate as a formula is prefixed so it is text.
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 23.5: RFC-4180-style CSV (CRLF line ends) of report rows, with formula injection
 * neutralised. The header comes from `columns`, else from the first row. */
export function toCsv(rows: ReadonlyArray<Record<string, unknown>>, columns?: string[]): string {
  const flat = rows.map((row) => flatten(row));
  const header = columns ?? (flat[0] ? Object.keys(flat[0]) : []);
  if (header.length === 0) {
    return "";
  }
  const lines = [header.join(",")];
  for (const row of flat) {
    lines.push(header.map((name) => cell(row[name])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
