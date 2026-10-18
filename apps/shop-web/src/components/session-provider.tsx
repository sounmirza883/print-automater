"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ApiClientError,
  type BranchSummary,
  type MyShopMembership,
} from "@print-automated/api-client";
import { Permission, UserRole } from "@print-automated/types";
import { getApi, isForbidden } from "@/lib/api";
import {
  readStoredBranch,
  resolveBranchSelection,
  writeStoredBranch,
  type BranchMode,
} from "@/lib/branch-selection";
import { membershipPermissions } from "@/lib/permissions";
import { useResource } from "@/lib/use-resource";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

interface SessionValue {
  user: SessionUser;
  /** Every business the person is an ACTIVE member of (empty for a platform admin). */
  memberships: readonly MyShopMembership[];
  /** The business the console is currently showing; null when there is none. */
  business: MyShopMembership | null;
  selectBusiness: (id: string) => void;
  /** The role that counts: the membership's role at `business` (never the account role). */
  businessRole: UserRole | null;
  permissions: ReadonlySet<Permission>;
  can: (permission: Permission) => boolean;
  isAdmin: boolean;
  /** The business's active branches; a branch-bound person is only given their own. Empty until
   * loaded, and when the list could not be loaded (then nothing branch-related is offered). */
  branches: readonly BranchSummary[];
  /** False while the business's branches are loading; the console waits for it so that no screen
   * fetches everything first and then again narrowed to the chosen branch. */
  branchesReady: boolean;
  /** The branch the console is scoped to; null means every branch. */
  branch: BranchSummary | null;
  /** Whether the person is fixed to a branch, has just one to work in, or chooses. */
  branchMode: BranchMode;
  /** What a list call passes as `branchId`; undefined when the server decides or nothing narrows. */
  branchFilter: string | undefined;
  /** True while looking at all of several branches: rows then say which branch they belong to. */
  showBranchColumn: boolean;
  /** Narrows the console to one branch, or to all of them (null); remembered per business. */
  selectBranch: (branchId: string | null) => void;
  /** Re-reads the branch list, after branches were added, archived or renamed. */
  reloadBranches: () => void;
}

export const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error("useSession must be used inside <SessionProvider>.");
  }
  return value;
}

const STORAGE_KEY = "pa.shop-web.business";
const storageListeners = new Set<() => void>();

function readStoredBusiness(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// One subscription serves both remembered choices (business and branch): either write tells every
// reader to look again, and another tab's write arrives as a `storage` event.
function subscribeToStorage(listener: () => void): () => void {
  storageListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    storageListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** 23.23: open the console on this business next time (e.g. the one just joined). */
export function rememberSelectedBusiness(id: string): void {
  writeStoredBusiness(id);
}

function writeStoredBusiness(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private mode etc.: the choice then lasts only until reload.
  }
  storageListeners.forEach((listener) => listener());
}

async function loadSession(
  signal: AbortSignal,
): Promise<{ user: SessionUser; memberships: MyShopMembership[] }> {
  const response = await fetch("/api/auth/session", { signal });
  if (response.status === 401) {
    // Let the shared resource hook send the person to sign-in.
    throw new ApiClientError(401, { message: "Not signed in." });
  }
  const { user } = (await response.json()) as { user: SessionUser };
  if (user.role === UserRole.ADMIN) {
    return { user, memberships: [] };
  }
  try {
    const { shops } = await getApi().shopStaff.myShops();
    return { user, memberships: shops };
  } catch (error) {
    // The role gate on this route 403s an account with no shop-side role.
    if (isForbidden(error)) {
      return { user, memberships: [] };
    }
    throw error;
  }
}

/** Loads who is signed in and which businesses they belong to, and owns
 * the "selected business" choice that every screen scopes itself by.
 * Children only render once this is known, so no screen ever has to
 * handle "session not loaded yet". */
export function SessionProvider({
  children,
  fallback,
  errorFallback,
}: {
  children: ReactNode;
  fallback: ReactNode;
  errorFallback: (retry: () => void, error: unknown) => ReactNode;
}): ReactNode {
  // Membership/role changes made elsewhere show up within five minutes
  // (and on any reload); the server enforces the real role per request.
  const session = useResource(loadSession, [], { intervalMs: 5 * 60_000 });
  const storedId = useSyncExternalStore(subscribeToStorage, readStoredBusiness, () => null);
  const [override, setOverride] = useState<string | null>(null);

  const selectBusiness = useCallback((id: string) => {
    setOverride(id);
    writeStoredBusiness(id);
  }, []);

  const business = useMemo(() => {
    if (session.data === null) {
      return null;
    }
    const wanted = override ?? storedId;
    const { memberships } = session.data;
    return memberships.find((membership) => membership.id === wanted) ?? memberships[0] ?? null;
  }, [session.data, override, storedId]);
  const shopId = business?.id ?? "";

  // The business's active branches (a branch-bound person is given only their own). Restarts when
  // the business changes, so a branch id is never carried across businesses. A failed load is
  // treated as "no branches": the console still opens, with nothing branch-related offered, and
  // the server still limits a branch-bound person to their own branch.
  const branchList = useResource(() => getApi().branches.list(shopId), [shopId], {
    intervalMs: 5 * 60_000,
    enabled: shopId !== "",
  });
  const branches = useMemo(() => branchList.data ?? [], [branchList.data]);
  const storedBranch = useSyncExternalStore(
    subscribeToStorage,
    () => readStoredBranch(shopId),
    () => null,
  );
  // Like the business, the pick is also held in state, so it holds even if storage refuses it.
  const [branchOverrides, setBranchOverrides] = useState<Readonly<Record<string, string | null>>>(
    {},
  );
  const branchOverride = branchOverrides[shopId];
  const wantedBranch = branchOverride !== undefined ? branchOverride : storedBranch;

  const selectBranch = useCallback(
    (branchId: string | null) => {
      if (shopId === "") {
        return;
      }
      setBranchOverrides((previous) => ({ ...previous, [shopId]: branchId }));
      writeStoredBranch(shopId, branchId);
      storageListeners.forEach((listener) => listener());
    },
    [shopId],
  );

  const selection = useMemo(
    () =>
      resolveBranchSelection({
        memberBranchId: business?.branchId ?? null,
        branches,
        stored: wantedBranch,
      }),
    [business, branches, wantedBranch],
  );
  const branchesReady = shopId === "" || !branchList.loading;
  const reloadBranches = branchList.reload;

  const value = useMemo<SessionValue | null>(() => {
    if (session.data === null) {
      return null;
    }
    const { user, memberships } = session.data;
    const businessRole = business?.role ?? null;
    const permissions = membershipPermissions(business);
    return {
      user,
      memberships,
      business,
      selectBusiness,
      businessRole,
      permissions,
      can: (permission) => permissions.has(permission),
      isAdmin: user.role === UserRole.ADMIN,
      branches,
      branchesReady,
      branch: branches.find((candidate) => candidate.id === selection.branchId) ?? null,
      branchMode: selection.mode,
      branchFilter: selection.filter,
      showBranchColumn: selection.showColumn,
      selectBranch,
      reloadBranches,
    };
  }, [
    session.data,
    business,
    selectBusiness,
    branches,
    branchesReady,
    selection,
    selectBranch,
    reloadBranches,
  ]);

  if (value === null) {
    return session.error !== null ? errorFallback(session.reload, session.error) : fallback;
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
