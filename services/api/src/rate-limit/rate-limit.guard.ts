import { randomUUID } from "node:crypto";
import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { AppException } from "../common/errors/app-exception.js";
import { REDIS_CLIENT, type RedisWithRateLimit } from "@print-automated/backend-shared";
import { RATE_LIMIT_KEY, type RateLimitOptions } from "./rate-limit.decorator.js";

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: RedisWithRateLimit,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!options) {
      // No @RateLimit() on this route -- nothing to enforce.
      return true;
    }

    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();

    const bucketKey = `ratelimit:${context.getClass().name}:${String(context.getHandler().name)}:${options.keyGenerator(request)}`;
    const now = Date.now();
    const member = `${now}:${randomUUID()}`;

    const [allowed, , retryAfterMs] = await this.redis.slidingWindowRateLimit(
      bucketKey,
      now,
      options.windowMs,
      options.limit,
      member,
    );

    if (allowed === 0) {
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      response.setHeader("Retry-After", String(retryAfterSeconds));
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        "RATE_LIMITED",
        "Too many requests. Please try again later.",
        true,
      );
    }

    return true;
  }
}
