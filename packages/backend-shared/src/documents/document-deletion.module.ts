import { Global, Module } from "@nestjs/common";
import { DocumentDeletionService } from "./document-deletion.service.js";

// Global, same as AuditModule/OrderStateMachineModule -- both
// services/api and services/worker need it, and it only depends on the
// also-global PrismaService and StorageService (each app's own
// StorageModule.forRoot() must already be in scope, exactly like
// OrderStateMachineModule's own precondition on BullModule).
@Global()
@Module({
  providers: [DocumentDeletionService],
  exports: [DocumentDeletionService],
})
export class DocumentDeletionModule {}
