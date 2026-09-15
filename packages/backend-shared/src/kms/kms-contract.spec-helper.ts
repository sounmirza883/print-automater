import { randomBytes } from "node:crypto";
import type { KeyManagementService } from "./kms.interface.js";

/** Run against every KeyManagementService implementation so "both
 * implementations pass the same contract test suite" (2.2) is literally
 * one shared suite, not two suites that happen to look similar. */
export function runKeyManagementServiceContract(
  name: string,
  createService: () => KeyManagementService,
): void {
  describe(`KeyManagementService contract: ${name}`, () => {
    let service: KeyManagementService;

    beforeEach(() => {
      service = createService();
    });

    it("generateDataKey returns a 32-byte plaintext DEK", async () => {
      const { plaintextDek } = await service.generateDataKey();
      expect(plaintextDek).toHaveLength(32);
    });

    it("the wrapped DEK never contains the plaintext DEK -- this IS the value that gets persisted as documents.encrypted_dek starting in 2.4", async () => {
      const { plaintextDek, wrappedDek } = await service.generateDataKey();

      expect(wrappedDek.equals(plaintextDek)).toBe(false);
      expect(wrappedDek.includes(plaintextDek)).toBe(false);
      // As it would actually be stored (hex/base64 in a JSON row or log
      // line), the plaintext must not appear as a substring either.
      expect(wrappedDek.toString("base64")).not.toContain(plaintextDek.toString("base64"));
      expect(wrappedDek.toString("hex")).not.toContain(plaintextDek.toString("hex"));
    });

    it("wrap -> unwrap round-trips to the exact original plaintext", async () => {
      const plaintextDek = randomBytes(32);
      const wrapped = await service.wrap(plaintextDek);
      const unwrapped = await service.unwrap(wrapped);
      expect(unwrapped.equals(plaintextDek)).toBe(true);
    });

    it("wrap never returns/leaks the plaintext it was given", async () => {
      const plaintextDek = randomBytes(32);
      const wrapped = await service.wrap(plaintextDek);
      expect(wrapped.equals(plaintextDek)).toBe(false);
      expect(wrapped.includes(plaintextDek)).toBe(false);
    });

    it("a tampered wrapped value fails to unwrap rather than silently returning wrong bytes", async () => {
      const plaintextDek = randomBytes(32);
      const wrapped = await service.wrap(plaintextDek);
      const tampered = Buffer.from(wrapped);
      const lastIndex = tampered.length - 1;
      tampered[lastIndex] = (tampered[lastIndex] ?? 0) ^ 0xff;

      await expect(service.unwrap(tampered)).rejects.toThrow();
    });
  });
}
