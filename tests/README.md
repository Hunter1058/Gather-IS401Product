# Gather

A campus events website styled using the supplied **Frosted Campus Glass** guide. The app keeps the **Gather** name and uses plain HTML, CSS, and JavaScript with a Node.js server and an optional Supabase connection. There is no React, Tailwind, or frontend build framework.

## Run on your Mac

Install Node.js 22.9 or newer, extract this project, then open Terminal in the `gather` folder:

```bash
npm ci
cp .env.example .env
npm start
```

Open **http://localhost:3000**. With the Supabase fields blank, Gather runs in demo mode. Demo login: **student / gather123**. A separate `byu-event-mockup.html` file is a self-contained design preview; the project folder is the development source.

## Tech stack

| Layer                 | Technology | Purpose                                                                               |
| --------------------- | ---------- | ------------------------------------------------------------------------------------- |
| Structure             | HTML       | Page shell, semantic forms, navigation, and dialogs                                   |
| Presentation          | CSS        | Semantic OKLCH tokens, glass surfaces, gradients, responsive layouts                  |
| Frontend              | JavaScript | Events, calendar navigation, filtering, bookmarks, RSVPs, surveys                     |
| Backend               | Node.js    | Static file serving, JSON API, validation, session cookies, Supabase requests         |
| Database and accounts | Supabase   | PostgreSQL event data, Auth, and per-user saved state protected by row-level security |

Lucide supplies the stroke icons. Fonts load through HTML `<link>` elements from Google Fonts, with sans-serif fallbacks. The Lucide runtime and license are included locally, so icons do not need a CDN.

## Connect Supabase

1. Create/select a Supabase project.
2. Run **supabase/schema.sql** in its SQL editor.
3. Run **supabase/seed.sql** to add illustrative event listings. Dates are based on the date the seed is executed. Only run this sample seed in a development database.
4. In `.env`, set your project URL and **publishable key** (a legacy anon key also works):

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

5. Restart Node. The footer shows the connected mode.
6. Create an account using email and password. If email confirmation is enabled in Supabase, confirm the email before signing in. Configure Supabase Auth’s Site URL/redirect URLs for your deployment. The app uses password sign-in after confirmation; it does not automatically sign in from an email link.

No credentials are included, and no live Supabase project was provisioned or changed. The supplied schema and connection code are ready to configure. Do not use a service-role or secret key: the server intentionally uses each signed-in user’s Supabase session so database policies remain effective.

## Project files

- `public/index.html` — HTML shell, font links, scripts.
- `public/styles.css` — style-guide tokens and responsive component styles.
- `public/app.js` — frontend screens, demo data, and API integration.
- `public/vendor/` — locally bundled Lucide runtime and license.
- `server.js` — Node HTTP server and authenticated API.
- `supabase/schema.sql` — database tables, indexes, grants, and RLS policies.
- `supabase/seed.sql` — sample events, with BYU Provo timezone timestamps.
- `tests/` — API and browser regression checks.
- `.env.example` — configuration template; `.env` is excluded from Git.

## Data and authentication behavior

In demo mode, browser local storage retains bookmarks, RSVPs, attendance, reminder preferences, survey responses, fictional friends, and interests. Demo accounts are local demonstrations only and share that browser’s planning state.

With Supabase configured, the event catalog comes from PostgreSQL. Auth uses Supabase email/password accounts. Node holds access and refresh tokens in server memory; the browser receives an opaque HttpOnly, SameSite cookie. User IDs are obtained from Supabase’s verified user response, never from a submitted state payload. The `user_state` table stores planning data as a JSONB document keyed to the authenticated user. RLS permits each user to read and write only their own row. Event records are publicly readable, but event creation/editing is restricted to database administrators; no creation interface exists.

Personal plan changes are queued through the API. If syncing fails, the footer offers a retry. Guests can browse; connected-mode personal actions require sign-in. Demo browser data is not automatically copied into a real account.

The memory session store is appropriate for this single-process class project. Restarting the server signs users out; saved database plans remain. Before a multi-instance deployment, replace the in-memory session and rate-limit stores with shared storage. For HTTPS hosting, set `NODE_ENV=production` and `APP_ORIGIN=https://your-domain` so cookies are Secure and write requests are restricted to that origin. Set the public origin explicitly when running behind a proxy.

## Preserved features

Home flyer carousel with pause/previous/next controls; event list; month/day calendar; search; combined date/category/location/club/major/food/free/spiritual filters; bookmarks and past saved events; RSVP/cancellation; past attendance; editable satisfaction surveys; interest-based recommendations; fictional friend list; event sharing; calendar-file reminders; event details; location links; account screens; empty and error states.

The original Won’t Haves remain excluded: custom event creation, group voting, messaging, and multiple-language support.

## Prototype boundaries

- Listings and friend activity are samples, not verified BYU events or real social connections. Friend selections are saved, but no real invitation or social graph is implemented.
- RSVP is a saved attendance intention, not an organizer ticket or capacity reservation.
- Ratings are private reflections, not reports sent to an organizer.
- Reminder selection downloads an `.ics` file. Import it in a calendar app to activate alerts; changing the selection does not edit an already imported calendar entry.
- Maps open a building search in Google Maps; no embedded map or room-level position is claimed.
- Sharing copies event details and a link when hosted. Local HTML previews copy useful text without a machine-specific path.
- General BYU links are used because sample events have no official event URLs.
- Password recovery, email delivery configuration, and production monitoring are outside this redesign.

## Design implementation

The supplied guide’s colors are defined once as semantic CSS variables in OKLCH. Components use those variables for the full-page indigo/aqua/lavender gradient, translucent surfaces, primary actions, category banners, and modal overlays. Space Grotesk is used for display text; Inter is used for controls and body text. Navigation, pills, event rows, detail panels, and avatars follow the guide. Reduced-motion preferences stop the automatic carousel and minimize transitions.

## Verification

Run server checks with `npm test`. Browser checks use Playwright; run `npx playwright install chromium` once, then `npm run test:browser`. Live Supabase credentials are intentionally not required for demo tests. A simulated Supabase API test checks session handling and user-scoped requests; it does not replace testing RLS against your actual project. After configuration, create two test users and confirm each account sees only its own saved plans.

Reference documentation: [Supabase Auth](https://supabase.com/docs/guides/auth), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), and [Securing your data](https://supabase.com/docs/guides/database/secure-data).
