import { Module } from "@nestjs/common";
import { IdempotencyInterceptor } from "./idempotency.interceptor.js";

@Module({
  providers: [IdempotencyInterceptor],
  exports: [IdempotencyInterceptor],
})
export class IdempotencyModule {}
