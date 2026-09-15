import { PasswordService } from "./password.service.js";

describe("PasswordService", () => {
  const passwordService = new PasswordService();

  it("verifies a correct password", async () => {
    const hash = await passwordService.hash("correct horse battery staple");
    await expect(passwordService.verify(hash, "correct horse battery staple")).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await passwordService.hash("correct horse battery staple");
    await expect(passwordService.verify(hash, "wrong password")).resolves.toBe(false);
  });

  it("hashes using argon2id, not the library default (argon2i)", async () => {
    const hash = await passwordService.hash("correct horse battery staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("produces a different hash for the same password on each call (random salt)", async () => {
    const [first, second] = await Promise.all([
      passwordService.hash("correct horse battery staple"),
      passwordService.hash("correct horse battery staple"),
    ]);
    expect(first).not.toBe(second);
  });
});
