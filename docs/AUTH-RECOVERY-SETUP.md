# Login and account recovery setup

This change is based on the supplied main archive at commit
`fb722920a88f29d9971334d42612022da36a79e9`. Apply the patch to that version, or
stop if `git apply --check` reports a conflict. Do not force a patch over newer work.

## What this changes

- Adds `/recover` for forgotten passwords, confirmation resends and account help.
- Validates account request shapes and bounds before calling Supabase. Login
  accepts existing shorter passwords; new/reset passwords need at least eight
  characters and must also satisfy the project's Supabase password policy.
- Normalizes credential failures without returning provider internals. Outages
  and throttles use 503 and 429 instead of pretending the password was wrong.
- Persists a new account's first/last name, username, visibility and interests
  in the Auth creation transaction. Confirmation in another browser therefore
  does not depend on sessionStorage. Duplicate usernames or invalid categories
  abort the whole account creation instead of leaving a partial profile.
- New legacy signup callers without a profile get a private, incomplete profile.
  Existing profiles and the `IsPrivate` column default are unchanged. The current
  two-step signup form's explicit Public/Private choice is honored.
- Optional photos remain a same-browser draft and finish after verified sign-in.
  If that draft is gone, add the photo in Profile settings. Passwords, Auth tokens
  and critical privacy/profile choices are not saved in that draft.
- Adds a dedicated, encrypted, HttpOnly recovery cookie and single-use database
  ticket. Normal login cookies cannot authorize this reset endpoint. A new reset
  supersedes the account's previous recovery ticket.
- Adds framing protection to server responses and stricter script/referrer/cache
  headers on the recovery page. Existing request-origin checks remain enforced.
- Adds a bounded, best-effort per-worker login/signup/email/recovery/deletion
  attempt guard. **This is not a distributed abuse-prevention service.**

No existing user, event, friendship, bookmark, RSVP or password is migrated or
deleted. The signup trigger is updated, so rehearse before applying it.

## 1. Start safely

From the existing repository, first check:

```bash
git status --short
git branch --show-current
```

With a clean main branch, update and create a branch:

```bash
git pull --ff-only origin main
git switch -c feature/auth-recovery-hardening
```

Check the downloaded patch, then apply it. Use the actual Downloads path:

```bash
git apply --check '/path/to/Gather-auth-recovery/gather-auth-recovery.patch'
git apply '/path/to/Gather-auth-recovery/gather-auth-recovery.patch'
git diff --check
npm test
```

An empty result from `git apply --check`, `git apply` or `git diff --check` means
that command succeeded. It does not mean the database or hosted configuration
has been updated. Do not run migrations automatically against production.

## 2. Rehearse the migration in Supabase

Open `supabase/tests/auth_recovery_rehearsal.sql`. Copy the **entire file** into
Supabase SQL Editor and run as the `postgres` owner. Use an off-peak moment; it
temporarily replaces functions inside a transaction and may briefly take locks.

It checks prerequisites and permissions, installs the proposed objects inside
one transaction, and tests copied functions against synthetic accounts. Every
fixture table has RLS enabled. Real account/profile/password/interest records
are not written. The final `ROLLBACK` removes all temporary changes.

Expected result:

```
PASS: auth recovery/signup rehearsal completed; all temporary changes will roll back.
```

Then run this separate read-only check:

```sql
select to_regclass('public."GatherRecoveryTicket"') as recovery_table,
       to_regnamespace('gather_auth_test') as temporary_test_schema;
```

Both should be null **before** the real migration. If the rehearsal fails, stop
and share the error, without passwords, email links, cookies or keys. Do not
remove its guards. If an editor leaves a failed transaction open, run `rollback;`.

This environment could not execute PostgreSQL; the rehearsal is supplied for
your Supabase project, not represented as an already-passed database test.

## 3. Apply the real migration once

Run the entire file below in SQL Editor:

`supabase/migrations/20261114000000_auth_recovery_signup.sql`

Expected: `Success. No rows returned`. It creates the recovery-ticket table with
RLS and no direct anon/authenticated table grants, grants authenticated users a
narrow caller-scoped RPC, and replaces the existing signup trigger function.
Its guards require the prior username-unique index, interests table and enabled
signup trigger, and check that the trigger body matches the repository baseline.
If it differs, stop and review your teammate’s live changes instead of overwriting them. The migration intentionally stops if installed twice.

Confirm:

```sql
select to_regprocedure('public.gather_recovery_ticket(text,text)') as recovery_function,
       (select relrowsecurity from pg_class
        where oid='public."GatherRecoveryTicket"'::regclass) as rls_enabled,
       has_table_privilege('authenticated','public."GatherRecoveryTicket"','SELECT') as direct_read_allowed,
       has_function_privilege('anon','public.gather_recovery_ticket(text,text)','EXECUTE') as anonymous_execute;
```

Expected: function present, RLS true, direct_read_allowed false,
anonymous_execute false. Do not hand-insert or reassign real users to test this.

## 4. Configure the server locally and on Vercel

Generate a fresh secret in your own terminal:

```bash
openssl rand -hex 32
```

Put its output only in `.env` locally and the server's Vercel environment
settings. Never paste it in chat, browser scripts, a public environment variable,
screenshots or Git. Use different secrets for development and production.

Required settings alongside the existing Supabase URL/publishable key:

```dotenv
AUTH_RECOVERY_SECRET=YOUR_GENERATED_SECRET
APP_ORIGIN=http://localhost:3000
```

For production use:

```dotenv
APP_ORIGIN=https://gather-is-401-product.vercel.app
```

