import { Module } from "@nestjs/common";
import {
  PrismaModule,
  RedisModule,
  StorageModule,
  KmsModule,
  CryptoModule,
  AuditModule,
  OrderStateMachineModule,
} from "@print-automated/backend-shared";
import { AppConfigModule, apiEnv } from "./config/config.module.js";
import { QueuesModule } from "./queues/queues.module.js";
import { HealthModule } from "./health/health.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { DocumentsModule } from "./documents/documents.module.js";
import { ShopsModule } from "./shops/shops.module.js";
import { OrdersModule } from "./orders/orders.module.js";
import { PaymentsModule } from "./payments/payments.module.js";
import { ShopOrdersModule } from "./shop-orders/shop-orders.module.js";
import { PrintersModule } from "./printers/printers.module.js";
import { ShopStaffModule } from "./shop-staff/shop-staff.module.js";

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule.forRoot({ url: apiEnv.REDIS_URL }),
    StorageModule.forRoot({
      endpoint: apiEnv.S3_ENDPOINT,
      region: apiEnv.S3_REGION,
      bucket: apiEnv.S3_BUCKET,
      accessKeyId: apiEnv.S3_ACCESS_KEY_ID,
      secretAccessKey: apiEnv.S3_SECRET_ACCESS_KEY,
      forcePathStyle: apiEnv.S3_FORCE_PATH_STYLE,
    }),
    KmsModule.forRoot(
      apiEnv.KMS_PROVIDER === "aws"
        ? {
            provider: "aws",
            // apiEnvSchema's checkStorageEnv already requires this
            // when KMS_PROVIDER=aws.
            awsKeyId: apiEnv.KMS_AWS_KEY_ID!,
            awsRegion: apiEnv.S3_REGION,
          }
        : {
            provider: "local",
            localMasterKey: apiEnv.KMS_LOCAL_MASTER_KEY!,
          },
    ),
    CryptoModule,
    QueuesModule,
    AuditModule,
    OrderStateMachineModule,
    HealthModule,
    AuthModule,
    DocumentsModule,
    ShopsModule,
    OrdersModule,
    PaymentsModule,
    ShopOrdersModule,
    PrintersModule,
    ShopStaffModule,
  ],
})
export class AppModule {}
