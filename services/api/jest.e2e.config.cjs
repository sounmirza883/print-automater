module.exports = {
  ...require("../../jest.preset.cjs"),
  rootDir: ".",
  testMatch: ["**/test/**/*.e2e-spec.ts"],
  setupFiles: ["<rootDir>/jest.setup.cjs"],
};
