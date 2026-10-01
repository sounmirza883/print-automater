"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type {
  AdminBusinessResponse,
  PlanDefinitionResponse,
  ShopPlanResponse,
} from "@print-automated/types";
import { PlanAssignment, PlanStatusCell } from "@/components/admin/plan-assignment";
import { ResourceBoundary } from "@/components/resource-boundary";
import { DataTable } from "@/components/ui";
import { getApi } from "@/lib/api";
import { humanizeEnum } from "@/lib/format";
import { useResource } from "@/lib/use-resource";

const PAGE_SIZE = 50;

export interface PlanRow {
  business: AdminBusinessResponse;
  /** null when this business's plan status could not be loaded. */
  plan: ShopPlanResponse | null;
}

interface PanelData {
  rows: PlanRow[];
  plans: PlanDefinitionResponse[];
}

async function loadRows(): Promise<PlanRow[]> {
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

async function loadPanel(): Promise<PanelData> {
  const [rows, definitions] = await Promise.all([loadRows(), getApi().plan.listDefinitions()]);
  return { rows, plans: definitions.items };
}

/** 26.6, then plan management: a platform admin assigns, renews, changes or
 * cancels each business's plan by picking one of the named plans defined on
 * the Plans page (no payment gateway; this is a manual admin action). Plan
 * status is fetched per row after the business list loads, since
 * `/admin/businesses` itself doesn't carry plan data. `overrides` reflects a
 * just-completed change immediately, without waiting for a full reload. */
export function PlanManagementPanel(): ReactNode {
  const state = useResource(loadPanel, []);
  const [overrides, setOverrides] = useState<Record<string, ShopPlanResponse>>({});

  return (
    <ResourceBoundary state={state} what="businesses and plans">
      {(data) => (
        <PlanTable
          rows={data.rows.map((row) => ({
            ...row,
            plan: overrides[row.business.id] ?? row.plan,
          }))}
          plans={data.plans}
          onPlanChanged={(businessId, plan) =>
            setOverrides((prev) => ({ ...prev, [businessId]: plan }))
          }
        />
      )}
    </ResourceBoundary>
  );
}

/** The table itself, separate from loading so it renders from plain props. */
export function PlanTable({
  rows,
  plans,
  onPlanChanged,
}: {
  rows: readonly PlanRow[];
  plans: readonly PlanDefinitionResponse[];
  onPlanChanged: (businessId: string, plan: ShopPlanResponse) => void;
}): ReactNode {
  if (rows.length === 0) {
    return <p className="text-muted">No businesses yet.</p>;
  }
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted">
        Names, prices and billing periods are set on the{" "}
        <Link href="/admin/plans" className="underline underline-offset-2">
          Plans
        </Link>{" "}
        page.
      </p>
      <DataTable
        caption="Businesses and their plans"
        head={["Business", "Status", "Plan", "Action"]}
      >
        {rows.map((row) => (
          <tr key={row.business.id}>
            <td className="px-4 py-2 font-medium">
              <Link
                href={`/admin/businesses/${row.business.id}`}
                className="underline underline-offset-2"
              >
                {row.business.name}
              </Link>
            </td>
            <td className="px-4 py-2 text-muted">{humanizeEnum(row.business.status)}</td>
            <td className="px-4 py-2">
              <PlanStatusCell plan={row.plan} />
            </td>
            <td className="px-4 py-2">
              <PlanAssignment
                compact
                shopId={row.business.id}
                shopName={row.business.name}
                current={row.plan}
                plans={plans}
                onChanged={(plan) => onPlanChanged(row.business.id, plan)}
              />
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
