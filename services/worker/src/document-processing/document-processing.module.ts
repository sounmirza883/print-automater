import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@print-automated/backend-shared";
import { DocumentProcessingProcessor } from "./document-processing.processor.js";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.DOCUMENT_PROCESSING })],
  providers: [DocumentProcessingProcessor],
})
export class DocumentProcessingModule {}
