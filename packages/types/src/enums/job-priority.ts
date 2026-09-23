/** §17/18/18.8. `print_jobs.priority` is a plain `Int` column (15.4) --
 * these are the fixed points on that scale everything else compares
 * against, not a closed Postgres enum (staff-facing UI or a future
 * "priority score" tweak can still use any int in between without a
 * migration). Higher sorts first. */
export const JobPriority = {
  NORMAL: 0,
  HIGH: 10,
  URGENT: 20,
} as const;

export type JobPriority = (typeof JobPriority)[keyof typeof JobPriority];
