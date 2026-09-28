import {
  humanizeEnum,
  isHeldByLatePrint,
  jobStatusTone,
  priorityLabel,
  type Tone,
} from "@print-automated/api-client";

export interface Badge {
  label: string;
  tone: Tone;
}

/** The short labels shown on a job, most important first: its status (with how long it has
 * been paused, when it is), a raised priority, and a late-print hold (23.33; the wording is
 * shared with shop-web, 23.31). */
export function jobBadges(
  job: {
    status: string;
    priority?: number;
    pausedAt?: string | null;
    blockedReason: string | null;
  },
  now: number = Date.now(),
): Badge[] {
  const paused = job.status === "PAUSED" && job.pausedAt !== undefined && job.pausedAt !== null;
  const badges: Badge[] = [
    {
      label: paused ? `Paused ${formatAge(job.pausedAt, now)}` : humanizeEnum(job.status),
      tone: jobStatusTone(job.status),
    },
  ];
  const priority = job.priority ?? 0;
  if (priority > 0) {
    badges.push({
      label: `${priorityLabel(priority)} priority`,
      tone: priority >= 20 ? "danger" : "caution",
    });
  }
  if (isHeldByLatePrint(job.blockedReason)) {
    badges.push({ label: "Held by late print", tone: "danger" });
  }
  return badges;
}

/** "3 min ago" style age of a timestamp. */
export function formatAge(iso: string | null | undefined, now: number = Date.now()): string {
  if (iso === null || iso === undefined) {
    return "";
  }
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  return `${Math.round(hours / 24)} d ago`;
}
