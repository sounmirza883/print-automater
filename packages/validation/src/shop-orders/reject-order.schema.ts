import { z } from "zod";
import { ShopRejectionReason } from "@print-automated/types";

/** §36/8.3's own Done-when: "Reject without a reason returns 422" --
 * this app's own established convention (shops.e2e-spec.ts et al.) is
 * that every plain schema-validation failure via the global
 * ZodValidationPipe returns 400, not 422 (422 here is reserved for a
 * specific business-rule AppException, e.g. IDEMPOTENCY_KEY_REUSED).
 * Read as "a missing/invalid reason is a 4xx client error, not a
 * silently-defaulted reject" -- the actual status is 400, matching
 * every other schema-validated body/query in this codebase, rather
 * than inventing a one-off 422 special case here. */
export const rejectOrderSchema = z.object({
  reason: z.nativeEnum(ShopRejectionReason),
});

export type RejectOrderInput = z.infer<typeof rejectOrderSchema>;
