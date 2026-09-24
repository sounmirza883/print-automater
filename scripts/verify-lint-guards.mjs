// Verifies that the two single-writer lint guards in eslint.config.js are
// actually ACTIVE, by linting deliberately-violating snippets and failing if a
// guard does not fire (or fires where it must be exempt).
//
// Why this exists: ESLint flat config replaces a rule's options when a later
// config block sets the same rule for the same file. 18.1 added the
// print_jobs.status guard as a second block and silently switched the
// orders.order_status guard OFF for every server file. A disabled rule
// produces no output, so an ordinary `eslint .` run cannot notice it -- it
// was only found by a code review that ran `eslint --print-config`.
//
// Run by the root `lint` script, so `pnpm -w lint` (and therefore CI) covers it.
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eslint = new ESLint({ cwd: repoRoot });

const ORDER_WRITE = `export async function f(p: unknown) {
  const prisma = p as { order: { update(a: unknown): Promise<void> } };
  await prisma.order.update({ where: { id: "x" }, data: { orderStatus: "PAID" } });
}`;

const JOB_WRITE = `export async function f(p: unknown) {
  const prisma = p as { printJob: { update(a: unknown): Promise<void> } };
  await prisma.printJob.update({ where: { id: "x" }, data: { status: "PRINTED" } });
}`;

const JOB_WRITE_DESTRUCTURED = `export async function f(tx: unknown) {
  const { printJob } = tx as { printJob: { updateMany(a: unknown): Promise<void> } };
  await printJob.updateMany({ where: { id: "x" }, data: { status: "PRINTED" } });
}`;

const ORDER_MSG = /Order status may only be written by OrderStateMachine/;
const JOB_MSG = /print_jobs\.status may only be written by PrintJobStateMachine/;

const ORDER_MACHINE = "packages/backend-shared/src/orders/order-state-machine.ts";
const JOB_MACHINE = "packages/backend-shared/src/print-jobs/print-job-state-machine.ts";

// [description, file the snippet is linted as, code, pattern, mustFire]
const cases = [
  ["order_status write is caught in services/api", "services/api/src/__probe__.ts", ORDER_WRITE, ORDER_MSG, true],
  ["order_status write is caught in services/worker", "services/worker/src/__probe__.ts", ORDER_WRITE, ORDER_MSG, true],
  ["order_status write is caught in backend-shared", "packages/backend-shared/src/__probe__.ts", ORDER_WRITE, ORDER_MSG, true],
  ["print_jobs.status write is caught in services/api", "services/api/src/__probe__.ts", JOB_WRITE, JOB_MSG, true],
  ["print_jobs.status write is caught in services/worker", "services/worker/src/__probe__.ts", JOB_WRITE, JOB_MSG, true],
  ["destructured printJob delegate is caught", "services/api/src/__probe__.ts", JOB_WRITE_DESTRUCTURED, JOB_MSG, true],
  ["BOTH guards are active in the same file at once", "services/api/src/__probe__.ts", `${ORDER_WRITE}\n${JOB_WRITE.replace("export async function f", "export async function g")}`, ORDER_MSG, true],
  ["order-state-machine.ts may write order_status", ORDER_MACHINE, ORDER_WRITE, ORDER_MSG, false],
  ["order-state-machine.ts may NOT write print_jobs.status", ORDER_MACHINE, JOB_WRITE, JOB_MSG, true],
  ["print-job-state-machine.ts may write print_jobs.status", JOB_MACHINE, JOB_WRITE, JOB_MSG, false],
  ["print-job-state-machine.ts may NOT write order_status", JOB_MACHINE, ORDER_WRITE, ORDER_MSG, true],
];

let failures = 0;
for (const [description, filePath, code, pattern, mustFire] of cases) {
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, filePath) });
  const fired = result.messages.some(
    (m) => m.ruleId === "no-restricted-syntax" && pattern.test(m.message),
  );
  const ok = fired === mustFire;
  if (!ok) failures += 1;
  console.error(`${ok ? "ok  " : "FAIL"}  ${description}${ok ? "" : ` (expected ${mustFire ? "a violation" : "no violation"}, got ${fired ? "a violation" : "none"})`}`);
}

if (failures > 0) {
  console.error(`\n${failures} lint-guard check(s) failed: a single-writer guard in eslint.config.js is not behaving as intended.`);
  process.exit(1);
}
console.error(`\nAll ${cases.length} lint-guard checks passed.`);
