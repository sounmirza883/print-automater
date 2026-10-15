const preset = require("../../jest.preset.cjs");

module.exports = {
  ...preset,
  rootDir: ".",
  // The standalone build copies package.json under .next, which jest-haste-map flags as a duplicate.
  modulePathIgnorePatterns: ["<rootDir>/.next"],
  transform: {
    // Same as the preset, plus the automatic JSX runtime so component tests
    // can render real .tsx components to static markup (react-dom/server).
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          verbatimModuleSyntax: false,
          jsx: "react-jsx",
          esModuleInterop: true,
        },
      },
    ],
  },
  moduleNameMapper: {
    // The app's own "@/..." alias (tsconfig paths), which Next resolves itself.
    "^@/(.*)$": "<rootDir>/src/$1",
    ...preset.moduleNameMapper,
  },
};
