import { Injectable } from "@nestjs/common";
import { Prisma, PrinterStatus } from "@prisma/client";
import type { HeartbeatInput } from "@print-automated/validation";
import { PrismaService } from "@print-automated/backend-shared";

@Injectable()
export class AgentHeartbeatService {
  constructor(private readonly prisma: PrismaService) {}

  /** §41/9.4. Printers are matched to this shop's existing rows by
   * name -- 9.6's real WMI-based discovery doesn't exist yet, and
   * nothing else has ever associated a printer with a specific agent
   * before now, so name is the only stable-enough signal available.
   * A name with no matching row is a printer this agent discovered
   * that staff never manually registered (8.4) -- created here rather
   * than dropped, matching 9.6's own eventual "discovered printers
   * appear in the Shop app" intent. `status` never overwrites
   * DISABLED: that's staff's own operator override (8.4), and a
   * heartbeat -- an agent-reported signal -- has no authority to
   * clobber it. */
  async processHeartbeat(deviceId: string, shopId: string, input: HeartbeatInput): Promise<void> {
    const agent = await this.prisma.printerAgent.findUniqueOrThrow({ where: { deviceId } });

    await this.prisma.printerAgent.update({
      where: { id: agent.id },
      data: { lastSeenAt: new Date() },
    });

    for (const reported of input.printers) {
      const existing = await this.prisma.printer.findFirst({
        where: { shopId, name: reported.name },
      });

      if (!existing) {
        await this.prisma.printer.create({
          data: {
            shopId,
            agentId: agent.id,
            name: reported.name,
            status: reported.status,
            capabilities: reported.capabilities as unknown as Prisma.InputJsonValue | undefined,
          },
        });
        continue;
      }

      if (existing.status === PrinterStatus.DISABLED) {
        // Still worth linking the agent (so a later re-enable/sweep
        // has something to act on), just not the status.
        await this.prisma.printer.update({
          where: { id: existing.id },
          data: { agentId: agent.id },
        });
        continue;
      }

      await this.prisma.printer.update({
        where: { id: existing.id },
        data: {
          agentId: agent.id,
          status: reported.status,
          capabilities: (reported.capabilities ?? existing.capabilities) as unknown as
            Prisma.InputJsonValue | undefined,
        },
      });
    }
  }
}
