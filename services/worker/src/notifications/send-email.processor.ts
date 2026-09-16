import { Inject, Logger } from "@nestjs/common";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import {
  EMAIL_TRANSPORT,
  PrismaService,
  QUEUE_NAMES,
  type EmailTransport,
  type SendEmailJob,
} from "@print-automated/backend-shared";

/** §78/7.2. Consumes what services/api's NotificationService (password
 * recovery) and 7.3's order-event mapping both enqueue -- one queue,
 * one processor, regardless of which feature produced the job. A
 * thrown error here is exactly what SEND_EMAIL_JOB_OPTIONS' retry/
 * backoff exists for: the enqueue already committed (and, for an
 * order-triggered notification, so did whatever order transition
 * produced it) long before this ever runs, so a transport failure here
 * has nothing to roll back -- it just retries. */
@Processor(QUEUE_NAMES.NOTIFICATIONS)
export class SendEmailProcessor extends WorkerHost {
  private readonly logger = new Logger(SendEmailProcessor.name);

  // Explicit @Inject() on every param -- document-processing.processor.ts's
  // own constructor already found `extends WorkerHost` plus cross-package
  // injected params loses emitDecoratorMetadata reliability.
  constructor(
    @Inject(EMAIL_TRANSPORT) private readonly emailTransport: EmailTransport,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<SendEmailJob>): Promise<{ delivered: true }> {
    const { to, subject, text, notificationId } = job.data;
    await this.emailTransport.send({ to, subject, text });

    if (notificationId) {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { sentAt: new Date() },
      });
    }

    return { delivered: true };
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job<SendEmailJob>): void {
    this.logger.log(`Sent email job ${job.id} to ${job.data.to}`);
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job<SendEmailJob> | undefined, error: Error): void {
    this.logger.error(
      `Email job ${job?.id} to ${job?.data.to} failed after ${job?.attemptsMade} attempt(s): ${error.message}`,
    );
  }
}
