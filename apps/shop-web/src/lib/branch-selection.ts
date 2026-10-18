/** Which branch the console is scoped to. Pure, so it is tested without a DOM; the session provider
 * owns the state and the storage, this only decides. The API decides what a person may see: this
 * only chooses what to ask for and which controls to show. */

export interface SelectableBranch {
  id: string;
  name: string;
  archivedAt: string | null;
}

/** `bound`: the person works at one branch and is fixed to it. `single`: the business has one
 * active branch, so there is nothing to choose. `choice`: an all-branches person in a business
 * with several, who picks one branch or "All branches". */
export type BranchMode = "bound" | "single" | "choice";

export interface BranchSelection {
  mode: BranchMode;
  /** The branch the console is on; null means every branch (and, for a business whose branches
   * have not loaded, that nothing is known yet). */
  branchId: string | null;
  /** What to pass as `branchId` on a list call. Only a deliberate pick narrows a list: a
   * branch-bound person is pinned by the server (naming a branch could only go stale), and a
   * one-branch business is left unfiltered so history from an archived branch stays visible. */
  filter: string | undefined;
  /** Whether rows should say which branch they belong to: only while looking at all of several. */
  showColumn: boolean;
}

export function resolveBranchSelection(input: {
  /** The member's own branch at this business; null = works at all branches. */
  memberBranchId: string | null;
  branches: readonly SelectableBranch[];
  /** The remembered choice for this business, if any. */
  stored: string | null;
}): BranchSelection {
  if (input.memberBranchId !== null) {
    return { mode: "bound", branchId: input.memberBranchId, filter: undefined, showColumn: false };
  }
  const active = input.branches.filter((branch) => branch.archivedAt === null);
  if (active.length <= 1) {
    return {
      mode: "single",
      branchId: active[0]?.id ?? null,
      filter: undefined,
      showColumn: false,
    };
  }
  // A remembered branch that was archived (or deleted) since falls back to all branches.
  const branchId = active.find((branch) => branch.id === input.stored)?.id ?? null;
  return { mode: "choice", branchId, filter: branchId ?? undefined, showColumn: branchId === null };
}

/** The part of `Storage` this uses, so tests can hand in a fake (or a broken one). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** One remembered choice per business, so switching business never carries a branch id across. */
export function branchStorageKey(shopId: string): string {
  return `pa.shop-web.branch.${shopId}`;
}

/** Touching `window.localStorage` can throw (private mode, blocked cookies), and there is none
 * while rendering on the server. */
function defaultStorage(): KeyValueStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readStoredBranch(
  shopId: string,
  storage: KeyValueStorage | undefined = defaultStorage(),
): string | null {
  try {
    const value = storage?.getItem(branchStorageKey(shopId)) ?? null;
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

/** null (all branches) forgets the choice, so all branches is the default. */
export function writeStoredBranch(
  shopId: string,
  branchId: string | null,
  storage: KeyValueStorage | undefined = defaultStorage(),
): void {
  try {
    if (branchId === null) {
      storage?.removeItem(branchStorageKey(shopId));
    } else {
      storage?.setItem(branchStorageKey(shopId), branchId);
    }
  } catch {
    // Private mode etc.: the choice then lasts only until reload.
  }
}
