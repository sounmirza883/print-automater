import { ApiClient, BearerTokenAuthStrategy, type TokenStorage } from "@print-automated/api-client";

export interface CreateMobileApiClientOptions {
  baseUrl: string;
  /** The app's own `TokenStorage` -- Phase 3.4 supplies an
   * `expo-secure-store`-backed implementation. Not defaulted to
   * `InMemoryTokenStorage` here: a default that quietly loses the
   * session on every app restart would be the kind of thing nobody
   * notices until a real device does exactly that. */
  storage: TokenStorage;
}

/** The one place shop-mobile constructs an `ApiClient`, so the
 * mobile-specific auth wiring (§3.1: bearer token via secure storage)
 * lives in exactly one spot rather than being repeated by every screen
 * that needs API access. */
export function createMobileApiClient(options: CreateMobileApiClientOptions): ApiClient {
  return new ApiClient({
    baseUrl: options.baseUrl,
    authStrategy: new BearerTokenAuthStrategy({
      baseUrl: options.baseUrl,
      storage: options.storage,
    }),
  });
}
