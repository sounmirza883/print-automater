import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { CryptoService, CURRENT_ENCRYPTION_VERSION } from "./crypto.service.js";

const DEK = randomBytes(32);
const TWENTY_MB = 20 * 1024 * 1024;
const CHUNK_SIZE = 1024 * 1024; // feed the "20MB PDF" in 1MB pieces, not one shot

function chunkedReadable(buffer: Buffer): Readable {
  let offset = 0;
  return new Readable({
    read() {
      if (offset >= buffer.length) {
        this.push(null);
        return;
      }
      const end = Math.min(offset + CHUNK_SIZE, buffer.length);
      this.push(buffer.subarray(offset, end));
      offset = end;
    },
  });
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

describe("CryptoService", () => {
  const service = new CryptoService();

  it("round-trips a genuinely streamed 20MB payload byte-for-byte", async () => {
    const plaintext = randomBytes(TWENTY_MB);

    const encrypted = service.encryptStream(chunkedReadable(plaintext), DEK);
    const ciphertext = await collect(encrypted.ciphertext);
    const authTag = await encrypted.authTag;

    expect(encrypted.encryptionVersion).toBe(CURRENT_ENCRYPTION_VERSION);
    expect(ciphertext).not.toEqual(plaintext);
    expect(ciphertext.length).toBe(plaintext.length); // GCM is a stream cipher: no padding

    const decrypted = service.decryptStream(
      chunkedReadable(ciphertext),
      DEK,
      encrypted.iv,
      authTag,
    );
    const result = await collect(decrypted);

    expect(result.equals(plaintext)).toBe(true);
  }, 30_000);

  it("a single tampered ciphertext byte causes an auth-tag failure, not silently-corrupted plaintext", async () => {
    const plaintext = Buffer.from("this document must not be printed if it was tampered with");
    const { ciphertext, iv, authTag } = await service.encryptBuffer(plaintext, DEK);

    const tampered = Buffer.from(ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;

    await expect(service.decryptBuffer(tampered, DEK, iv, authTag)).rejects.toThrow();
  });

  it("wrong DEK also fails rather than producing garbage that looks like success", async () => {
    const plaintext = Buffer.from("secret print job contents");
    const { ciphertext, iv, authTag } = await service.encryptBuffer(plaintext, DEK);
    const wrongDek = randomBytes(32);

    await expect(service.decryptBuffer(ciphertext, wrongDek, iv, authTag)).rejects.toThrow();
  });

  it("encryptBuffer/decryptBuffer round-trip small payloads (the common case for 2.7's PDFs)", async () => {
    const plaintext = Buffer.from("%PDF-1.7\n...fake pdf bytes for a unit test...");
    const encrypted = await service.encryptBuffer(plaintext, DEK);
    const decrypted = await service.decryptBuffer(
      encrypted.ciphertext,
      DEK,
      encrypted.iv,
      encrypted.authTag,
    );
    expect(decrypted.equals(plaintext)).toBe(true);
  });
});
