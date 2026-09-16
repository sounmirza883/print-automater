import { z } from "zod";

/** §75. `signature` is the agent's Ed25519 signature (base64url) over
 * the raw bytes of the nonce `POST /agents/authenticate/challenge`
 * issued -- proof of possession of the private key this device
 * registered with, without that key ever leaving the agent. */
export const authenticateSchema = z.object({
  deviceId: z.string().uuid(),
  signature: z.string().min(1),
});

export type AuthenticateInput = z.infer<typeof authenticateSchema>;
