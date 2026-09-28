"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { AdminBusinessDetail } from "@print-automated/api-client";
import type { ShopStatus } from "@print-automated/types";
import { SelectField } from "@/components/form-kit";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import {
  Button,
  ForbiddenState,
  LiveStatus,
  PageHeader,
  Panel,
  Pill,
  Stat,
  StatGrid,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatCount, formatDate, humanizeEnum } from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import { STATUS_OPTIONS, STATUS_TONE } from "./businesses-screen";

/** Workstream A (23.7): one business's detail -- counts of what's
 * actually happening there, its profile, and the one thing an admin can
 * do that the business's own staff cannot: force its status. Same
 * `isAdmin` gate as `BusinessesScreen`, not a per-shop permission. */
export function BusinessDetail({ businessId }: { businessId: string }): ReactNode {
  const { isAdmin } = useSession();
  if (!isAdmin) {
    return <ForbiddenState what="business management" />;
  }
  return <BusinessDetailBody businessId={businessId} />;
}

function BusinessDetailBody({ businessId }: { businessId: string }): ReactNode {
  const state = useResource(() => getApi().admin.getBusiness(businessId), [businessId]);
  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/admin/businesses" className="underline underline-offset-2">
          &larr; Businesses
        </Link>
      </p>
      <PageHeader
        title={state.data?.name ?? "Business"}
        actions={
          <LiveStatus
            lastUpdated={state.lastUpdated}
            refreshing={state.refreshing}
            onRefresh={state.reload}
          />
        }
      />
      <ResourceBoundary state={state} what="this business">
        {(data) => <BusinessBody data={data} onChanged={state.reload} />}
      </ResourceBoundary>
    </>
  );
}

function BusinessBody({
  data,
  onChanged,
}: {
  data: AdminBusinessDetail;
  onChanged: () => void;
}): ReactNode {
  const runner = useActionRunner(onChanged);
  const [status, setStatus] = useState<ShopStatus>(data.status);

  return (
    <div className="grid gap-4">
      {runner.error !== null && (
        <p
          role="alert"
          className="rounded-md border border-danger/50 bg-danger-soft px-3 py-2 text-danger-fg"
        >
          {runner.error}
        </p>
      )}

      <StatGrid>
        <Stat label="Active staff" value={formatCount(data.counts.staff)} />
        <Stat label="Orders" value={formatCount(data.counts.orders)} />
        <Stat label="Printers" value={formatCount(data.counts.printers)} />
      </StatGrid>

      <Panel title="Profile" id="profile">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">Address</dt>
            <dd>{data.address}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">Phone</dt>
            <dd>{data.phone ?? "Not set"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">Since</dt>
            <dd>{formatDate(data.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">
              Current status
            </dt>
            <dd>
              <Pill tone={STATUS_TONE[data.status] ?? "neutral"}>{humanizeEnum(data.status)}</Pill>
            </dd>
          </div>
        </dl>
      </Panel>

      <Panel title="Status" id="status">
        <form
          className="grid gap-3 text-sm sm:max-w-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void runner.run(() => getApi().admin.updateBusinessStatus(data.id, status));
          }}
        >
          <SelectField
            label="Status"
            value={status}
            onChange={(value) => setStatus(value as ShopStatus)}
            options={STATUS_OPTIONS}
          />
          <p className="text-xs text-muted">
            This overrides the business&apos;s own open/close setting -- use it to suspend a
            business for abuse, or to reopen one on its behalf.
          </p>
          <div>
            <Button
              type="submit"
              variant="primary"
              disabled={runner.busy || status === data.status}
            >
              {runner.busy ? "Saving…" : "Save status"}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
