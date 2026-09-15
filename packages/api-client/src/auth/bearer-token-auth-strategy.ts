import type { AuthTokens } from "../types.js";
import type { AuthStrategy } from "./auth-strategy.js";

/** Wherever mobile (Phase 3.4, backed by `expo-secure-store`) or a test
 * keeps its token pair. Deliberately not part of this package's own
 * dependencies -- `@print-automated/api-client` must build under Node
 * (the agent), a bundler (web), and Metro (mobile) alike, so it cannot
 * depend on any one of those runtimes' storage APIs. Each consumer
 * supplies its own implementation of this interface instead. */
export interface TokenStorage {
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  setTokens(tokens: AuthTokens): Promise<void>;
  clearTokens(): Promise<void>;
}

export interface BearerTokenAuthStrategyOptions {
  baseUrl: string;
  storage: TokenStorage;
  fetchImpl?: typeof fetch;
}

/** Mobile's `AuthStrategy`: an access/refresh token pair held in
 * caller-supplied storage, attached as `Authorization: Bearer <token>`. */
export class BearerTokenAuthStrategy implements AuthStrategy {
  constructor(private readonly options: BearerTokenAuthStrategyOptions) {}

  async getHeaders(): Promise<Record<string, string>> {
    const token = await this.options.storage.getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  getRequestInit(): RequestInit {
    return {};
  }

  async refresh(): Promise<boolean> {
    const refreshToken = await this.options.storage.getRefreshToken();
    if (!refreshToken) {
      return false;
    }

    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await fetchImpl(`${this.options.baseUrl}/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      // A refresh token is single-use (§14 of the plan's rotation design,
      // services/api's TokenService) -- one rejected refresh means the
      // whole family is gone, not "try again later". Clearing storage
      // here (rather than leaving a now-useless token behind) is what
      // makes the next `getHeaders()` correctly report "signed out".
      await this.options.storage.clearTokens();
      return false;
    }

    const tokens = (await response.json()) as AuthTokens;
    await this.options.storage.setTokens(tokens);
    return true;
  }
}

/** Reference `TokenStorage` for tests and any consumer that doesn't yet
 * need persistence across restarts. Not suitable for mobile's real use
 * (a process restart loses the session) -- Phase 3.4 supplies a
 * SecureStore-backed implementation for that. */
export class InMemoryTokenStorage implements TokenStorage {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  async getAccessToken(): Promise<string | null> {
    return this.accessToken;
  }

  async getRefreshToken(): Promise<string | null> {
    return this.refreshToken;
  }

  async setTokens(tokens: AuthTokens): Promise<void> {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
  }

  async clearTokens(): Promise<void> {
    this.accessToken = null;
    this.refreshToken = null;
  }
}
