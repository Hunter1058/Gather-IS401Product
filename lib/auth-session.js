// All Supabase calls stay on the server. Cookies carry tokens across workers;
// no process-local session map or service-role key is needed.
const ACCESS = "gather_access";
const REFRESH = "gather_refresh";
const MAX_AGE = 60 * 60 * 24 * 365;

export function authSessions(makeClient, { secure = false } = {}) {
  function cookie(name, value, maxAge) {
    return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  }

  function read(req, name) {
    const matches = (req.headers.cookie || "").split(";")
      .map(part => part.trim()).filter(part => part.startsWith(name + "="));
    if (matches.length !== 1) return null;
    try {
      const value = decodeURIComponent(matches[0].slice(name.length + 1));
      return value && value.length <= 3800 ? value : null;
    } catch { return null; }
  }

  function save(res, session) {
    const access = session?.access_token, refresh = session?.refresh_token;
    if (!access || !refresh || encodeURIComponent(access).length > 3800 || encodeURIComponent(refresh).length > 3800)
      throw Object.assign(Error("Unable to store this account's session. Contact the project administrator."), { status: 500 });
    res.setHeader("Set-Cookie", [
      cookie(ACCESS, access, MAX_AGE), cookie(REFRESH, refresh, MAX_AGE),
      cookie("gather_session", "", 0), // remove obsolete in-memory session IDs
    ]);
  }

  function clear(res) {
    res.setHeader("Set-Cookie", [ACCESS, REFRESH, "gather_session"].map(name => cookie(name, "", 0)));
  }

  async function restore(req, res) {
    const access_token = read(req, ACCESS), refresh_token = read(req, REFRESH);
    if (!access_token || !refresh_token) return null;
    const client = makeClient();
    const { data, error } = await client.auth.setSession({ access_token, refresh_token });
    if (error) {
      if (error.status >= 500 || error.name === "AuthRetryableFetchError")
        throw Object.assign(Error("Account service is temporarily unavailable. Try again."), { status: 503 });
      clear(res);
      return null;
    }
    if (!data.session) { clear(res); return null; }
    // Never authorize using a user ID or decoded JWT supplied by the browser.
    const verified = await client.auth.getUser();
    if (verified.error) {
      if (verified.error.status >= 500 || verified.error.name === "AuthRetryableFetchError")
        throw Object.assign(Error("Account service is temporarily unavailable. Try again."), { status: 503 });
      clear(res);
      return null;
    }
    if (!verified.data.user) { clear(res); return null; }
    if (data.session.access_token !== access_token || data.session.refresh_token !== refresh_token)
      save(res, data.session);
    return { client, user: verified.data.user };
  }

  return { save, clear, restore };
}
