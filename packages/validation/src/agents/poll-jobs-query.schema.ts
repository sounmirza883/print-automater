import { z } from "zod";

const MAX_WAIT_SECONDS = 25;

/** §9.7's `GET /agents/jobs?wait=25` -- a query param arrives as a
 * string, so `z.coerce.number()` before bounding it. Capped at 25s
 * server-side regardless of what the client asks for: a long-poll
 * exists to bound worst-case latency, not to let a slow client hold a
 * connection (and, since claim checks route through it too, a Node
 * event-loop turn) open indefinitely. */
export const pollJobsQuerySchema = z.object({
  wait: z.coerce.number().int().min(1).max(MAX_WAIT_SECONDS).optional().default(MAX_WAIT_SECONDS),
});

export type PollJobsQueryInput = z.infer<typeof pollJobsQuerySchema>;
