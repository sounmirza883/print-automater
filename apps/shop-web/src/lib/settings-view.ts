import type { OperatingHours, ShopSettings, ShopSettingsPatch } from "@print-automated/api-client";

export const AUTOMATION_KEYS = [
  "autoPrinterAssignmentEnabled",
  "autoOperatorAssignmentEnabled",
  "autoQueueManagementEnabled",
  "inventoryAlertsEnabled",
  "automaticNotificationsEnabled",
  "pageLimitEnforcementEnabled",
  "autoFailoverEnabled",
  "inventoryTrackingEnabled",
  "qualityCheckEnabled",
  "multiItemEnabled",
] as const;

export type AutomationKey = (typeof AUTOMATION_KEYS)[number];

export interface AutomationToggle {
  key: AutomationKey;
  label: string;
  /** What switching it OFF does: the consequence a person needs before deciding. */
  offEffect: string;
  /** Not built yet: shown, but not changeable. */
  unavailable?: boolean;
}

/** PRD 76/122: every automatic path has a switch, and manual work always
 * stays possible. `offEffect` is written for the person switching it off. */
export const AUTOMATION_TOGGLES: readonly AutomationToggle[] = [
  {
    key: "autoPrinterAssignmentEnabled",
    label: "Assign printers automatically",
    offEffect:
      "New jobs wait for manual printer assignment: they show as “Waiting for manual printer assignment” until staff pick a printer. Nothing is lost, and switching it back on picks them up again.",
  },
  {
    key: "autoOperatorAssignmentEnabled",
    label: "Assign operators automatically",
    offEffect: "There is no automatic operator assignment to switch on yet.",
    unavailable: true,
  },
  {
    key: "autoQueueManagementEnabled",
    label: "Manage the queue automatically",
    offEffect:
      "Jobs are not re-ordered or recovered automatically (for example after a printer comes back). Staff move them by hand; jobs wait for manual printer assignment.",
  },
  {
    key: "inventoryAlertsEnabled",
    label: "Low-stock alerts",
    offEffect: "No low-stock alerts are raised. Stock levels are still tracked.",
  },
  {
    key: "automaticNotificationsEnabled",
    label: "Automatic customer notifications",
    offEffect:
      "Routine updates to customers stop. It does NOT stop the notices a customer must always get: an order being rejected (they are refunded) and a print failure are always sent in the app.",
  },
  {
    key: "pageLimitEnforcementEnabled",
    label: "Enforce printer page limits",
    offEffect: "Printer page limits are ignored when choosing a printer, even where they are set.",
  },
  {
    key: "autoFailoverEnabled",
    label: "Printer failover",
    offEffect:
      "When a printer goes offline or reaches its limit, its waiting jobs stay where they are instead of moving to another printer.",
  },
  {
    key: "inventoryTrackingEnabled",
    label: "Track paper stock",
    offEffect:
      "Printing does not use up stock and jobs never wait for paper. Items and movements can still be recorded by hand.",
  },
  {
    key: "qualityCheckEnabled",
    label: "Quality check before collection",
    offEffect: "Printed orders go straight to ready for collection without a quality check.",
  },
  {
    key: "multiItemEnabled",
    label: "Several items per order",
    offEffect: "An order is printed as one job, whatever it contains.",
  },
];

export type BusinessKey =
  "currency" | "taxRateBasisPoints" | "operatingHours" | "notificationSettings";

/** The screen's editable copy of the settings. */
export type SettingsDraft = Pick<ShopSettings, BusinessKey | AutomationKey>;

