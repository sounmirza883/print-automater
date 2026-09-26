import type { PrinterRule, PrinterRuleInput } from "@print-automated/api-client";
import { ColorMode, PaperSize, PaperType, Sides } from "@print-automated/types";
import { humanizeEnum } from "@/lib/format";
import { parseWholeNumber } from "@/lib/form-values";

export const MAX_RULES = 50;

export const RULE_CONDITION_OPTIONS = {
  paperSize: Object.values(PaperSize),
  color: Object.values(ColorMode),
  sides: Object.values(Sides),
  paperType: Object.values(PaperType),
} as const;

export interface RuleForm {
  name: string;
  action: "PREFER" | "AVOID";
  printerIds: string[];
  enabled: boolean;
  paperSize: string;
  color: string;
  sides: string;
  paperType: string;
  minPages: string;
  maxPages: string;
}

export function emptyRuleForm(): RuleForm {
  return {
    name: "",
    action: "PREFER",
    printerIds: [],
    enabled: true,
    paperSize: "",
    color: "",
    sides: "",
    paperType: "",
    minPages: "",
    maxPages: "",
  };
}

export function ruleToForm(rule: PrinterRule): RuleForm {
  const c = rule.conditions;
  return {
    name: rule.name,
    action: rule.action,
    printerIds: [...rule.printerIds],
    enabled: rule.enabled,
    paperSize: c.paperSize ?? "",
    color: c.color ?? "",
    sides: c.sides ?? "",
    paperType: c.paperType ?? "",
    minPages: c.minPages === undefined ? "" : String(c.minPages),
    maxPages: c.maxPages === undefined ? "" : String(c.maxPages),
  };
}

export type RuleCheck =
  | { ok: true; input: PrinterRuleInput }
  | { ok: false; errors: Partial<Record<"name" | "printerIds" | "minPages" | "maxPages", string>> };

/** Validates the way the API will (name 1-80, 1-50 unique printers, page
 * bounds whole and ordered) and builds conditions with only what is set. */
export function buildRuleInput(form: RuleForm): RuleCheck {
  const errors: Partial<Record<"name" | "printerIds" | "minPages" | "maxPages", string>> = {};
  const name = form.name.trim();
  if (name === "" || name.length > 80) errors.name = "Give the rule a name of up to 80 characters.";
  if (form.printerIds.length === 0) errors.printerIds = "Choose at least one printer.";
  const min =
    form.minPages.trim() === ""
      ? undefined
      : parseWholeNumber(form.minPages, { min: 1, max: 1_000_000 });
  const max =
    form.maxPages.trim() === ""
      ? undefined
      : parseWholeNumber(form.maxPages, { min: 1, max: 1_000_000 });
  if (form.minPages.trim() !== "" && min === undefined)
    errors.minPages = "Enter a whole number of 1 or more.";
  if (form.maxPages.trim() !== "" && max === undefined)
    errors.maxPages = "Enter a whole number of 1 or more.";
  if (min !== undefined && max !== undefined && max < min)
    errors.maxPages = "The maximum cannot be below the minimum.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const conditions: PrinterRuleInput["conditions"] = {};
  if (form.paperSize) conditions.paperSize = form.paperSize;
  if (form.color) conditions.color = form.color;
  if (form.sides) conditions.sides = form.sides;
  if (form.paperType) conditions.paperType = form.paperType;
  if (min !== undefined) conditions.minPages = min;
  if (max !== undefined) conditions.maxPages = max;
  return {
    ok: true,
    input: {
      name,
      action: form.action,
      printerIds: form.printerIds,
      conditions,
      enabled: form.enabled,
    },
  };
}

/** One line describing when a rule applies. "Every job" when it has no conditions. */
export function describeConditions(conditions: PrinterRule["conditions"]): string {
  const parts: string[] = [];
  if (conditions.paperSize) parts.push(`paper ${humanizeEnum(conditions.paperSize)}`);
  if (conditions.paperType) parts.push(`${humanizeEnum(conditions.paperType)} paper`);
  if (conditions.color) parts.push(conditions.color === "COLOR" ? "colour" : "black and white");
  if (conditions.sides) parts.push(conditions.sides === "DOUBLE" ? "double-sided" : "single-sided");
  if (conditions.minPages !== undefined && conditions.maxPages !== undefined) {
    parts.push(`${conditions.minPages} to ${conditions.maxPages} pages`);
  } else if (conditions.minPages !== undefined) {
    parts.push(`${conditions.minPages} pages or more`);
  } else if (conditions.maxPages !== undefined) {
    parts.push(`up to ${conditions.maxPages} pages`);
  }
  return parts.length === 0 ? "Every job" : `Jobs with ${parts.join(", ")}`;
}

/** The rule ids in their new order after moving one up (-1) or down (+1).
 * The API needs EVERY id, so this always returns the full list; moving past
 * either end returns the order unchanged. */
export function moveRule(ids: readonly string[], id: string, direction: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}
