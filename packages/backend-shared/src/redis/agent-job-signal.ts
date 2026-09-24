import type Redis from "ioredis";

/** The per-device Redis list an agent's long-poll (`GET /agents/jobs?wait=N`)
 * blocks on. Shared by the API (new job accepted / reassigned) and the worker
 * (failover / recovery moved a job onto that agent's printer), so both sides
 * always agree on the key. */
export function agentJobSignalKey(deviceId: string): string {
  return `agent-job-signal:${deviceId}`;
}

/** A wake-up nudge only: the long-poll re-reads the database for what is really
 * QUEUED, so a lost or trimmed signal costs latency, never correctness. Trimmed
 * so a long-offline agent cannot grow the list without bound. */
export async function signalAgentDevice(redis: Redis, deviceId: string): Promise<void> {
  const key = agentJobSignalKey(deviceId);
  await redis.multi().lpush(key, "1").ltrim(key, 0, 49).expire(key, 3600).exec();
}
