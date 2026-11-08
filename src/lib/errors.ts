// Errors from browser-side Supabase calls, worded for people at the counter. When the internet
// drops, the client reports the browser's own text ("TypeError: Failed to fetch"), which means
// nothing to staff. Database errors are already written for people and pass through.
export function friendlyError(
  error: { message?: string } | null | undefined,
  fallback = "Something went wrong. Try again.",
) {
  const message = error?.message?.trim() ?? "";
  if (!message) return fallback;
  if (/failed to fetch|networkerror|load failed|network request failed|fetch failed|timed? ?out/i.test(message)) {
    return "No internet connection. Check it and try again. Nothing was saved.";
  }
  if (/jwt expired|invalid jwt|refresh token|not authenticated/i.test(message)) {
    return "You've been logged out. Reload the page and log in again.";
  }
  return message;
}
