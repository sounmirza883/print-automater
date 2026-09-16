import { Inject, Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import type { ApiEnv } from "@print-automated/config";
import { API_ENV } from "../config/config.module.js";

const AGENT_TOKEN_TTL = "15m";

export interface AgentTokenPayload {
  sub: string; // deviceId
  shopId: string;
  type: "agent";
}

/** §75. A separate secret and payload shape from `TokenService`
 * (human users) -- an agent identity is a deviceId, not a user id +
 * role, and the two credential types must never be interchangeable. */
@Injectable()
export class AgentTokenService {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  issue(deviceId: string, shopId: string): string {
    const payload: AgentTokenPayload = { sub: deviceId, shopId, type: "agent" };
    return jwt.sign(payload, this.env.JWT_AGENT_SECRET, { expiresIn: AGENT_TOKEN_TTL });
  }

  verify(token: string): AgentTokenPayload {
    return jwt.verify(token, this.env.JWT_AGENT_SECRET) as AgentTokenPayload;
  }
}
