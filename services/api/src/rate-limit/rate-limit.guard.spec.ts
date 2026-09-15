import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AppException } from "../common/errors/app-exception.js";
import type { RateLimitOptions } from "./rate-limit.decorator.js";
import { RateLimitGuard } from "./rate-limit.guard.js";

function createContext(rateLimitOptions: RateLimitOptions | undefined) {
  const setHeader = jest.fn();
  const request = { ip: "127.0.0.1", body: {} } as unknown as Request;
  const response = { setHeader };

  const reflector = {
    get: () => rateLimitOptions,
  } as unknown as Reflector;

  const context = {
    getHandler: () => ({ name: "testHandler" }),
    getClass: () => ({ name: "TestController" }),
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;

  return { context, reflector, setHeader };
}

describe("RateLimitGuard", () => {
  it("passes through untouched when the route has no @RateLimit()", async () => {
    const { context, reflector } = createContext(undefined);
    const redis = { slidingWindowRateLimit: jest.fn() };
    const guard = new RateLimitGuard(reflector, redis as never);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redis.slidingWindowRateLimit).not.toHaveBeenCalled();
  });

  it("allows the request when the Lua script reports allowed=1", async () => {
    const options: RateLimitOptions = {
      limit: 5,
      windowMs: 60_000,
      keyGenerator: () => "some-key",
    };
    const { context, reflector } = createContext(options);
    const redis = { slidingWindowRateLimit: jest.fn().mockResolvedValue([1, 4, 0]) };
    const guard = new RateLimitGuard(reflector, redis as never);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("rejects with 429 and sets Retry-After when the Lua script reports allowed=0", async () => {
    const options: RateLimitOptions = {
      limit: 5,
      windowMs: 60_000,
      keyGenerator: () => "some-key",
    };
    const { context, reflector, setHeader } = createContext(options);
    const redis = {
      slidingWindowRateLimit: jest.fn().mockResolvedValue([0, 0, 12_345]),
    };
    const guard = new RateLimitGuard(reflector, redis as never);

    await expect(guard.canActivate(context)).rejects.toThrow(AppException);
    expect(setHeader).toHaveBeenCalledWith("Retry-After", "13"); // ceil(12345/1000)
  });

  it("builds the bucket key from the controller, handler, and options.keyGenerator", async () => {
    const keyGenerator = jest.fn().mockReturnValue("1.2.3.4:someone@example.com");
    const options: RateLimitOptions = { limit: 5, windowMs: 60_000, keyGenerator };
    const { context, reflector } = createContext(options);
    const redis = { slidingWindowRateLimit: jest.fn().mockResolvedValue([1, 4, 0]) };
    const guard = new RateLimitGuard(reflector, redis as never);

    await guard.canActivate(context);

    expect(redis.slidingWindowRateLimit).toHaveBeenCalledWith(
      "ratelimit:TestController:testHandler:1.2.3.4:someone@example.com",
      expect.any(Number),
      60_000,
      5,
      expect.any(String),
    );
  });
});
