"use client";

import { useState, type ReactNode } from "react";
import type { BranchSummary, ShopStaffListItem } from "@print-automated/api-client";
import { Permission, UserRole } from "@print-automated/types";
import { CheckField, SelectField } from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { Button } from "@/components/ui";
import { getApi } from "@/lib/api";
import { roleLabel } from "@/lib/permissions";
import { PERMISSION_GROUPS, disabledReason, isCustom, toggled } from "@/lib/permission-groups";
import {
  ALL_BRANCHES,
  branchLabel,
  branchOptions,
  branchToWire,
  withCurrentBranch,
} from "@/lib/staff-view";

/** Per-person branch and access: where they work, then the role's defaults with individual
 * permissions ticked on or off. The API decides what is allowed (nobody gives what they lack,
 * owners are untouchable, nobody edits themselves, business settings and "all branches" stay with
 * owners, a branch-bound manager only works within their own branch); the panel mirrors that so a
 * line that would be refused is locked with the reason. Removing someone lives here too, below. */
export function EditDialog({
  member,
  isSelf,
  editor,
  branches,
  onClose,
  onSaved,
  onRemove,
}: {
  member: ShopStaffListItem;
  isSelf: boolean;
  editor: {
    permissions: ReadonlySet<Permission>;
    role: UserRole | null;
    branchId: string | null;
  };
  branches: readonly BranchSummary[];
  onClose: () => void;
  onSaved: () => void;
  onRemove: () => void;
}): ReactNode {
  const runner = useActionRunner(onSaved);
  const current = new Set(member.permissions as Permission[]);
  const defaults = new Set(member.defaultPermissions as Permission[]);
  const [selected, setSelected] = useState<ReadonlySet<Permission>>(current);
  const startingBranch = member.branchId ?? ALL_BRANCHES;
  const [branch, setBranch] = useState(startingBranch);
  const isOwner = member.role === UserRole.SHOP_OWNER;
  const locked = isSelf || isOwner;
  // The person's current branch is always among the options so the select shows it as chosen,
  // even when this editor may not hand it out (all branches, for a manager who is not an owner).
  const options = withCurrentBranch(branchOptions(editor, branches, { forRole: member.role }), {
    value: startingBranch,
    label: branchLabel(member.branchName),
  });
  // A one-location business has nothing to choose, so it never sees the field.
  const showBranch = branches.length > 1 && !isOwner;
  const permissionsChanged =
    selected.size !== current.size || [...selected].some((permission) => !current.has(permission));
  const branchChanged = showBranch && branch !== startingBranch;
  const matchesDefaults =
    selected.size === defaults.size &&
    [...selected].every((permission) => defaults.has(permission));

  return (
    <FormDialog
      title={`Edit ${member.name}`}
      submitLabel="Save changes"
      busy={runner.busy}
      error={runner.error}
      disabled={locked || !(permissionsChanged || branchChanged)}
      onCancel={onClose}
      onSubmit={() =>
        void runner
          .run(() =>
            getApi().shopStaff.updateAccess(member.id, {
              ...(permissionsChanged ? { permissions: [...selected] } : {}),
              ...(branchChanged ? { branchId: branchToWire(branch) } : {}),
            }),
          )
          .then((outcome) => outcome === "ok" && onClose())
      }
    >
      <p>
        <strong>{roleLabel(member.role as UserRole)}</strong>. Choose where {member.name} works, and
        tick what they can do at this business. Anything changed from the role&apos;s defaults is
        marked <span className="font-medium">custom</span>.
      </p>
      {locked && (
        <p className="text-sm text-muted">
          {isOwner
            ? "An owner always has full access at every branch, so there is nothing to edit."
            : "You cannot change your own access."}
        </p>
      )}
      {showBranch && (
        <SelectField
          label="Branch"
          value={branch}
          onChange={setBranch}
          options={options}
          disabled={locked || options.length <= 1}
          hint={
            editor.branchId !== null
              ? "You manage this branch, so people can only work here."
              : "Choose “All branches” only for someone who covers every location (owners only)."
          }
        />
      )}
      {PERMISSION_GROUPS.map((group) => (
        <fieldset key={group.title} className="space-y-2">
          <legend className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">
            {group.title}
          </legend>
          {group.items.map((line) => {
            const reason = locked
              ? null
              : disabledReason(editor.permissions, current, line.permission);
            const custom = isCustom(line.permission, selected, defaults);
            return (
              <CheckField
                key={line.permission}
                label={line.label}
                checked={selected.has(line.permission)}
                disabled={locked || reason !== null}
                onChange={(on) => setSelected((prev) => toggled(prev, line.permission, on))}
                hint={
                  [line.hint, custom ? "Custom" : null, reason].filter(Boolean).join(" · ") ||
                  undefined
                }
              />
            );
          })}
        </fieldset>
      ))}
      {!locked && (
        <Button
          variant="ghost"
          onClick={() => setSelected(new Set(defaults))}
          disabled={matchesDefaults}
        >
          Reset to role defaults
        </Button>
      )}
      <div className="mt-2 space-y-2 border-t border-line pt-4">
        <p className="text-sm font-medium">Remove from business</p>
        <p className="text-xs text-muted">
          {member.name} loses access to this business straight away. Their account and history are
          kept.
        </p>
        <Button variant="danger" onClick={onRemove}>
          Remove {member.name}…
        </Button>
      </div>
    </FormDialog>
  );
}
