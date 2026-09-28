import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ApiClient,
  type AuthUser,
  type Can,
  type MyShopMembership,
} from "@print-automated/api-client";
import { createMobileApiClient } from "@/lib/api-client";
import { SecureStoreTokenStorage } from "@/lib/secure-store-token-storage";
import { API_BASE_URL } from "@/lib/env";
import { membershipCan } from "@/lib/permissions";

export interface ShopAuthContextValue {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
  /** §29-38's screens all operate against one shop -- the PRD has no
   * shop-switcher UI anywhere, even though shop_staff itself allows a
   * user to staff more than one. `null` while resolving, or when the
   * signed-in staff member has no active membership at all. */
  shopId: string | null;
  shopName: string | null;
  /** 23.32: the person's role at that business, and what it may do there (from the
   * membership; display only, the API authorises every request). Allows nothing while
   * resolving or without a membership. */
  role: string | null;
  can: Can;
  apiClient: ApiClient;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const ShopAuthContext = createContext<ShopAuthContextValue | null>(null);

// One SecureStore-backed jar for the app's lifetime -- not per-render,
// so a re-render of the provider never loses track of what's already
// on disk.
const storage = new SecureStoreTokenStorage();

export function ShopAuthProvider({ children }: { children: ReactNode }): ReactNode {
  const apiClient = useMemo(() => createMobileApiClient({ baseUrl: API_BASE_URL, storage }), []);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);
  const [shopName, setShopName] = useState<string | null>(null);
  const [membership, setMembership] = useState<MyShopMembership | null>(null);

  /** Resolves "the" shop and returns how many businesses the account staffs. */
  async function resolveShop(): Promise<number> {
    const { shops } = await apiClient.shopStaff.myShops();
    // No shop-switcher UI exists anywhere in the PRD -- the first
    // active membership is "the" shop this session operates as.
    setShopId(shops[0]?.id ?? null);
    setShopName(shops[0]?.name ?? null);
    setMembership(shops[0] ?? null);
    return shops.length;
  }

  useEffect(() => {
    // §3.4's "persists the session across restart": a stored refresh
    // token means there IS a session to resume. `BearerTokenAuthStrategy`
    // (3.1) transparently exchanges it for a fresh access token the
    // first time any API call 401s, so `resolveShop()` below is what
    // actually triggers that exchange on a cold start -- this effect
    // doesn't need to call refresh itself. `user` stays null until the
    // next successful login (there is no `GET /v1/me` endpoint yet to
    // recover identity from a bare refresh token -- showing the staff
    // member's name before their next explicit action is still out of
    // scope; resolving *which shop* is not, since 8.5-8.9's screens
    // have no other way to get a shopId at all).
    void storage.getRefreshToken().then(async (refreshToken) => {
      const authenticated = refreshToken !== null;
      setIsAuthenticated(authenticated);
      if (authenticated) {
        await resolveShop().catch(() => undefined);
      }
      setIsLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately mount-only: resolveShop is a new function reference every render, and this effect must run exactly once on cold start, not on every render.
  }, []);

  async function login(email: string, password: string): Promise<void> {
    const result = await apiClient.auth.login({ email, password });
    await storage.setTokens({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    // 23.22: being staff means an ACTIVE business membership (whatever the account-level
    // role -- an invited person may hold a plain customer account). `GET /shop/staff/me`
    // now answers any signed-in account, so an account with no business is refused here
    // instead of by that route's old 403: revoke the session and say where they belong.
    const businesses = await resolveShop();
    if (businesses === 0) {
      await apiClient.auth.logout(result.refreshToken).catch(() => undefined);
      await storage.clearTokens();
      throw new Error("This account is not part of a business. Customers use the customer app.");
    }
    setUser(result.user);
    setIsAuthenticated(true);
  }

  async function logout(): Promise<void> {
    const refreshToken = await storage.getRefreshToken();
    if (refreshToken !== null) {
      // Best-effort revoke -- storage is cleared regardless, so a flaky
      // network call never leaves the app looking signed-in when the
      // user asked to sign out.
      await apiClient.auth.logout(refreshToken).catch(() => undefined);
    }
    await storage.clearTokens();
    setUser(null);
    setShopId(null);
    setShopName(null);
    setMembership(null);
    setIsAuthenticated(false);
  }

  const can = useMemo(() => membershipCan(membership), [membership]);

  const value = useMemo<ShopAuthContextValue>(
    () => ({
      isLoading,
      isAuthenticated,
      user,
      shopId,
      shopName,
      role: membership?.role ?? null,
      can,
      apiClient,
      login,
      logout,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- login/logout close over apiClient/storage, not state; including them would just re-create the context value every render for no behavioral change.
    [isLoading, isAuthenticated, user, shopId, shopName, membership, can, apiClient],
  );

  return <ShopAuthContext.Provider value={value}>{children}</ShopAuthContext.Provider>;
}

export function useShopAuth(): ShopAuthContextValue {
  const context = useContext(ShopAuthContext);
  if (context === null) {
    throw new Error("useShopAuth must be used within a ShopAuthProvider");
  }
  return context;
}
