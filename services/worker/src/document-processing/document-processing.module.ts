import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@print-automated/backend-shared";
import { DocumentProcessingProcessor } from "./document-processing.processor.js";
import { DocumentProcessingService } from "./document-processing.service.js";
import { ClamavScannerService } from "./clamav-scanner.service.js";
import { PdfInspectorService } from "./pdf-inspector.service.js";
import { ImageToPdfService } from "./image-to-pdf.service.js";
import { DOCX_CONVERTER } from "./docx-converter.js";
import { SofficeDocxConverter } from "./soffice-docx-converter.js";
import { WORKER_ENV } from "../config/config.module.js";
import type { WorkerEnv } from "@print-automated/config";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.DOCUMENT_PROCESSING })],
  providers: [
    DocumentProcessingProcessor,
    DocumentProcessingService,
    ClamavScannerService,
    PdfInspectorService,
    ImageToPdfService,
    {
      provide: DOCX_CONVERTER,
      inject: [WORKER_ENV],
      useFactory: (env: WorkerEnv) =>
        new SofficeDocxConverter({
          enabled: env.DOCX_CONVERSION_ENABLED,
          binary: env.SOFFICE_PATH,
          timeoutMs: env.DOCX_CONVERSION_TIMEOUT_MS,
        }),
    },
  ],
})
export class DocumentProcessingModule {}