export function draftFromSettings(settings: ShopSettings): SettingsDraft {
  const draft = {
    currency: settings.currency,
    taxRateBasisPoints: settings.taxRateBasisPoints,
    operatingHours: settings.operatingHours,
    notificationSettings: { ...settings.notificationSettings },
  } as SettingsDraft;
  for (const key of AUTOMATION_KEYS) {
    (draft as unknown as Record<string, unknown>)[key] = settings[key];
  }
  return draft;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The keys the person changed AND is allowed to change: business details
 * need MANAGE_SETTINGS (owner), automation switches MANAGE_AUTOMATION
 * (owner, manager). A key outside the person's groups is never sent, so a
 * manager saving an automation change can never trip the API's per-group
 * permission check with a stale business value. */
export function buildSettingsPatch(
  base: SettingsDraft,
  draft: SettingsDraft,
  allowed: { business: boolean; automation: boolean },
): ShopSettingsPatch {
  const patch: Record<string, unknown> = {};
  if (allowed.business) {
    if (base.currency !== draft.currency) patch.currency = draft.currency;
    if (base.taxRateBasisPoints !== draft.taxRateBasisPoints) {
      patch.taxRateBasisPoints = draft.taxRateBasisPoints;
    }
    if (!same(base.operatingHours, draft.operatingHours))
      patch.operatingHours = draft.operatingHours;
    const notification: Record<string, boolean> = {};
    for (const key of ["emailEnabled", "appEnabled"] as const) {
      if (base.notificationSettings[key] !== draft.notificationSettings[key]) {
        notification[key] = draft.notificationSettings[key];
      }
    }
    if (Object.keys(notification).length > 0) patch.notificationSettings = notification;
  }
  if (allowed.automation) {
    for (const key of AUTOMATION_KEYS) {
      if (base[key] !== draft[key]) patch[key] = draft[key];
    }
  }
  return patch as ShopSettingsPatch;
}

export interface ConflictMerge {
  /** The draft to show after reloading: my edits where the server did not move, theirs where it did. */
  draft: SettingsDraft;
  /** Keys where both of us changed something: the server's value was kept. */
  overwritten: string[];
  /** Keys I changed that the server left alone, so my edit was kept. */
  kept: string[];
}

/** After a SETTINGS_VERSION_CONFLICT: reload the latest, keep every edit of
 * mine the other saver did not also touch, and take THEIR value for any key
 * both of us changed, naming those so nothing is silently lost. */
export function mergeAfterConflict(
  base: SettingsDraft,
  mine: SettingsDraft,
  latest: SettingsDraft,
): ConflictMerge {
  const merged = { ...latest } as Record<string, unknown>;
  const overwritten: string[] = [];
  const kept: string[] = [];
  for (const key of Object.keys(latest) as Array<keyof SettingsDraft>) {
    const iChanged = !same(base[key], mine[key]);
    const theyChanged = !same(base[key], latest[key]);
    if (iChanged && !theyChanged) {
      merged[key] = mine[key];
      kept.push(key);
    } else if (iChanged && theyChanged && !same(mine[key], latest[key])) {
      overwritten.push(key);
    }
  }
  return { draft: merged as unknown as SettingsDraft, overwritten, kept };
}

export const WEEKDAY_LABELS: Record<string, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

const minutes = (value: string): number => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Mirrors the API's operating-hours rules (HH:MM, close after open, no
 * overlap within a day, at most 6 windows) so a mistake is explained before
 * saving. Returns human sentences; empty means valid. */
export function validateHours(hours: OperatingHours | null): string[] {
  if (hours === null) return [];
  const problems: string[] = [];
  if (hours.timezone.trim() === "") problems.push("Enter a timezone, like Asia/Karachi.");
  for (const [day, windows] of Object.entries(hours.weekly)) {
    const name = WEEKDAY_LABELS[day] ?? day;
    const list = windows ?? [];
    if (list.length > 6) problems.push(`${name}: at most 6 opening periods.`);
    for (const window of list) {
      if (!TIME.test(window.open) || !TIME.test(window.close)) {
        problems.push(`${name}: use 24-hour times like 09:00.`);
      } else if (minutes(window.close) <= minutes(window.open)) {
        problems.push(`${name}: closing time must be after opening time.`);
      }
    }
    const sorted = [...list]
      .filter((w) => TIME.test(w.open) && TIME.test(w.close))
      .sort((a, b) => minutes(a.open) - minutes(b.open));
    for (let i = 1; i < sorted.length; i += 1) {
      if (minutes(sorted[i]!.open) < minutes(sorted[i - 1]!.close)) {
        problems.push(`${name}: opening periods overlap.`);
        break;
      }
    }
  }
  return problems;
}
