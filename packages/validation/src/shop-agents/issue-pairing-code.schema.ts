import { z } from "zod";

export const issuePairingCodeSchema = z.object({
  shopId: z.string().uuid(),
});

export type IssuePairingCodeInput = z.infer<typeof issuePairingCodeSchema>;
