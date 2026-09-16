import { Logger } from "@nestjs/common";
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job, Queue } from "bullmq";
import { QUEUE_NAMES } from "@print-automated/backend-shared";

/** §103/12.5's own "queue depth" metric -- nothing else in this
 * codebase ever calls BullMQ's own `getJobCounts()`. One structured log
 * line per tracked queue per tick, `metric: "queue.depth"`, so a
 * CloudWatch Metric Filter (12.7, once real AWS exists) can turn each
 * queue's `waiting`/`active` counts into a real backlog alarm without
 * this process needing to push metrics anywhere itself -- the same
 * "structured log line is the metric's source of truth" approach
 * PinoLoggerService's own object-first convention now supports
 * natively. */
@Processor(QUEUE_NAMES.QUEUE_METRICS)
export class QueueMetricsProcessor extends WorkerHost {
  private readonly logger = new Logger(QueueMetricsProcessor.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.DOCUMENT_PROCESSING) private readonly documentProcessing: Queue,
    @InjectQueue(QUEUE_NAMES.ORDER_EXPIRATION) private readonly orderExpiration: Queue,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly notifications: Queue,
    @InjectQueue(QUEUE_NAMES.PRINTER_OFFLINE_SWEEP) private readonly printerOfflineSweep: Queue,
    @InjectQueue(QUEUE_NAMES.PRINT_TIMEOUT) private readonly printTimeout: Queue,
    @InjectQueue(QUEUE_NAMES.PAYMENT_RECONCILIATION) private readonly paymentReconciliation: Queue,
    @InjectQueue(QUEUE_NAMES.DOCUMENT_RETENTION) private readonly documentRetention: Queue,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const queues: ReadonlyArray<readonly [string, Queue]> = [
      [QUEUE_NAMES.DOCUMENT_PROCESSING, this.documentProcessing],
      [QUEUE_NAMES.ORDER_EXPIRATION, this.orderExpiration],
      [QUEUE_NAMES.NOTIFICATIONS, this.notifications],
      [QUEUE_NAMES.PRINTER_OFFLINE_SWEEP, this.printerOfflineSweep],
      [QUEUE_NAMES.PRINT_TIMEOUT, this.printTimeout],
      [QUEUE_NAMES.PAYMENT_RECONCILIATION, this.paymentReconciliation],
      [QUEUE_NAMES.DOCUMENT_RETENTION, this.documentRetention],
    ];

    for (const [name, queue] of queues) {
      const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
      this.logger.log({ metric: "queue.depth", queue: name, ...counts }, "Queue depth snapshot.");
    }
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(`Queue metrics sweep (job ${job?.id}) failed: ${error.message}`);
  }
}
