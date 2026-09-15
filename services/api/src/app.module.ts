import { Module } from "@nestjs/common";
import { AppConfigModule } from "./config/config.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { RedisModule } from "./redis/redis.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { HealthModule } from "./health/health.module.js";
import { AuthModule } from "./auth/auth.module.js";

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    StorageModule,
    AuditModule,
    HealthModule,
    AuthModule,
  ],
})
export class AppModule {}
