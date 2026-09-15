import { Global, Module } from "@nestjs/common";
import { CryptoService } from "./crypto.service.js";

// No config to inject -- unlike Redis/Storage/Kms, this needs no
// forRoot(). Global within whichever app imports it, alongside its
// Storage/Kms/Redis/Audit/Prisma siblings.
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
