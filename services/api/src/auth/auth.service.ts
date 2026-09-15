import { randomBytes } from "node:crypto";
import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { UserRole, UserStatus } from "@prisma/client";
import type { RegisterInput, LoginInput } from "@print-automated/validation";
import { PrismaService, AuditService } from "@print-automated/backend-shared";
import { NotificationService } from "../notifications/notification.service.js";
import { AuditAction } from "../audit/audit-action.js";
import { hashToken } from "../common/crypto.util.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";
import { InvalidRefreshTokenError, RefreshTokenReuseDetectedError } from "./token.errors.js";

const PASSWORD_RESET_TTL_MINUTES = 30;

export interface AuthResult {
  user: { id: string; name: string; email: string; role: UserRole };
  accessToken: string;
  refreshToken: string;
}

interface StoredUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly notificationService: NotificationService,
    private readonly auditService: AuditService,
  ) {}

  /** Self-registration always creates a CUSTOMER account -- role is
   * never taken from client input (§81: the client is never trusted for
   * authorization-relevant decisions). Staff/admin accounts are
   * provisioned through other means, not this endpoint. */
  async register(input: RegisterInput): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictException("An account with this email already exists.");
    }

    const passwordHash = await this.passwordService.hash(input.password);
    const user = await this.prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: input.name,
        email: input.email,
        phone: input.phone,
        passwordHash,
      },
    });

    return this.issueAuthResult(user, AuditAction.REGISTER);
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      // Same message whether the account doesn't exist or the password
      // is wrong -- don't let this endpoint confirm which emails exist.
      throw new UnauthorizedException("Invalid email or password.");
    }

    const passwordValid = await this.passwordService.verify(user.passwordHash, input.password);
    if (!passwordValid) {
      throw new UnauthorizedException("Invalid email or password.");
    }

    return this.issueAuthResult(user, AuditAction.LOGIN);
  }

  async refresh(rawRefreshToken: string): Promise<Omit<AuthResult, "user">> {
    try {
      const pair = await this.tokenService.rotateRefreshToken(rawRefreshToken);
      return { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
    } catch (error) {
      if (
        error instanceof InvalidRefreshTokenError ||
        error instanceof RefreshTokenReuseDetectedError
      ) {
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }
  }

  /** Idempotent: an already-invalid token means there's nothing left to
   * revoke, so this succeeds silently rather than erroring on a retry.
   * Only a meaningful logout (a token that actually decoded) is audited
   * -- there's no actor to attribute a garbage-token attempt to. */
  async logout(rawRefreshToken: string): Promise<void> {
    const payload = this.tokenService.decodeRefreshToken(rawRefreshToken);
    if (!payload) {
      return;
    }
    await this.tokenService.revokeFamily(payload.familyId);
    await this.auditService.record({
      actorId: payload.sub,
      action: AuditAction.LOGOUT,
      resourceType: "user",
      resourceId: payload.sub,
    });
  }

  /** Always behaves identically whether or not the email is registered,
   * so this endpoint can't be used to enumerate accounts. */
  async requestPasswordRecovery(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return;
    }

    const rawToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt,
      },
    });

    this.notificationService.sendPasswordRecovery(email, rawToken);
  }

  private async issueAuthResult(user: StoredUser, action: AuditAction): Promise<AuthResult> {
    const pair = await this.tokenService.issueTokenPair(user);
    await this.auditService.record({
      actorId: user.id,
      action,
      resourceType: "user",
      resourceId: user.id,
    });
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
    };
  }
}
