import type { ReactNode } from "react";
import type { ShopListItem } from "@/lib/configure-quote";

export interface ShopListProps {
  shops: ShopListItem[];
  selectedShopId: string | null;
  onSelect: (shopId: string) => void;
}

/** §17's named shop-list fields -- name, status, estimated processing
 * time -- presented for whatever 4.3's capability/status filter
 * already narrowed the list down to; this component doesn't re-filter
 * anything itself. `estimatedProcessingTimeMinutes` stays the honest
 * `null` placeholder 4.3 documented (no real job-backlog data exists
 * yet to estimate from) -- shown as "Not available yet", never a
 * fabricated number. */
export function ShopList({ shops, selectedShopId, onSelect }: ShopListProps): ReactNode {
  if (shops.length === 0) {
    return <p className="text-sm text-gray-600">No shops currently match this configuration.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {shops.map((shop) => {
        const selected = shop.id === selectedShopId;
        return (
          <li key={shop.id}>
            <button
              type="button"
              onClick={() => onSelect(shop.id)}
              aria-pressed={selected}
              className="w-full rounded-md border px-3 py-2 text-left"
              style={{
                borderColor: selected ? "var(--color-primary-action)" : "#d1d5db",
                borderWidth: selected ? 2 : 1,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{shop.name}</span>
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                  style={{ backgroundColor: statusColor(shop.status) }}
                >
                  {shop.status}
                </span>
              </div>
              <p className="text-sm text-gray-600">{shop.address}</p>
              <p className="text-sm text-gray-600">
                Estimated time:{" "}
                {shop.estimatedProcessingTimeMinutes !== null
                  ? `${shop.estimatedProcessingTimeMinutes} min`
                  : "Not available yet"}
              </p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function statusColor(status: string): string {
  return status === "OPEN" ? "var(--color-success)" : "var(--color-neutral)";
}
