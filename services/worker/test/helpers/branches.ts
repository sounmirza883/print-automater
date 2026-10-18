import type { PrismaClient } from "@prisma/client";

/** The business's oldest branch: where a single-branch fixture's orders, print jobs, printers and
 * agents live. Every business has one from the moment it exists (a trigger creates it), and a
 * fixture that never adds a second branch is exactly the "one location" business of today.
 * Fixtures that exercise branches create their own second branch and name it explicitly. */
export async function branchIdOf(
  db: Pick<PrismaClient, "branch">,
  shopId: string,
): Promise<string> {
  const branch = await db.branch.findFirstOrThrow({
    where: { shopId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return branch.id;
}
