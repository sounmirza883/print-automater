// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/*.config.js",
      "**/*.config.cjs",
      "**/*.setup.cjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // CLI-style scripts where console output IS the intended UX, unlike
    // application code where structured logging (Pino, 1.8) is the norm.
    files: ["**/prisma/seed.ts", "**/scripts/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  eslintConfigPrettier,
);
