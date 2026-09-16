import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";

/** Imports a raw 32-byte Ed25519 public key (base64url) via JWK
 * (OKP/Ed25519), rather than constructing an SPKI/DER wrapper by
 * hand -- Node's `crypto` has supported OKP JWK import since well
 * before Node 22, and the agent (9.5) exports its own public key the
 * same way (`publicKey.export({ format: "jwk" }).x`), so both sides
 * speak the identical encoding with no manual ASN.1. */
function publicKeyFromRaw(publicKeyBase64Url: string): KeyObject {
  return createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: publicKeyBase64Url },
    format: "jwk",
  });
}

/** §41/9.3's own Done-when: "a tampered signature is rejected."
 * Never throws -- any malformed input (a bad key, a bad signature
 * encoding) is just "not valid," the same as a signature that
 * verifies cleanly but doesn't match. */
export function verifyEd25519Signature(
  publicKeyBase64Url: string,
  message: string,
  signatureBase64Url: string,
): boolean {
  try {
    const publicKey = publicKeyFromRaw(publicKeyBase64Url);
    const signature = Buffer.from(signatureBase64Url, "base64url");
    return cryptoVerify(null, Buffer.from(message, "utf8"), publicKey, signature);
  } catch {
    return false;
  }
}
