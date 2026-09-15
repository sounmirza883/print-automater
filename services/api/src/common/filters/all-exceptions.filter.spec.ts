import { ArgumentsHost, ForbiddenException, HttpStatus } from "@nestjs/common";
import { AppException } from "../errors/app-exception.js";
import { AllExceptionsFilter } from "./all-exceptions.filter.js";

function createHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const log = { error: jest.fn(), warn: jest.fn() };
  const request = { id: "test-request-id", log };

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json, log };
}

describe("AllExceptionsFilter", () => {
  const filter = new AllExceptionsFilter();

  it("honors a custom AppException's status/errorCode/retryable exactly", () => {
    const { host, status, json, log } = createHost();
    const exception = new AppException(
      HttpStatus.CONFLICT,
      "SHOP_ALREADY_PAIRED",
      "This shop already has a paired agent.",
      false,
    );

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      error_code: "SHOP_ALREADY_PAIRED",
      message: "This shop already has a paired agent.",
      retryable: false,
      request_id: "test-request-id",
    });
    // 4xx is warn, not error -- it's an expected/handled case, not a bug.
    expect(log.warn).toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("derives a code and retryable=false for a built-in 4xx HttpException", () => {
    const { host, status, json } = createHost();
    filter.catch(new ForbiddenException("Not allowed."), host);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      error_code: "FORBIDDEN",
      message: "Not allowed.",
      retryable: false,
      request_id: "test-request-id",
    });
  });

  it("maps an unrecognized thrown value to a safe, retryable 500 and logs the real cause", () => {
    const { host, status, json, log } = createHost();
    const realError = new Error("connect ECONNREFUSED 127.0.0.1:5433");

    filter.catch(realError, host);

    expect(status).toHaveBeenCalledWith(500);
    const [payload] = json.mock.calls[0] as [Record<string, unknown>];
    expect(payload["error_code"]).toBe("INTERNAL_SERVER_ERROR");
    expect(payload["retryable"]).toBe(true);
    expect(payload["message"]).not.toContain("ECONNREFUSED");
    expect(log.error).toHaveBeenCalledWith({ err: realError }, "Unhandled exception");
  });
});
