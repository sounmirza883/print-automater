import { Inject, Logger } from "@nestjs/common";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import {
  PrintJobStateMachine,
  PrismaService,
  QUEUE_NAMES,
  REDIS_CLIENT,
  reevaluatePrinterJobs,
  signalAgentDevice,
} from "@print-automated/backend-shared";

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

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PrintJobStateMachine) private readonly jobStateMachine: PrintJobStateMachine,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ markedOfflineCount: number; failoverErrors: number }> {
    const staleThreshold = new Date(Date.now() - MISSED_HEARTBEAT_THRESHOLD_MS);
    // UPDATE .. RETURNING (not updateMany): only the rows THIS statement flipped
    // come back, so two racing sweeps (or a heartbeat that flips a printer back
    // ONLINE in between) can never both claim the same OFFLINE transition, and a
    // printer that was already OFFLINE never re-triggers failover. Postgres
    // re-evaluates the WHERE clause on a row another statement just updated, so
    // the loser of a race simply gets no row back.
    const flipped = await this.prisma.$queryRaw<Array<{ id: string; shopId: string }>>`
      UPDATE printers AS p
      SET status = 'OFFLINE'::"PrinterStatus", updated_at = now()
      FROM printer_agents AS a
      WHERE p.agent_id = a.id
        AND p.status IN ('ONLINE'::"PrinterStatus", 'ERROR'::"PrinterStatus")
        AND (a.last_seen_at IS NULL OR a.last_seen_at < ${staleThreshold})
      RETURNING p.id AS id, p.shop_id AS "shopId"
    `;

    if (flipped.length > 0) {
      // §103/12.5: "agent connectivity"/"agent disconnection" metric --
      // pairs with agent-heartbeat.service.ts's own "agent.reconnected"
      // log for the other direction of the same signal.
      this.logger.log(
        { metric: "agent.disconnected", count: flipped.length },
        `Printer offline sweep: marked ${flipped.length} printer(s) OFFLINE.`,
      );
    }

    const failoverErrors = await this.failOverJustOfflinePrinters(flipped);
    return { markedOfflineCount: flipped.length, failoverErrors };
  }

  /** 19.14 (PRD 25/122). Automatic failover is opt-in per shop
   * (`shops.auto_failover_enabled`); reevaluatePrinterJobs re-checks the flag
   * itself, and it only ever moves QUEUED jobs, never CLAIMED/PRINTING (paper
   * may already be coming out). Each printer is contained on its own: the
   * OFFLINE flip already committed and must not be undone or retried by a
   * handoff failure -- the timeout sweep is the safety net for a job left on a
   * dead printer. Receiving agents are woken only AFTER their moves commit. */
  private async failOverJustOfflinePrinters(
    flipped: Array<{ id: string; shopId: string }>,
  ): Promise<number> {
    if (flipped.length === 0) {
      return 0;
    }
    const optedIn = new Set(
      (
        await this.prisma.shop.findMany({
          where: {
            id: { in: [...new Set(flipped.map((p) => p.shopId))] },
            autoFailoverEnabled: true,
          },
          select: { id: true },
        })
      ).map((shop) => shop.id),
    );
    let errors = 0;
    for (const printer of flipped) {
      if (!optedIn.has(printer.shopId)) {
        continue;
      }
      try {
        const result = await reevaluatePrinterJobs(
          {
            prisma: this.prisma,
            jobMachine: this.jobStateMachine,
            onError: (jobId, err) =>
              this.logger.error(
                { jobId, printerId: printer.id, err },
                "Offline failover could not re-evaluate one job; continuing with the rest.",
              ),
          },
          { shopId: printer.shopId, printerId: printer.id, trigger: "PRINTER_ERROR" },
        );
        errors += result.errors.length;
        await Promise.all(
          result.notifyDeviceIds.map((deviceId) => signalAgentDevice(this.redis, deviceId)),
        );
      } catch (error) {
        errors += 1;
        this.logger.error(
          { printerId: printer.id, err: error },
          "Offline failover for a printer failed; the print-timeout sweep remains the safety net.",
        );
      }
    }
    return errors;
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(`Printer offline sweep (job ${job?.id}) failed: ${error.message}`);
  }
}
