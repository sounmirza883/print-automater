import { z } from "zod";
import { MAX_DASHBOARD_RANGE_DAYS } from "../dashboard/dashboard-query.schema.js";

const DAY_MS = 86_400_000;
export const DEFAULT_REPORT_RANGE_DAYS = 30;
export const REPORT_GROUP_BY = ["day", "week", "month"] as const;
export const REPORT_FORMATS = ["json", "csv"] as const;

/** 23.5: every report takes the same bounded query. `to` defaults to now and `from` to
 * 30 days before it; the range runs forwards and spans at most 366 days, so a report can
 * never scan a shop's whole history by accident. */
export const reportQuerySchema = z
  .object({
    shopId: z.string().uuid(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    groupBy: z.enum(REPORT_GROUP_BY).default("day"),
    format: z.enum(REPORT_FORMATS).default("json"),
    /** ISO 4217 code for the money reports; default: the currency with most money in range. */
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .transform((value) => value.toUpperCase())
      .optional(),
  })
  .superRefine((value, ctx) => {
    const to = value.to ?? new Date();
    const from = value.from ?? new Date(to.getTime() - DEFAULT_REPORT_RANGE_DAYS * DAY_MS);
    if (from >= to) {
      ctx.addIssue({ code: "custom", path: ["from"], message: "`from` must be before `to`." });
    } else if (to.getTime() - from.getTime() > MAX_DASHBOARD_RANGE_DAYS * DAY_MS) {
      ctx.addIssue({
        code: "custom",
        path: ["from"],
        message: `The range may not exceed ${MAX_DASHBOARD_RANGE_DAYS} days.`,
      });
    }
  });
export type ReportQueryInput = z.infer<typeof reportQuerySchema>;
