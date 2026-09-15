import { Global, Module } from "@nestjs/common";
import { CryptoService } from "./crypto.service.js";

// Global for now, alongside Storage/Kms/Redis/Audit/Prisma -- these are
// exactly the modules the design doc's architecture (§2) says
// services/worker (2.6) will need too. They live in services/api/src
// today because there's only one consumer so far; at 2.6, when
// services/worker becomes a second real consumer, this and its
// siblings move into a shared workspace package rather than being
// duplicated into the worker app.
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
