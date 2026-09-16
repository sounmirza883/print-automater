import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiClient, type AuthUser } from "@print-automated/api-client";
import { createMobileApiClient } from "@/lib/api-client";
import { SecureStoreTokenStorage } from "@/lib/secure-store-token-storage";
import { API_BASE_URL } from "@/lib/env";

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

  async function resolveShop(): Promise<void> {
    const { shops } = await apiClient.shopStaff.myShops();
    // No shop-switcher UI exists anywhere in the PRD -- the first
    // active membership is "the" shop this session operates as.
    setShopId(shops[0]?.id ?? null);
    setShopName(shops[0]?.name ?? null);
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
    setUser(result.user);
    setIsAuthenticated(true);
    await resolveShop();
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
    setIsAuthenticated(false);
  }

  const value = useMemo<ShopAuthContextValue>(
    () => ({ isLoading, isAuthenticated, user, shopId, shopName, apiClient, login, logout }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- login/logout close over apiClient/storage, not state; including them would just re-create the context value every render for no behavioral change.
    [isLoading, isAuthenticated, user, shopId, shopName, apiClient],
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
