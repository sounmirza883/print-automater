import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { AgentTokenService } from "./agent-token.service.js";

export interface AuthenticatedAgent {
  deviceId: string;
  shopId: string;
}

export type RequestWithAgent = Request & { agent?: AuthenticatedAgent };

/** The agent-side equivalent of JwtAuthGuard -- every `/agents/*`
 * route past registration/authentication itself starts here. Verifies
 * against JWT_AGENT_SECRET (a different secret from human users'
 * access tokens), never JwtAuthGuard's own TokenService. */
@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(private readonly agentTokenService: AgentTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAgent>();
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token.");
    }

    const token = authHeader.slice("Bearer ".length);
    try {
      const payload = this.agentTokenService.verify(token);
      request.agent = { deviceId: payload.sub, shopId: payload.shopId };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired agent token.");
    }
  }
}
