import { Injectable } from "@nestjs/common";
import { Prisma, ShopStatus, type Shop } from "@prisma/client";
import { PaperSize, type Page, type PrinterCapabilities } from "@print-automated/types";
import type { ListShopsQueryInput } from "@print-automated/validation";
import { PrismaService } from "@print-automated/backend-shared";
import { listResult, resolvePagination } from "../common/pagination.js";

export interface ShopListItem {
  id: string;
  name: string;
  address: string;
  status: ShopStatus;
  capabilities: PrinterCapabilities | null;
  /** §17 names "distance" and "estimated processing time" as fields a
   * shop can expose, but MVP has no geolocation (§17: "Advanced
   * map/location discovery can follow later") and no real job-backlog
   * data to estimate from (that needs Phase 8's dispatch model) --
   * both are honest `null` placeholders, not fabricated numbers, kept
   * as real (nullable) response fields so a later phase can populate
   * them without an API shape change. */
  distanceKm: number | null;
  estimatedProcessingTimeMinutes: number | null;
}

@Injectable()
export class ShopsService {
  constructor(private readonly prisma: PrismaService) {}

  /** §17/§18: only shops currently able to fulfil the requested
   * configuration, and only shops currently accepting orders at all
   * (§107) -- CLOSED/BUSY/TEMPORARILY_UNAVAILABLE/SUSPENDED are all
   * "cannot currently accept them" states; only OPEN qualifies. */
  async list(query: ListShopsQueryInput): Promise<ShopListItem[] | Page<ShopListItem>> {
    const pagination = resolvePagination(query);
    // A shop with no declared capabilities can't be confirmed to support anything specific,
    // so any requested capability excludes it (a JSON path filter never matches NULL);
    // an unfiltered browse still includes it. The filter runs in SQL so a page is exact.
    const capabilityFilters: Prisma.ShopWhereInput[] = [];
    if (query.paper === PaperSize.A4) {
      capabilityFilters.push({ capabilities: { path: ["a4"], equals: true } });
    }
    if (query.color === true) {
      capabilityFilters.push({ capabilities: { path: ["color"], equals: true } });
    }
    if (query.duplex === true) {
      capabilityFilters.push({ capabilities: { path: ["duplex"], equals: true } });
    }
    const where: Prisma.ShopWhereInput = {
      status: ShopStatus.OPEN,
      ...(capabilityFilters.length > 0 ? { AND: capabilityFilters } : {}),
    };
    const [shops, total] = await Promise.all([
      this.prisma.shop.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: pagination.take,
        skip: pagination.skip,
      }),
      pagination.paged ? this.prisma.shop.count({ where }) : Promise.resolve(0),
    ]);
    return listResult(pagination, shops.map(toShopListItem), total);
  }
}

function toShopListItem(shop: Shop): ShopListItem {
  return {
    id: shop.id,
    name: shop.name,
    address: shop.address,
    status: shop.status,
    capabilities: shop.capabilities as PrinterCapabilities | null,
    distanceKm: null,
    estimatedProcessingTimeMinutes: null,
  };
}
