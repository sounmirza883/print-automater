import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BranchShopResolver } from "./branch-shop.resolver.js";
import { BranchesController } from "./branches.controller.js";
import { BranchesService } from "./branches.service.js";

@Module({
  imports: [AuthModule],
  controllers: [BranchesController],
  providers: [BranchesService, BranchShopResolver],
  exports: [BranchesService],
})
export class BranchesModule {}
