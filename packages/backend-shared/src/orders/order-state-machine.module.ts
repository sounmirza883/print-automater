import { Global, Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "../queues/queue-names.js";
import { OrderStateMachine } from "./order-state-machine.js";

// Global within whichever app imports it, same as AuditModule -- both
// services/api (order creation, cancel) and services/worker (5.6's
// expiration sweep) need it, and it only depends on the also-global
// PrismaService, plus (7.3) the "notifications" queue -- registering
// it again here is safe even though services/api's QueuesModule and
// services/worker's NotificationsModule already register the same
// name themselves; BullMQ's registerQueue just points a DI-scoped
// Queue instance at the same underlying named queue in Redis, however
// many times it's registered. Requires BullModule.forRootAsync() to
// already be in scope, which every app that imports this module
// already provides globally.
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.NOTIFICATIONS })],
  providers: [OrderStateMachine],
  exports: [OrderStateMachine],
})
export class OrderStateMachineModule {}
