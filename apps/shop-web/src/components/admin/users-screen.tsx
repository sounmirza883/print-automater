"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { UserStatus } from "@print-automated/types";
import { Pager } from "@/components/form-kit";
import { ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import {
  Cell,
  DataTable,
  EmptyState,
  ForbiddenState,
  LiveStatus,
  PageHeader,
  Panel,
  Pill,
  Row,
  type Tone,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatDate, humanizeEnum } from "@/lib/format";
import { roleLabel } from "@/lib/permissions";
import { useResource } from "@/lib/use-resource";

const PAGE = 25;

/** Shared with `user-detail.tsx`: how each `UserStatus` reads (tone + label).
 * `roleLabel` (lib/permissions) already covers the role side for every
 * back-office screen; this is the status equivalent, scoped to admin
 * user-management (no other screen changes a user's own account status). */
export const USER_STATUS_TONE: Record<string, Tone> = {
  [UserStatus.ACTIVE]: "good",
  [UserStatus.SUSPENDED]: "caution",
  [UserStatus.DELETED]: "danger",
};

export const USER_STATUS_OPTIONS = Object.values(UserStatus).map((value) => ({
  value,
  label: humanizeEnum(value),
}));

/** Workstream B: every user on the platform, ADMIN only. Explicitly not
 * built on `staff-screen.tsx`/`Permission.MANAGE_USERS` -- this is
 * platform-wide, gated the same way `BusinessesScreen` is (`isAdmin`,
 * not a per-shop permission). */
export function UsersScreen(): ReactNode {
  const { isAdmin } = useSession();
  if (!isAdmin) {
    return <ForbiddenState what="user management" />;
  }
  return <UsersBody />;
}

function UsersBody(): ReactNode {
  const [page, setPage] = useState(0);
  const list = useResource(
    () => getApi().admin.listUsers({ limit: PAGE, offset: page * PAGE }),
    [page],
    { intervalMs: 60_000 },
  );

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Every account on the platform"
        actions={
          <LiveStatus
            lastUpdated={list.lastUpdated}
            refreshing={list.refreshing}
            onRefresh={list.reload}
          />
        }
      />
      <ResourceBoundary state={list} what="users">
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title="No users yet">Accounts appear here once they register.</EmptyState>
          ) : (
            <Panel flushOnPhone>
              <DataTable
                caption="Users"
                head={["Name", "Email", "Role", "Status", "Since"]}
                stackOnPhone
              >
                {data.items.map((user) => (
                  <Row key={user.id}>
                    <Cell className="font-medium">
                      <Link
                        href={`/admin/users/${user.id}`}
                        className="underline underline-offset-2"
                      >
                        {user.name}
                      </Link>
                    </Cell>
                    <Cell label="Email" className="text-muted">
                      {user.email}
                    </Cell>
                    <Cell label="Role">{roleLabel(user.role)}</Cell>
                    <Cell label="Status">
                      <Pill tone={USER_STATUS_TONE[user.status] ?? "neutral"}>
                        {humanizeEnum(user.status)}
                      </Pill>
                    </Cell>
                    <Cell label="Since" className="text-muted">
                      {formatDate(user.createdAt)}
                    </Cell>
                  </Row>
                ))}
              </DataTable>
              <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
            </Panel>
          )
        }
      </ResourceBoundary>
    </>
  );
}
