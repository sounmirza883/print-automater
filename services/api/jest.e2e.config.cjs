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
};