Keep one stable secret per environment across workers/deployments. Rotating it
invalidates active recovery cookies; users can request a fresh link. A missing
secret disables recovery with a safe error. Production missing Supabase settings
now fails startup instead of exposing demo accounts. No service-role credential
is required for signup/login/recovery. Account deletion retains its separate,
optional server-only credential.

If you cannot access Vercel, the account owner must add these settings and
redeploy. Local testing can continue first; hosted recovery cannot work until
the hosted secret/origin are configured.

## 5. Configure Supabase email links

In Authentication URL configuration:

- Site URL: `https://gather-is-401-product.vercel.app`.
- Add exact Redirect URLs for `http://localhost:3000/recover`,
  `http://localhost:3000/login`,
  `https://gather-is-401-product.vercel.app/recover`, and
  `https://gather-is-401-product.vercel.app/login`.
- Keep any other required, reviewed app URLs. Avoid broad wildcards that accept
  unrelated hosts. Use separate configured origins for preview environments.

In the **Reset Password** email template, replace the reset link with:

```html
<a href="{{ .RedirectTo }}#token_hash={{ .TokenHash }}">Reset password</a>
```

Preserve the surrounding email wording/branding. This is the reset template,
not the confirmation/signup template. The existing confirmation link can keep
using `{{ .ConfirmationURL }}`. After confirmation, the user signs in normally;
the app does not trust URL access tokens to create its server login cookie.

The custom reset template is required. Its one-time hash goes in the URL
fragment so the initial page request does not send it in a URL query. The page
removes the fragment immediately and requires a deliberate Continue click
before verification, reducing accidental consumption by simple email previews.
It never treats signup/invite tokens as recovery tokens. It cannot prevent all
mail scanners from interacting with links; test your email provider.

Check SMTP/provider setup, recipient restrictions, delivery quotas, spam folder,
confirmation expiry, recovery expiry, password policy and security notification
settings. Keep email confirmation enabled unless your team intentionally
chooses a different account-verification policy.

## 6. Browser and live checks

Run locally:

```bash
npx playwright install chromium
npm run test:browser
npm run test:friends:browser
npm run test:auth:browser
npm start
```

The new browser suite uses mock HTTP APIs; the SQL rehearsal tests synthetic
database behavior. Neither proves real email delivery. See
`docs/AUTH-TEST-CHECKLIST.md` for live tests and remaining security checks.

The automated Node/HTTP/VM suite passed 109 tests in the development environment.
Chromium could not launch there because its process socket was denied, so the
three real-browser suites must be run on your Mac. Do not label them passed
until you have their output. The previous archive's UI test doubles were
updated for the avatar DOM and settings request; the event fixture now marks
its primary category explicitly.

## 7. Commit and review after checks pass

Check `git status --short` and inspect the diff. Stage only the files listed in
the patch package's `CHANGED-FILES.txt`, including the migration and tests.
Check `git diff --cached --check` and the staged diff. Make sure `.env` and real
keys are absent. Then commit, push this branch, and open a pull request into
main. Coordinate the hosted configuration and deployment with the owner.

Applying SQL in the dashboard does not record a Git commit. Committing the
migration does not execute it in Supabase. Both steps are needed. Do not run
the old migration again as a rollback. If a problem occurs, restore the code
through a reviewed Git revert; leave the new private ticket table in place
until a separate, reviewed database rollback is prepared.

## Security boundaries and residual risks

- The ticket table stores a random ticket's hash, not passwords or Auth tokens.
  Auth credentials live only inside the server-encrypted HttpOnly cookie.
- The RPC is callable by authenticated users for their own UUID. It does not
  mean only the web server can invoke it. A client cannot mint a valid encrypted
  recovery cookie without the separate server secret. Direct ticket table reads
  and writes are revoked. Never expose the secret or a service-role key.
- Consumption is atomic across workers. Explicit provider password rejections
  permit a retry; ambiguous transport/server failures leave the ticket consumed
  because the password may already have changed. Try signing in or request a
  new link. A successful password change cannot be rolled back by this app.
- Recovery deliberately ignores normal login cookies. If B is signed in while
  using A's link, the page identifies A and updates A. Completing recovery clears
  normal cookies in that browser; B may need to sign in again. It does not change
  B's password or revoke B's other devices.
- A successful reset requests global Supabase sign-out for the reset account.
  If this fails, the UI explicitly says session revocation could not be confirmed.
  Even successful refresh-token revocation does not guarantee every already-
  issued JWT is instantly unusable; test your expiry/session settings.
- Ordinary logout also clears this browser’s recovery cookie. Copied/stolen
  credentials are a separate revocation risk; keep reset links and cookies private.
- Ordinary login cookies still have the existing one-year Max-Age. Team decisions
  on shorter sessions, inactivity expiry, MFA and reauthentication remain open.
- Per-worker counters reset on cold starts and are not shared across Vercel
  workers. They use the socket address rather than trusting spoofable forwarded
  IP headers. Shared proxies can share an IP bucket. Configure and test provider
  limits and platform/WAF limits using a trusted client-IP source. Do not claim
  brute-force or email-abuse protection is complete based on these counters.
- A comprehensive script CSP for the legacy inline-script pages, third-party
  asset policy, accessibility and full production security review remain separate
  work. Recovery has a strict self-only script policy; other pages get framing
  and base-URL protection without breaking their existing scripts.

Official references: [password reset](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail),
[email templates](https://supabase.com/docs/guides/auth/auth-email-templates),
[verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp),
[updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser),
[sign-out](https://supabase.com/docs/reference/javascript/auth-signout).
