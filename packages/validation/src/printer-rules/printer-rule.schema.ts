import { z } from "zod";
import { ColorMode, PaperSize, PaperType, Sides } from "@print-automated/types";

/** 22.3 (PRD 77). A rule applies to a job when EVERY present condition matches;
 * `minPages`/`maxPages` compare the job's total pages (pages x copies). No conditions =
 * every job. */
export const printerRuleConditionsSchema = z
  .object({
    paperSize: z.nativeEnum(PaperSize).optional(),
    color: z.nativeEnum(ColorMode).optional(),
    sides: z.nativeEnum(Sides).optional(),
    paperType: z.nativeEnum(PaperType).optional(),
    minPages: z.number().int().min(1).max(1_000_000).optional(),
    maxPages: z.number().int().min(1).max(1_000_000).optional(),
  })
  .strict()
  .refine(
    (c) => c.minPages === undefined || c.maxPages === undefined || c.maxPages >= c.minPages,
    "maxPages must not be below minPages.",
  );
export type PrinterRuleConditionsInput = z.infer<typeof printerRuleConditionsSchema>;

export const PRINTER_RULE_ACTIONS = ["PREFER", "AVOID"] as const;
export const MAX_PRINTER_RULES_PER_SHOP = 50;

const name = z.string().trim().min(1).max(80);
const printerIds = z
  .array(z.string().uuid())
  .min(1)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, "Printer ids must be unique.");

export const listPrinterRulesQuerySchema = z.object({ shopId: z.string().uuid() });
export type ListPrinterRulesQueryInput = z.infer<typeof listPrinterRulesQuerySchema>;

/** A new rule is appended at the end of the order; reorder with PUT .../order. */
export const createPrinterRuleSchema = z
  .object({
    shopId: z.string().uuid(),
    name,
    action: z.enum(PRINTER_RULE_ACTIONS),
    printerIds,
    conditions: printerRuleConditionsSchema.default({}),
    enabled: z.boolean().default(true),
  })
  .strict();
export type CreatePrinterRuleInput = z.infer<typeof createPrinterRuleSchema>;

export const updatePrinterRuleSchema = z
  .object({
    /** Optimistic concurrency: the rule `version` the client last read. */
    expectedVersion: z.number().int().min(0).optional(),
    name: name.optional(),
    action: z.enum(PRINTER_RULE_ACTIONS).optional(),
    printerIds: printerIds.optional(),
    conditions: printerRuleConditionsSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "expectedVersion"),
    "Give at least one field to change.",
  );
export type UpdatePrinterRuleInput = z.infer<typeof updatePrinterRuleSchema>;

/** The complete new order: every existing rule id exactly once (checked by the API). */
export const reorderPrinterRulesSchema = z
  .object({
    shopId: z.string().uuid(),
    ruleIds: z
      .array(z.string().uuid())
      .max(MAX_PRINTER_RULES_PER_SHOP)
      .refine((ids) => new Set(ids).size === ids.length, "Rule ids must be unique."),
  })
  .strict();
export type ReorderPrinterRulesInput = z.infer<typeof reorderPrinterRulesSchema>;
