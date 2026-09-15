import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DocumentsController } from "./documents.controller.js";
import { DocumentsService } from "./documents.service.js";

@Module({
  imports: [AuthModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  // 4.4's quote endpoint (OrdersModule) needs a document's owned status
  // and page count -- reuses getStatus() rather than duplicating the
  // 404-vs-403 ownership check DocumentsService already has.
  exports: [DocumentsService],
})
export class DocumentsModule {}
