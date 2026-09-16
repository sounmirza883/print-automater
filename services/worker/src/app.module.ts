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
  EmailModule,
  REDIS_CLIENT,
} from "@print-automated/backend-shared";
import { WorkerConfigModule, workerEnv } from "./config/config.module.js";
import { DocumentProcessingModule } from "./document-processing/document-processing.module.js";
import { OrderExpirationModule } from "./order-expiration/order-expiration.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";

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
    EmailModule.forRoot(
      workerEnv.EMAIL_TRANSPORT === "ses"
        ? {
            provider: "ses",
            awsRegion: workerEnv.S3_REGION,
            fromAddress: workerEnv.EMAIL_FROM_ADDRESS,
          }
        : {
            provider: "mailhog",
            host: workerEnv.SMTP_HOST,
            port: workerEnv.SMTP_PORT,
            fromAddress: workerEnv.EMAIL_FROM_ADDRESS,
          },
    ),
    BullModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (connection: Redis) => ({ connection }),
    }),
    DocumentProcessingModule,
    OrderExpirationModule,
    NotificationsModule,
  ],
})
export class AppModule {}
