import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiClient, type AuthUser } from "@print-automated/api-client";
import { createMobileApiClient } from "@/lib/api-client";
import { SecureStoreTokenStorage } from "@/lib/secure-store-token-storage";
import { API_BASE_URL } from "@/lib/env";

export interface ShopAuthContextValue {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
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

  useEffect(() => {
    // §3.4's "persists the session across restart": a stored refresh
    // token means there IS a session to resume. `BearerTokenAuthStrategy`
    // (3.1) transparently exchanges it for a fresh access token the
    // first time any API call 401s, so this effect only needs to decide
    // whether to show the tabs or the login screen -- it doesn't itself
    // call the API on every cold start. `user` stays null until the
    // next successful login (there is no `GET /v1/me` endpoint yet to
    // recover identity from a bare refresh token -- Phase 8+ can add one
    // if a restored session needs to show the staff member's name
    // before their next explicit action).
    void storage.getRefreshToken().then((refreshToken) => {
      setIsAuthenticated(refreshToken !== null);
      setIsLoading(false);
    });
  }, []);

  async function login(email: string, password: string): Promise<void> {
    const result = await apiClient.auth.login({ email, password });
    await storage.setTokens({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
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
    setIsAuthenticated(false);
  }

  const value = useMemo<ShopAuthContextValue>(
    () => ({ isLoading, isAuthenticated, user, apiClient, login, logout }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- login/logout close over apiClient/storage, not state; including them would just re-create the context value every render for no behavioral change.
    [isLoading, isAuthenticated, user, apiClient],
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
