import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { PrinterAgentStatus } from "@prisma/client";
import type { RegisterAgentInput } from "@print-automated/validation";
import { AppException, AuditService, PrismaService } from "@print-automated/backend-shared";
import { AgentPairingCodeService } from "../shop-agents/agent-pairing-code.service.js";
import { AgentChallengeService } from "./agent-challenge.service.js";
import { AgentTokenService } from "./agent-token.service.js";
import { verifyEd25519Signature } from "./ed25519.util.js";

export interface RegisteredAgent {
  deviceId: string;
  shopId: string;
}

// The agent protocol needs no branch: it is stored on the agent row (from the pairing code) and
// every printer the agent reports takes it from there.

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pairingCodeService: AgentPairingCodeService,
    private readonly challengeService: AgentChallengeService,
    private readonly tokenService: AgentTokenService,
    private readonly auditService: AuditService,
  ) {}

  /** §41/9.3. `pairingCodeService.redeem` already makes this
   * single-use, atomically -- a stale or already-used code fails
   * before any device record is ever created. Audited as
   * PRINTER_REGISTERED (§83) with no human actor (`actorId: null`):
   * the agent registered itself, using a code staff issued, but staff
   * didn't perform this specific action. */
  async register(input: RegisterAgentInput): Promise<RegisteredAgent> {
    const { shopId, branchId } = await this.pairingCodeService.redeem(input.pairingCode);
    const agent = await this.prisma.printerAgent.create({
      data: { deviceId: input.deviceId, shopId, branchId, publicKey: input.publicKey },
    });

    await this.auditService.record({
      actorId: null,
      action: "PRINTER_REGISTERED",
      resourceType: "printer_agent",
      resourceId: agent.id,
      metadata: { deviceId: agent.deviceId, shopId, branchId },
    });

    return { deviceId: agent.deviceId, shopId: agent.shopId };
  }

  async issueChallenge(deviceId: string): Promise<{ nonce: string }> {
    await this.findActiveAgent(deviceId);
    const nonce = await this.challengeService.issue(deviceId);
    return { nonce };
  }

  /** §75/9.3's own Done-when: "a tampered signature is rejected."
   * The nonce is consumed (deleted) before verification, not after --
   * a signature check that throws partway through must not leave a
   * still-valid nonce a retried request could reuse. */
  async authenticate(deviceId: string, signature: string): Promise<{ accessToken: string }> {
    const agent = await this.findActiveAgent(deviceId);

    const nonce = await this.challengeService.consume(deviceId);
    if (nonce === null) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        "CHALLENGE_EXPIRED",
        "No pending challenge for this device -- request a new one.",
        true,
      );
    }

    if (!verifyEd25519Signature(agent.publicKey, nonce, signature)) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        "INVALID_SIGNATURE",
        "Signature verification failed.",
        false,
      );
    }

    // §103/12.5: "agent connectivity" metric -- authenticate() is what
    // an agent calls to (re-)establish a session (§75's short-lived
    // agent JWT means this recurs, not just at first startup), making
    // it the natural low-noise "agent connected" signal -- unlike the
    // 30s heartbeat, this only fires when a session actually starts.
    this.logger.log(
      { metric: "agent.connected", deviceId: agent.deviceId, shopId: agent.shopId },
      "Agent authenticated.",
    );
    return { accessToken: this.tokenService.issue(agent.deviceId, agent.shopId) };
  }

  private async findActiveAgent(
    deviceId: string,
  ): Promise<{ deviceId: string; shopId: string; publicKey: string }> {
    const agent = await this.prisma.printerAgent.findUnique({ where: { deviceId } });
    if (!agent || agent.status !== PrinterAgentStatus.ACTIVE) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        "UNKNOWN_DEVICE",
        "Unknown or revoked device.",
        false,
      );
    }
    return agent;
  }
}
