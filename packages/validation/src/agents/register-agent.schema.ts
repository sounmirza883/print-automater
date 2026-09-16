import { z } from "zod";

/** §41/9.3. `deviceId` is agent-generated (a UUID minted once, on
 * first run, and persisted locally per 9.5) -- not server-assigned,
 * so the agent can present the same identity across a re-registration
 * of a lost pairing if it ever needs to (out of MVP scope, but the
 * shape doesn't preclude it). `publicKey` is the raw 32-byte Ed25519
 * public key, base64url-encoded -- the agent never transmits the
 * private half. */
export const registerAgentSchema = z.object({
  pairingCode: z.string().length(8),
  deviceId: z.string().uuid(),
  publicKey: z.string().min(1),
});

export type RegisterAgentInput = z.infer<typeof registerAgentSchema>;
