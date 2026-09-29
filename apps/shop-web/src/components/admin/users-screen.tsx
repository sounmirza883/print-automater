"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { UserStatus } from "@print-automated/types";
import { Pager } from "@/components/form-kit";
import { ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import {
  DataTable,
  EmptyState,
  ForbiddenState,
  LiveStatus,
  PageHeader,
  Panel,
  Pill,
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
            <Panel>
              <DataTable caption="Users" head={["Name", "Email", "Role", "Status", "Since"]}>
                {data.items.map((user) => (
                  <tr key={user.id}>
                    <td className="px-4 py-2 font-medium">
                      <Link
                        href={`/admin/users/${user.id}`}
                        className="underline underline-offset-2"
                      >
                        {user.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-muted">{user.email}</td>
                    <td className="px-4 py-2">{roleLabel(user.role)}</td>
                    <td className="px-4 py-2">
                      <Pill tone={USER_STATUS_TONE[user.status] ?? "neutral"}>
                        {humanizeEnum(user.status)}
                      </Pill>
                    </td>
                    <td className="px-4 py-2 text-muted">{formatDate(user.createdAt)}</td>
                  </tr>
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
