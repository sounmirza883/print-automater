/** Display formatting shared by every screen. Pure, so unit-tested. */

/** ISO 4217 minor-unit exponents that are NOT 2. Deliberately a fixed
 * table, not `Intl`: Intl reports CLDR *cash* digits, which differ by
 * engine and version (Chromium says PKR has 0 decimals, Node says 2), and
 * a wrong answer here shows money off by a factor of 100. The API stores
 * PKR as paisa (x100), so the table is the contract, not the runtime. */
const ZERO_DECIMAL = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

/** How many decimal places one major unit has in `currency`, or null for
 * something that is not a three-letter code. */
export function minorUnitDigits(currency: string): number | null {
  if (!/^[A-Z]{3}$/.test(currency)) {
    return null;
  }
  if (ZERO_DECIMAL.has(currency)) {
    return 0;
  }
  return THREE_DECIMAL.has(currency) ? 3 : 2;
}

/** Money on the wire is an integer count of minor units in an explicit
 * currency, and is NEVER summed across currencies. `12550, "PKR"` ->
 * "PKR 125.50". An unrecognised code falls back to "<CODE> <minor> (minor
 * units)" rather than guessing a scale. */
export function formatMoney(minor: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  if (digits === null) {
    return `${currency} ${minor.toLocaleString("en")} (minor units)`;
  }
  const major = minor / 10 ** digits;
  const number = new Intl.NumberFormat("en", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(major);
  return `${currency} ${number}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en").format(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/** `PRINTER_OFFLINE` -> "Printer offline", and the priority labels: shared with shop-mobile
 * (@print-automated/api-client, 23.31). */
export { humanizeEnum, priorityLabel } from "@print-automated/api-client";

/** "3 min ago" style age of an ISO timestamp, relative to `now`. */
export function formatAge(iso: string | null, now: number = Date.now()): string {
  if (iso === null) {
    return "never";
  }
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  return `${Math.round(hours / 24)} d ago`;
}

/** Up to two initials for an avatar: the first letter of the first two words,
 * or the first two letters of a single word. `Array.from` keeps a non-Latin
 * letter (or an emoji) whole instead of cutting a surrogate pair. Never empty. */
export function initialsOf(name: string): string {
  const [first, second] = name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  if (first === undefined) {
    return "?";
  }
  const letters =
    second === undefined
      ? Array.from(first).slice(0, 2)
      : [...Array.from(first).slice(0, 1), ...Array.from(second).slice(0, 1)];
  return letters.join("").toUpperCase();
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en", { dateStyle: "medium" });
}

/** "125.50" -> 12550 in `currency`, or null when the text is not a
 * plain non-negative amount with no more decimals than the currency has.
 * The inverse of `formatMoney`, for amount fields (reprint cost, delivery fee). */
export function parseMoneyToMinor(text: string, currency: string): number | null {
  const digits = minorUnitDigits(currency) ?? 2;
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  const match = /^(\d{1,9})(?:\.(\d+))?$/.exec(trimmed);
  if (match === null) {
    return null;
  }
  const fraction = match[2] ?? "";
  if (fraction.length > digits) {
    return null;
  }
  return Number(match[1]) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
}

/** Minor units -> the text an amount field shows ("12550" -> "125.50"). */
export function minorToInput(minor: number, currency: string): string {
  const digits = minorUnitDigits(currency) ?? 2;
  return (minor / 10 ** digits).toFixed(digits);
}

const COMPACT = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** Axis-tick style: 950 -> "950", 12400 -> "12.4K", 2500000 -> "2.5M". */
export function formatCompact(value: number): string {
  return COMPACT.format(value);
}

/** A money amount as a compact major-unit number WITHOUT the currency ("8K" for PKR 8,000.00),
 * for chart axes whose title already names the currency. */
export function formatCompactMoney(minor: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  return formatCompact(digits === null ? minor : minor / 10 ** digits);
}
