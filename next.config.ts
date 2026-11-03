import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Team moved under Settings.
  async redirects() {
    return [{ source: "/team", destination: "/settings/team", permanent: true }];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
