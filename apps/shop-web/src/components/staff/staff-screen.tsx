"use client";

import { useState, type ReactNode } from "react";
import type {
  BranchSummary,
  Page,
  ShopStaffListItem,
  StaffInvite,
} from "@print-automated/api-client";
import { Permission, UserRole } from "@print-automated/types";
import { Pager, SearchForm, SelectField, TextField } from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import { EditDialog } from "@/components/staff/edit-dialog";
import {
  Button,
  Cell,
  DataTable,
  EmptyState,
  LiveStatus,
  Notice,
  PageHeader,
  Panel,
  Pill,
  Row,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { roleLabel } from "@/lib/permissions";
import {
  ROLE_SUMMARY,
  branchLabel,
  branchOptions,
  branchToWire,
  canActOnMember,
  canCancelInvite,
  grantableRoles,
  looksLikeEmail,
  roleOptions,
  withInviteCopy,
} from "@/lib/staff-view";
import { useResource } from "@/lib/use-resource";

const PAGE = 25;
const INVITE_PAGE = 10;

type Dialog =
  | { kind: "invite" }
  | { kind: "cancel-invite"; invite: StaffInvite }
  | { kind: "role"; member: ShopStaffListItem }
  | { kind: "edit"; member: ShopStaffListItem }
  | { kind: "remove"; member: ShopStaffListItem };

/** PRD 47: who works at the business and what each person may do.
 * MANAGE_USERS (owner, manager). Only an owner can grant or change an
 * owner (the API's rule, mirrored so the option is not even offered), and
 * a business always keeps at least one owner (CANNOT_REMOVE_LAST_OWNER).
 *
 * People are added by email invitation only (23.18/23.23): the API emails a
 * code and nobody joins until they accept it with that address, so the
 * screen never says someone "has access" after inviting them. */
export function StaffScreen(): ReactNode {
  return (
    <RequirePermission permission={Permission.MANAGE_USERS} what="staff">
      <StaffBody />
    </RequirePermission>
  );
}

function StaffBody(): ReactNode {
  const { business, user, businessRole, permissions: myPermissions } = useSession();
  const shopId = business?.id ?? "";
  const myBranchId = business?.branchId ?? null;
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [branch, setBranch] = useState("");
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invitePage, setInvitePage] = useState(0);
  const invites = useResource(
    () =>
      getApi().shopStaff.listInvites(shopId, {
        branchId: branch || undefined,
        limit: INVITE_PAGE,
        offset: invitePage * INVITE_PAGE,
      }),
    [shopId, branch, invitePage],
    { intervalMs: 60_000, enabled: shopId !== "" },
  );
  const list = useResource(
    () =>
      getApi().shopStaff.list(shopId, {
        q: q || undefined,
        role: role || undefined,
        status: status || undefined,
        branchId: branch || undefined,
        limit: PAGE,
        offset: page * PAGE,
      }),
    [shopId, q, role, status, branch, page],
    { intervalMs: 60_000, enabled: shopId !== "" },
  );
  // A branch-bound person gets only their own branch back, so a one-location business (and a
  // branch manager) never sees any branch controls.
  const branchList = useResource(() => getApi().branches.list(shopId), [shopId], {
    enabled: shopId !== "",
  });
  const branches = branchList.data ?? [];
  const multiBranch = branches.length > 1;
  const editor = { permissions: myPermissions, role: businessRole, branchId: myBranchId };

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
            <Button
              variant="primary"
              onClick={() => {
                setNotice(null);
                setDialog({ kind: "invite" });
              }}
            >
              Invite a person
            </Button>
          </>
        }
      />
      {notice !== null && (
        <Notice tone="good" role="status" className="mb-4">
          {notice}
        </Notice>
      )}
      <PendingInvites
        data={invites.data}
        page={invitePage}
        onPage={setInvitePage}
        actorRole={businessRole}
        userId={user.id}
        showBranch={multiBranch}
        onCancel={(invite) => setDialog({ kind: "cancel-invite", invite })}
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
        {multiBranch && myBranchId === null && (
          <SelectField
            label="Branch"
            value={branch}
            onChange={(value) => {
              setBranch(value);
              setPage(0);
              setInvitePage(0);
            }}
            options={branches
              .filter((candidate) => candidate.archivedAt === null)
              .map((candidate) => ({ value: candidate.id, label: candidate.name }))}
            emptyLabel="Any branch"
          />
        )}
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
            <Panel flushOnPhone>
              <DataTable
                caption="Staff"
                head={[
                  "Name",
                  "Email",
                  "Role",
                  ...(multiBranch ? ["Branch"] : []),
                  "Status",
                  "Since",
                  "",
                ]}
                stackOnPhone
              >
                {data.items.map((member) => (
                  <Row key={member.id}>
                    <Cell className="font-medium">
                      {member.name}
                      {member.userId === user.id && (
                        <span className="ml-2 text-xs text-muted">(you)</span>
                      )}
                    </Cell>
                    <Cell label="Email" className="text-muted">
                      {member.email}
                    </Cell>
                    <Cell label="Role">
                      {roleLabel(member.role as UserRole)}
                      {member.customised && (
                        <span className="ml-2 align-middle">
                          <Pill tone="caution">Custom access</Pill>
                        </span>
                      )}
                    </Cell>
                    {multiBranch && (
                      <Cell label="Branch" className="text-muted">
                        {branchLabel(member.branchName)}
                      </Cell>
                    )}
                    <Cell label="Status">
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
                    </Cell>
                    <Cell label="Since" className="text-muted">
                      {formatDate(member.createdAt)}
                    </Cell>
                    <Cell className="text-right whitespace-nowrap">
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
                            onClick={() => setDialog({ kind: "edit", member })}
                          >
                            Edit
                          </Button>
                        </>
                      )}
                    </Cell>
                  </Row>
                ))}
              </DataTable>
              <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
            </Panel>
          )
        }
      </ResourceBoundary>
      {dialog?.kind === "invite" && (
        <InviteDialog
          shopId={shopId}
          actorRole={businessRole}
          actorBranchId={myBranchId}
          branches={branches}
          onClose={() => setDialog(null)}
          onSent={(email) => {
            setNotice(
              `Invitation sent to ${email}. They join once they accept it, signing in with that address.`,
            );
            invites.reload();
          }}
        />
      )}
      {dialog?.kind === "cancel-invite" && (
        <CancelInviteDialog
          invite={dialog.invite}
          onClose={() => setDialog(null)}
          onChanged={invites.reload}
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
      {dialog?.kind === "edit" && (
        <EditDialog
          member={dialog.member}
          isSelf={dialog.member.userId === user.id}
          editor={editor}
          branches={branches}
          onClose={() => setDialog(null)}
          onSaved={list.reload}
          onRemove={() => setDialog({ kind: "remove", member: dialog.member })}
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

function InviteDialog({
  shopId,
  actorRole,
  actorBranchId,
  branches,
  onClose,
  onSent,
}: {
  shopId: string;
  actorRole: UserRole | null;
  actorBranchId: string | null;
  branches: readonly BranchSummary[];
  onClose: () => void;
  onSent: (email: string) => void;
}): ReactNode {
  const runner = useActionRunner(NOTHING_TO_RELOAD);
  const roles = grantableRoles(actorRole);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>(UserRole.SHOP_COUNTER);
  const [touched, setTouched] = useState(false);
  // Where the person will work. A one-location business has nothing to choose (the API uses its
  // only branch), and an owner works at all branches, so the field only appears when it matters.
  const options = branchOptions({ role: actorRole, branchId: actorBranchId }, branches, {
    forRole: role,
  });
  const showBranch = branches.length > 1 && options.length > 0;
  const [branchChoice, setBranchChoice] = useState("");
  const branch = options.some((option) => option.value === branchChoice)
    ? branchChoice
    : (options[0]?.value ?? "");
  const emailError = looksLikeEmail(email) ? null : "Enter the person's email address.";
  return (
    <FormDialog
      title="Invite a person"
      submitLabel="Send invitation"
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() => {
        setTouched(true);
        if (emailError) return;
        const address = email.trim();
        void runner
          .run(async () => {
            try {
              await getApi().shopStaff.addByEmail(
                shopId,
                address,
                role,
                showBranch ? branchToWire(branch) : undefined,
              );
            } catch (error) {
              throw withInviteCopy(error);
            }
          })
          .then((outcome) => {
            if (outcome === "ok") {
              onSent(address);
              onClose();
            }
          });
      }}
    >
      <TextField
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        error={touched ? emailError : null}
      />
      <SelectField label="Role" value={role} onChange={setRole} options={roleOptions(roles)} />
      <RoleSummary role={role} />
      {showBranch && (
        <SelectField
          label="Branch"
          value={branch}
          onChange={setBranchChoice}
          options={options}
          disabled={options.length <= 1}
        />
      )}
      <p className="text-xs text-muted">
        We email them a code. They join only once they accept it, signing in with this address
        (anyone without an account creates one first). The code works for 7 days; inviting the same
        address again replaces it.
        {actorRole !== UserRole.SHOP_OWNER && " Only an owner can invite an owner."}
      </p>
    </FormDialog>
  );
}

/** Nothing on screen changes until the person accepts; the caller refreshes the list. */
const NOTHING_TO_RELOAD = (): void => undefined;

function PendingInvites({
  data,
  page,
  onPage,
  actorRole,
  userId,
  showBranch,
  onCancel,
}: {
  data: Page<StaffInvite> | null;
  page: number;
  onPage: (page: number) => void;
  actorRole: UserRole | null;
  userId: string;
  showBranch: boolean;
  onCancel: (invite: StaffInvite) => void;
}): ReactNode {
  // Shown only while something is pending; the staff list below carries loading/error states.
  if (data === null || data.total === 0) {
    return null;
  }
  return (
    <Panel
      title="Pending invitations"
      aside={`${data.total} waiting`}
      className="mb-4"
      flushOnPhone
    >
      <DataTable
        caption="Pending invitations"
        head={["Email", "Role", ...(showBranch ? ["Branch"] : []), "Sent", "Expires", ""]}
        stackOnPhone
      >
        {data.items.map((invite) => (
          <Row key={invite.id}>
            <Cell className="font-medium">
              {invite.email}
              {invite.invitedBy === userId && (
                <span className="ml-2 text-xs text-muted">(by you)</span>
              )}
            </Cell>
            <Cell label="Role">{roleLabel(invite.role as UserRole)}</Cell>
            {showBranch && (
              <Cell label="Branch" className="text-muted">
                {branchLabel(invite.branchName)}
              </Cell>
            )}
            <Cell label="Sent" className="text-muted">
              {formatDate(invite.createdAt)}
            </Cell>
            <Cell label="Expires" className="text-muted">
              {formatDate(invite.expiresAt)}
            </Cell>
            <Cell className="text-right whitespace-nowrap">
              {canCancelInvite(actorRole, invite.role) && (
                <Button variant="ghost" onClick={() => onCancel(invite)}>
                  Cancel
                </Button>
              )}
            </Cell>
          </Row>
        ))}
      </DataTable>
      <Pager page={page} pageSize={INVITE_PAGE} total={data.total} onPage={onPage} />
    </Panel>
  );
}

function CancelInviteDialog({
  invite,
  onClose,
  onChanged,
}: {
  invite: StaffInvite;
  onClose: () => void;
  onChanged: () => void;
}): ReactNode {
  const runner = useActionRunner(onChanged);
  return (
    <FormDialog
      title={`Cancel the invitation to ${invite.email}`}
      submitLabel="Cancel invitation"
      submitTone="danger"
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() =>
        void runner
          .run(() => getApi().shopStaff.revokeInvite(invite.id))
          .then((outcome) => outcome === "ok" && onClose())
      }
    >
      <p>
        Their code stops working straight away. If they have already accepted, nothing changes here:
        remove them from the staff list instead.
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
      {member.customised && (
        <p className="text-sm text-muted">
          {member.name} has custom access. Changing the role resets it to the new role&apos;s
          defaults.
        </p>
      )}
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
