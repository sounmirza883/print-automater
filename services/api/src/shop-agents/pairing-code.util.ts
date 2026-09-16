import { randomInt } from "node:crypto";

// Excludes 0/O and 1/I/L -- an 8-character code meant to be read off
// a screen and typed into the agent's own pairing UI (9.5's loopback
// page) should never be ambiguous about which character is which.
const CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

/** §41/9.2. Cryptographically random, not `Math.random()` -- this
 * code is the only thing standing between "any device" and "a device
 * this shop's staff actually authorized," for the 10-minute window
 * it's valid. */
export function generatePairingCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CHARSET[randomInt(CHARSET.length)];
  }
  return code;
}
