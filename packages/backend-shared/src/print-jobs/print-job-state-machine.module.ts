import { Global, Module } from "@nestjs/common";
import { PrintJobStateMachine } from "./print-job-state-machine.js";

// Global within whichever app imports it, same as OrderStateMachineModule
// -- services/api (agent claim/report, dispatch) and services/worker
// (19.5's own print-timeout/queue-recovery sweeps) both need it. Only
// depends on the also-global PrismaService, unlike OrderStateMachineModule
// it needs no queue of its own. 18.16: it does call OrderStateMachine (also
// global) to sync the order inside the same transaction as the job write;
// the notification enqueue happens through that machine, after commit.
@Global()
@Module({
  providers: [PrintJobStateMachine],
  exports: [PrintJobStateMachine],
})
export class PrintJobStateMachineModule {}
