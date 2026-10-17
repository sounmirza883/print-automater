"use client";

import { useState, type ReactNode } from "react";
import type { ShopStaffListItem } from "@print-automated/api-client";
import { Permission, UserRole } from "@print-automated/types";
import { CheckField } from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { Button } from "@/components/ui";
import { getApi } from "@/lib/api";
import { roleLabel } from "@/lib/permissions";
import { PERMISSION_GROUPS, disabledReason, isCustom, toggled } from "@/lib/permission-groups";

/** Per-person access: the role's defaults, with individual permissions ticked on or off. The
 * API decides what is allowed (nobody gives what they lack, owners are untouchable, nobody edits
 * themselves, business settings stay with owners); the panel mirrors that so a line that would
 * be refused is locked with the reason. Removing someone lives here too, below the access list. */
export function EditDialog({
  member,
  isSelf,
  editorPermissions,
  onClose,
  onSaved,
  onRemove,
}: {
  member: ShopStaffListItem;
  isSelf: boolean;
  editorPermissions: ReadonlySet<Permission>;
  onClose: () => void;
  onSaved: () => void;
  onRemove: () => void;
}): ReactNode {
  const runner = useActionRunner(onSaved);
  const current = new Set(member.permissions as Permission[]);
  const defaults = new Set(member.defaultPermissions as Permission[]);
  const [selected, setSelected] = useState<ReadonlySet<Permission>>(current);
  const isOwner = member.role === UserRole.SHOP_OWNER;
  const locked = isSelf || isOwner;
  const changed =
    selected.size !== current.size || [...selected].some((permission) => !current.has(permission));
  const matchesDefaults =
    selected.size === defaults.size &&
    [...selected].every((permission) => defaults.has(permission));

  return (
    <FormDialog
      title={`Edit ${member.name}`}
      submitLabel="Save access"
      busy={runner.busy}
      error={runner.error}
      disabled={locked || !changed}
      onCancel={onClose}
      onSubmit={() =>
        void runner
          .run(() => getApi().shopStaff.updateAccess(member.id, [...selected]))
          .then((outcome) => outcome === "ok" && onClose())
      }
    >
      <p>
        <strong>{roleLabel(member.role as UserRole)}</strong>. Tick what {member.name} can do at
        this business. Anything changed from the role&apos;s defaults is marked{" "}
        <span className="font-medium">custom</span>.
      </p>
      {locked && (
        <p className="text-sm text-muted">
          {isOwner
            ? "An owner always has full access, so there is nothing to edit."
            : "You cannot change your own access."}
        </p>
      )}
      {PERMISSION_GROUPS.map((group) => (
        <fieldset key={group.title} className="space-y-2">
          <legend className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">
            {group.title}
          </legend>
          {group.items.map((line) => {
            const reason = locked
              ? null
              : disabledReason(editorPermissions, current, line.permission);
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
