module.exports = {
  ...require("../../jest.preset.cjs"),
  rootDir: ".",
  // Expo Router puts app/, lib/, providers/, etc. at the project root
  // (not under src/, unlike this repo's other packages) -- see
  // tsconfig.json's own comment for why. Overriding the shared preset's
  // src/-scoped pattern here, not in jest.preset.cjs itself, since every
  // other package still follows the src/ convention.
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
  testPathIgnorePatterns: ["/node_modules/", "/.expo/"],
};
