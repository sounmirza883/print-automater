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

/** §85. Apply alongside @UseGuards(RateLimitGuard) on a route handler. */
export const RateLimit = (options: RateLimitOptions): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, options);
