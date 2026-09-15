import type { ApiError } from "@print-automated/types";

/** Thrown for every non-2xx response. Implements `ApiError` (§104) so a
 * caller can branch on `error_code` / `retryable` without re-parsing the
 * response body itself -- the parsing happened once, here. */
export class ApiClientError extends Error implements ApiError {
  readonly status: number;
  readonly error_code: string;
  readonly retryable: boolean;
  readonly request_id: string;

  constructor(status: number, body: Partial<ApiError>) {
    super(body.message ?? `Request failed with status ${status}`);
    this.name = "ApiClientError";
    this.status = status;
    this.error_code = body.error_code ?? "UNKNOWN_ERROR";
    this.retryable = body.retryable ?? false;
    this.request_id = body.request_id ?? "unknown";
  }

  /** `payload` is whatever the response body parsed to -- the API's
   * `AllExceptionsFilter` (§104) always emits the full `ApiError` shape,
   * but this client may also be pointed at something else (a proxy, a
   * gateway timeout page), so a malformed body degrades to a best-effort
   * error rather than throwing while constructing the error itself. */
  static fromResponse(status: number, statusText: string, payload: unknown): ApiClientError {
    if (isApiErrorShape(payload)) {
      return new ApiClientError(status, payload);
    }
    const message = typeof payload === "string" && payload.length > 0 ? payload : statusText;
    return new ApiClientError(status, { message });
  }
}

function isApiErrorShape(payload: unknown): payload is Partial<ApiError> {
  return typeof payload === "object" && payload !== null && "error_code" in payload;
}
