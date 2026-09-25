import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@print-automated/backend-shared";
import { DocumentProcessingProcessor } from "./document-processing.processor.js";
import { DocumentProcessingService } from "./document-processing.service.js";
import { ClamavScannerService } from "./clamav-scanner.service.js";
import { PdfInspectorService } from "./pdf-inspector.service.js";
import { ImageToPdfService } from "./image-to-pdf.service.js";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.DOCUMENT_PROCESSING })],
  providers: [
    DocumentProcessingProcessor,
    DocumentProcessingService,
    ClamavScannerService,
    PdfInspectorService,
    ImageToPdfService,
  ],
})
export class DocumentProcessingModule {}
