import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

export default nextConfig;
