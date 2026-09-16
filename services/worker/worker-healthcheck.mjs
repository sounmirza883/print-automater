// §12.6: services/worker has no HTTP server (§2.6: BullMQ consumer
// only), so its HEALTHCHECK can't hit an endpoint the way the api
// image's own /v1/health does. A real ioredis PING against the same
// REDIS_URL the worker itself connects to is a genuine liveness
// signal (the worker is useless if it can't reach its queues), not
// just "is the process still running" -- which Docker/ECS already
// track without a HEALTHCHECK instruction at all.
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });

try {
  await redis.connect();
  await redis.ping();
  process.exit(0);
} catch {
  process.exit(1);
} finally {
  redis.disconnect();
}
