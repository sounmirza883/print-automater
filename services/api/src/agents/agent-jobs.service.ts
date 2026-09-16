import { HttpStatus, Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type Redis from "ioredis";
import { PrintJobStatus } from "@prisma/client";
import { AppException, PrismaService, REDIS_CLIENT } from "@print-automated/backend-shared";

export interface PrintJobSummary {
  id: string;
  orderId: string;
  printerId: string;
  printerName: string;
  status: PrintJobStatus;
  claimedAt: string | null;
  createdAt: string;
}

function signalKey(deviceId: string): string {
  return `agent-job-signal:${deviceId}`;
}

/** §9.7. `GET /agents/jobs?wait=N` is a long-poll: check the database
 * for an already-QUEUED job first (covers a job that was queued while
 * this agent wasn't polling at all), then block on a per-device Redis
 * list so a *new* job wakes a waiting poll immediately instead of only
 * at the next timeout. The list entry itself is never trusted as "the"
 * job -- it's a wake-up nudge, so every wake (signalled or timed out)
 * re-reads the database, the only source of truth for what's actually
 * still QUEUED. */
@Injectable()
export class AgentJobsService implements OnModuleDestroy {
  // BRPOP blocks its connection for up to `wait` seconds. Sharing the
  // app-wide REDIS_CLIENT for that would stall every other
  // Redis-dependent request on this process -- rate limiting, agent
  // challenges, order locks -- for the same duration, since ioredis
  // multiplexes commands over one TCP connection by default.
  // `duplicate()` clones the same connection options without
  // re-reading REDIS_URL, giving blocking calls their own connection.
  private readonly blockingRedis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.blockingRedis = redis.duplicate();
  }

  async onModuleDestroy(): Promise<void> {
    await this.blockingRedis.quit();
  }

  /** Called from shop-orders.service.ts's acceptOrder() sideEffect,
   * inside the same transaction that creates the QUEUED print_job --
   * a missed notify only costs latency (the next timeout still finds
   * the job via the DB check), never correctness. Trimmed so a long-
   * offline agent accumulating accepted orders doesn't grow this list
   * without bound; the DB check makes any trimmed-away signal harmless. */
  async notify(deviceId: string): Promise<void> {
    const key = signalKey(deviceId);
    await this.redis.multi().lpush(key, "1").ltrim(key, 0, 49).expire(key, 3600).exec();
  }

  async waitForJob(deviceId: string, waitSeconds: number): Promise<PrintJobSummary | null> {
    const immediate = await this.findQueuedJob(deviceId);
    if (immediate) {
      return immediate;
    }

    const popped = await this.blockingRedis.brpop(signalKey(deviceId), waitSeconds);
    if (!popped) {
      return null;
    }
    return this.findQueuedJob(deviceId);
  }

  /** §9.7's own Done-when: two agents racing the same job, exactly one
   * wins. `updateMany`'s WHERE clause is the entire mechanism -- a
   * plain read-then-write would let both callers see `status: QUEUED`
   * and both "succeed"; only the database's own row-level atomicity
   * across two concurrent UPDATEs guarantees a single winner. The
   * `printer: { agent: { deviceId } }` relation filter is what makes
   * this agent-scoped without a separate lookup: an agent can only
   * ever claim a job queued for one of ITS OWN printers, never another
   * shop's (or even the same shop's *other* agent's) job by guessing
   * an id. */
  async claim(jobId: string, deviceId: string): Promise<PrintJobSummary> {
    const claimed = await this.prisma.printJob.updateMany({
      where: { id: jobId, status: PrintJobStatus.QUEUED, printer: { agent: { deviceId } } },
      data: { status: PrintJobStatus.CLAIMED, claimedAt: new Date() },
    });

    if (claimed.count === 0) {
      const existing = await this.prisma.printJob.findFirst({
        where: { id: jobId, printer: { agent: { deviceId } } },
      });
      if (!existing) {
        throw new AppException(
          HttpStatus.NOT_FOUND,
          "JOB_NOT_FOUND",
          "No such print job for this agent.",
          false,
        );
      }
      throw new AppException(
        HttpStatus.CONFLICT,
        "JOB_ALREADY_CLAIMED",
        "Another agent already claimed this job.",
        false,
      );
    }

    const job = await this.prisma.printJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { printer: true },
    });
    return this.toSummary(job);
  }

  private async findQueuedJob(deviceId: string): Promise<PrintJobSummary | null> {
    const job = await this.prisma.printJob.findFirst({
      where: { status: PrintJobStatus.QUEUED, printer: { agent: { deviceId } } },
      orderBy: { createdAt: "asc" },
      include: { printer: true },
    });
    return job ? this.toSummary(job) : null;
  }

  private toSummary(job: {
    id: string;
    orderId: string;
    printerId: string;
    status: PrintJobStatus;
    claimedAt: Date | null;
    createdAt: Date;
    printer: { name: string };
  }): PrintJobSummary {
    return {
      id: job.id,
      orderId: job.orderId,
      printerId: job.printerId,
      printerName: job.printer.name,
      status: job.status,
      claimedAt: job.claimedAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
    };
  }
}
