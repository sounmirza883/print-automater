import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import type { UserRole } from "@prisma/client";
import { TokenService } from "./token.service.js";

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

export type RequestWithUser = Request & { user?: AuthenticatedUser };

/** §81: every protected route starts here. Verifies the access JWT and
 * attaches { id, role } to the request; RolesGuard and ShopScopeGuard
 * both depend on request.user being set by this guard running first. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokenService: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token.");
    }

    const token = authHeader.slice("Bearer ".length);
    try {
      const payload = this.tokenService.verifyAccessToken(token);
      request.user = { id: payload.sub, role: payload.role };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired access token.");
    }
  }
}
