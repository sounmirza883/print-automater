import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static marketing site: no API calls, no workspace packages.
  output: "standalone",
};

export default nextConfig;
