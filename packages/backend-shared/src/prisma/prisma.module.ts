import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

// No config needed -- Prisma reads DATABASE_URL from process.env
// directly via its own .env loading, independent of either app's Zod
// env schema (services/api's ApiEnv, services/worker's WorkerEnv).
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
