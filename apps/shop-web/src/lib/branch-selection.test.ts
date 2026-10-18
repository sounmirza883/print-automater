import {
  branchStorageKey,
  readStoredBranch,
  resolveBranchSelection,
  writeStoredBranch,
  type KeyValueStorage,
} from "./branch-selection";

const main = { id: "a", name: "Main", archivedAt: null };
const gulberg = { id: "b", name: "Gulberg", archivedAt: null };
const oldTown = { id: "c", name: "Old Town", archivedAt: "2026-10-05T10:00:00.000Z" };

describe("resolveBranchSelection", () => {
  it("fixes a branch-bound person to their own branch, whatever is stored", () => {
    const selection = resolveBranchSelection({
      memberBranchId: "a",
      branches: [main],
      stored: "b",
    });
    expect(selection).toEqual({
      mode: "bound",
      branchId: "a",
      filter: undefined,
      showColumn: false,
    });
  });

  it("keeps a branch-bound person on their branch even when the branch list is empty or has not loaded", () => {
    expect(
      resolveBranchSelection({ memberBranchId: "a", branches: [], stored: null }),
    ).toMatchObject({ mode: "bound", branchId: "a" });
  });

  it("leaves a branch-bound person's lists to the server, which pins them to their own branch", () => {
    // Naming a branch could only go stale (a manager moved elsewhere) and be refused with 403.
    expect(
      resolveBranchSelection({ memberBranchId: "a", branches: [main, gulberg], stored: "b" })
        .filter,
    ).toBeUndefined();
  });

  it("makes a business with one active branch that branch, with nothing to choose", () => {
    const selection = resolveBranchSelection({
      memberBranchId: null,
      branches: [main, oldTown],
      stored: "c",
    });
    expect(selection).toEqual({
      mode: "single",
      branchId: "a",
      filter: undefined,
      showColumn: false,
    });
  });

  it("does not filter a one-branch business, so history from an archived branch stays visible", () => {
    expect(
      resolveBranchSelection({ memberBranchId: null, branches: [gulberg, oldTown], stored: null })
        .filter,
    ).toBeUndefined();
  });

  it("treats a business whose branches have not loaded as having nothing to choose", () => {
    expect(resolveBranchSelection({ memberBranchId: null, branches: [], stored: "a" })).toEqual({
      mode: "single",
      branchId: null,
      filter: undefined,
      showColumn: false,
    });
  });

  it("gives an all-branches person in a multi-branch business all branches when nothing is stored", () => {
    expect(
      resolveBranchSelection({ memberBranchId: null, branches: [main, gulberg], stored: null }),
    ).toEqual({ mode: "choice", branchId: null, filter: undefined, showColumn: true });
  });

  it("lets an all-branches person narrow to one branch they stored", () => {
    expect(
      resolveBranchSelection({ memberBranchId: null, branches: [main, gulberg], stored: "b" }),
    ).toEqual({ mode: "choice", branchId: "b", filter: "b", showColumn: false });
  });

  it("falls back to all branches when the stored branch is archived or no longer exists", () => {
    const base = { memberBranchId: null, branches: [main, gulberg, oldTown] };
    expect(resolveBranchSelection({ ...base, stored: "c" })).toMatchObject({
      mode: "choice",
      branchId: null,
      showColumn: true,
    });
    expect(resolveBranchSelection({ ...base, stored: "gone" })).toMatchObject({
      branchId: null,
      filter: undefined,
    });
  });

  it("counts only active branches when deciding whether there is a choice", () => {
    expect(
      resolveBranchSelection({
        memberBranchId: null,
        branches: [main, gulberg, oldTown],
        stored: null,
      }).mode,
    ).toBe("choice");
    expect(
      resolveBranchSelection({ memberBranchId: null, branches: [main, oldTown], stored: null })
        .mode,
    ).toBe("single");
  });
});

/** A storage that holds values in a map. */
function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  values: Record<string, string>;
} {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
    removeItem: (key) => {
      delete values[key];
    },
  };
}

/** A storage that refuses everything, as private mode or a full quota does. */
const brokenStorage: KeyValueStorage = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
  removeItem: () => {
    throw new Error("denied");
  },
};

describe("branch storage", () => {
  it("keeps one choice per business", () => {
    expect(branchStorageKey("shop-1")).toBe("pa.shop-web.branch.shop-1");
    expect(branchStorageKey("shop-2")).not.toBe(branchStorageKey("shop-1"));
  });

  it("remembers a branch for one business without touching another", () => {
    const storage = memoryStorage();
    writeStoredBranch("shop-1", "b", storage);
    expect(readStoredBranch("shop-1", storage)).toBe("b");
    expect(readStoredBranch("shop-2", storage)).toBeNull();
  });

  it("forgets the choice when all branches is picked (null), so the default is all branches", () => {
    const storage = memoryStorage();
    writeStoredBranch("shop-1", "b", storage);
    writeStoredBranch("shop-1", null, storage);
    expect(readStoredBranch("shop-1", storage)).toBeNull();
    expect(storage.values).toEqual({});
  });

  it("reads an empty stored value as no choice", () => {
    const storage = memoryStorage({ [branchStorageKey("shop-1")]: "" });
    expect(readStoredBranch("shop-1", storage)).toBeNull();
  });

  it("never throws when storage does: a read is no choice, a write is quietly skipped", () => {
    expect(readStoredBranch("shop-1", brokenStorage)).toBeNull();
    expect(() => writeStoredBranch("shop-1", "b", brokenStorage)).not.toThrow();
    expect(() => writeStoredBranch("shop-1", null, brokenStorage)).not.toThrow();
  });

  it("reads as no choice when there is no storage at all (server rendering)", () => {
    expect(readStoredBranch("shop-1")).toBeNull();
    expect(() => writeStoredBranch("shop-1", "b")).not.toThrow();
  });
});
