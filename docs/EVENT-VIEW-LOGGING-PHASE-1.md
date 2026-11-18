# Phase 1: event-detail view logging

Implemented application code and tests; no deployment or database migration applied. Sharing behavior and the monthly/overall score tables and calculation functions are unchanged.

## Changed files

- [server.js](../server.js): authenticated view endpoint and text-cast public event IDs.
- [lib/event-interactions.js](../lib/event-interactions.js): ID/body validation, event lookup and insert.
- [public/app.js](../public/app.js): detail-session guard and background logging.
- [public/events.js](../public/events.js): same detail-session guard and background logging.
- [tests/event-interactions-http.test.js](../tests/event-interactions-http.test.js): real HTTP handler with mocked Supabase.
- [tests/events-ui.test.js](../tests/events-ui.test.js): both real page scripts with document/HTTP fixtures.
- [tests/helpers/database.js](../tests/helpers/database.js): insert support in existing database fixture.
- [tests/browser.mjs](../tests/browser.mjs): Chromium coverage for both detail implementations; current compact home-card selectors.
- [supabase/review/event_interaction_log_inspection.sql](../supabase/review/event_interaction_log_inspection.sql): read-only metadata inspection for review.
- [supabase/migrations/20261118000000_event_detail_views.sql](../supabase/migrations/20261118000000_event_detail_views.sql): unapplied, guarded permissions proposal.
- [supabase/tests/event_view_checks.sql](../supabase/tests/event_view_checks.sql): unapplied local/staging permission checks.
- This implementation report.

## Trigger behavior

After valid details successfully render, each page makes one background POST if the dialog was closed or its previous detail ID differs. The guard is set synchronously before the request, so repeated openEvent calls and bookmark/RSVP redraws cannot create another request. Switching events and closing/reopening count again. Native dialog close events clear detail state, including Escape; a queued close event cannot clear an already reopened dialog. Returning from an event's map/reflection subview retains the same detail session.

Authenticated direct links count when details actually open: `/events?event=ID` and the existing legacy `/#event=ID`. Anonymous and demo browsing skip logging. Missing events do not log.

Requests are independent of plan/account UI error handling. HTTP failures produce a console warning with the status; network failures produce a generic console warning. Neither opens a popup, changes plan state, nor retries. The server logs sanitized error codes through its existing error handler. Ambiguous failures can lose a view; there is deliberately no retry that might duplicate a committed write. This does not provide idempotency for manually replayed API requests.

## API

`POST /api/events/:eventId/view`, JSON body `{}`, same-origin cookies and `X-Gather-Account` matching the verified user.

The existing session restoration verifies with Supabase Auth `getUser()` and supplies the per-user JWT client. The endpoint derives UserID solely from that verified user. Any supplied body fields, including ownership, interaction type, generated IDs, or timestamps, are rejected.

The ID must be a canonical positive decimal string within PostgreSQL signed bigint range. It remains a string in lookups and inserts. Public event-list reads now cast EventID to text in PostgREST before JSON parsing to avoid precision loss before opening details.

The insert sends exactly UserID, EventID, InteractionType=`view`, RecipientUserID=NULL. Supabase supplies InteractionID and created_at. No log SELECT/RETURNING is required.

Responses: 201 `{ "logged": true }`; 400 invalid ID/body; 401 absent/invalid session; 403 disallowed origin; 404 event unavailable; 405 unsupported method (Allow: POST); 409 missing/mismatched account header. Database errors return the existing sanitized 500 response; session-provider outages can return 503. No new credentials or authentication mechanism are used.

## Supabase review required

The existing table is reported by the user but is absent from repository schema definitions. Its actual defaults, constraints, triggers, grants and policies have not been independently verified. No authorized database metadata connection or local PostgreSQL client was available. Run the read-only inspection SQL and review its results with ChatGPT before deciding whether the migration is needed.

The proposed migration assumes the documented six columns, enabled RLS, sequence-generated InteractionID, timestamp default and nullable recipient. It stops if these expectations fail or *any existing policies* are present. Existing policies must be reviewed and reconciled separately; this file deliberately does not drop them or assume their effects.

For the no-existing-policy case, it removes table/column INSERT permissions from PUBLIC, anon and authenticated, then grants authenticated INSERT only for the four submitted columns and USAGE on the identity sequence. This prevents client-supplied generated IDs or timestamps. Its INSERT policy requires auth.uid() ownership, `view`, a null recipient and an existing event visible to the caller. It adds no SELECT/UPDATE/DELETE policy or grants and leaves RLS enabled. Existing event-read permissions remain necessary. No score object or function is referenced or altered.

The prepared local/staging SQL checks exercise actual database permissions with existing profiles/events and roll back inserted rows. Sequence increments are not rolled back. Review triggers before running even this rehearsal. Neither SQL file has been executed here.

## Validation

- `npm test`: 123 passed, 0 failed, 0 skipped.
- `npm run test:browser`: passed in Chromium with mocked APIs.
- `git diff --check`: passed.

Coverage includes verified identity rather than session-payload identity, missing/forged sessions, absent/mismatched account headers, cross-origin rejection, ID bounds, exact bigint strings, event existence, rejected forged body fields, database failures without leaked details, native Escape/reopen, event switching, bookmark/RSVP redraw suppression, shared links, anonymous/demo browsing, quiet HTTP/network failures, and existing application behaviors.

Remaining gate: review live database metadata, reconcile/apply approved permissions outside this change, and run local/staging SQL permission checks plus an integration smoke test against Supabase. Mock tests do not prove production RLS/defaults/trigger behavior. Nothing has been deployed.
