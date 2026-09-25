import { z } from "zod";

/** 22.1 (PRD 75/76). One settings surface for a shop. Two permission groups:
 * BUSINESS settings (MANAGE_SETTINGS, owner) and AUTOMATION / operating flags
 * (MANAGE_AUTOMATION, owner and manager). The route checks the group of every key
 * present in a patch, so a manager cannot smuggle a business change into an
 * automation update. */
export const BUSINESS_SETTING_KEYS = [
  "currency",
  "taxRateBasisPoints",
  "operatingHours",
  "notificationSettings",
] as const;

export const AUTOMATION_SETTING_KEYS = [
  "autoPrinterAssignmentEnabled",
  "autoOperatorAssignmentEnabled",
  "autoQueueManagementEnabled",
  "inventoryAlertsEnabled",
  "automaticNotificationsEnabled",
  "pageLimitEnforcementEnabled",
  // These four live on `shops` (hot-path reads unchanged) but are edited here.
  "autoFailoverEnabled",
  "inventoryTrackingEnabled",
  "qualityCheckEnabled",
  "multiItemEnabled",
] as const;

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM.");
const minutes = (value: string): number => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

const windowSchema = z
  .object({ open: timeOfDay, close: timeOfDay })
  .strict()
  .refine((w) => minutes(w.close) > minutes(w.open), "close must be after open.");

/** A weekly schedule in the shop's own timezone. A missing or empty day = closed.
 * Informational: PRD 75 lists operating hours as configuration, and nothing in the
 * PRD says orders are refused outside them, so they are never enforced. */
export const operatingHoursSchema = z
  .object({
    timezone: z.string().min(1).max(64),
    weekly: z
      .object(
        Object.fromEntries(WEEKDAYS.map((day) => [day, z.array(windowSchema).max(6).optional()])),
      )
      .strict()
      .superRefine((weekly, ctx) => {
        for (const [day, windows] of Object.entries(weekly)) {
          const sorted = [...((windows as Array<{ open: string; close: string }>) ?? [])].sort(
            (a, b) => minutes(a.open) - minutes(b.open),
          );
          for (let i = 1; i < sorted.length; i += 1) {
            if (minutes(sorted[i]!.open) < minutes(sorted[i - 1]!.close)) {
              ctx.addIssue({ code: "custom", message: `Overlapping windows on ${day}.` });
            }
          }
        }
      }),
  })
  .strict();
export type OperatingHours = z.infer<typeof operatingHoursSchema>;

export const notificationSettingsSchema = z
  .object({ emailEnabled: z.boolean(), appEnabled: z.boolean() })
  .strict();
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const getShopSettingsQuerySchema = z.object({ shopId: z.string().uuid() });
export type GetShopSettingsQueryInput = z.infer<typeof getShopSettingsQuerySchema>;

export const updateShopSettingsSchema = z
  .object({
    shopId: z.string().uuid(),
    /** Optimistic concurrency: the `version` the client last read. Omitted =
     * last-write-wins (kept only so legacy single-flag callers keep working). */
    expectedVersion: z.number().int().min(0).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, "Use a 3-letter upper-case currency code.")
      .optional(),
    taxRateBasisPoints: z.number().int().min(0).max(10_000).nullable().optional(),
    operatingHours: operatingHoursSchema.nullable().optional(),
    notificationSettings: notificationSettingsSchema
      .partial()
      .refine((value) => Object.keys(value).length > 0, "Give at least one notification setting.")
      .optional(),
    autoPrinterAssignmentEnabled: z.boolean().optional(),
    autoOperatorAssignmentEnabled: z.boolean().optional(),
    autoQueueManagementEnabled: z.boolean().optional(),
    inventoryAlertsEnabled: z.boolean().optional(),
    automaticNotificationsEnabled: z.boolean().optional(),
    pageLimitEnforcementEnabled: z.boolean().optional(),
    autoFailoverEnabled: z.boolean().optional(),
    inventoryTrackingEnabled: z.boolean().optional(),
    qualityCheckEnabled: z.boolean().optional(),
    multiItemEnabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "shopId" && key !== "expectedVersion"),
    "Give at least one setting to change.",
  );
export type UpdateShopSettingsInput = z.infer<typeof updateShopSettingsSchema>;
