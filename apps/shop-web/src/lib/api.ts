import { errorMessageFor } from "@/lib/error-copy";
import { ApiClient, ApiClientError, CookieAuthStrategy } from "@print-automated/api-client";

/** Every browser-side API call goes to THIS app's origin under `/api`
 * (the BFF proxy, `app/api/v1/[...path]`), never to the real API: the
 * api-client builds `/v1/...` paths, and this wrapper re-roots them.
 * The session is an httpOnly cookie the browser never reads;
 * `CookieAuthStrategy` handles refresh-on-401 (single flight per tab)
 * through `/api/auth/refresh`. */
const BFF_ORIGIN_PLACEHOLDER = "http://bff.invalid";

const viaBff: typeof fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), BFF_ORIGIN_PLACEHOLDER);
  return fetch(`/api${url.pathname}${url.search}`, init);
};

let client: ApiClient | undefined;

export function getApi(): ApiClient {
  client ??= new ApiClient({
    baseUrl: BFF_ORIGIN_PLACEHOLDER,
    authStrategy: new CookieAuthStrategy({ refreshUrl: "/api/auth/refresh" }),
    fetchImpl: viaBff,
  });
  return client;
}

/** The session is gone (refresh already failed inside the client). */
export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

/** The signed-in person's role does not allow this. */
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 403;
}

export function isNetworkFailure(error: unknown): boolean {
  return !(error instanceof ApiClientError);
}

/** One place that turns a failure into words a person can act on. */
export function describeError(error: unknown): string {
  return errorMessageFor(error);
}

export function redirectToSignIn(): void {
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}
