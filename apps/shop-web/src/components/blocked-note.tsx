import Link from "next/link";
import type { ReactNode } from "react";
import { describeBlockedReason } from "@/lib/job-status";

const BOX = {
  danger: "border-danger/50 bg-danger-soft",
  accent: "border-accent/50 bg-accent-soft",
  caution: "border-caution/50 bg-caution-soft",
  good: "border-caution/50 bg-caution-soft",
  neutral: "border-caution/50 bg-caution-soft",
} as const;

/** Why a job is parked, in plain words, with what to do and where. Used
 * on the dashboards, the queue and the order screen so the same reason
 * always reads the same. */
export function BlockedNote({ reason }: { reason: string | null }): ReactNode {
  const blocked = describeBlockedReason(reason);
  if (blocked === null) {
    return null;
  }
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${BOX[blocked.tone]}`}>
      <p className="font-medium">{blocked.label}</p>
      <p className="text-xs">{blocked.hint}</p>
      {blocked.action !== undefined && (
        <Link
          href={blocked.action.href}
          className="mt-1 inline-block text-xs font-medium underline"
        >
          {blocked.action.label}
        </Link>
      )}
    </div>
  );
}
