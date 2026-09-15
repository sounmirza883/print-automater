import { Global, Inject, Injectable, Module, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import type { ApiEnv } from "@print-automated/config";
import { API_ENV } from "../config/config.module.js";
import { registerSlidingWindowRateLimitCommand } from "./sliding-window-rate-limit.command.js";

export const REDIS_CLIENT = Symbol("REDIS_CLIENT");

/** Not exported: exists purely so Nest calls quit() on app shutdown/
 * app.close() (both production SIGTERM via enableShutdownHooks(), and
 * every e2e test's teardown) instead of leaving the TCP connection open
 * and the process hanging. Nest eagerly instantiates every provider a
 * module declares, so this runs without anything needing to inject it. */
@Injectable()
class RedisLifecycle implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}

/** Global: 1.9's rate limiter, 2.6's BullMQ queues, and every later
 * idempotency/lock use (5.3, 6.5, 9.7) share this one connection rather
 * than each opening its own. */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) =>
        registerSlidingWindowRateLimitCommand(
          new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
        ),
    },
    RedisLifecycle,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
