import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/** 18.20: the two single-writer invariants (`orders.order_status` only via
 * OrderStateMachine, `print_jobs.status` only via PrintJobStateMachine) are
 * enforced by ESLint `no-restricted-syntax` rules, but no AST selector can
 * see inside a `$executeRaw` / `$queryRaw` / `$executeRawUnsafe` SQL string.
 * This is the cheap textual backstop for that blind spot.
 *
 * LIMITS, deliberately: it is a regex over source text, not a SQL parser.
 * It catches a literal `UPDATE print_jobs ... status =` / `UPDATE orders
 * ... order_status =` (optionally quoted / schema-qualified, any case, any
 * whitespace, template or plain string) within ~600 chars of the UPDATE. It
 * does NOT catch SQL assembled from fragments at runtime, dynamic column
 * names, `INSERT ... ON CONFLICT DO UPDATE SET status`, `MERGE`, or SQL kept
 * in `.sql` files run by a tool. Test files (*.spec.ts, *.e2e-spec.ts,
 * *.test.ts, anything under a `test` directory) are skipped -- they backdate
 * rows on purpose -- as are the two state-machine files themselves. */
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

const ALLOWED_FILES = [
  ["packages", "backend-shared", "src", "orders", "order-state-machine.ts"],
  ["packages", "backend-shared", "src", "print-jobs", "print-job-state-machine.ts"],
].map((parts) => join(REPO_ROOT, ...parts));

const IDENT = String.raw`(?:"?public"?\.)?`;
const PRINT_JOBS_STATUS = new RegExp(
  String.raw`UPDATE\s+${IDENT}"?print_jobs"?\b[\s\S]{0,600}?(?<![A-Za-z_])"?status"?\s*=`,
  "i",
);
const ORDERS_STATUS = new RegExp(
  String.raw`UPDATE\s+${IDENT}"?orders"?\b[\s\S]{0,600}?"?order_status"?\s*=`,
  "i",
);

export function findViolations(source: string): string[] {
  const found: string[] = [];
  if (PRINT_JOBS_STATUS.test(source)) {
    found.push("raw SQL UPDATEs print_jobs.status");
  }
  if (ORDERS_STATUS.test(source)) {
    found.push("raw SQL UPDATEs orders.order_status");
  }
  return found;
}

function isTestFile(path: string): boolean {
  return (
    /\.(spec|e2e-spec|test)\.[cm]?[jt]sx?$/.test(path) ||
    path.split(sep).includes("test") ||
    path.split(sep).includes("__tests__")
  );
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".next") {
      continue;
    }
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (/\.[cm]?tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
}

function sourceRoots(): string[] {
  const roots: string[] = [];
  for (const group of ["services", "packages"]) {
    for (const pkg of readdirSync(join(REPO_ROOT, group))) {
      const src = join(REPO_ROOT, group, pkg, "src");
      try {
        if (statSync(src).isDirectory()) {
          roots.push(src);
        }
      } catch {
        // package without a src directory
      }
    }
  }
  return roots;
}

describe("single-writer raw-SQL guard (18.20)", () => {
  it("detector has teeth: flags representative violating snippets, ignores benign ones", () => {
    expect(
      findViolations(
        "await tx.$executeRaw`UPDATE print_jobs SET status = 'FAILED' WHERE id = ${id}`",
      ),
    ).toEqual(["raw SQL UPDATEs print_jobs.status"]);
    expect(
      findViolations('await p.$executeRawUnsafe(\'update "print_jobs" set "status"=$1\')'),
    ).toHaveLength(1);
    expect(
      findViolations(
        "await tx.$executeRaw`UPDATE orders SET order_status = 'PAID' WHERE id = ${id}`",
      ),
    ).toEqual(["raw SQL UPDATEs orders.order_status"]);
    // Benign: other columns / tables, SELECT ... FOR UPDATE, the test-only backdating.
    expect(findViolations("UPDATE print_jobs SET updated_at = NOW() WHERE id = 1")).toEqual([]);
    expect(findViolations("SELECT id FROM orders WHERE id = 1 FOR UPDATE")).toEqual([]);
    expect(findViolations("UPDATE orders SET payment_status = 'PAID' WHERE id = 1")).toEqual([]);
  });

  it("no non-test source under services/*/src or packages/*/src writes either status column via raw SQL", () => {
    const files: string[] = [];
    for (const root of sourceRoots()) {
      walk(root, files);
    }
    const scanned = files.filter((file) => !isTestFile(file) && !ALLOWED_FILES.includes(file));
    // Sanity: the walk really found the production sources (guards against a
    // silently-empty scan after a directory rename).
    expect(scanned.length).toBeGreaterThan(50);
    expect(files.some((file) => ALLOWED_FILES.includes(file))).toBe(true);

    const violations = scanned.flatMap((file) =>
      findViolations(readFileSync(file, "utf8")).map(
        (violation) => `${relative(REPO_ROOT, file)}: ${violation}`,
      ),
    );
    expect(violations).toEqual([]);
  });
});
