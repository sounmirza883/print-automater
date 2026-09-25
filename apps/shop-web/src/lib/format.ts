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
function minorUnitDigits(currency: string): number | null {
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

/** `PRINTER_OFFLINE` -> "Printer offline". */
export function humanizeEnum(value: string): string {
  const spaced = value.toLowerCase().replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

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

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en", { dateStyle: "medium" });
}

const JOB_PRIORITY_LABELS: ReadonlyArray<readonly [number, string]> = [
  [20, "Urgent"],
  [10, "High"],
  [0, "Normal"],
];

/** `JobPriority` scale: 0 normal, 10 high, 20 urgent. */
export function priorityLabel(priority: number): string {
  for (const [threshold, label] of JOB_PRIORITY_LABELS) {
    if (priority >= threshold) {
      return label;
    }
  }
  return "Normal";
}
