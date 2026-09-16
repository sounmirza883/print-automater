import { Global, Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import type Redis from "ioredis";
import {
  REDIS_CLIENT,
  QUEUE_NAMES,
  DOCUMENT_PROCESSING_JOB_OPTIONS,
  SEND_EMAIL_JOB_OPTIONS,
} from "@print-automated/backend-shared";

/** Global: reuses 1.8's shared Redis connection rather than opening a
 * second pool. BullModule.registerQueue only needs to be called once
 * per queue name across the whole app -- listed here so any module can
 * @InjectQueue(QUEUE_NAMES.DOCUMENT_PROCESSING) without re-registering
 * it. This is the producer side (retry/backoff policy included, since
 * defaultJobOptions only applies to jobs .add()-ed through this Queue
 * instance); 2.6 adds the worker process that consumes what gets added
 * here. */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (connection: Redis) => ({ connection }),
    }),
    BullModule.registerQueue({
      name: QUEUE_NAMES.DOCUMENT_PROCESSING,
      defaultJobOptions: DOCUMENT_PROCESSING_JOB_OPTIONS,
    }),
    BullModule.registerQueue({
      name: QUEUE_NAMES.NOTIFICATIONS,
      defaultJobOptions: SEND_EMAIL_JOB_OPTIONS,
    }),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
