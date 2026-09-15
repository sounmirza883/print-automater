import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service.js";

// No config to inject -- just needs PrismaModule imported wherever this
// is. Global within whichever app imports it: every feature module
// (orders, payments, printers, ...) writes audit entries per §83, so
// this is cross-cutting infrastructure, not a feature module of its own.
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
