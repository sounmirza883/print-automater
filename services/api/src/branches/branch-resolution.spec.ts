import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AppException } from "@print-automated/backend-shared";
import {
  resolveBranchForCustomerOrder,
  resolveBranchForStaffOperation,
} from "./branch-resolution.js";

interface FakeBranch {
  id: string;
  name: string;
  shopId: string;
  isOpen: boolean;
  archivedAt: Date | null;
  createdAt: Date;
}

const SHOP = "shop-1";
const A: FakeBranch = branch("a", "Main", 1);
const B: FakeBranch = branch("b", "Second", 2);

function branch(id: string, name: string, order: number, over: Partial<FakeBranch> = {}) {
  return {
    id,
    name,
    shopId: SHOP,
    isOpen: true,
    archivedAt: null,
    createdAt: new Date(2026, 0, order),
    ...over,
  };
}

/** Just the two calls the resolvers make: the oldest-first list and the share-locked row read. */
function fakeTx(rows: FakeBranch[]): Prisma.TransactionClient {
  return {
    branch: {
      findMany: async (args: { where: { shopId: string; archivedAt: null }; take?: number }) =>
        rows
          .filter((r) => r.shopId === args.where.shopId && r.archivedAt === null)
          .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
          .slice(0, args.take ?? rows.length)
          .map((r) => ({ id: r.id, name: r.name, isOpen: r.isOpen })),
    },
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const [id, shopId] = values as [string, string];
      return rows
        .filter((r) => r.id === id && r.shopId === shopId)
        .map((r) => ({ id: r.id, name: r.name, isOpen: r.isOpen, archivedAt: r.archivedAt }));
    },
  } as unknown as Prisma.TransactionClient;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "OK";
  } catch (error) {
    if (error instanceof AppException) return error.errorCode;
    if (error instanceof ForbiddenException) return "FORBIDDEN";
    throw error;
  }
}

