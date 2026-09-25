import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import type Redis from "ioredis";
import {
  PrismaModule,
  RedisModule,
  StorageModule,
  KmsModule,
  CryptoModule,
  AuditModule,
  OrderStateMachineModule,
  PrintJobStateMachineModule,
  DocumentDeletionModule,
  EmailModule,
  type EmailModuleOptions,
  REDIS_CLIENT,
} from "@print-automated/backend-shared";
import { WorkerConfigModule, workerEnv } from "./config/config.module.js";
import { DocumentProcessingModule } from "./document-processing/document-processing.module.js";
import { OrderExpirationModule } from "./order-expiration/order-expiration.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { LowStockAlertsModule } from "./low-stock-alerts/low-stock-alerts.module.js";
import { PrinterOfflineSweepModule } from "./printer-offline-sweep/printer-offline-sweep.module.js";
import { PrintTimeoutModule } from "./print-timeout/print-timeout.module.js";
import { DocumentRetentionModule } from "./document-retention/document-retention.module.js";
import { QueueMetricsModule } from "./queue-metrics/queue-metrics.module.js";

// 14.5: which EmailTransport EMAIL_TRANSPORT selects -- "smtp" (any
// standards-compliant relay, no AWS required, the production default)
// alongside the existing "mailhog" (dev) and "ses" (AWS, still
// available) choices, the same shape KMS_PROVIDER already uses for
// KmsModule above.
function buildEmailOptions(): EmailModuleOptions {
  switch (workerEnv.EMAIL_TRANSPORT) {
    case "ses":
      return {
        provider: "ses",
        awsRegion: workerEnv.S3_REGION,
        fromAddress: workerEnv.EMAIL_FROM_ADDRESS,
      };
    case "smtp":
      return {
        provider: "smtp",
        host: workerEnv.SMTP_HOST,
        port: workerEnv.SMTP_PORT,
        fromAddress: workerEnv.EMAIL_FROM_ADDRESS,
        secure: workerEnv.SMTP_SECURE,
        auth:
          workerEnv.SMTP_USER && workerEnv.SMTP_PASSWORD
            ? { user: workerEnv.SMTP_USER, pass: workerEnv.SMTP_PASSWORD }
            : undefined,
      };
    case "mailhog":
      return {
        provider: "mailhog",
        host: workerEnv.SMTP_HOST,
        port: workerEnv.SMTP_PORT,
        fromAddress: workerEnv.EMAIL_FROM_ADDRESS,
      };
  }
}

@Module({
  imports: [
    WorkerConfigModule,
    PrismaModule,
    RedisModule.forRoot({ url: workerEnv.REDIS_URL }),
    StorageModule.forRoot({
      endpoint: workerEnv.S3_ENDPOINT,
      region: workerEnv.S3_REGION,
      bucket: workerEnv.S3_BUCKET,
      accessKeyId: workerEnv.S3_ACCESS_KEY_ID,
      secretAccessKey: workerEnv.S3_SECRET_ACCESS_KEY,
      forcePathStyle: workerEnv.S3_FORCE_PATH_STYLE,
    }),
    KmsModule.forRoot(
      workerEnv.KMS_PROVIDER === "aws"
        ? {
            provider: "aws",
            // workerEnvSchema's checkStorageEnv already requires this
            // when KMS_PROVIDER=aws.
            awsKeyId: workerEnv.KMS_AWS_KEY_ID!,
            awsRegion: workerEnv.S3_REGION,
          }
        : {
            provider: "local",
            localMasterKey: workerEnv.KMS_LOCAL_MASTER_KEY!,
          },
    ),
    CryptoModule,
    AuditModule,
    OrderStateMachineModule,
    PrintJobStateMachineModule,
    DocumentDeletionModule,
    EmailModule.forRoot(buildEmailOptions()),
    BullModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (connection: Redis) => ({ connection }),
    }),
    DocumentProcessingModule,
    OrderExpirationModule,
    NotificationsModule,
    PrinterOfflineSweepModule,
    LowStockAlertsModule,
    PrintTimeoutModule,
    DocumentRetentionModule,
    QueueMetricsModule,
  ],
})
export class AppModule {}
