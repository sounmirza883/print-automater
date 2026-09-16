import { Inject, Logger } from "@nestjs/common";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { PrinterStatus } from "@prisma/client";
import { PrismaService, QUEUE_NAMES } from "@print-automated/backend-shared";

/** 3x the agent's own 30s heartbeat interval (9.4/9.5) -- long enough
 * that one dropped beat doesn't flip a printer's status, short enough
 * that "killing the agent flips its printers to Offline within the
 * threshold" (9.4's own Done-when) still reads as prompt. No Done-when
 * pins an exact multiplier, so this is a reasonable fixed default
 * rather than another env var, matching order-expiration's own
 * TICK_INTERVAL_MS precedent for "cadence, not the configurable
 * business TTL, needs no env var." */
const MISSED_HEARTBEAT_THRESHOLD_MS = 90_000;

/** §41/9.4's other half: nothing proactively notices an agent went
 * silent except this sweep. Every printer still linked to an agent
 * whose last heartbeat is older than the threshold (or that never
 * sent one at all) goes OFFLINE -- except DISABLED, staff's own
 * operator override (8.4), which a heartbeat-derived signal has no
 * authority to clobber. */
@Processor(QUEUE_NAMES.PRINTER_OFFLINE_SWEEP)
export class PrinterOfflineSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(PrinterOfflineSweepProcessor.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super();
  }

  async process(_job: Job): Promise<{ markedOfflineCount: number }> {
    const staleThreshold = new Date(Date.now() - MISSED_HEARTBEAT_THRESHOLD_MS);
    const result = await this.prisma.printer.updateMany({
      where: {
        agentId: { not: null },
        status: { in: [PrinterStatus.ONLINE, PrinterStatus.ERROR] },
        agent: {
          OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: staleThreshold } }],
        },
      },
      data: { status: PrinterStatus.OFFLINE },
    });

    if (result.count > 0) {
      // §103/12.5: "agent connectivity"/"agent disconnection" metric --
      // pairs with agent-heartbeat.service.ts's own "agent.reconnected"
      // log for the other direction of the same signal.
      this.logger.log(
        { metric: "agent.disconnected", count: result.count },
        `Printer offline sweep: marked ${result.count} printer(s) OFFLINE.`,
      );
    }
    return { markedOfflineCount: result.count };
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(`Printer offline sweep (job ${job?.id}) failed: ${error.message}`);
  }
}
