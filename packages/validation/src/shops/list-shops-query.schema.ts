import { z } from "zod";
import { PaperSize } from "@print-automated/types";
import { optionalPaginationQuerySchema } from "../common/pagination.schema.js";

/** §17 `GET /shops?paper&color&duplex`. All three are optional --
 * omitting a dimension means "no requirement on it yet" (e.g. browsing
 * before configuring a print job), not "false". Query strings are
 * always strings, so booleans are the literal strings "true"/"false" --
 * `z.coerce.boolean()` is a well-known footgun here (any non-empty
 * string, including the literal "false", coerces to `true`), so this
 * uses an explicit enum + transform instead. */
export const listShopsQuerySchema = z
  .object({
    paper: z.nativeEnum(PaperSize).optional(),
    color: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === "true")),
    duplex: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === "true")),
  })
  .merge(optionalPaginationQuerySchema);

export type ListShopsQueryInput = z.infer<typeof listShopsQuerySchema>;
