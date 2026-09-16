import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import { AppException, REDIS_CLIENT } from "@print-automated/backend-shared";

const LOCK_TTL_MS = 10_000;

// Only deletes the key if it still holds the token this exact acquire
// call set -- without this, a lock held past its own TTL (a slow
// handler, a crashed process) could already have been re-acquired by
// someone else by the time the original holder's `finally` runs;
// releasing unconditionally would then delete *their* lock, not ours.
const RELEASE_IF_OWNER_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

interface RedisWithOrderLock extends Redis {
  releaseOrderLockIfOwner(key: string, token: string): Promise<number>;
}

/** §76's "Redis lock on the order" -- on top of (not instead of)
 * OrderStateMachine's own Postgres row lock, which already serializes
 * concurrent *transitions* on one order correctly by itself (proven by
 * 5.4's and 5.6's own concurrency tests). This lock's job is different:
 * it serializes the *whole webhook-processing step* -- idempotency
 * check, transition, payment-status update, marking the event
 * processed -- as one unit per order, so two different events for the
 * same order (a PAID and a FAILED arriving close together) can't
 * interleave their reads of "is this event already processed" against
 * each other. A contended lock fails fast (409, retryable) rather than
 * blocking the request open -- real PSPs redeliver on a non-2xx
 * response, so "come back shortly" is the correct behavior here, not a
 * long synchronous wait. */
@Injectable()
export class OrderLockService {
  private readonly redis: RedisWithOrderLock;

  constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    redis.defineCommand("releaseOrderLockIfOwner", {
      numberOfKeys: 1,
      lua: RELEASE_IF_OWNER_LUA,
    });
    this.redis = redis as RedisWithOrderLock;
  }

  async withLock<T>(orderId: string, fn: () => Promise<T>): Promise<T> {
    const key = `order-lock:${orderId}`;
    const token = randomUUID();

    const acquired = await this.redis.set(key, token, "PX", LOCK_TTL_MS, "NX");
    if (acquired !== "OK") {
      throw new AppException(
        HttpStatus.CONFLICT,
        "ORDER_LOCK_CONTENDED",
        "Another operation is already in progress for this order.",
        true,
      );
    }

    try {
      return await fn();
    } finally {
      await this.redis.releaseOrderLockIfOwner(key, token);
    }
  }
}
