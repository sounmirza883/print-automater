import { z } from "zod";
import { ColorMode, Orientation, PaperSize, Sides } from "@print-automated/types";

/** A print job never needs more than this many copies in one order --
 * a sanity bound (4.6's "copies (bounded)"), not a business rule
 * anyone has specified a precise number for; generous enough that no
 * real customer hits it, small enough to make an obviously-wrong
 * client request (or a scripted abuse attempt) fail validation instead
 * of producing an absurd quote. */
const MAX_COPIES = 500;

const pageSelectionSchema = z.union([
  z.object({ mode: z.literal("all") }),
  z.object({
    mode: z.literal("range"),
    from: z.number().int().positive(),
    to: z.number().int().positive(),
  }),
]);

/** Shared by every endpoint that accepts a print job's configuration
 * (4.4's quote endpoint, Phase 5's order creation) -- one schema, not
 * one per endpoint, so "what's a valid PrintConfiguration" is answered
 * in exactly one place. Mirrors packages/types' `PrintConfiguration`
 * (§16) field-for-field; range bounds against a specific document's
 * actual page count are packages/pricing's `resolvePageCount`'s job,
 * not this schema's -- that requires the document's real page count,
 * which isn't known statically. */
export const printConfigurationSchema = z.object({
  pages: pageSelectionSchema,
  copies: z.number().int().positive().max(MAX_COPIES),
  paperSize: z.nativeEnum(PaperSize),
  color: z.nativeEnum(ColorMode),
  sides: z.nativeEnum(Sides),
  orientation: z.nativeEnum(Orientation),
});

export type PrintConfigurationInput = z.infer<typeof printConfigurationSchema>;
