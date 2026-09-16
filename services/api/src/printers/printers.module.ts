import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PrinterShopResolver } from "./printer-shop.resolver.js";
import { PrintersController } from "./printers.controller.js";
import { PrintersService } from "./printers.service.js";

@Module({
  imports: [AuthModule],
  controllers: [PrintersController],
  providers: [PrintersService, PrinterShopResolver],
})
export class PrintersModule {}
