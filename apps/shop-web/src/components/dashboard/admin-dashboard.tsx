"use client";

import type { ReactNode } from "react";
import type { AdminDashboardResponse } from "@print-automated/types";
import { ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import {
  BarList,
  ForbiddenState,
  LiveStatus,
  PageHeader,
  Panel,
  Pill,
  Stat,
  StatGrid,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatBytes, formatCount, humanizeEnum } from "@/lib/format";
import { useResource } from "@/lib/use-resource";

const POLL_MS = 60_000;

function sortedRows(record: Record<string, number>): Array<{ label: string; value: number }> {
  return Object.entries(record)
    .sort(([, a], [, b]) => b - a)
    .map(([label, value]) => ({ label: humanizeEnum(label), value }));
}

/** PRD 42, platform administrators only (the API answers 403 to anyone
 * else; this just avoids asking). Platform-wide, not per business. */
export function AdminDashboard(): ReactNode {
  const { isAdmin } = useSession();
  if (!isAdmin) {
    return <ForbiddenState what="the platform dashboard" />;
  }
  return <AdminDashboardBody />;
}

function AdminDashboardBody(): ReactNode {
  const state = useResource(() => getApi().dashboard.admin(), [], { intervalMs: POLL_MS });
  return (
    <>
      <PageHeader
        title="Platform"
        subtitle="Health and activity across every business"
        actions={
          <LiveStatus
            lastUpdated={state.lastUpdated}
            refreshing={state.refreshing}
            onRefresh={state.reload}
          />
        }
      />
      <ResourceBoundary state={state} what="the platform dashboard">
        {(data) => <AdminDashboardView data={data} />}
      </ResourceBoundary>
    </>
  );
}

export function AdminDashboardView({ data }: { data: AdminDashboardResponse }): ReactNode {
  const failing = data.system.checks.filter((check) => !check.ok);
  return (
    <div className="grid gap-4">
      <Panel
        title="System status"
        tone={data.system.ready ? "good" : "danger"}
        aside={
          <Pill tone={data.system.ready ? "good" : "danger"}>
            {data.system.ready ? "Ready" : "Degraded"}
          </Pill>
        }
        id="system"
      >
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.system.checks.map((check) => (
            <li
              key={check.name}
              className="flex items-center justify-between gap-2 rounded-md border border-line bg-panel-2 px-3 py-2"
            >
              <span className="font-medium">{humanizeEnum(check.name)}</span>
              <Pill tone={check.ok ? "good" : "danger"}>{check.ok ? "OK" : "Failing"}</Pill>
            </li>
          ))}
        </ul>
        {failing.length > 0 && (
          <ul className="mt-3 grid gap-1 text-sm text-danger-fg" role="alert">
            {failing.map((check) => (
              <li key={check.name}>
                {humanizeEnum(check.name)}: {check.error ?? "check failed"}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <StatGrid>
        <Stat
          label="Businesses"
          value={formatCount(data.businesses.total)}
          hint="Manage businesses"
          href="/admin/businesses"
        />
        <Stat label="Users" value={formatCount(data.users.total)} />
        <Stat
          label="Orders"
          value={formatCount(data.orders.total)}
          hint={`${formatCount(data.orders.today)} today`}
        />
        <Stat
          label="Printers"
          value={formatCount(data.printers.total)}
          hint={`${formatCount(data.printers.agentsActive)} agents active`}
        />
        <Stat
          label="Failed jobs, 24 h"
          value={formatCount(data.errors.failedJobs24h)}
          tone={data.errors.failedJobs24h > 0 ? "danger" : "neutral"}
        />
        <Stat
          label="Failed payments, 24 h"
          value={formatCount(data.errors.failedPayments24h)}
          tone={data.errors.failedPayments24h > 0 ? "danger" : "neutral"}
        />
        <Stat
          label="Documents stored"
          value={formatCount(data.storage.documents)}
          hint={`${formatBytes(data.storage.readyBytes)} ready`}
        />
        <Stat
          label="Security events, 24 h"
          value={formatCount(data.securityEvents24h.total)}
          tone={data.securityEvents24h.total > 0 ? "caution" : "neutral"}
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Businesses by status" id="businesses">
          <BarList ariaLabel="Businesses by status" rows={sortedRows(data.businesses.byStatus)} />
        </Panel>
        <Panel title="Users by role" id="users-role">
          <BarList ariaLabel="Users by role" rows={sortedRows(data.users.byRole)} />
        </Panel>
        <Panel title="Users by status" id="users-status">
          <BarList ariaLabel="Users by status" rows={sortedRows(data.users.byStatus)} />
        </Panel>
        <Panel title="Orders by status" id="orders-status">
          <BarList ariaLabel="Orders by status" rows={sortedRows(data.orders.byStatus)} />
        </Panel>
        <Panel title="Printers by status" id="printers-status">
          <BarList ariaLabel="Printers by status" rows={sortedRows(data.printers.byStatus)} />
        </Panel>
        <Panel
          title="Security events, last 24 hours"
          aside={<span className="num">{formatCount(data.securityEvents24h.total)}</span>}
          id="security"
        >
          {data.securityEvents24h.total === 0 ? (
            <p className="text-muted">No security-relevant events were recorded.</p>
          ) : (
            <BarList
              ariaLabel="Security events by action"
              rows={sortedRows(data.securityEvents24h.byAction).map((row) => ({
                ...row,
                tone: "caution" as const,
              }))}
            />
          )}
        </Panel>
      </div>

      <Panel title="Subscriptions" id="subscriptions">
        <p className="text-muted">
          {data.subscriptions === null
            ? "The platform has no subscription or billing model yet, so there is nothing to show here."
            : "Subscription data is available."}
        </p>
      </Panel>
    </div>
  );
}
