import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { RateLimitGuard } from "../rate-limit/rate-limit.guard.js";
import { RateLimit } from "../rate-limit/rate-limit.decorator.js";
import { AuthenticateChallengeDto } from "./dto/authenticate-challenge.dto.js";
import { AuthenticateDto } from "./dto/authenticate.dto.js";
import { RegisterAgentDto } from "./dto/register-agent.dto.js";
import { AgentsService, type RegisteredAgent } from "./agents.service.js";

const MINUTE_MS = 60_000;

function bodyDeviceId(request: Request): string {
  const deviceId = (request.body as { deviceId?: unknown } | undefined)?.deviceId;
  return typeof deviceId === "string" ? deviceId : "unknown";
}

/** No JwtAuthGuard anywhere here -- these three endpoints are the
 * entry point that *establishes* agent identity in the first place,
 * the agent-JWT equivalent of /auth/register and /auth/login. §85's
 * "agent auth 10/min per device" is the only thing standing between
 * an open endpoint and a signature-guessing loop. */
@Controller("agents")
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post("register")
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowMs: MINUTE_MS, keyGenerator: bodyDeviceId })
  register(@Body() dto: RegisterAgentDto): Promise<RegisteredAgent> {
    return this.agentsService.register(dto);
  }

  @Post("authenticate/challenge")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowMs: MINUTE_MS, keyGenerator: bodyDeviceId })
  issueChallenge(@Body() dto: AuthenticateChallengeDto): Promise<{ nonce: string }> {
    return this.agentsService.issueChallenge(dto.deviceId);
  }

  @Post("authenticate")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowMs: MINUTE_MS, keyGenerator: bodyDeviceId })
  authenticate(@Body() dto: AuthenticateDto): Promise<{ accessToken: string }> {
    return this.agentsService.authenticate(dto.deviceId, dto.signature);
  }
}
