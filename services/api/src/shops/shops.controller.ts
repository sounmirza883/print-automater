import { Controller, Get, Query } from "@nestjs/common";
import type { Page } from "@print-automated/types";
import { ListShopsQueryDto } from "./dto/list-shops-query.dto.js";
import { ShopsService, type ShopListItem } from "./shops.service.js";

/** §17: public discovery, deliberately no auth guard -- a customer can
 * browse participating shops before creating an account, same as
 * browsing a storefront before checking out.
 *
 * Fix wave 1: there is deliberately NO business-creation route here any
 * more. The public self-service signup (`POST /shops/register`) was removed
 * by product decision: a business is onboarded only by a platform admin
 * (`POST /admin/businesses`, which also creates the owner's account and
 * emails them an activation code). See definition-of-done.md #1. */
@Controller("shops")
export class ShopsController {
  constructor(private readonly shopsService: ShopsService) {}

  @Get()
  list(@Query() query: ListShopsQueryDto): Promise<ShopListItem[] | Page<ShopListItem>> {
    return this.shopsService.list(query);
  }
}
