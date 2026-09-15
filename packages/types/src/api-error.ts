/** §104 — the shape of every error response. Customer-facing `message`
 * must be human-readable prose, never an internal code or stack detail. */
export interface ApiError {
  error_code: string;
  message: string;
  retryable: boolean;
  request_id: string;
}
