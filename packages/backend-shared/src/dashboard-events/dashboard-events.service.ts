import { EventEmitter } from "node:events";
import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS_CLIENT } from "../redis/redis.module.js";

/// 27.1: the one thing that makes a dashboard "live" instead of polled -- a tiny ping,
/// never a payload, so no aggregation logic is duplicated over the wire. A subscriber
/// (services/api's SSE controller) re-fetches the SAME REST aggregate endpoint it would
/// have polled anyway; this just tells it to do that NOW instead of waiting out the
/// interval. Both "order" and "job" kinds exist so a future subscriber can tell what
/// changed without re-deriving it, though today every consumer just refetches regardless.
export type DashboardEventKind = "order" | "job";

export interface DashboardEvent {
  shopId: string;
  kind: DashboardEventKind;
}

const CHANNEL = "dashboard-events";
const EMIT_NAME = "event";

/// Redis pub/sub, not a new technology: `ioredis` is already a dependency (agent-jobs.service.ts,
/// order-lock.service.ts, queues.module.ts), and pub/sub is exactly "a message reaches every
/// process sharing this Redis," which is what a multi-instance services/api needs for an SSE
/// connection on ANY instance to hear about a write committed on ANY OTHER instance. The
/// subscriber connection is duplicated (a client in subscribe mode can't run other commands),
/// the same idiom agent-jobs.service.ts's own blocking BRPOP connection already uses. Exposed as
/// a plain EventEmitter, not an rxjs Observable: backend-shared has no rxjs dependency, and the
/// one consumer that needs an Observable (a NestJS `@Sse()` controller) already depends on rxjs
/// itself and can wrap this locally.
@Injectable()
export class DashboardEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(DashboardEventsService.name);
  private readonly subscriber: Redis;
  private readonly emitter = new EventEmitter();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    // One SSE connection per open browser tab subscribes here -- no artificial cap.
    this.emitter.setMaxListeners(0);
    this.subscriber = redis.duplicate();
    this.subscriber.subscribe(CHANNEL).catch((error: unknown) => {
      this.logger.error("dashboard events subscribe failed", { error: String(error) });
    });
    this.subscriber.on("message", (_channel: string, message: string) => {
      try {
        this.emitter.emit(EMIT_NAME, JSON.parse(message) as DashboardEvent);
      } catch {
        // Malformed message: ignore rather than crash the subscriber.
      }
    });
  }

  /** Fire-and-forget: a dropped ping just means a client's own periodic poll catches up
   * instead of an instant push -- never worth failing the caller's transaction commit over. */
  publish(event: DashboardEvent): void {
    this.redis.publish(CHANNEL, JSON.stringify(event)).catch((error: unknown) => {
      this.logger.warn("dashboard event publish failed", { error: String(error) });
    });
  }

  /** Calls `listener` for every event published on ANY process sharing this Redis, never just
   * this one -- callers filter by shopId themselves. Returns an unsubscribe function. */
  subscribe(listener: (event: DashboardEvent) => void): () => void {
    this.emitter.on(EMIT_NAME, listener);
    return () => this.emitter.off(EMIT_NAME, listener);
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber.quit();
  }
}
