import { ApiClient, CookieAuthStrategy } from "@print-automated/api-client";

export interface CreateWebApiClientOptions {
  baseUrl: string;
  /** customer-web's own route handler that rotates the httpOnly session
   * cookie (Phase 3.3 builds it) -- not the backend API's own
   * `/v1/auth/refresh`, which customer-web's browser JS is never
   * allowed to call directly in cookie mode (see `CookieAuthStrategy`'s
   * own doc comment). Required rather than defaulted: that route
   * doesn't exist yet, and guessing its path here would just be a
   * placeholder pretending to be a real integration. */
  refreshUrl: string;
}

/** The one place customer-web constructs an `ApiClient`, so the
 * web-specific auth wiring (§3.1: cookie-based) lives in exactly one
 * spot rather than being repeated by every screen that needs API
 * access. */
export function createWebApiClient(options: CreateWebApiClientOptions): ApiClient {
  return new ApiClient({
    baseUrl: options.baseUrl,
    authStrategy: new CookieAuthStrategy({ refreshUrl: options.refreshUrl }),
  });
}
