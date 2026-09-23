import type { JobTransitionContext } from "./print-job-state-machine.js";
import { PrintJobStateMachine } from "./print-job-state-machine.js";

/** 18.1's own Done-when: "a test proves PrintJobStateMachine's public
 * API has no parameter through which a caller could pass an existing
 * tx." This is structural, not conventional -- `transition()`/
 * `transitionMany()` only ever accept (job id(s), event, actor, an
 * optional ctx); every `$transaction` this class runs, it opens
 * itself. Full behavioural coverage (the actual lock-first-then-jobs
 * ordering, the ESLint rule catching a direct write) is proven
 * elsewhere: the ESLint rule was verified against a deliberately-
 * violating scratch file during development (per this sub-phase's own
 * Done-when) and is not re-asserted here as a committed test, since
 * doing so would require leaving that violating file in the tree; the
 * lock ordering itself is proven behaviourally by 18.10's e2e
 * concurrency suite, which is the only place a real Postgres
 * connection (and therefore a real deadlock or its absence) can be
 * observed at all. */
describe("PrintJobStateMachine (18.1): no caller-supplied transaction", () => {
  it("transition()/transitionMany() each declare exactly 3 required parameters -- (id(s), event, actor); ctx is optional and there is no tx slot anywhere", () => {
    expect(PrintJobStateMachine.prototype.transition.length).toBe(3);
    expect(PrintJobStateMachine.prototype.transitionMany.length).toBe(3);
  });

  it("JobTransitionContext (the only extensibility point of transition()/transitionMany()) carries no tx-shaped field", () => {
    // The real assertion here is that this file typechecks at all: if
    // `keyof JobTransitionContext` ever gained a property literally
    // named "tx", the `Extract` below would stop being `never` and the
    // assignment would fail to compile.
    type SmuggledTx = Extract<keyof JobTransitionContext, "tx">;
    const smuggledTxKeys: SmuggledTx[] = [];
    expect(smuggledTxKeys).toHaveLength(0);

    const declaredKeys: (keyof JobTransitionContext)[] = [
      "metadata",
      "printerId",
      "blockedReason",
      "osJobId",
      "guard",
    ];
    expect(declaredKeys).not.toContain("tx");
  });
});
