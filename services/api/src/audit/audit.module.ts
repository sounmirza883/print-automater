import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service.js";

// Global: every future feature module (orders, payments, printers, ...)
// writes audit entries per §83, so this is cross-cutting infrastructure
// like PrismaModule and AppConfigModule, not a feature module of its own.
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
