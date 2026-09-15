import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DocumentsModule } from "../documents/documents.module.js";
import { OrderNumberService } from "./order-number.service.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderNumberService],
  exports: [OrderNumberService],
})
export class OrdersModule {}
