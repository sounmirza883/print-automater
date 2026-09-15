import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import type { ApiEnv } from "@print-automated/config";
import type { UserRole } from "@prisma/client";
import { API_ENV } from "../config/config.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { InvalidRefreshTokenError, RefreshTokenReuseDetectedError } from "./token.errors.js";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_DAYS = 30;

interface AccessTokenPayload {
  sub: string;
  role: UserRole;
}

interface RefreshTokenPayload {
  sub: string;
  familyId: string;
  jti: string;
}

export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  familyId: string;
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

@Injectable()
export class TokenService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly prisma: PrismaService,
  ) {}

  issueAccessToken(user: { id: string; role: UserRole }): string {
    const payload: AccessTokenPayload = { sub: user.id, role: user.role };
    return jwt.sign(payload, this.env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    return jwt.verify(token, this.env.JWT_ACCESS_SECRET) as AccessTokenPayload;
  }

  /** Starts a brand-new rotation family (login, 1.5). */
  async issueTokenPair(user: { id: string; role: UserRole }): Promise<IssuedTokenPair> {
    const familyId = randomUUID();
    const refreshToken = await this.createRefreshToken(user.id, familyId);
    return {
      accessToken: this.issueAccessToken(user),
      refreshToken,
      familyId,
    };
  }

  /** Rotates a refresh token: the presented token is revoked and a new
   * one issued in the same family. If the presented token was already
   * revoked (already used once before), that's reuse -- the whole
   * family is revoked and no new tokens are issued. */
  async rotateRefreshToken(rawRefreshToken: string): Promise<IssuedTokenPair> {
    let payload: RefreshTokenPayload;
    try {
      payload = jwt.verify(rawRefreshToken, this.env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
    } catch {
      throw new InvalidRefreshTokenError();
    }

    const tokenHash = hashToken(rawRefreshToken);
    const existing = await this.prisma.refreshToken.findFirst({ where: { tokenHash } });

    if (!existing) {
      throw new InvalidRefreshTokenError();
    }

    if (existing.revokedAt !== null) {
      await this.revokeFamily(payload.familyId);
      throw new RefreshTokenReuseDetectedError();
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    const role = await this.getUserRole(payload.sub);
    const newRefreshToken = await this.createRefreshToken(payload.sub, payload.familyId);

    return {
      accessToken: this.issueAccessToken({ id: payload.sub, role }),
      refreshToken: newRefreshToken,
      familyId: payload.familyId,
    };
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createRefreshToken(userId: string, familyId: string): Promise<string> {
    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    const payload: RefreshTokenPayload = { sub: userId, familyId, jti };
    const rawToken = jwt.sign(payload, this.env.JWT_REFRESH_SECRET, {
      expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d`,
    });

    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: hashToken(rawToken),
        expiresAt,
      },
    });

    return rawToken;
  }

  private async getUserRole(userId: string): Promise<UserRole> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true },
    });
    return user.role;
  }
}
