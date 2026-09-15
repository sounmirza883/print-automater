import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { GeneratedDataKey, KeyManagementService } from "./kms.interface.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const DEK_LENGTH = 32;

/** Dev-only stand-in for AwsKmsProvider (§62). The "master key" is
 * whatever string KMS_LOCAL_MASTER_KEY holds (packages/config only
 * enforces >=32 chars, not exactly 32 bytes) -- sha256 normalizes it
 * into a proper fixed-size AES-256 key regardless of the source
 * string's length or encoding. Wrapped format is a single self-
 * contained buffer: [iv(12) | authTag(16) | ciphertext], so wrap()'s
 * Buffer-in/Buffer-out contract needs no separate metadata alongside it. */
@Injectable()
export class LocalKmsProvider implements KeyManagementService {
  private readonly masterKey: Buffer;

  constructor(masterKeySecret: string) {
    this.masterKey = createHash("sha256").update(masterKeySecret, "utf8").digest();
  }

  async generateDataKey(): Promise<GeneratedDataKey> {
    const plaintextDek = randomBytes(DEK_LENGTH);
    const wrappedDek = await this.wrap(plaintextDek);
    return { plaintextDek, wrappedDek };
  }

  // async, deliberately, even though nothing here awaits anything: the
  // interface promises Promise<Buffer>, and a caller reasonably expects
  // failure to surface as a rejection. createDecipheriv().final() throws
  // SYNCHRONOUSLY on auth-tag failure -- without `async`, that throw
  // would escape the call itself rather than reject the returned
  // promise, so a caller's .catch() would never run and an unhandled
  // exception would crash the process instead.
  async wrap(plaintextDek: Buffer): Promise<Buffer> {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintextDek), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]);
  }

  async unwrap(wrappedDek: Buffer): Promise<Buffer> {
    const iv = wrappedDek.subarray(0, IV_LENGTH);
    const authTag = wrappedDek.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = wrappedDek.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, this.masterKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
