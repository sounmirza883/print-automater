"use client";

import type { ReactNode } from "react";
import { INPUT } from "@/components/form-kit";
import { getApi } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

/** 23.26: choose one of the business's operators by name. The list is the staff directory
 * narrowed to OPERATOR (id and display name only), which every staff role may read; a
 * directory read without a search term does not count against the search budget. The
 * API decides who is an operator here (by their role at this business, 23.25). */
export function OperatorPicker({
  shopId,
  value,
  onChange,
  emptyLabel,
  label = "Operator",
  className = INPUT,
  labelClassName = "grid gap-1 text-sm font-medium",
}: {
  shopId: string;
  value: string;
  onChange: (operatorId: string) => void;
  /** The empty choice's label ("Any", "Nobody"). */
  emptyLabel: string;
  label?: string;
  className?: string;
  labelClassName?: string;
}): ReactNode {
  const operators = useResource(
    () => getApi().shopStaff.directory(shopId, { role: "OPERATOR", limit: 100 }),
    [shopId],
    { enabled: shopId !== "" },
  );

  if (operators.data === null) {
    return (
      <p className="text-sm text-muted">
        {operators.error !== null ? "Could not load operators." : "Loading operators…"}
      </p>
    );
  }
  const items = operators.data.items;
  // Keep a chosen id selectable even if it is not on this page (e.g. from a shared link).
  const missing = value !== "" && !items.some((item) => item.userId === value);
  return (
    <label className={labelClassName}>
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={className}
      >
        <option value="">{emptyLabel}</option>
        {missing && <option value={value}>Selected operator</option>}
        {items.map((item) => (
          <option key={item.userId} value={item.userId}>
            {item.name}
          </option>
        ))}
      </select>
      {items.length === 0 && (
        <span className="text-xs font-normal text-muted">
          No one works here as an operator yet.
        </span>
      )}
    </label>
  );
}
