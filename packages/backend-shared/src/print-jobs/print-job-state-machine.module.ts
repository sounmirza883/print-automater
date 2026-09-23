import { Global, Module } from "@nestjs/common";
import { PrintJobStateMachine } from "./print-job-state-machine.js";

// Global within whichever app imports it, same as OrderStateMachineModule
// -- services/api (agent claim/report, dispatch) and services/worker
// (19.5's own print-timeout/queue-recovery sweeps) both need it. Only
// depends on the also-global PrismaService, unlike OrderStateMachineModule
// it needs no queue of its own: it never enqueues anything itself (18.1's
// own design -- the caller, not this machine, invokes the order machine's
// sync, and the order machine is what owns the notifications queue).
@Global()
@Module({
  providers: [PrintJobStateMachine],
  exports: [PrintJobStateMachine],
})
export class PrintJobStateMachineModule {}
