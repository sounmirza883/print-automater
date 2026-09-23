import { Module } from "@nestjs/common";
import { InvoicesService } from "./invoices.service.js";

@Module({
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
