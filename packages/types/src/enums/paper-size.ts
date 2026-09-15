/** §16 — MVP supports A4 only; A3/Letter/Legal are explicit non-goals
 * (§11) and are added here when that work actually starts. */
export const PaperSize = {
  A4: "A4",
} as const;

export type PaperSize = (typeof PaperSize)[keyof typeof PaperSize];
