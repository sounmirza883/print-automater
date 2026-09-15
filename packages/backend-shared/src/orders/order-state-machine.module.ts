import { Global, Module } from "@nestjs/common";
import { OrderStateMachine } from "./order-state-machine.js";

// Global within whichever app imports it, same as AuditModule -- both
// services/api (order creation, cancel) and services/worker (5.6's
// expiration sweep) need it, and it only depends on the also-global
// PrismaService, so there's nothing app-specific to configure.
@Global()
@Module({
  providers: [OrderStateMachine],
  exports: [OrderStateMachine],
})
export class OrderStateMachineModule {}
