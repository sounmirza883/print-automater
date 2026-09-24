export { PrismaService } from "./prisma/prisma.service.js";
export { PrismaModule } from "./prisma/prisma.module.js";

export { REDIS_CLIENT } from "./redis/redis.module.js";
export { RedisModule, type RedisModuleOptions } from "./redis/redis.module.js";
export {
  registerSlidingWindowRateLimitCommand,
  type RedisWithRateLimit,
} from "./redis/sliding-window-rate-limit.command.js";

export { agentJobSignalKey, signalAgentDevice } from "./redis/agent-job-signal.js";

export { S3_CLIENT, STORAGE_BUCKET } from "./storage/storage.tokens.js";
export { StorageModule, type StorageModuleOptions } from "./storage/storage.module.js";
export { StorageService } from "./storage/storage.service.js";

export { DocumentDeletionService } from "./documents/document-deletion.service.js";
export { DocumentDeletionModule } from "./documents/document-deletion.module.js";

export { PinoLoggerService } from "./logging/pino-logger.service.js";

export {
  KEY_MANAGEMENT_SERVICE,
  type KeyManagementService,
  type GeneratedDataKey,
} from "./kms/kms.interface.js";
export { KmsModule, type KmsModuleOptions } from "./kms/kms.module.js";
export { LocalKmsProvider } from "./kms/local-kms.provider.js";
export { AwsKmsProvider } from "./kms/aws-kms.provider.js";

export { CryptoModule } from "./crypto/crypto.module.js";
export {
  CryptoService,
  CURRENT_ENCRYPTION_VERSION,
  type EncryptedStream,
} from "./crypto/crypto.service.js";

export { ROLE_PERMISSIONS } from "./auth/role-permissions.js";

export { AuditModule } from "./audit/audit.module.js";
export { AuditService, type RecordAuditEntryInput } from "./audit/audit.service.js";
export { redactMetadata } from "./audit/redact-metadata.js";

export { QUEUE_NAMES } from "./queues/queue-names.js";
export type { DocumentProcessingJob } from "./queues/document-processing.job.js";
export { DOCUMENT_PROCESSING_JOB_OPTIONS } from "./queues/document-processing.job-options.js";
export type { SendEmailJob } from "./queues/send-email.job.js";
export { SEND_EMAIL_JOB_OPTIONS } from "./queues/send-email.job-options.js";

export { AppException } from "./errors/app-exception.js";

export {
  OrderEvent,
  OrderStateMachine,
  type TransitionActor,
  type TransitionContext,
} from "./orders/order-state-machine.js";
export { OrderStateMachineModule } from "./orders/order-state-machine.module.js";
export {
  aggregateOrderStatus,
  type AggregateOrderStatusOptions,
} from "./orders/aggregate-order-status.js";

export {
  jobTransitionEdges,
  PrintJobEvent,
  PrintJobStateMachine,
  type JobTransitionActor,
  type JobTransitionContext,
  type JobTransitionResult,
  type LockedPrintJobRow,
} from "./print-jobs/print-job-state-machine.js";
export { PrintJobStateMachineModule } from "./print-jobs/print-job-state-machine.module.js";
export {
  explodeOrderItems,
  type OrderItemLike,
  type PrintJobDraft,
} from "./print-jobs/explode-order-items.js";
export {
  allocatePrinter,
  type AllocationRequest,
  type AllocationResult,
  type PrinterCandidate,
} from "./print-jobs/allocate-printer.js";

export {
  EMAIL_TRANSPORT,
  type EmailMessage,
  type EmailTransport,
} from "./notifications/email-transport.interface.js";
export { EmailModule, type EmailModuleOptions } from "./notifications/email.module.js";
export { MailhogEmailTransport } from "./notifications/mailhog-email-transport.js";
export { SesEmailTransport } from "./notifications/ses-email-transport.js";
export {
  SmtpEmailTransport,
  type SmtpEmailTransportOptions,
} from "./notifications/smtp-email-transport.js";
export { periodStart, type PageLimitPeriod } from "./printers/page-limit-period.js";
export { jobPages, type JobPagesFallbackReason } from "./print-jobs/job-pages.js";
export { logJobPagesFallback } from "./print-jobs/job-pages-log.js";
export {
  buildPrinterCandidates,
  type PrinterCandidateSet,
} from "./print-jobs/printer-candidates.js";
export {
  reevaluatePrinterJobs,
  type FailoverTrigger,
  type ReevaluationOutcome,
  type ReevaluationResult,
} from "./print-jobs/reevaluate-printer-jobs.js";
export {
  AVAILABILITY_BLOCKED_REASONS,
  reallocateWaitingJobs,
  type ReallocationOutcome,
  type ReallocationResult,
} from "./print-jobs/reallocate-waiting-jobs.js";
export {
  applyStockMovement,
  INVENTORY_MOVEMENT_AUDIT_ACTION,
  type StockMode,
  type StockMovementInput,
  type StockMovementResult,
} from "./inventory/stock-movement.js";
export { isLowStock } from "./inventory/low-stock.js";
export {
  availablePaperSheets,
  isInventoryTrackingEnabled,
  paperItemMatches,
  paperNeedFor,
  sheetsForJob,
  withPaperAvailability,
  type PaperNeed,
} from "./inventory/paper-availability.js";
export {
  consumePaperForJob,
  consumptionOrder,
  INVENTORY_SHORTFALL_AUDIT_ACTION,
  type PaperConsumptionResult,
} from "./inventory/consume-paper.js";
