import { z } from "zod";

/** `POST /shop/agents/pairing-code`. The code is for ONE branch: the paired PC, and every printer
 * its heartbeat reports, belong to it. A branch-bound person's code is always for their own branch
 * (naming another is 403); otherwise name the branch, or omit it in a one-branch business. */
export const issuePairingCodeSchema = z.object({
  shopId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
});

export type IssuePairingCodeInput = z.infer<typeof issuePairingCodeSchema>;
