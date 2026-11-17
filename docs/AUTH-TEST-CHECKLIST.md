# Authentication verification checklist

Use fictional test details, a mailbox you control, and a test Supabase project
where possible. Never share passwords, complete email links, cookies, tokens
or secrets. Do not load-test the production app or send bulk email. Label each
result with environment, date and code commit; mock tests and live tests are
different evidence.

## Automated here

`npm test`: 109 passing tests, zero failures/skips in the development environment.
This includes existing events/friends regressions and these auth-focused checks:

| Area | Checked behavior |
| --- | --- |
| Input validation | Null, arrays, invalid types, forged owner fields, malformed/oversized JSON, bounded metadata, literal password whitespace, legacy short-password login |
| Credentials | Generic failed-login message, provider details removed, 503 outages, 429 throttles, no Auth tokens in JSON |
| Origin and redirects | Foreign/null origins rejected on write routes; reset destinations come from fixed configuration rather than request hosts |
| Sessions | Fresh-client verification, cookie rotation/flags, rejected malformed/duplicate/partial tokens, preserved cookies during provider outage |
| Signup | Exact profile/privacy metadata, string bigint interests, no photo/password in browser drafts, photo matching verified account, stale drafts preserve completed privacy |
| Recovery | Fixed recovery token type, encrypted cookie, no normal-cookie authorization, A/B account isolation, tampering/duplicate/expired cookies, email-link replay |
| Concurrency | Atomic ticket consume simulation, superseding tickets, one update under simultaneous attempts, safe retry only on explicit password rejection |
| Failure handling | Ledger failures block updates, ambiguous update outcome consumes ticket, sign-out failure reported truthfully |
| UI logic | Manual Continue, fragment removal, escaped identity, text-only errors, mismatch prevention, pending submit guard, password form cleared after success |
| Abuse guard | Per-worker account/IP thresholds and expiry; test explicitly records that separate workers do not share counters |

The tests mock the Supabase SDK, database RPC, or DOM as appropriate. They do
not prove that the real provider or database enforces those boundaries.

## Supplied checks you run

| Check | Required result |
| --- | --- |
| Entire SQL rehearsal, before migration | PASS followed by rollback; cleanup query returns null objects |
| Real migration and permissions query | RLS enabled, direct authenticated table read denied, anonymous function execution denied |
| `npm run test:browser` | Existing event/login/share regressions pass |
| `npm run test:friends:browser` | Existing friend flows pass |
| `npm run test:auth:browser` | Login/help, manual reset verification, refresh, mismatch, signup payload and mobile checks pass |

Chromium could not start in the development environment (process socket denied).
Database and real-browser results are therefore **pending your execution**.

## Live tests with accounts/mailboxes you control

1. **Signup/confirmation:** create a new private account with username/interests;
   before clicking the email, confirm its profile contains those choices. Confirm
   from a different browser and sign in. Repeat for an explicitly public account.
   Check no password is stored in public.User.Password or browser storage by
   these flows. Supabase Auth manages the password; the legacy column is unused.
2. **Atomic failure:** in a test project, attempt a duplicate username and an
   invalid/stale category through signup. Confirm no partial new Auth/profile
   account remains and the form can be retried with corrected details. Provider
   trigger errors can be generic; inspect Auth logs privately if needed.
3. **Ordinary login:** correct/wrong password, unknown address, unconfirmed
   address, uppercase/space-padded email, valid older short password, password
   manager/autofill, Enter submission, keyboard-only navigation and mobile.
   Failed credentials must not create a session. Do not trim passwords.
4. **Persistence/logout:** refresh, close/reopen browser, second tab, account
   switch, expired access token with refresh, invalid refresh token, explicit
   logout, Back button and a later protected request. Sensitive data must not
   remain accessible because a previous page was visible.
5. **Request email:** use a known address and an unused address. Both receive
   generic on-screen eligibility wording. Verify actual known-account delivery,
   spam folder, sender identity, SMTP quotas and confirmation resend. Do not
   infer existence from whether an email arrives in a mailbox you do not own.
6. **Reset end to end:** request a reset, open the email, check the address bar
   loses its fragment, click Continue, confirm the displayed account, enter a
   new password and sign in. Old password must fail; new one must work. No raw
   password/token/hash may appear in page URLs, logs or analytics.
7. **Reset links:** wrong/edited hash, expired hash, already consumed link,
   already completed reset, two new links and a confirmation link used at the
   reset endpoint. None may silently authenticate an unintended account.
   A mailbox scanner may consume a link; verify how your provider behaves.
8. **A/B isolation:** sign in as B in a browser, then open A's reset email in
   that browser. Recovery must clearly identify A. Change A's password; B's
   password and other-device login must remain unaffected. This browser's
   normal cookies clear after completion.
9. **Refresh/two tabs:** refresh the new-password form, open two copies, submit
   simultaneously. At most one use of a recovery ticket may change a password.
   A new verified link invalidates the older ticket. A normal login alone must
   not unlock `/api/auth/recovery/password`.
10. **Policy/provider failure:** test a weak/reused password, mismatched fields,
    slow/offline connection, lost response after submit, Auth outage and ticket
    RPC failure in a test environment. Errors must remain actionable and must
    not show a successful empty/signed-in state. After an uncertain reset, try
    signing in or request a new link rather than repeatedly submitting it.
11. **Revocation:** keep account A signed in on a second device before its reset.
    Check refresh/session revocation after reset and the remaining lifetime of
    already-issued JWTs. Record actual behavior against configured expiry; do
    not assume global sign-out instantly revokes every JWT.
12. **New account/session edge cases:** deleted/disabled account, email changed
    during recovery, missing profile, disabled signups and previously invited
    users. Test in an isolated project and record the provider's result. The
    migration does not repair pre-existing orphaned profiles/accounts.
13. **Lost identity:** forgot username (use email), forgot which email (password
    manager/previous Gather mail), lost mailbox (email-provider recovery or a
    documented identity-verified support process). No public name-to-email
    lookup or automatic ownership reassignment should be introduced.
14. **Optional photo/storage:** storage blocked, original signup tab closed,
    confirmation on another device, stale draft for another account, interrupted
    photo save. Critical names/username/visibility/interests must remain saved;
    only the optional photo may need choosing again.
15. **Production deployment:** exact APP_ORIGIN, Secure/HttpOnly cookie flags,
    no-store on account APIs, strict recovery CSP/referrer protection, framing
    denied, valid HTTPS and redirect allowlists. Restart/redeploy and test again
    on the public domain, not just localhost. Missing Supabase configuration
    must fail deployment rather than enable demo sign-in.
16. **Abuse/configuration review:** provider/platform rate limits across multiple
    workers, reset/resend mail abuse, CAPTCHA/bot controls if enabled, MFA and
    recovery policy, notification emails, session lifetime and account-deletion
    reauthentication. Perform bounded tests in a test environment with the owner.
    These are not proven by the local per-process limiter.
17. **Privilege/secret review:** anon cannot read profiles/tickets outside intended
    policies; authenticated A cannot modify B's plans/profile/relationships;
    service-role and recovery secrets are absent from Git and static assets.
    Audit the rest of the app's existing RLS policies and logs separately.

Record failures with redacted messages/statuses, the route (without a token),
browser and reproduction steps. Run regression tests again after any fixes.
There is no claim here that every possible attack has been excluded.
