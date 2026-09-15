import { ApiClientError } from "./api-client-error.js";

describe("ApiClientError.fromResponse", () => {
  it("uses the §104 error body fields when present", () => {
    const error = ApiClientError.fromResponse(422, "Unprocessable Entity", {
      error_code: "VALIDATION_FAILED",
      message: "Email is required.",
      retryable: false,
      request_id: "req-9",
    });

    expect(error.status).toBe(422);
    expect(error.error_code).toBe("VALIDATION_FAILED");
    expect(error.message).toBe("Email is required.");
    expect(error.retryable).toBe(false);
    expect(error.request_id).toBe("req-9");
  });

  it("falls back to UNKNOWN_ERROR/statusText when the body isn't the §104 shape and carries no usable text", () => {
    const error = ApiClientError.fromResponse(502, "Bad Gateway", "");

    expect(error.status).toBe(502);
    expect(error.error_code).toBe("UNKNOWN_ERROR");
    expect(error.retryable).toBe(false);
    expect(error.request_id).toBe("unknown");
    expect(error.message).toBe("Bad Gateway");
  });

  it("falls back to a non-empty plain-text body as the message when the body has no error_code", () => {
    const error = ApiClientError.fromResponse(500, "Internal Server Error", "boom");
    expect(error.message).toBe("boom");
  });
});
