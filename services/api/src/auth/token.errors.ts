export class InvalidRefreshTokenError extends Error {
  constructor(message = "Refresh token is invalid or expired") {
    super(message);
    this.name = "InvalidRefreshTokenError";
  }
}

/** Thrown when a refresh token that was already rotated away (revoked)
 * is presented again -- the classic signal of a stolen/replayed token.
 * The entire rotation family has already been revoked by the time this
 * is thrown (§46/§92-style idempotent, fail-safe reaction). */
export class RefreshTokenReuseDetectedError extends Error {
  constructor(message = "Refresh token reuse detected; token family revoked") {
    super(message);
    this.name = "RefreshTokenReuseDetectedError";
  }
}
