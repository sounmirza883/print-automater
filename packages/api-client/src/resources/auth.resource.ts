import type { RegisterInput, LoginInput, RecoveryInput } from "@print-automated/validation";
import type { HttpClient } from "../http-client.js";
import type { AuthResult, AuthTokens } from "../types.js";

/** §70. None of these calls carry an existing credential -- each either
 * creates a session or is the recovery path taken when there isn't one
 * -- so all run with `authenticated: false`, skipping auth-header
 * attachment and the refresh-on-401 loop entirely. */
export class AuthResource {
  constructor(private readonly http: HttpClient) {}

  register(input: RegisterInput): Promise<AuthResult> {
    return this.http.request<AuthResult>("/v1/auth/register", {
      method: "POST",
      body: input,
      authenticated: false,
    });
  }

  login(input: LoginInput): Promise<AuthResult> {
    return this.http.request<AuthResult>("/v1/auth/login", {
      method: "POST",
      body: input,
      authenticated: false,
    });
  }

  /** Exposed for direct use; `BearerTokenAuthStrategy.refresh()` calls
   * the same endpoint itself rather than through this resource, since it
   * must run before an `ApiClient`/`HttpClient` necessarily exists yet. */
  refresh(refreshToken: string): Promise<AuthTokens> {
    return this.http.request<AuthTokens>("/v1/auth/refresh", {
      method: "POST",
      body: { refreshToken },
      authenticated: false,
    });
  }

  logout(refreshToken: string): Promise<void> {
    return this.http.request<void>("/v1/auth/logout", {
      method: "POST",
      body: { refreshToken },
      authenticated: false,
    });
  }

  recovery(input: RecoveryInput): Promise<void> {
    return this.http.request<void>("/v1/auth/recovery", {
      method: "POST",
      body: input,
      authenticated: false,
    });
  }
}
