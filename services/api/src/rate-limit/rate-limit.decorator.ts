import { SetMetadata } from "@nestjs/common";
import type { Request } from "express";

export interface RateLimitOptions {
  /** Max requests allowed within the window. */
  limit: number;
  windowMs: number;
  /** Identifies the bucket this request counts against -- e.g. IP alone
   * (signup), or IP+email (login), or device id (9.3's agent auth). */
  keyGenerator: (request: Request) => string;
}

export const RATE_LIMIT_KEY = "rate_limit_options";

/** §85. Apply alongside @UseGuards(RateLimitGuard) on a route handler.
 *
 * 24.1: may also take several buckets at once (e.g. the public QR routes'
 * per-IP+shop AND per-IP budgets); the request must fit in every one of
 * them. Each bucket's keyGenerator must produce a key distinct from the
 * others' (prefix it, e.g. `ip:` vs `ip-shop:`), since they share the
 * route's `ratelimit:<Controller>:<handler>:` namespace. */
export const RateLimit = (options: RateLimitOptions | RateLimitOptions[]): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, options);
