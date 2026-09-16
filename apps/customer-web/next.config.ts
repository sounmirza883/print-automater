import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // §12.6: traces the actual require/import graph into a minimal
  // .next/standalone/ folder (its own node_modules subset, not this
  // whole workspace's) -- what makes a Docker image for this app small
  // and self-contained instead of copying the entire monorepo's
  // node_modules into the runtime image.
  output: "standalone",
  // Workspace packages consumed as raw TS source (main: "./src/index.ts",
  // no build step -- see packages/design-tokens and packages/api-client's
  // package.json) live outside this app's own src tree. Without this,
  // webpack treats them as opaque externals and never applies its own
  // .js-specifier-to-.ts-file resolution to their internal imports,
  // which is exactly the "Module not found: Can't resolve './tokens.js'"
  // failure this app hit before adding it. @print-automated/types is
  // NOT listed here -- it's build-to-dist (like packages/config/
  // validation), so webpack sees ordinary compiled JS and needs no
  // special handling for it.
  transpilePackages: ["@print-automated/design-tokens", "@print-automated/api-client"],
  webpack(config) {
    // Those packages' own source uses NodeNext-style ".js" specifiers on
    // relative imports (e.g. "./tokens.js" resolving to tokens.ts) --
    // required so Node's native ESM loader can run them directly
    // (services/api and services/worker depend on exactly that when
    // they consume a workspace package at runtime; changing it there
    // would break that, not fix this). Webpack doesn't do that mapping
    // by default, so tell it to: a ".js" specifier that doesn't
    // literally exist should also try ".ts"/".tsx".
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".js", ".ts", ".tsx"],
    };
    return config;
  },
};

export default nextConfig;
