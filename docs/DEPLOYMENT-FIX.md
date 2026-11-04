# Events and login deployment fix

## Findings from the supplied merged main ZIP

- `public/events.js` had `.map(([keyName,label)=>` instead of
  `.map(([keyName,label])=>`. This is a parse error: none of the Events page
  script can run, including its API requests and rendering.
- The origin guard defaulted to `http://<host>`. Browser requests from Vercel
  use HTTPS, so login/signup/bookmark/RSVP requests are rejected unless
  `APP_ORIGIN` happens to override that default correctly. The user's current
  environment-variable value was not available for inspection.
- Login stored the account client in a process-local Map, keyed by an opaque
  cookie. Other Vercel instances cannot restore that account. This is separate
  from incorrect credentials or a Supabase outage.
- The Events page waited for account state before fetching public events. A
  failed account request consequently hid otherwise available listings.

The user confirmed that the deployed health/configuration/events APIs worked
and that Discover displayed events. Direct access to the live site and GitHub
was blocked in the development environment, so findings were verified against
the supplied ZIP rather than live production logs.

## Changes

The syntax fix preserves the merged avatar/profile presentation and event
category relationships. Public events load independently of account state.
During an account-service failure, public events remain visible with a retry
notice and disabled personal controls; unconfirmed preferences are never
treated as successfully loaded empty data.

The origin guard uses HTTPS on Vercel while retaining an explicit `APP_ORIGIN`
override and cross-site request rejection. The serverless handler returns the
request promise so asynchronous work remains attached to its invocation.

Sessions use two HttpOnly, SameSite=Lax cookies: access and refresh tokens.
Cookies are Secure in production/on Vercel. Each authenticated request creates
an independent Supabase client, restores the tokens with `setSession`, and
verifies identity with `getUser`. Refreshed tokens are returned through cookies.
No new signing secret, service-role key, dependency, or database table is used.
The frontend still only calls the existing Node API; it never reads Auth tokens.

Sign-out clears the cookies and revokes the current refresh session through
Supabase. As with normal Supabase sessions, a copied access JWT can remain
valid until its expiry; clearing a browser cookie cannot revoke a JWT by itself.
The old `gather_session` cookie becomes obsolete. Sign in again after deploying.

The login-attempt counter is still best-effort per worker. Shared production
abuse limits should be configured through Vercel/Supabase rather than treating
this counter as a global rate limiter.

## Apply in the real repository

Start from a clean working tree. If `git status --short` lists existing changes,
preserve and review those before switching branches. Otherwise:

```sh
git switch main
git pull --ff-only
git switch -c fix/events-login-deployment
git apply --check /absolute/path/to/gather-events-login-fix.patch
git apply /absolute/path/to/gather-events-login-fix.patch
npm test
npm run test:browser
npm start
```

The patch is based on the newly supplied merged-main ZIP. If `git apply --check`
reports a conflict, stop and reconcile it; do not overwrite subsequent team
changes with the included full source folder.

Test locally with a known account: events render, login survives reload, saved
preferences persist, and accounts remain separate. No SQL needs to be run.
The patch does not change the previously applied migration or category keys.

After validation:

```sh
git add .env.example server.js lib/auth-session.js lib/request-origin.js public/events.js public/auth.js tests/auth-session.test.js tests/http.test.js tests/events-ui.test.js tests/saved-page.test.js tests/browser.mjs docs/DEPLOYMENT-FIX.md docs/EVENT-PLANS-SETUP.md
git diff --cached --check
git --no-pager diff --cached --stat
git commit -m "Fix event rendering and Vercel login sessions"
git push -u origin fix/events-login-deployment
```

Open a pull request targeting main. The package does not push, merge, or deploy
anything automatically.

## Vercel settings and deployment

In the existing Vercel project, Settings → Environment Variables, verify these
values for the Production environment. Keep the existing Supabase credentials
private; they do not need to be sent to anyone or committed to Git.

```text
SUPABASE_URL=https://rszzmjefzwnioeykcesl.supabase.co
SUPABASE_KEY=<existing public/publishable or legacy anon key>
APP_ORIGIN=https://gather-is-401-product.vercel.app
```

`APP_ORIGIN` is the application origin, not the Supabase URL or an `/events`
path. If Preview deployments have their own override, use the intended preview
origin or omit APP_ORIGIN for Preview so Vercel's HTTPS host is used. Do not
reuse the production override on a different preview hostname.

Keep the Supabase Auth Site URL set to the previously corrected
`https://gather-is-401-product.vercel.app`. Password recovery is outside this
patch and remains unimplemented.

After the PR is reviewed/merged, check that Vercel deploys the new main commit.
Changing environment variables requires a new deployment/redeployment. The
existing API routing is already working; do not replace the project's deployment
configuration as part of this fix.

## Production acceptance checks

1. `/api/health` returns `{ "ok": true }`, `/api/config` reports Supabase mode,
   and `/api/events` returns listings.
2. `/events` displays upcoming events when signed out, and calendar view works.
   If the API has only past events, add a real upcoming event through the team's
   established process; this patch does not remove the upcoming-date filter.
3. Sign in with a known account. Refresh and navigate between Discover, Events,
   and Saved. The account must remain signed in.
4. Bookmark and mark Going; reload and verify the database state. Unsave and
   cancel: bookmark disappears and RSVPGoing is false.
5. Sign out, use another account, and verify plan separation. Return to the first
   account and verify its saved state.
6. If login still fails, inspect browser Network → `/api/auth/login`: record the
   status and error message only. Never share passwords, cookies, Authorization
   headers, Auth links, or successful session tokens. A 403 origin error means
   APP_ORIGIN needs checking; a 400 credentials/confirmation error comes from
   Supabase; 5xx failures need the Vercel function logs.

## Validation and limits

The 21 native tests pass with fake Supabase/network responses. Coverage includes
the real HTTP handler, a second module/worker restoring the same cookies, two
accounts in parallel, forged cookies, refresh-cookie rotation, transient Auth
errors, origin checks, event controls, and visible listings during account
failures. Existing DOM fixtures now support the merged avatar's classList API.

The browser suite was extended for login/reload and account-service outages.
Its Chromium download was blocked here; run `npm run test:browser` on the Mac
where Chromium is already installed. Real Supabase/Vercel acceptance checks are
still required; no real credentials or production data were used here.

References:
- https://supabase.com/docs/reference/javascript/auth-setsession
- https://supabase.com/docs/reference/javascript/auth-getuser
- https://supabase.com/docs/guides/auth/sessions
- https://vercel.com/docs/functions
