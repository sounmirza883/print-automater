"use client";

import { useState, type ReactNode } from "react";
import type { AdminUser } from "@print-automated/api-client";
import { UserRole, UserStatus } from "@print-automated/types";
import { SelectField } from "@/components/form-kit";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import {
  BackLink,
  Button,
  DetailGrid,
  ForbiddenState,
  LiveStatus,
  Notice,
  PageHeader,
  Panel,
  Pill,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatDate, humanizeEnum } from "@/lib/format";
import { roleLabel } from "@/lib/permissions";
import { useResource } from "@/lib/use-resource";
import { USER_STATUS_OPTIONS, USER_STATUS_TONE } from "./users-screen";

/** Workstream B: the 8 `UserRole` values an admin may assign, as of this
 * task. Deliberately an explicit list rather than `Object.values(UserRole)`
 * -- when Task 4 adds `SYSTEM` to that enum, this list stays exactly what
 * it is today without needing a matching edit here. */
const ASSIGNABLE_ROLES: readonly UserRole[] = [
  UserRole.CUSTOMER,
  UserRole.SHOP_OWNER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_COUNTER,
  UserRole.ADMIN,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
  UserRole.SUPPLIER,
];

const ROLE_OPTIONS = ASSIGNABLE_ROLES.map((value) => ({ value, label: roleLabel(value) }));

/** Workstream B: one user's detail -- profile plus the two things an
 * admin can force here that the person cannot do to themselves in any
 * other screen: change their platform role, or their account status.
 * Same `isAdmin` gate as `BusinessDetail`, not a per-shop permission. */
export function UserDetail({ userId }: { userId: string }): ReactNode {
  const { isAdmin } = useSession();
  if (!isAdmin) {
    return <ForbiddenState what="user management" />;
  }
  return <UserDetailBody userId={userId} />;
}

function UserDetailBody({ userId }: { userId: string }): ReactNode {
  const { user: actor } = useSession();
  const state = useResource(() => getApi().admin.getUser(userId), [userId]);
  return (
    <>
      <BackLink href="/admin/users">Users</BackLink>
      <PageHeader
        title={state.data?.name ?? "User"}
        actions={
          <LiveStatus
            lastUpdated={state.lastUpdated}
            refreshing={state.refreshing}
            onRefresh={state.reload}
          />
        }
      />
      <ResourceBoundary state={state} what="this user">
        {(data) => <UserBody data={data} isSelf={data.id === actor.id} onChanged={state.reload} />}
      </ResourceBoundary>
    </>
  );
}

function UserBody({
  data,
  isSelf,
  onChanged,
}: {
  data: AdminUser;
  isSelf: boolean;
  onChanged: () => void;
}): ReactNode {
  const roleRunner = useActionRunner(onChanged);
  const statusRunner = useActionRunner(onChanged);
  const [role, setRole] = useState<UserRole>(data.role);
  const [status, setStatus] = useState<UserStatus>(data.status);

  const wouldRemoveOwnAdmin = isSelf && role !== UserRole.ADMIN;
  const wouldDeactivateSelf =
    isSelf && (status === UserStatus.SUSPENDED || status === UserStatus.DELETED);

  return (
    <DetailGrid
      main={
        <>
          <Panel title="Profile" id="profile">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-muted">Email</dt>
                <dd>{data.email}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted">Since</dt>
                <dd>{formatDate(data.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted">Current role</dt>
                <dd>{roleLabel(data.role)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted">Current status</dt>
                <dd>
                  <Pill tone={USER_STATUS_TONE[data.status] ?? "neutral"}>
                    {humanizeEnum(data.status)}
                  </Pill>
                </dd>
              </div>
            </dl>
            {isSelf && <p className="mt-3 text-xs text-muted">This is your own account.</p>}
          </Panel>

          <Panel title="Role" id="role">
            {roleRunner.error !== null && (
              <Notice tone="danger" role="alert" className="mb-3">
                {roleRunner.error}
              </Notice>
            )}
            <form
              className="grid gap-3 text-sm sm:max-w-sm"
              onSubmit={(event) => {
                event.preventDefault();
                void roleRunner.run(() => getApi().admin.updateUserRole(data.id, role));
              }}
            >
              <SelectField
                label="Role"
                value={role}
                onChange={(value) => setRole(value as UserRole)}
                options={ROLE_OPTIONS}
              />
              {wouldRemoveOwnAdmin && (
                <p className="text-xs text-danger-fg">
                  You cannot change your own role away from admin -- another admin has to do this
                  for you.
                </p>
              )}
              <div>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={roleRunner.busy || role === data.role || wouldRemoveOwnAdmin}
                >
                  {roleRunner.busy ? "Saving…" : "Change role"}
                </Button>
              </div>
            </form>
          </Panel>
        </>
      }
      aside={
        <>
          <Panel title="Status" id="status">
            {statusRunner.error !== null && (
              <Notice tone="danger" role="alert" className="mb-3">
                {statusRunner.error}
              </Notice>
            )}
            <form
              className="grid gap-3 text-sm sm:max-w-sm"
              onSubmit={(event) => {
                event.preventDefault();
                void statusRunner.run(() => getApi().admin.updateUserStatus(data.id, status));
              }}
            >
              <SelectField
                label="Status"
                value={status}
                onChange={(value) => setStatus(value as UserStatus)}
                options={USER_STATUS_OPTIONS}
              />
              <p className="text-xs text-muted">
                Suspending or deleting an account also signs it out everywhere -- every refresh
                token it holds is revoked immediately.
              </p>
              {wouldDeactivateSelf && (
                <p className="text-xs text-danger-fg">
                  You cannot suspend or delete your own account -- another admin has to do this for
                  you.
                </p>
              )}
              <div>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={statusRunner.busy || status === data.status || wouldDeactivateSelf}
                >
                  {statusRunner.busy ? "Saving…" : "Save status"}
                </Button>
              </div>
            </form>
          </Panel>
        </>
      }
    />
  );
}
