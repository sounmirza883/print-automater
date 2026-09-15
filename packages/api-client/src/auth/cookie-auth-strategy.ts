import type { AuthStrategy } from "./auth-strategy.js";

export interface CookieAuthStrategyOptions {
  /** Hit to refresh the session on a 401. This is customer-web's *own*
   * route handler (e.g. `/api/auth/refresh`), not the backend's
   * `/v1/auth/refresh` directly -- in cookie mode the raw refresh token
   * lives only in an httpOnly cookie the browser's JS never reads, so
   * only a server-side handler (Phase 3.3) can act on it. This strategy
   * just knows where to knock. */
  refreshUrl: string;
  fetchImpl?: typeof fetch;
}

/** Web's `AuthStrategy`: the session travels as an httpOnly cookie the
 * browser attaches automatically, so this strategy never sees or stores
 * a token value at all. */
export class CookieAuthStrategy implements AuthStrategy {
  constructor(private readonly options: CookieAuthStrategyOptions) {}

  async getHeaders(): Promise<Record<string, string>> {
    return {};
  }

  getRequestInit(): RequestInit {
    return { credentials: "include" };
  }

  async refresh(): Promise<boolean> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await fetchImpl(this.options.refreshUrl, {
      method: "POST",
      credentials: "include",
    });
    return response.ok;
  }
}
