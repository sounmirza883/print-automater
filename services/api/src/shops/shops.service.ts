import { Injectable } from "@nestjs/common";
import { ShopStatus, type Shop } from "@prisma/client";
import { PaperSize, type PrinterCapabilities } from "@print-automated/types";
import type { ListShopsQueryInput } from "@print-automated/validation";
import { PrismaService } from "@print-automated/backend-shared";

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
  async list(query: ListShopsQueryInput): Promise<ShopListItem[]> {
    const shops = await this.prisma.shop.findMany({
      where: { status: ShopStatus.OPEN },
      orderBy: { name: "asc" },
    });

    return shops.filter((shop) => matchesRequestedConfiguration(shop, query)).map(toShopListItem);
  }
}

/** A shop with no declared `capabilities` yet can't be confirmed to
 * support anything specific -- it's excluded from any filtered search
 * rather than guessed into or out of the results. An entirely
 * unfiltered request (browsing before configuring a job) still
 * includes it, since nothing was actually asked of it. */
function matchesRequestedConfiguration(shop: Shop, query: ListShopsQueryInput): boolean {
  const hasAnyFilter = query.paper !== undefined || query.color === true || query.duplex === true;
  if (!hasAnyFilter) {
    return true;
  }

  const capabilities = shop.capabilities as PrinterCapabilities | null;
  if (capabilities === null) {
    return false;
  }

  if (query.paper === PaperSize.A4 && !capabilities.a4) {
    return false;
  }
  if (query.color === true && !capabilities.color) {
    return false;
  }
  if (query.duplex === true && !capabilities.duplex) {
    return false;
  }
  return true;
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
