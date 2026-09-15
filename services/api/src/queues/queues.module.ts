import { Global, Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import type Redis from "ioredis";
import { REDIS_CLIENT } from "../redis/redis.module.js";
import { QUEUE_NAMES } from "./queue-names.js";

/** Global: reuses 1.8's shared Redis connection rather than opening a
 * second pool. BullModule.registerQueue only needs to be called once
 * per queue name across the whole app -- listed here so any module can
 * @InjectQueue(QUEUE_NAMES.DOCUMENT_PROCESSING) without re-registering
 * it. This is the producer side only; 2.6 adds the worker process that
 * actually consumes what gets added here. */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (connection: Redis) => ({ connection }),
    }),
    BullModule.registerQueue({ name: QUEUE_NAMES.DOCUMENT_PROCESSING }),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
