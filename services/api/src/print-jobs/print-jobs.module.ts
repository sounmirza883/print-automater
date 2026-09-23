import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PrintJobShopResolver } from "./print-job-shop.resolver.js";
import { PrintJobsController } from "./print-jobs.controller.js";
import { PrintJobsService } from "./print-jobs.service.js";

@Module({
  imports: [AuthModule],
  controllers: [PrintJobsController],
  providers: [PrintJobsService, PrintJobShopResolver],
})
export class PrintJobsModule {}
