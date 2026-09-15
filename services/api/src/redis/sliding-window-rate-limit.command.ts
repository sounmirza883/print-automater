import type Redis from "ioredis";

/** Atomic (single EVAL, no check-then-act race under concurrency):
 * evicts entries older than the window, counts what's left, and either
 * admits the request (adding it to the set) or reports how long until
 * the oldest entry ages out. A true sliding window (§85), not a fixed
 * window that resets and allows a burst at the boundary. */
const SLIDING_WINDOW_RATE_LIMIT_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return {1, limit - count - 1, 0}
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retryAfterMs = 0
if oldest[2] ~= nil then
  retryAfterMs = tonumber(oldest[2]) + window - now
end
return {0, 0, retryAfterMs}
`;

export interface RedisWithRateLimit extends Redis {
  /** Returns [allowed (1/0), remaining, retryAfterMs]. */
  slidingWindowRateLimit(
    key: string,
    now: number,
    windowMs: number,
    limit: number,
    member: string,
  ): Promise<[allowed: number, remaining: number, retryAfterMs: number]>;
}

export function registerSlidingWindowRateLimitCommand(client: Redis): RedisWithRateLimit {
  client.defineCommand("slidingWindowRateLimit", {
    numberOfKeys: 1,
    lua: SLIDING_WINDOW_RATE_LIMIT_LUA,
  });
  return client as RedisWithRateLimit;
}
