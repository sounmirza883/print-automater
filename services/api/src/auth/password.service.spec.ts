import { PASSWORD_NOT_SET, PasswordService } from "./password.service.js";

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

  describe("fix wave 1: an account created with no password yet (admin-onboarded owner)", () => {
    it("the not-yet-set marker is recognised, and a real hash is not", async () => {
      expect(passwordService.isPasswordSet(PASSWORD_NOT_SET)).toBe(false);
      expect(passwordService.isPasswordSet(await passwordService.hash("anything at all"))).toBe(
        true,
      );
    });

    it("no password ever verifies against the marker -- including the marker itself -- and it never throws", async () => {
      for (const attempt of ["", PASSWORD_NOT_SET, "!", "password123"]) {
        await expect(passwordService.verify(PASSWORD_NOT_SET, attempt)).resolves.toBe(false);
      }
    });
  });

  it("produces a different hash for the same password on each call (random salt)", async () => {
    const [first, second] = await Promise.all([
      passwordService.hash("correct horse battery staple"),
      passwordService.hash("correct horse battery staple"),
    ]);
    expect(first).not.toBe(second);
  });
});
