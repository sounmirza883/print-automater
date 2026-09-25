import {
  AUTOMATION_SETTING_KEYS,
  BUSINESS_SETTING_KEYS,
  getShopSettingsQuerySchema,
  updateShopSettingsSchema,
} from "./shop-settings.schema.js";

const shopId = "6ddee6f2-64f4-42ed-8e6e-f51691514da5";
const ok = (v: unknown) => updateShopSettingsSchema.safeParse(v).success;

describe("updateShopSettingsSchema (22.1)", () => {
  it("needs a shopId and at least one setting", () => {
    expect(ok({})).toBe(false);
    expect(ok({ shopId })).toBe(false);
    expect(ok({ shopId, autoFailoverEnabled: true })).toBe(true);
    expect(ok({ autoFailoverEnabled: true })).toBe(false);
  });

  it("is strict: an unknown key is refused rather than silently dropped", () => {
    expect(ok({ shopId, autoFailoverEnabled: true, bogus: 1 })).toBe(false);
  });

  it("expectedVersion is optional but must be a non-negative integer", () => {
    expect(ok({ shopId, currency: "PKR", expectedVersion: 0 })).toBe(true);
    expect(ok({ shopId, currency: "PKR", expectedVersion: -1 })).toBe(false);
    expect(ok({ shopId, currency: "PKR", expectedVersion: 1.5 })).toBe(false);
  });

  it("currency is an ISO-4217-shaped upper-case code", () => {
    expect(ok({ shopId, currency: "USD" })).toBe(true);
    expect(ok({ shopId, currency: "usd" })).toBe(false);
    expect(ok({ shopId, currency: "US" })).toBe(false);
  });

  it("tax is basis points 0..10000 or null (no tax configured)", () => {
    expect(ok({ shopId, taxRateBasisPoints: 1700 })).toBe(true);
    expect(ok({ shopId, taxRateBasisPoints: null })).toBe(true);
    expect(ok({ shopId, taxRateBasisPoints: 10001 })).toBe(false);
    expect(ok({ shopId, taxRateBasisPoints: -1 })).toBe(false);
    expect(ok({ shopId, taxRateBasisPoints: 12.5 })).toBe(false);
  });

  it("operating hours: IANA-ish timezone, HH:MM windows, close after open, no overlap", () => {
    const good = {
      timezone: "Asia/Karachi",
      weekly: { mon: [{ open: "09:00", close: "17:30" }], sun: [] },
    };
    expect(ok({ shopId, operatingHours: good })).toBe(true);
    expect(ok({ shopId, operatingHours: null })).toBe(true);
    expect(
      ok({
        shopId,
        operatingHours: { ...good, weekly: { mon: [{ open: "17:00", close: "09:00" }] } },
      }),
    ).toBe(false);
    expect(
      ok({
        shopId,
        operatingHours: { ...good, weekly: { mon: [{ open: "9:00", close: "17:00" }] } },
      }),
    ).toBe(false);
    expect(
      ok({
        shopId,
        operatingHours: {
          ...good,
          weekly: {
            mon: [
              { open: "09:00", close: "12:00" },
              { open: "11:00", close: "14:00" },
            ],
          },
        },
      }),
    ).toBe(false);
    expect(ok({ shopId, operatingHours: { ...good, weekly: { funday: [] } } })).toBe(false);
    expect(ok({ shopId, operatingHours: { timezone: "", weekly: {} } })).toBe(false);
  });

  it("notification settings are booleans, partial patches allowed, unknown keys refused", () => {
    expect(ok({ shopId, notificationSettings: { emailEnabled: false } })).toBe(true);
    expect(ok({ shopId, notificationSettings: { smsEnabled: true } })).toBe(false);
    expect(ok({ shopId, notificationSettings: { emailEnabled: "no" } })).toBe(false);
  });

  it("classifies every key as exactly one of business / automation (permission split)", () => {
    const shape = Object.keys(updateShopSettingsSchema.innerType().shape);
    const classified = new Set<string>([...BUSINESS_SETTING_KEYS, ...AUTOMATION_SETTING_KEYS]);
    for (const key of shape) {
      if (key === "shopId" || key === "expectedVersion") continue;
      expect(classified.has(key)).toBe(true);
    }
    for (const key of BUSINESS_SETTING_KEYS) {
      expect(AUTOMATION_SETTING_KEYS).not.toContain(key);
    }
  });
});

describe("getShopSettingsQuerySchema", () => {
  it("requires a uuid shopId", () => {
    expect(getShopSettingsQuerySchema.safeParse({ shopId }).success).toBe(true);
    expect(getShopSettingsQuerySchema.safeParse({ shopId: "x" }).success).toBe(false);
  });
});
