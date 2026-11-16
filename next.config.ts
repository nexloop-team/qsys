import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

// Tunnels for testing on a phone (ngrok, Cloudflare). `next dev` refuses its scripts and server
// actions to any address other than localhost unless it's listed here. Development only: in
// production these would let any tunnel site post to the app.
const DEV_TUNNELS =
  process.env.NODE_ENV === "production"
    ? []
    : ["*.ngrok-free.dev", "*.ngrok-free.app", "*.ngrok.app", "*.ngrok.io", "*.trycloudflare.com"];

const nextConfig: NextConfig = {
  cacheComponents: true,
  allowedDevOrigins: DEV_TUNNELS,
  experimental: {
    serverActions: { allowedOrigins: DEV_TUNNELS },
  },
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

// Sentry: readable stack traces need the source maps uploaded, which only happens when
// SENTRY_AUTH_TOKEN (and SENTRY_ORG / SENTRY_PROJECT) are set on Vercel. Without them it builds as usual.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  telemetry: false,
});
