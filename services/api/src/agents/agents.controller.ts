import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AgentAuthGuard, type RequestWithAgent } from "./agent-auth.guard.js";
import { AgentHeartbeatService } from "./agent-heartbeat.service.js";
import { AgentJobsService, type PrintJobSummary } from "./agent-jobs.service.js";
import { DocumentsService } from "../documents/documents.service.js";
import { RateLimitGuard } from "../rate-limit/rate-limit.guard.js";
import { RateLimit } from "../rate-limit/rate-limit.decorator.js";
import { AuthenticateChallengeDto } from "./dto/authenticate-challenge.dto.js";
import { AuthenticateDto } from "./dto/authenticate.dto.js";
import { HeartbeatDto } from "./dto/heartbeat.dto.js";
import { PollJobsQueryDto } from "./dto/poll-jobs-query.dto.js";
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
  constructor(
    private readonly agentsService: AgentsService,
    private readonly heartbeatService: AgentHeartbeatService,
    private readonly agentJobsService: AgentJobsService,
    private readonly documentsService: DocumentsService,
  ) {}

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

  @Post("heartbeat")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AgentAuthGuard)
  async heartbeat(@Req() req: RequestWithAgent, @Body() dto: HeartbeatDto): Promise<void> {
    await this.heartbeatService.processHeartbeat(req.agent!.deviceId, req.agent!.shopId, dto);
  }

  /** §9.7. 200 with a job when one is found (immediately, or after the
   * Redis signal wakes this call); 204 on a plain timeout. Never 4xx
   * for "nothing to do" -- an empty queue is this endpoint's normal,
   * expected steady state, not a client error. */
  @Get("jobs")
  @UseGuards(AgentAuthGuard)
  async pollJobs(
    @Req() req: RequestWithAgent,
    @Query() query: PollJobsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PrintJobSummary | undefined> {
    const job = await this.agentJobsService.waitForJob(req.agent!.deviceId, query.wait);
    if (!job) {
      res.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    return job;
  }

  @Post("jobs/:id/claim")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AgentAuthGuard)
  claim(@Req() req: RequestWithAgent, @Param("id") id: string): Promise<PrintJobSummary> {
    return this.agentJobsService.claim(id, req.agent!.deviceId);
  }

  /** §64/§65/9.8: same "decrypt on the fly, stream the bytes, never a
   * reusable link" contract as the customer-facing download endpoint
   * -- this one is just authorized against job assignment instead of
   * document ownership. */
  @Get("jobs/:id/document")
  @UseGuards(AgentAuthGuard)
  async downloadDocument(
    @Req() req: RequestWithAgent,
    @Param("id") id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.documentsService.downloadForJob(
      id,
      req.agent!.deviceId,
    );
    res
      .status(HttpStatus.OK)
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
        "Content-Length": String(buffer.length),
      })
      .send(buffer);
  }
}
