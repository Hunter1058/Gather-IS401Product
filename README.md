# Gather

Gather is a BYU campus events website built for IS 401. It brings listings from five BYU sources into one place so students can find activities, see when and where they happen, and make plans with friends.

## Run Gather locally

You’ll need Node.js 22 or later and access to a Supabase project.

1. Clone this repository and open the project folder in a terminal.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up the database:
   - **Team database:** Use the team’s Supabase project settings if the database is already set up.
   - **New database:** Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor. Run [`supabase/seed.sql`](supabase/seed.sql) if you want sample events for development.
   - **Existing database that predates RSVPs and bookmarks:** Apply the [event plans migration](supabase/migrations/20261102000000_event_plans.sql) if it hasn’t already been applied. See the [event plans setup and API guide](docs/EVENT-PLANS-SETUP.md) for details.

4. Copy [`.env.example`](.env.example) to `.env` in the project root. Set the Supabase project URL and the publishable key or legacy `anon` key:

   ```dotenv
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_KEY=your-publishable-key
   PORT=3000
   ```

5. Start the app:

   ```bash
   npm start
   ```

6. Open [Gather on localhost](http://localhost:3000).

Keep your local `.env` file out of Git.

## Verify the sign-in flow

1. Open Gather, select **Sign in**, and create an account.
2. Sign in and refresh the page. Your session should stay active.
3. Sign out and refresh again. You should remain signed out and be able to sign back in.

## Import event listings

The app reads events already stored in Supabase. Importing or refreshing listings is a separate step.

| Source | Script | How it runs |
| --- | --- | --- |
| BYU OnStage | [`scrapeOnstage.js`](scrapeOnstage.js) | Writes to Supabase when run. Set the month in the script. |
| BYU Athletics | [`scrapeAthletics.js`](scrapeAthletics.js) | Writes to Supabase when run. Set the month in the script. |
| BYU Library Events | [`scrapeLibrary.js`](scrapeLibrary.js) | Previews upcoming events. Add `--save` to write. |
| BYU Events Calendar | [`scrapeCalendar.js`](scrapeCalendar.js) | Accepts a month in `YYYY-MM` format. Add `--save` to write. |
| BYUSA | [`scrapeBYUSA.js`](scrapeBYUSA.js) | Accepts a month in `YYYY-MM` format. Add `--save` to write. |

The scrapers require Cheerio. If it isn’t listed in `package.json`, install it with `npm install cheerio`. To save imports, set `SUPABASE_SECRET_KEY` in your local `.env`. Keep this key private and use it only in the import scripts.

If you’re importing into a fresh database, the checked-in schema needs additional changes for the scrapers. The `Events` table needs `EventImage` as nullable `text`, `EventEndTime` as nullable `time`, and `SourceURL` as unique `text`. The team’s shared database already has these fields.

For example, preview the December 2026 BYUSA listings, then save them:

```bash
node scrapeBYUSA.js 2026-12
node scrapeBYUSA.js 2026-12 --save
```

Repeat imports update records with the same `SourceURL`. The same event can still appear more than once if different sources use different URLs.

## Accessibility

On November 4, 2026, the Gather homepage scored **100/100 for Accessibility** in a local Chrome Lighthouse audit, exceeding the project target of 90. The same run scored 96 for Performance, 100 for Best Practices, and 90 for SEO. These scores apply to the homepage tested.

## Code organization

| File or folder | Purpose |
| --- | --- |
| `server.js` | Starts the Node.js server, serves static files, and handles API routes. |
| `public/index.html` and `public/app.js` | Provide the homepage and shared app shell. |
| `public/events.html` and `public/events.js` | Implement the Events page at `/events`. |
| `public/login.html`, `public/signup.html`, and `public/auth.js` | Implement sign-in and account creation. |
| `public/styles.css` | Provides shared styles and responsive layouts. |
| `supabase/` | Contains the database schema, migrations, and optional seed data. |

Gather uses HTML, CSS, and JavaScript for the frontend, Node.js for the server, and Supabase for PostgreSQL and authentication. The event scrapers use Cheerio to read event listings from source pages.

## Database relationships

Gather stores user profiles in `User` and event listings in `Events`. The `Bookmark` and `RSVP` tables connect users to events. A linking table connects events to categories, allowing one event to belong to multiple categories. The `Friends` table connects one user profile to another.

![Entity relationship diagram for Gather’s events, user profiles, categories, bookmarks, RSVPs, and friendships](https://github.com/user-attachments/assets/b8ab864f-8352-45f6-9083-1221c3c2c010)

See the [database schema](supabase/schema.sql) and [event plans migration](supabase/migrations/20261102000000_event_plans.sql) for the table definitions.