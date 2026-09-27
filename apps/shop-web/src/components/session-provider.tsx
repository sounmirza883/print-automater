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
import { ApiClientError, type MyShopMembership } from "@print-automated/api-client";
import { Permission, UserRole } from "@print-automated/types";
import { getApi, isForbidden } from "@/lib/api";
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

function subscribeToStoredBusiness(listener: () => void): () => void {
  storageListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    storageListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
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
  const storedId = useSyncExternalStore(subscribeToStoredBusiness, readStoredBusiness, () => null);
  const [override, setOverride] = useState<string | null>(null);

  const selectBusiness = useCallback((id: string) => {
    setOverride(id);
    writeStoredBusiness(id);
  }, []);

  const value = useMemo<SessionValue | null>(() => {
    if (session.data === null) {
      return null;
    }
    const { user, memberships } = session.data;
    const wanted = override ?? storedId;
    const business =
      memberships.find((membership) => membership.id === wanted) ?? memberships[0] ?? null;
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
    };
  }, [session.data, override, storedId, selectBusiness]);

  if (value === null) {
    return session.error !== null ? errorFallback(session.reload, session.error) : fallback;
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
