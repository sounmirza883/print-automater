import { randomUUID } from "node:crypto";
import { apiEnvSchema, loadEnv } from "@print-automated/config";
import { UserRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { TokenService } from "./token.service.js";
import { InvalidRefreshTokenError, RefreshTokenReuseDetectedError } from "./token.errors.js";

// Integration test: rotation/reuse-detection is DB state machine behavior
// (§46/§92-style safety), not something a mock can trustworthily prove.
// Runs against the real Postgres from the dev stack (0.4) locally, or the
// GitHub Actions service container in CI (0.7) -- both expose DATABASE_URL.
describe("TokenService (integration)", () => {
  let prisma: PrismaService;
  let tokenService: TokenService;
  let testUser: { id: string; role: UserRole };

  beforeAll(async () => {
    const env = loadEnv(apiEnvSchema);
    prisma = new PrismaService();
    await prisma.$connect();
    tokenService = new TokenService(env, prisma);

    const user = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Token Service Test User",
        email: `token-service-test-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant-for-this-test",
      },
    });
    testUser = { id: user.id, role: user.role };
  });

  afterAll(async () => {
    // Cascades refresh_tokens (schema: onDelete: Cascade).
    await prisma.user.delete({ where: { id: testUser.id } });
    await prisma.$disconnect();
  });

  it("issues an access token that verifies back to the same user and role", async () => {
    const pair = await tokenService.issueTokenPair(testUser);
    const payload = tokenService.verifyAccessToken(pair.accessToken);
    expect(payload.sub).toBe(testUser.id);
    expect(payload.role).toBe(testUser.role);
  });

  it("rotation issues a new refresh token in the same family and revokes the old one", async () => {
    const first = await tokenService.issueTokenPair(testUser);
    const rotated = await tokenService.rotateRefreshToken(first.refreshToken);

    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    expect(rotated.familyId).toBe(first.familyId);

    const rows = await prisma.refreshToken.findMany({
      where: { familyId: first.familyId },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.revokedAt).not.toBeNull(); // the original, rotated away
    expect(rows[1]!.revokedAt).toBeNull(); // the newly issued replacement
  });

  it("replaying an already-rotated (revoked) refresh token revokes the entire family", async () => {
    const first = await tokenService.issueTokenPair(testUser);
    await tokenService.rotateRefreshToken(first.refreshToken); // rotates once; `first` is now revoked

    await expect(tokenService.rotateRefreshToken(first.refreshToken)).rejects.toThrow(
      RefreshTokenReuseDetectedError,
    );

    const rows = await prisma.refreshToken.findMany({ where: { familyId: first.familyId } });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it("rejects an unknown or malformed refresh token", async () => {
    await expect(tokenService.rotateRefreshToken("not-a-real-token")).rejects.toThrow(
      InvalidRefreshTokenError,
    );
  });

  it("revokeFamily revokes every active token in the family and is idempotent", async () => {
    const pair = await tokenService.issueTokenPair(testUser);

    await tokenService.revokeFamily(pair.familyId);
    await tokenService.revokeFamily(pair.familyId); // must not throw on an already-revoked family

    const rows = await prisma.refreshToken.findMany({ where: { familyId: pair.familyId } });
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
  });
});
