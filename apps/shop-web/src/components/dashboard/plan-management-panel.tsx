"use client";

import { useState, type ReactNode } from "react";
import type { AdminBusinessResponse, ShopPlanResponse } from "@print-automated/types";
import { ResourceBoundary } from "@/components/resource-boundary";
import { DataTable, Pill } from "@/components/ui";
import { getApi, describeError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useResource } from "@/lib/use-resource";

const PAGE_SIZE = 50;
const DEFAULT_DAYS = 30;

interface Row {
  business: AdminBusinessResponse;
  plan: ShopPlanResponse | null;
}

async function loadRows(): Promise<Row[]> {
  const result = await getApi().admin.listBusinesses({ limit: PAGE_SIZE });
  return Promise.all(
    result.items.map(async (business) => {
      const plan = await getApi()
        .plan.adminGet(business.id)
        .catch(() => null);
      return { business, plan };
    }),
  );
}

function PlanCell({ plan }: { plan: ShopPlanResponse | null }): ReactNode {
  if (plan === null) {
    return <span className="text-muted">Unavailable</span>;
  }
  if (!plan.active) {
    return <Pill tone="danger">Expired</Pill>;
  }
  return (
    <span>
      <Pill tone="good">Active</Pill>{" "}
      {plan.expiresAt !== null && (
        <span className="text-muted">until {formatDate(plan.expiresAt)}</span>
      )}
    </span>
  );
}

function ActivateRow({
  row,
  onActivated,
}: {
  row: Row;
  onActivated: (plan: ShopPlanResponse) => void;
}): ReactNode {
  const { business } = row;
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function activate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onActivated(await getApi().plan.adminActivate(business.id, days));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td className="px-4 py-2 font-medium">{business.name}</td>
      <td className="px-4 py-2 text-muted">{business.status}</td>
      <td className="px-4 py-2">
        <PlanCell plan={row.plan} />
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`plan-days-${business.id}`}>
            Days to add for {business.name}
          </label>
          <input
            id={`plan-days-${business.id}`}
            type="number"
            min={1}
            max={3650}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="w-20 rounded-md border border-line bg-panel px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={() => void activate()}
            disabled={busy}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-transparent bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Activate / renew"}
          </button>
        </div>
        {error !== null && (
          <p className="mt-1 text-xs text-danger-fg" role="alert">
            {describeError(error)}
          </p>
        )}
      </td>
    </tr>
  );
}

/** 26.6: replaces the dashboard's own static "no subscription model yet"
 * placeholder with the real thing -- a platform admin activates or renews
 * each business's plan by adding days to it (no payment gateway; this is a
 * manual admin action, per the feature's own scope). Plan status is fetched
 * per row after the business list loads, since `/admin/businesses` itself
 * doesn't carry plan data. `overrides` reflects a just-completed
 * activate/renew immediately, without waiting for a full reload. */
export function PlanManagementPanel(): ReactNode {
  const state = useResource(loadRows, []);
  const [overrides, setOverrides] = useState<Record<string, ShopPlanResponse>>({});

  return (
    <ResourceBoundary state={state} what="businesses and plans">
      {(rows) => {
        if (rows.length === 0) {
          return <p className="text-muted">No businesses yet.</p>;
        }
        return (
          <DataTable
            caption="Businesses and their plan status"
            head={["Business", "Status", "Plan", "Action"]}
          >
            {rows.map((row) => (
              <ActivateRow
                key={row.business.id}
                row={{ ...row, plan: overrides[row.business.id] ?? row.plan }}
                onActivated={(plan) =>
                  setOverrides((prev) => ({ ...prev, [row.business.id]: plan }))
                }
              />
            ))}
          </DataTable>
        );
      }}
    </ResourceBoundary>
  );
}
