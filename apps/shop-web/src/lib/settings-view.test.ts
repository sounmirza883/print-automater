import type { ShopSettings } from "@print-automated/api-client";
import {
  AUTOMATION_KEYS,
  AUTOMATION_TOGGLES,
  buildSettingsPatch,
  draftFromSettings,
  mergeAfterConflict,
  validateHours,
} from "./settings-view";

const settings: ShopSettings = {
  shopId: "s",
  version: 3,
  updatedAt: "2026-01-01T00:00:00Z",
  currency: "PKR",
  taxRateBasisPoints: 1700,
  operatingHours: {
    timezone: "Asia/Karachi",
    weekly: { mon: [{ open: "09:00", close: "18:00" }] },
  },
  notificationSettings: { emailEnabled: true, appEnabled: true },
  autoPrinterAssignmentEnabled: true,
  autoOperatorAssignmentEnabled: false,
  autoQueueManagementEnabled: true,
  inventoryAlertsEnabled: true,
  automaticNotificationsEnabled: true,
  pageLimitEnforcementEnabled: false,
  autoFailoverEnabled: false,
  inventoryTrackingEnabled: true,
  qualityCheckEnabled: false,
  multiItemEnabled: false,
};
const base = draftFromSettings(settings);

describe("toggle catalogue", () => {
  it("covers exactly the API's ten automation keys, once each", () => {
    expect(AUTOMATION_TOGGLES.map((t) => t.key).sort()).toEqual([...AUTOMATION_KEYS].sort());
  });

  it("states the required copy", () => {
    const notifications = AUTOMATION_TOGGLES.find((t) => t.key === "automaticNotificationsEnabled");
    expect(notifications?.offEffect).toMatch(/does NOT stop/);
    expect(notifications?.offEffect).toMatch(/rejected/);
    expect(notifications?.offEffect).toMatch(/print failure/);
    const printers = AUTOMATION_TOGGLES.find((t) => t.key === "autoPrinterAssignmentEnabled");
    expect(printers?.offEffect).toMatch(/manual printer assignment/);
  });

  it("marks operator assignment as not yet available", () => {
    expect(
      AUTOMATION_TOGGLES.find((t) => t.key === "autoOperatorAssignmentEnabled")?.unavailable,
    ).toBe(true);
  });
});

describe("buildSettingsPatch", () => {
  it("sends only what changed", () => {
    const draft = { ...base, autoFailoverEnabled: true };
    expect(buildSettingsPatch(base, draft, { business: true, automation: true })).toEqual({
      autoFailoverEnabled: true,
    });
    expect(buildSettingsPatch(base, base, { business: true, automation: true })).toEqual({});
  });

  it("never sends a group the role may not change (manager: automation only)", () => {
    const draft = {
      ...base,
      currency: "USD",
      autoFailoverEnabled: true,
      notificationSettings: { emailEnabled: false, appEnabled: true },
    };
    expect(buildSettingsPatch(base, draft, { business: false, automation: true })).toEqual({
      autoFailoverEnabled: true,
    });
    expect(buildSettingsPatch(base, draft, { business: true, automation: false })).toEqual({
      currency: "USD",
      notificationSettings: { emailEnabled: false },
    });
  });

  it("can clear the tax rate and the operating hours with null", () => {
    const draft = { ...base, taxRateBasisPoints: null, operatingHours: null };
    expect(buildSettingsPatch(base, draft, { business: true, automation: false })).toEqual({
      taxRateBasisPoints: null,
      operatingHours: null,
    });
  });
});

describe("mergeAfterConflict", () => {
  it("keeps my edits the other saver did not touch and takes their other changes", () => {
    const mine = { ...base, autoFailoverEnabled: true };
    const latest = { ...base, currency: "USD", multiItemEnabled: true };
    const result = mergeAfterConflict(base, mine, latest);
    expect(result.draft.autoFailoverEnabled).toBe(true);
    expect(result.kept).toEqual(["autoFailoverEnabled"]);
    expect(result.draft.currency).toBe("USD");
    expect(result.draft.multiItemEnabled).toBe(true);
    expect(result.overwritten).toEqual([]);
  });

  it("names a key both changed differently and keeps the server value", () => {
    const mine = { ...base, currency: "EUR" };
    const latest = { ...base, currency: "USD" };
    const result = mergeAfterConflict(base, mine, latest);
    expect(result.overwritten).toEqual(["currency"]);
    expect(result.draft.currency).toBe("USD");
  });
});

describe("validateHours", () => {
  it("accepts valid hours and none", () => {
    expect(validateHours(settings.operatingHours)).toEqual([]);
    expect(validateHours(null)).toEqual([]);
  });

  it("explains bad, reversed and overlapping periods", () => {
    const problems = validateHours({
      timezone: "",
      weekly: {
        mon: [{ open: "9:00", close: "18:00" }],
        tue: [{ open: "18:00", close: "09:00" }],
        wed: [
          { open: "09:00", close: "13:00" },
          { open: "12:00", close: "17:00" },
        ],
      },
    });
    expect(problems).toEqual([
      "Enter a timezone, like Asia/Karachi.",
      "Monday: use 24-hour times like 09:00.",
      "Tuesday: closing time must be after opening time.",
      "Wednesday: opening periods overlap.",
    ]);
  });
});
