import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@print-automated/backend-shared";
import { DocumentRetentionProcessor } from "./document-retention.processor.js";
import { DocumentRetentionScheduler } from "./document-retention.scheduler.js";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.DOCUMENT_RETENTION })],
  providers: [DocumentRetentionProcessor, DocumentRetentionScheduler],
})
export class DocumentRetentionModule {}
