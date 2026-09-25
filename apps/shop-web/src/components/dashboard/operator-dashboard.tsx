"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Permission } from "@print-automated/types";
import type { DashboardJob, OperatorDashboardResponse } from "@print-automated/types";
import { JobRow } from "@/components/dashboard/job-row";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import { LiveStatus, PageHeader, Panel, Stat, StatGrid } from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatCount } from "@/lib/format";
import { useResource } from "@/lib/use-resource";

/** Production is a live activity: a shorter poll than the owner view. */
const POLL_MS = 15_000;

/** PRD 40, the production view: MY current job first, then what is
 * assigned to me, what is waiting for anyone, what is blocked (with why),
 * and what I finished today. "Mine" is the signed-in user; every list is
 * capped by the API and comes with its full count, linked on to the
 * queue when there is more than fits here. */
export function OperatorDashboard(): ReactNode {
  return (
    <RequirePermission
      permission={Permission.VIEW_OPERATOR_DASHBOARD}
      what="the production dashboard"
    >
      <OperatorDashboardBody />
    </RequirePermission>
  );
}

function OperatorDashboardBody(): ReactNode {
  const { business } = useSession();
  const shopId = business?.id ?? "";
  const state = useResource(() => getApi().dashboard.operator(shopId, 10), [shopId], {
    intervalMs: POLL_MS,
    enabled: shopId !== "",
  });

  return (
    <>
      <PageHeader
        title="Production"
        subtitle="Your jobs and what the floor is waiting on"
        actions={
          <LiveStatus
            lastUpdated={state.lastUpdated}
            refreshing={state.refreshing}
            onRefresh={state.reload}
          />
        }
      />
      <ResourceBoundary state={state} what="the production dashboard">
        {(data) => <OperatorDashboardView data={data} />}
      </ResourceBoundary>
    </>
  );
}

function JobList({
  title,
  total,
  jobs,
  empty,
  tone,
  showPrinter,
  moreHref,
  id,
}: {
  title: string;
  total: number;
  jobs: DashboardJob[];
  empty: string;
  tone?: "neutral" | "caution" | "accent";
  showPrinter?: boolean;
  moreHref?: string;
  id: string;
}): ReactNode {
  return (
    <Panel
      title={title}
      id={id}
      tone={tone === "neutral" ? undefined : tone}
      aside={<span className="num">{formatCount(total)}</span>}
    >
      {jobs.length === 0 ? (
        <p className="text-muted">{empty}</p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} showPrinter={showPrinter} />
            ))}
          </ul>
          {total > jobs.length && (
            <p className="mt-3 text-xs text-muted">
              Showing {jobs.length} of {formatCount(total)}.{" "}
              {moreHref !== undefined && (
                <Link href={moreHref} className="font-medium underline">
                  See them all in the queue
                </Link>
              )}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

export function OperatorDashboardView({ data }: { data: OperatorDashboardResponse }): ReactNode {
  return (
    <div className="grid gap-4">
      <StatGrid>
        <Stat
          label="My current job"
          value={formatCount(data.currentJobs.length)}
          tone={data.currentJobs.length > 0 ? "accent" : "neutral"}
        />
        <Stat label="Assigned to me" value={formatCount(data.myAssigned.total)} />
        <Stat label="Waiting" value={formatCount(data.waiting.total)} hint="Unclaimed jobs" />
        <Stat
          label="Blocked"
          value={formatCount(data.blocked.total)}
          tone={data.blocked.total > 0 ? "caution" : "neutral"}
          href="/orders?group=needsAttention"
        />
        <Stat label="Done today" value={formatCount(data.completedToday.total)} tone="good" />
      </StatGrid>

      <JobList
        id="current"
        title="Current job"
        total={data.currentJobs.length}
        jobs={data.currentJobs}
        tone={data.currentJobs.length > 0 ? "accent" : "neutral"}
        empty="You have no job on a printer right now."
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <JobList
          id="assigned"
          title="Assigned to me"
          total={data.myAssigned.total}
          jobs={data.myAssigned.items}
          empty="Nothing is assigned to you."
          moreHref="/orders"
        />
        <JobList
          id="waiting"
          title="Waiting for a printer or operator"
          total={data.waiting.total}
          jobs={data.waiting.items}
          empty="No jobs are waiting."
          moreHref="/orders"
        />
      </div>

      <JobList
        id="blocked"
        title="Blocked jobs"
        total={data.blocked.total}
        jobs={data.blocked.items}
        tone={data.blocked.total > 0 ? "caution" : "neutral"}
        empty="No job is blocked."
        moreHref="/orders?group=needsAttention"
      />

      <JobList
        id="completed"
        title="Completed today"
        total={data.completedToday.total}
        jobs={data.completedToday.items}
        empty="You have not completed a job yet today."
        moreHref="/orders?group=completed"
      />
    </div>
  );
}
