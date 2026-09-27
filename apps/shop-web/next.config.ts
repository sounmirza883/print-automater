import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const baseConfig: NextConfig = {
  // Same reasoning as customer-web: a minimal, self-contained
  // .next/standalone/ output for the Docker image.
  output: "standalone",
  // Workspace packages consumed as raw TS source (design-tokens,
  // api-client) live outside this app's src tree; see customer-web's
  // next.config.ts for the full explanation of this and the
  // extensionAlias below (NodeNext-style ".js" specifiers on ".ts" files).
  transpilePackages: ["@print-automated/design-tokens", "@print-automated/api-client"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".js", ".ts", ".tsx"],
    };
    return config;
  },
};

/** `next dev` writes to its own folder. `next build` replaces `.next` wholesale, and a dev
 * server still running on the old `.next` then fails with "Cannot find module './NNNN.js'"
 * (hit on 2026-09-27 when a build ran beside `pnpm dev`). Builds, `next start` and the Docker
 * image keep using `.next`. */
export default function nextConfig(phase: string): NextConfig {
  return phase === PHASE_DEVELOPMENT_SERVER ? { ...baseConfig, distDir: ".next-dev" } : baseConfig;
}
