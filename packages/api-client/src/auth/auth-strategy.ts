/** The pluggability point Phase 3.1 exists for: everything above this
 * interface (HttpClient, the resource classes) is identical for every
 * client type; everything below it differs by how that client type is
 * allowed to hold credentials.
 *
 * Two implementations live in this package:
 *  - `CookieAuthStrategy` -- web. The httpOnly session cookie (set by
 *    customer-web's own route handlers, Phase 3.3) is attached by the
 *    browser automatically; this strategy never touches the token value.
 *  - `BearerTokenAuthStrategy` -- mobile. Holds an access/refresh token
 *    pair via a caller-supplied `TokenStorage` (Phase 3.4 supplies an
 *    Expo SecureStore-backed one; tests use `InMemoryTokenStorage`).
 *
 * The Printer Agent (§41) is deliberately NOT covered by either: its
 * identity is an Ed25519 device keypair with challenge/response
 * authentication, not a username/password-issued refresh token (see
 * `services/api/src/auth`, which only knows about human users). A
 * `BearerTokenAuthStrategy`-shaped stand-in would call a `/v1/auth/refresh`
 * endpoint that cannot possibly accept a device credential -- that's
 * fabricated behavior, not a real implementation. The agent gets its own
 * `AuthStrategy` in Phase 9.3, once agent registration/authentication
 * actually exist to implement it against. */
export interface AuthStrategy {
  /** Headers to merge onto every outgoing request -- e.g. `Authorization:
   * Bearer <token>` for bearer auth. Cookie auth returns `{}`: the
   * credential travels as a cookie, not a header. */
  getHeaders(): Promise<Record<string, string>>;

  /** `fetch` `RequestInit` overrides applied to every request -- e.g.
   * `{ credentials: "include" }` for cookie auth, so the browser attaches
   * (and accepts `Set-Cookie` from) the API's cookie. */
  getRequestInit(): RequestInit;

  /** Called after a 401 on an authenticated request, deduplicated across
   * concurrent callers by `HttpClient` (never called directly by resource
   * code). Returns `true` if the credential was refreshed and the
   * original request should be retried once, `false` if it could not be
   * refreshed and the 401 should propagate to the caller as-is. */
  refresh(): Promise<boolean>;
}
