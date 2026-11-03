// Same-site path for post-login / email-link redirects, or the fallback.
// Rejects protocol-relative ("//x"), backslash ("/\x", which browsers read as "//x"),
// control characters, and anything that resolves to another origin.
export function safeRedirectPath(next: string | null | undefined, fallback: string) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const base = "http://placeholder.local";
    const url = new URL(next, base);
    if (url.origin !== base) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
