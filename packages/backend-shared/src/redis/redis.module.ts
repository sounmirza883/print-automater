import { DynamicModule, Global, Inject, Injectable, Module, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { registerSlidingWindowRateLimitCommand } from "./sliding-window-rate-limit.command.js";

export const REDIS_CLIENT = Symbol("REDIS_CLIENT");

export interface RedisModuleOptions {
  url: string;
}

/** Not exported: exists purely so Nest calls quit() on app shutdown/
 * app.close() (production SIGTERM via enableShutdownHooks(), and every
 * e2e test's teardown) instead of leaving the TCP connection open and
 * the process hanging. Nest eagerly instantiates every provider a
 * module declares, so this runs without anything needing to inject it. */
@Injectable()
class RedisLifecycle implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}

/** forRoot(), not a factory injecting some app-specific env token: the
 * REDIS_URL each caller has lives in a differently-shaped, already-
 * validated env object (services/api's ApiEnv, services/worker's
 * WorkerEnv) -- this module only needs the one string, passed directly,
 * so it stays agnostic to which app is calling it. Global within
 * whichever app registers it: 1.9's rate limiter, 2.6's BullMQ queues,
 * and every later idempotency/lock use (5.3, 6.5, 9.7) share this one
 * connection rather than each opening its own. */
@Global()
@Module({})
export class RedisModule {
  static forRoot(options: RedisModuleOptions): DynamicModule {
    return {
      module: RedisModule,
      providers: [
        {
          provide: REDIS_CLIENT,
          useFactory: () =>
            registerSlidingWindowRateLimitCommand(
              new Redis(options.url, { maxRetriesPerRequest: null }),
            ),
        },
        RedisLifecycle,
      ],
      exports: [REDIS_CLIENT],
    };
  }
}
