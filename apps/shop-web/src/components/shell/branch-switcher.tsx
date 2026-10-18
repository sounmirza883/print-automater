"use client";

import type { ReactNode } from "react";
import { Menu, MenuItem } from "@/components/menu";
import { useSession } from "@/components/session-provider";
import { Icon } from "@/components/shell/icons";
import { branchLabel } from "@/lib/staff-view";

/** Which branch the console is showing. A menu ("All branches" plus each branch) only for someone
 * who works at all branches of a business that has several; a branch-bound person sees their own
 * branch's name as a plain label; a one-branch business, and a platform admin, get nothing at all.
 * `compact` is the phone bar's one-line version. */
export function BranchSwitcher({ compact = false }: { compact?: boolean }): ReactNode {
  const { business, branches, branch, branchMode, selectBranch } = useSession();
  if (business === null || branchMode === "single") {
    return null;
  }

  const shell = compact
    ? "flex min-h-9 w-full min-w-0 items-center gap-2 text-sm"
    : "flex min-h-[44px] w-full min-w-0 items-center gap-2.5 rounded-lg border border-line bg-panel px-2.5";

  if (branchMode === "bound") {
    const name = business.branchName ?? branch?.name ?? "Your branch";
    return (
      <div className={shell}>
        <Icon name="pin" className="size-4 shrink-0 text-muted" />
        {compact ? (
          <span className="min-w-0 truncate">
            <span className="text-muted">Branch: </span>
            <span className="font-medium text-ink">{name}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-muted">Branch</span>
            <span className="block truncate text-sm font-medium text-ink">{name}</span>
          </span>
        )}
      </div>
    );
  }

  const current = branchLabel(branch?.name ?? null);
  const face = compact ? (
    <span className="min-w-0 flex-1 truncate text-left">
      <span className="text-muted">Branch: </span>
      <span className="font-medium text-ink">{current}</span>
    </span>
  ) : (
    <span className="min-w-0 flex-1 text-left">
      <span className="block text-xs text-muted">Branch</span>
      <span className="block truncate text-sm font-medium text-ink">{current}</span>
    </span>
  );

  return (
    <Menu
      label="Switch branch"
      className="min-w-0"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          className={`${shell} ${compact ? "rounded-md" : "hover:border-line-strong"}`}
        >
          <Icon name="pin" className="size-4 shrink-0 text-muted" />
          {face}
          <Icon name="chevrons" className="size-4 shrink-0 text-muted" />
        </button>
      )}
    >
      {(close) => (
        <>
          <BranchItem
            label="All branches"
            selected={branch === null}
            onSelect={() => {
              selectBranch(null);
              close();
            }}
          />
          {branches.map((candidate) => (
            <BranchItem
              key={candidate.id}
              label={candidate.name}
              selected={candidate.id === branch?.id}
              onSelect={() => {
                selectBranch(candidate.id);
                close();
              }}
            />
          ))}
        </>
      )}
    </Menu>
  );
}

function BranchItem({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}): ReactNode {
  return (
    <MenuItem onSelect={onSelect}>
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {selected && <Icon name="check" className="size-4 shrink-0" />}
    </MenuItem>
  );
}
