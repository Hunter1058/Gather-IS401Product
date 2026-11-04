export function isSameOrigin(req, env = process.env) {
  const origin = req.headers.origin;
  if (!origin) return req.headers["sec-fetch-site"] !== "cross-site";
  // Vercel terminates TLS before the Node handler. The raw socket therefore
  // does not reliably describe the public request's HTTPS scheme.
  const protocol = env.VERCEL || req.socket?.encrypted ? "https" : "http";
  try {
    const expected = new URL(env.APP_ORIGIN || `${protocol}://${req.headers.host}`).origin;
    return origin === expected;
  } catch { return false; }
}
