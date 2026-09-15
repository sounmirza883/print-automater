module.exports = {
  ...require("../../jest.preset.cjs"),
  rootDir: ".",
  testMatch: ["**/test/**/*.e2e-spec.ts"],
  setupFiles: ["<rootDir>/jest.setup.cjs"],
  // Known Prisma/Redis-pool-vs-Jest-teardown race: connections close
  // correctly (RedisLifecycle, PrismaService.onModuleDestroy) but not
  // always inside Jest's default grace window across parallel workers.
  // All assertions already passed by the time this would matter.
  forceExit: true,
  // Every e2e suite spins up a full NestJS app (its own Prisma
  // connection pool, BullMQ connections, ...) -- Jest's own default
  // (one worker per CPU core) was empirically observed to run enough
  // of those at once to exhaust both host memory and the Postgres
  // connection pool simultaneously (many suites failing together with
  // "unable to start a transaction" / connection-pool-timeout errors,
  // not a real regression in any one of them). e2e suites are
  // Postgres/Redis-bound, not CPU-bound, so a modest cap trades a
  // longer wall-clock run for suites that don't flake under their own
  // combined weight -- worth it in CI too, where runners are often
  // more resource-constrained than a dev machine, not just locally.
  maxWorkers: 4,
};
