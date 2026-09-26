"use client";

import { useState, type ReactNode } from "react";
import type { ShopStaffListItem } from "@print-automated/api-client";
import { Permission, UserRole } from "@print-automated/types";
import { Pager, SearchForm, SelectField, TextField } from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import {
  Button,
  DataTable,
  EmptyState,
  LiveStatus,
  PageHeader,
  Panel,
  Pill,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { roleLabel } from "@/lib/permissions";
import {
  ROLE_SUMMARY,
  canActOnMember,
  grantableRoles,
  isUuid,
  roleOptions,
} from "@/lib/staff-view";
import { useResource } from "@/lib/use-resource";

const PAGE = 25;

type Dialog =
  | { kind: "add" }
  | { kind: "role"; member: ShopStaffListItem }
  | { kind: "remove"; member: ShopStaffListItem };

/** PRD 47: who works at the business and what each person may do.
 * MANAGE_USERS (owner, manager). Only an owner can grant or change an
 * owner (the API's rule, mirrored so the option is not even offered), and
 * a business always keeps at least one owner (CANNOT_REMOVE_LAST_OWNER). */
export function StaffScreen(): ReactNode {
  return (
    <RequirePermission permission={Permission.MANAGE_USERS} what="staff">
      <StaffBody />
    </RequirePermission>
  );
}

function StaffBody(): ReactNode {
  const { business, user, businessRole } = useSession();
  const shopId = business?.id ?? "";
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const list = useResource(
    () =>
      getApi().shopStaff.list(shopId, {
        q: q || undefined,
        role: role || undefined,
        status: status || undefined,
        limit: PAGE,
        offset: page * PAGE,
      }),
    [shopId, q, role, status, page],
    { intervalMs: 60_000, enabled: shopId !== "" },
  );

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle={business?.name}
        actions={
          <>
            <LiveStatus
              lastUpdated={list.lastUpdated}
              refreshing={list.refreshing}
              onRefresh={list.reload}
            />
            <Button variant="primary" onClick={() => setDialog({ kind: "add" })}>
              Add a person
            </Button>
          </>
        }
      />
      <SearchForm
        label="Search name or email"
        value={draft}
        onChange={setDraft}
        onSubmit={() => {
          setQ(draft.trim());
          setPage(0);
        }}
      >
        <SelectField
          label="Role"
          value={role}
          onChange={(value) => {
            setRole(value);
            setPage(0);
          }}
          options={roleOptions(grantableRoles(UserRole.SHOP_OWNER))}
          emptyLabel="Any"
        />
        <SelectField
          label="Status"
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(0);
          }}
          options={[
            { value: "ACTIVE", label: "Active" },
            { value: "SUSPENDED", label: "Suspended" },
            { value: "REMOVED", label: "Removed" },
          ]}
          emptyLabel="Current (not removed)"
        />
      </SearchForm>
      <ResourceBoundary state={list} what="staff">
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title={q || role || status ? "No one matches" : "No staff yet"}>
              {q || role || status
                ? "Try different filters."
                : "Add the people who work at this business."}
            </EmptyState>
          ) : (
            <Panel>
              <DataTable caption="Staff" head={["Name", "Email", "Role", "Status", "Since", ""]}>
                {data.items.map((member) => (
                  <tr key={member.id}>
                    <td className="px-4 py-2 font-medium">
                      {member.name}
                      {member.userId === user.id && (
                        <span className="ml-2 text-xs text-muted">(you)</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted">{member.email}</td>
                    <td className="px-4 py-2">{roleLabel(member.role as UserRole)}</td>
                    <td className="px-4 py-2">
                      <Pill
                        tone={
                          member.status === "ACTIVE"
                            ? "good"
                            : member.status === "SUSPENDED"
                              ? "caution"
                              : "neutral"
                        }
                      >
                        {member.status === "ACTIVE"
                          ? "Active"
                          : member.status === "SUSPENDED"
                            ? "Suspended"
                            : "Removed"}
                      </Pill>
                    </td>
                    <td className="px-4 py-2 text-muted">{formatDate(member.createdAt)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {member.status !== "REMOVED" && canActOnMember(businessRole, member.role) && (
                        <>
                          <Button
                            variant="ghost"
                            onClick={() => setDialog({ kind: "role", member })}
                          >
                            Change role
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => setDialog({ kind: "remove", member })}
                          >
                            Remove
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </DataTable>
              <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
            </Panel>
          )
        }
      </ResourceBoundary>
      {dialog?.kind === "add" && (
        <AddDialog
          shopId={shopId}
          actorRole={businessRole}
          onClose={() => setDialog(null)}
          onSaved={list.reload}
        />
      )}
      {dialog?.kind === "role" && (
        <RoleDialog
          member={dialog.member}
          actorRole={businessRole}
          onClose={() => setDialog(null)}
          onSaved={list.reload}
        />
      )}
      {dialog?.kind === "remove" && (
        <RemoveDialog
          member={dialog.member}
          onClose={() => setDialog(null)}
          onSaved={list.reload}
        />
      )}
    </>
  );
}

function RoleSummary({ role }: { role: string }): ReactNode {
  return <p className="text-xs text-muted">{ROLE_SUMMARY[role] ?? ""}</p>;
}

function AddDialog({
  shopId,
  actorRole,
  onClose,
  onSaved,
}: {
  shopId: string;
  actorRole: UserRole | null;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const runner = useActionRunner(onSaved);
  const roles = grantableRoles(actorRole);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<string>(UserRole.SHOP_COUNTER);
  const [touched, setTouched] = useState(false);
  const idError = !isUuid(userId)
    ? "Paste the person's user ID (they must already have an account)."
    : null;
  return (
    <FormDialog
      title="Add a person"
      submitLabel="Add to business"
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() => {
        setTouched(true);
        if (idError) return;
        void runner
          .run(() => getApi().shopStaff.add(shopId, userId.trim(), role))
          .then((o) => o === "ok" && onClose());
      }}
    >
      <TextField
        label="User ID"
        value={userId}
        onChange={setUserId}
        error={touched ? idError : null}
        mono
      />
      <SelectField label="Role" value={role} onChange={setRole} options={roleOptions(roles)} />
      <RoleSummary role={role} />
      <p className="text-xs text-muted">
        Adding someone who was removed before restores them with this role.
        {actorRole !== UserRole.SHOP_OWNER && " Only an owner can make someone an owner."}
      </p>
    </FormDialog>
  );
}

function RoleDialog({
  member,
  actorRole,
  onClose,
  onSaved,
}: {
  member: ShopStaffListItem;
  actorRole: UserRole | null;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const runner = useActionRunner(onSaved);
  const [role, setRole] = useState(member.role);
  return (
    <FormDialog
      title={`Change role for ${member.name}`}
      submitLabel="Change role"
      busy={runner.busy}
      error={runner.error}
      disabled={role === member.role}
      onCancel={onClose}
      onSubmit={() =>
        void runner
          .run(() => getApi().shopStaff.changeRole(member.id, role))
          .then((o) => o === "ok" && onClose())
      }
    >
      <p>
        Now: <strong>{roleLabel(member.role as UserRole)}</strong>. The new role applies to their
        next request, at this business only.
      </p>
      <SelectField
        label="New role"
        value={role}
        onChange={setRole}
        options={roleOptions(grantableRoles(actorRole))}
      />
      <RoleSummary role={role} />
    </FormDialog>
  );
}

function RemoveDialog({
  member,
  onClose,
  onSaved,
}: {
  member: ShopStaffListItem;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const runner = useActionRunner(onSaved);
  return (
    <FormDialog
      title={`Remove ${member.name}`}
      submitLabel="Remove from business"
      submitTone="danger"
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() =>
        void runner
          .run(() => getApi().shopStaff.remove(member.id))
          .then((o) => o === "ok" && onClose())
      }
    >
      <p>
        {member.name} loses access to this business straight away. Their account and history are
        kept, and you can add them again later. A business must always keep at least one owner.
      </p>
    </FormDialog>
  );
}
