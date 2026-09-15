import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { Injectable } from "@nestjs/common";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/** Bumped only if the algorithm/format ever changes; persisted alongside
 * iv/authTag (documents.encryption_version, 2.4) so a future migration
 * can tell which documents were encrypted under which scheme. */
export const CURRENT_ENCRYPTION_VERSION = 1;

export interface EncryptedStream {
  /** The Cipher itself -- a Transform stream; read from it to get
   * ciphertext bytes as plaintext is piped in. */
  ciphertext: Readable;
  iv: Buffer;
  encryptionVersion: number;
  /** GCM's auth tag only exists once every plaintext byte has been
   * processed, so it's a promise that resolves when `ciphertext` ends
   * (or rejects if the cipher stream itself errors). */
  authTag: Promise<Buffer>;
}

/** §62/§63 layer 3: application-level document encryption, one DEK per
 * document (obtained from KeyManagementService, 2.2). This is a
 * DIFFERENT encryption than KMS wrapping -- KMS protects the DEK itself;
 * this protects the actual PDF bytes, using that DEK. Streaming so 2.7's
 * worker never has to hold a whole document in memory to encrypt it. */
@Injectable()
export class CryptoService {
  encryptStream(plaintext: Readable, dek: Buffer): EncryptedStream {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, dek, iv);

    const authTag = new Promise<Buffer>((resolve, reject) => {
      cipher.on("end", () => resolve(cipher.getAuthTag()));
      cipher.on("error", reject);
    });

    plaintext.pipe(cipher);

    return { ciphertext: cipher, iv, encryptionVersion: CURRENT_ENCRYPTION_VERSION, authTag };
  }

  /** Returns the plaintext stream. If `authTag` doesn't match what the
   * ciphertext actually decrypts to -- tampering, wrong key, wrong iv --
   * the returned stream emits an 'error' event rather than silently
   * producing corrupted bytes; it never resolves as if it succeeded. */
  decryptStream(ciphertext: Readable, dek: Buffer, iv: Buffer, authTag: Buffer): Readable {
    const decipher = createDecipheriv(ALGORITHM, dek, iv);
    decipher.setAuthTag(authTag);
    ciphertext.pipe(decipher);
    return decipher;
  }

  /** Buffer convenience wrapper over encryptStream, for callers (2.7's
   * worker, and every test below) that already have the whole document
   * in memory -- documents are capped at 25MB (packages/config), so
   * this is a reasonable ergonomic shortcut, not the primary API. */
  async encryptBuffer(
    plaintext: Buffer,
    dek: Buffer,
  ): Promise<{ ciphertext: Buffer; iv: Buffer; authTag: Buffer; encryptionVersion: number }> {
    const { ciphertext, iv, encryptionVersion, authTag } = this.encryptStream(
      Readable.from(plaintext),
      dek,
    );
    const chunks = await collectStream(ciphertext);
    return { ciphertext: chunks, iv, authTag: await authTag, encryptionVersion };
  }

  async decryptBuffer(
    ciphertext: Buffer,
    dek: Buffer,
    iv: Buffer,
    authTag: Buffer,
  ): Promise<Buffer> {
    const plaintext = this.decryptStream(Readable.from(ciphertext), dek, iv, authTag);
    return collectStream(plaintext);
  }
}

function collectStream(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
