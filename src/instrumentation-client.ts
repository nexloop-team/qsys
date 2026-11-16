// Error tracking in the browser (Sentry). Off until NEXT_PUBLIC_SENTRY_DSN is set.
// No personal data: no IP addresses, cookies or form contents, and no session replays.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
  // A small share of page loads for speed readings; every error is still sent.
  tracesSampleRate: 0.05,
  // Noise from browser extensions and flaky venue Wi-Fi, not bugs in the app.
  ignoreErrors: ["ResizeObserver loop", "Failed to fetch", "NetworkError when attempting to fetch resource", "Load failed"],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
