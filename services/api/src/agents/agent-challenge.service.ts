import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS_CLIENT } from "@print-automated/backend-shared";

const CHALLENGE_TTL_SECONDS = 60;

function challengeKey(deviceId: string): string {
  return `agent-challenge:${deviceId}`;
}

/** §75's "server nonce -> agent signature" step. Redis-backed (not
 * the database) -- this is a short-lived, single-use value, the same
 * shape as the order lock (6.5) rather than anything that needs to
 * survive a restart. */
@Injectable()
export class AgentChallengeService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async issue(deviceId: string): Promise<string> {
    const nonce = randomBytes(32).toString("base64url");
    await this.redis.set(challengeKey(deviceId), nonce, "EX", CHALLENGE_TTL_SECONDS);
    return nonce;
  }

  /** Single-use: deleted on read so a signature can never be replayed
   * against the same nonce twice, even if it leaked. */
  async consume(deviceId: string): Promise<string | null> {
    const key = challengeKey(deviceId);
    const nonce = await this.redis.get(key);
    if (nonce === null) {
      return null;
    }
    await this.redis.del(key);
    return nonce;
  }
}
