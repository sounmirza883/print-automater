/** Display formatting shared by every screen. Pure, so unit-tested. */

const digitsCache = new Map<string, number | null>();

/** How many decimal places one major unit has in `currency` (PKR/USD 2,
 * JPY 0, KWD 3), or null for a code Intl does not know. */
function minorUnitDigits(currency: string): number | null {
  const cached = digitsCache.get(currency);
  if (cached !== undefined) {
    return cached;
  }
  let digits: number | null;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits as number;
  } catch {
    digits = null;
  }
  digitsCache.set(currency, digits);
  return digits;
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
