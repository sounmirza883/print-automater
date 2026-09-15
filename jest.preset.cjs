/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          verbatimModuleSyntax: false,
        },
      },
    ],
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testMatch: ["**/src/**/*.test.ts", "**/src/**/*.spec.ts"],
  clearMocks: true,
  // Many packages start with zero unit tests and gain them in a later
  // sub-phase; an empty suite should not fail `pnpm -w test`.
  passWithNoTests: true,
};
