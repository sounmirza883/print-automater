import { randomUUID } from "node:crypto";
import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import {
  AppException,
  REDIS_CLIENT,
  type RedisWithRateLimit,
} from "@print-automated/backend-shared";
import { RATE_LIMIT_KEY, type RateLimitOptions } from "./rate-limit.decorator.js";

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: RedisWithRateLimit,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<RateLimitOptions | RateLimitOptions[] | undefined>(
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
    const prefix = `ratelimit:${context.getClass().name}:${String(context.getHandler().name)}`;

    // 24.1: every bucket must admit the request. Checked in declaration
    // order, stopping at the first refusal -- a request already refused is
    // not also charged to the buckets after it. (One an earlier bucket
    // admitted has spent its slot: that attempt did happen.)
    for (const bucket of Array.isArray(options) ? options : [options]) {
      const now = Date.now();
      const [allowed, , retryAfterMs] = await this.redis.slidingWindowRateLimit(
        `${prefix}:${bucket.keyGenerator(request)}`,
        now,
        bucket.windowMs,
        bucket.limit,
        `${now}:${randomUUID()}`,
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
    }

    return true;
  }
}
