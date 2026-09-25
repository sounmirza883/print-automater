import { randomUUID } from "node:crypto";
import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  AppException,
  REDIS_CLIENT,
  type RedisWithRateLimit,
} from "@print-automated/backend-shared";

/** 23.11: search is the costliest read (a leading-wildcard match), so every route that takes
 * a search term (`q`, or `search` on inventory and suppliers) shares ONE per-user budget:
 * SEARCH_LIMIT searches per minute across all of them, not one budget per route (which would
 * let a caller multiply their allowance by the number of routes). A request WITHOUT a search
 * term is a plain list and is never counted or throttled.
 *
 * Runs after the class-level auth guards (so `request.user` is set, and a caller who would be
 * refused with 401/403 never spends budget). Anonymous callers cannot reach these routes. */
export const SEARCH_LIMIT = 60;
export const SEARCH_WINDOW_MS = 60_000;

@Injectable()
export class SearchRateLimitGuard implements CanActivate {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisWithRateLimit) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: { id: string } }>();
    const query = request.query as Record<string, unknown>;
    const term = query.q ?? query.search;
    if (typeof term !== "string" || term.length === 0) {
      return true;
    }
    const who = request.user?.id ?? request.ip ?? "anon";
    const now = Date.now();
    const [allowed, , retryAfterMs] = await this.redis.slidingWindowRateLimit(
      `ratelimit:search:${who}`,
      now,
      SEARCH_WINDOW_MS,
      SEARCH_LIMIT,
      `${now}:${randomUUID()}`,
    );
    if (allowed === 0) {
      http
        .getResponse<Response>()
        .setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        "RATE_LIMITED",
        "Too many searches. Please try again shortly.",
        true,
      );
    }
    return true;
  }
}
