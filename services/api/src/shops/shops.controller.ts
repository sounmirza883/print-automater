import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import type { Page } from "@print-automated/types";
import type { AuthResult } from "../auth/auth.service.js";
import { RateLimitGuard } from "../rate-limit/rate-limit.guard.js";
import { RateLimit } from "../rate-limit/rate-limit.decorator.js";
import { ListShopsQueryDto } from "./dto/list-shops-query.dto.js";
import { RegisterShopDto } from "./dto/register-shop.dto.js";
import { ShopsService, type ShopListItem } from "./shops.service.js";

const MINUTE_MS = 60_000;

/** §17: public discovery, deliberately no auth guard -- a customer can
 * browse participating shops before creating an account, same as
 * browsing a storefront before checking out. */
@Controller("shops")
export class ShopsController {
  constructor(private readonly shopsService: ShopsService) {}

  @Get()
  list(@Query() query: ListShopsQueryDto): Promise<ShopListItem[] | Page<ShopListItem>> {
    return this.shopsService.list(query);
  }

  /** Self-service business signup (definition-of-done.md #1): unauthenticated,
   * unlike every other route this controller might grow -- a prospective
   * business has no account yet. Same 3/hr-per-IP shape as
   * `POST /auth/register` (§85), since this also mints a new account. */
  @Post("register")
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 3, windowMs: 60 * MINUTE_MS, keyGenerator: (req) => req.ip ?? "unknown" })
  register(@Body() dto: RegisterShopDto): Promise<AuthResult> {
    return this.shopsService.registerShop(dto);
  }
}