describe("resolveBranchForStaffOperation (pairing code, counter order, manual printer, PC move)", () => {
  it("pins a branch-bound person to their own branch, and refuses another", async () => {
    const tx = fakeTx([A, B]);
    await expect(
      resolveBranchForStaffOperation(tx, {
        shopId: SHOP,
        actorBranchId: "b",
        requested: undefined,
      }),
    ).resolves.toEqual({ id: "b", name: "Second" });
    await expect(
      resolveBranchForStaffOperation(tx, { shopId: SHOP, actorBranchId: "b", requested: "b" }),
    ).resolves.toEqual({ id: "b", name: "Second" });
    expect(
      await codeOf(
        resolveBranchForStaffOperation(tx, { shopId: SHOP, actorBranchId: "b", requested: "a" }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("lets an all-branches person name any branch of the business", async () => {
    const tx = fakeTx([A, B]);
    await expect(
      resolveBranchForStaffOperation(tx, { shopId: SHOP, actorBranchId: null, requested: "b" }),
    ).resolves.toEqual({ id: "b", name: "Second" });
  });

  it("uses the only branch when none is named, and asks when there are several", async () => {
    await expect(
      resolveBranchForStaffOperation(fakeTx([A]), {
        shopId: SHOP,
        actorBranchId: null,
        requested: undefined,
      }),
    ).resolves.toEqual({ id: "a", name: "Main" });
    expect(
      await codeOf(
        resolveBranchForStaffOperation(fakeTx([A, B]), {
          shopId: SHOP,
          actorBranchId: null,
          requested: undefined,
        }),
      ),
    ).toBe("BRANCH_REQUIRED");
  });

  it("does not count an archived branch as 'the only branch'", async () => {
    const tx = fakeTx([A, branch("b", "Second", 2, { archivedAt: new Date() })]);
    await expect(
      resolveBranchForStaffOperation(tx, {
        shopId: SHOP,
        actorBranchId: null,
        requested: undefined,
      }),
    ).resolves.toEqual({ id: "a", name: "Main" });
  });

  it("refuses an unknown branch (400) and an archived one (409)", async () => {
    const tx = fakeTx([A, branch("b", "Second", 2, { archivedAt: new Date() })]);
    expect(
      await codeOf(
        resolveBranchForStaffOperation(tx, {
          shopId: SHOP,
          actorBranchId: null,
          requested: "nope",
        }),
      ),
    ).toBe("BRANCH_NOT_FOUND");
    expect(
      await codeOf(
        resolveBranchForStaffOperation(tx, { shopId: SHOP, actorBranchId: null, requested: "b" }),
      ),
    ).toBe("BRANCH_ARCHIVED");
  });

  it("treats another business's branch as unknown", async () => {
    const tx = fakeTx([A]);
    expect(
      await codeOf(
        resolveBranchForStaffOperation(tx, {
          shopId: "another-shop",
          actorBranchId: null,
          requested: "a",
        }),
      ),
    ).toBe("BRANCH_NOT_FOUND");
  });

  it("does not refuse a closed branch: staff at the counter can still key an order in", async () => {
    const tx = fakeTx([branch("a", "Main", 1, { isOpen: false })]);
    await expect(
      resolveBranchForStaffOperation(tx, {
        shopId: SHOP,
        actorBranchId: "a",
        requested: undefined,
      }),
    ).resolves.toEqual({ id: "a", name: "Main" });
  });
});

describe("resolveBranchForCustomerOrder (a customer scanning a branch's QR code)", () => {
  it("sends an order with no branch to the oldest non-archived branch", async () => {
    const tx = fakeTx([B, A]);
    await expect(
      resolveBranchForCustomerOrder(tx, { shopId: SHOP, requested: undefined }),
    ).resolves.toEqual({ id: "a", name: "Main" });
    const archivedFirst = fakeTx([branch("a", "Main", 1, { archivedAt: new Date() }), B]);
    await expect(
      resolveBranchForCustomerOrder(archivedFirst, { shopId: SHOP, requested: undefined }),
    ).resolves.toEqual({ id: "b", name: "Second" });
  });

  it("takes the named branch", async () => {
    await expect(
      resolveBranchForCustomerOrder(fakeTx([A, B]), { shopId: SHOP, requested: "b" }),
    ).resolves.toEqual({ id: "b", name: "Second" });
  });

  it("refuses a closed branch (409 BRANCH_CLOSED), named or defaulted", async () => {
    const closed = branch("a", "Main", 1, { isOpen: false });
    expect(
      await codeOf(
        resolveBranchForCustomerOrder(fakeTx([closed, B]), { shopId: SHOP, requested: "a" }),
      ),
    ).toBe("BRANCH_CLOSED");
    expect(
      await codeOf(
        resolveBranchForCustomerOrder(fakeTx([closed, B]), { shopId: SHOP, requested: undefined }),
      ),
    ).toBe("BRANCH_CLOSED");
    // The other branch of the same business still takes orders.
    await expect(
      resolveBranchForCustomerOrder(fakeTx([closed, B]), { shopId: SHOP, requested: "b" }),
    ).resolves.toEqual({ id: "b", name: "Second" });
  });

  it("refuses an archived branch (409), another business's branch (400) and an unknown one (400)", async () => {
    const archived = branch("a", "Main", 1, { archivedAt: new Date() });
    expect(
      await codeOf(
        resolveBranchForCustomerOrder(fakeTx([archived, B]), { shopId: SHOP, requested: "a" }),
      ),
    ).toBe("BRANCH_ARCHIVED");
    expect(
      await codeOf(resolveBranchForCustomerOrder(fakeTx([A]), { shopId: "other", requested: "a" })),
    ).toBe("BRANCH_NOT_FOUND");
    expect(
      await codeOf(resolveBranchForCustomerOrder(fakeTx([A]), { shopId: SHOP, requested: "zzz" })),
    ).toBe("BRANCH_NOT_FOUND");
  });
});
