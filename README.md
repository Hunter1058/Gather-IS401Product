# Gather

Gather is a BYU campus events website built for IS 401. It brings listings from five BYU sources into one place so students can find activities, see when and where they happen, and make plans with friends.

## Run Gather locally

You’ll need Node.js 22 or later, access to a Supabase project, and a Google Gemini API key if you plan to use automatic event categorization.

1. Clone this repository and open the project folder in a terminal.

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up the database:
   - **Team database:** Use the team's existing Supabase project settings if the database is already configured.
   - **New database:** Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor. Run [`supabase/seed.sql`](supabase/seed.sql) if you want sample events for development.
   - **Existing database that predates RSVPs and bookmarks:** Apply the [event plans migration](supabase/migrations/20261102000000_event_plans.sql) if it hasn't already been applied. See the [event plans setup and API guide](docs/EVENT-PLANS-SETUP.md) for details.
   - **Event categories:** Ensure the `EventCategory` and `Event_Category_Linking_Table` tables are configured for AI categorization.

4. Configure environment variables:

   Copy [`.env.example`](.env.example) to `.env` in the project root.

   ```bash
   cp .env.example .env
   ```

   Add the following configuration values:

   ```dotenv
   # Supabase connection
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_KEY=your-publishable-key

   # Supabase privileged keys
   SUPABASE_SECRET_KEY=your-secret-key
   SUPABASE_AI_SECRET_KEY=your-ai-secret-key

   # Google Gemini AI
   GEMINI_API_KEY=your-gemini-api-key

   # Local server
   PORT=3000
   ```

   **Environment variable purposes:**

   | Variable | Description |
   |---|---|
   | `SUPABASE_URL` | URL of the Supabase project used by Gather. |
   | `SUPABASE_KEY` | Supabase publishable or legacy anon key for the application. |
   | `SUPABASE_SECRET_KEY` | Privileged key used by event scraping and import scripts. |
   | `SUPABASE_AI_SECRET_KEY` | Privileged key used to update event categories in Supabase. |
   | `GEMINI_API_KEY` | Google Gemini API key used for automatic event categorization. |
   | `PORT` | Port used by the local server (default: 3000). |

   The Gemini and privileged Supabase keys are only needed for the scripts that use them. They are not required simply to browse Gather locally.

   **Security:** Never commit `.env` or expose privileged Supabase and Gemini keys in frontend JavaScript. Keep these credentials private.

5. Start the application:

   ```bash
   npm start
   ```

6. Open [Gather on localhost](http://localhost:3000).

7. Optional — Run AI event categorization:

   Gather uses Google Gemini to analyze event titles and descriptions and assign categories from the existing Supabase database.

   ```bash
   node --env-file=.env categorize-events.js
   ```

   The script processes uncategorized events in batches. Run it again to process additional events.

   Events with uploaded flyers display their original images. Events without flyers can display category-specific stock images stored in Supabase Storage.

   Automatic categorization is also configured through `.github/workflows/categorize-events.yml`, which runs every six hours and supports manual execution. The GitHub repository must have the following Actions secrets configured:

   - `SUPABASE_URL`
   - `SUPABASE_AI_SECRET_KEY`
   - `GEMINI_API_KEY`

## Verify the sign-in flow

1. Open Gather, select **Sign in**, and create an account.
2. Sign in and refresh the page. Your session should remain active.
3. Open **Profile settings** and update your name, profile picture, or event interests.
4. Verify that your saved profile picture appears in the navigation bar across Discover, Events, Calendar, Friends, and Settings.
5. Refresh the website to confirm your profile settings persist.
6. Sign out and refresh again. You should remain signed out and be able to sign back in.

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