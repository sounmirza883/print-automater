import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  generateKeyPairSync,
  createPrivateKey,
  sign as cryptoSign,
  type JsonWebKey,
} from "node:crypto";
import { randomUUID } from "node:crypto";
import { IDENTITY_FILE } from "./paths.js";

/** §41: an Ed25519 keypair generated locally, once, on first pairing
 * -- the private half is persisted here (so the agent can keep
 * signing challenges after a restart) but is never transmitted over
 * the network; only `publicKeyJwk` (the raw 32-byte public key,
 * base64url, matching the `x` field of its own JWK export) is ever
 * sent to `POST /agents/register`. `deviceId` is minted once and
 * reused for the agent's whole lifetime -- it's the identity `POST
 * /agents/authenticate` proves possession of, not something the
 * server assigns. */
export interface AgentIdentity {
  deviceId: string;
  shopId: string;
  publicKeyJwk: string;
  privateKeyJwk: JsonWebKey;
}

export function loadIdentity(): AgentIdentity | null {
  if (!existsSync(IDENTITY_FILE)) {
    return null;
  }
  const raw = readFileSync(IDENTITY_FILE, "utf8");
  return JSON.parse(raw) as AgentIdentity;
}

export function saveIdentity(identity: AgentIdentity): void {
  // mode 0600 -- best-effort on Windows (no POSIX permission bits),
  // correct and load-bearing if this app is ever ported to Linux/macOS.
  writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2), { mode: 0o600 });
}

export type AgentKeyMaterial = Omit<AgentIdentity, "shopId">;

/** Called exactly once, during pairing (9.5's loopback UI, "Pair"
 * action) -- never regenerated after that; re-pairing this same
 * installation would need a fresh device_id too, since the server
 * treats (deviceId, publicKey) as one identity, not two independently
 * rotatable halves.
 *
 * Deliberately does NOT take `shopId`: the caller doesn't know which
 * shop this device belongs to until *after* `POST /agents/register`
 * redeems the pairing code and returns it -- `deviceId` and the
 * keypair must exist before that call (the request body carries
 * them), so `shopId` can only be folded in afterward, once the
 * response is in hand. */
export function generateKeyMaterial(): AgentKeyMaterial {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" }) as { x: string };
  const privateJwk = privateKey.export({ format: "jwk" }) as JsonWebKey;
  return {
    deviceId: randomUUID(),
    publicKeyJwk: publicJwk.x,
    privateKeyJwk: privateJwk,
  };
}

/** §75: signs the raw UTF-8 bytes of a server-issued nonce. Mirrors
 * services/api's own `verifyEd25519Signature` (ed25519.util.ts) byte
 * for byte -- both sides import/export via JWK, never a hand-rolled
 * DER/SPKI wrapper. */
export function signChallenge(identity: AgentIdentity, nonce: string): string {
  const privateKey = createPrivateKey({ key: identity.privateKeyJwk, format: "jwk" });
  const signature = cryptoSign(null, Buffer.from(nonce, "utf8"), privateKey);
  return signature.toString("base64url");
}
