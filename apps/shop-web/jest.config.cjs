const preset = require("../../jest.preset.cjs");

module.exports = {
  ...preset,
  rootDir: ".",
  moduleNameMapper: {
    // The app's own "@/..." alias (tsconfig paths), which Next resolves itself.
    "^@/(.*)$": "<rootDir>/src/$1",
    ...preset.moduleNameMapper,
  },
};
