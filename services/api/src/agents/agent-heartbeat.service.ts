import { Injectable, Logger } from "@nestjs/common";
import { Prisma, PrinterStatus } from "@prisma/client";
import type { HeartbeatInput } from "@print-automated/validation";
import { PrismaService } from "@print-automated/backend-shared";
import { AgentJobsService } from "./agent-jobs.service.js";

@Injectable()
export class AgentHeartbeatService {
  private readonly logger = new Logger(AgentHeartbeatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentJobs: AgentJobsService,
  ) {}

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
            // 15.6: `driverName`/`portName` map onto the 15.3 printer
            // profile's `model`/`connectionType` -- both plain free
            // text with no other writer yet (updatePrinterSchema
            // doesn't expose either), so there's nothing for a fresh
            // heartbeat to clobber here. `location` is deliberately
            // never set from a heartbeat at all (15.3's own schema
            // comment: staff-set only, forever) -- the wire schema
            // doesn't even carry it.
            model: reported.driverName,
            connectionType: reported.portName,
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

      if (existing.status === PrinterStatus.OFFLINE) {
        // §103/12.5: "agent connectivity" metric, the reconnect half of
        // printer-offline-sweep.processor.ts's own "marked N printer(s)
        // OFFLINE" -- only fires on the OFFLINE -> heartbeat-received
        // state change, not every 30s heartbeat, for the same low-noise
        // reason authenticate()'s own "agent.connected" log fires on
        // session start rather than every request. A heartbeat's
        // reported status can only ever be ONLINE or ERROR (an agent
        // that's actually offline sends nothing) -- receiving one at
        // all while the printer was OFFLINE is what "reconnected"
        // means here.
        this.logger.log(
          { metric: "agent.reconnected", deviceId, printerId: existing.id },
          "Printer reconnected.",
        );
      }

      await this.prisma.printer.update({
        where: { id: existing.id },
        data: {
          agentId: agent.id,
          status: reported.status,
          capabilities: (reported.capabilities ?? existing.capabilities) as unknown as
            Prisma.InputJsonValue | undefined,
          // 15.6: same "reported field, or keep whatever's already
          // there" fallback as capabilities just above -- an agent
          // that omits driverName/portName (an old/unupdated agent
          // that's never sent them, or this run's own "unchanged
          // since last beat" omission, discovery.ts's
          // toHeartbeatPrinters) must never null out a previously
          // reported (or, once a future PATCH endpoint exposes these
          // for editing, staff-set) value. `location` is never part
          // of this update at all -- staff-set only, per 15.3.
          model: reported.driverName ?? existing.model,
          connectionType: reported.portName ?? existing.connectionType,
        },
      });

      // Awaited inside the heartbeat request on purpose (the agent's next
      // beat is 30s away and the moves are a handful of small transactions),
      // but agentJobs.reevaluatePrinter contains every failure, so a slow or
      // failing re-evaluation can delay but never fail the heartbeat
      // (covered by failover-containment.e2e-spec.ts).
      // 19.4 trigger (c): the printer just BECAME unsuitable (a state
      // change, not every 30s beat that repeats ERROR). After commit; a no-op
      // unless the shop opted in.
      if (reported.status === PrinterStatus.ERROR && existing.status !== PrinterStatus.ERROR) {
        await this.agentJobs.reevaluatePrinter(shopId, existing.id, "PRINTER_ERROR");
      }
    }
  }
}
