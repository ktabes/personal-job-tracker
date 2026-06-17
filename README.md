# Discord Job-Search Tracker Bot

Personal Discord bot for monitoring configurable company/protocol career pages and tracking applications as a lightweight CRM. It posts scheduled reports, lets you mark roles as applied, updates and closes applications through Discord interactions, persists state in SQLite, and regenerates a Google-Sheets-ready CSV after every application change.

The target table starts empty. Add your own targets with `/targets add`.

## Design Rules

- Applications are archived, never deleted. Closing sets `status = closed` and keeps the row permanently.
- Applications are independent of the live scrape. Applying to an open role copies company, title, and URL into `applications`.
- SQLite is the source of truth. The CSV is regenerated from `applications` and is never read as writable state.
- Fetch failures are reported as failures, not as "No matching roles."
- Manual-only targets report as manual and are never fetched.

## Tech Stack

- TypeScript on Node.js 20+
- `discord.js` slash commands, buttons, string select menus, and modals
- SQLite with `better-sqlite3`
- `node-cron` scheduled reports
- Railway persistent volume for SQLite and CSV

## Environment

Copy `.env.example` to `.env`.

```bash
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CHANNEL_ID=
DISCORD_GUILD_ID=
DATABASE_PATH=/data/job-search-tracker.sqlite
CSV_EXPORT_PATH=/data/applications.csv
REPORT_TIMEZONE=America/New_York
```

`DISCORD_GUILD_ID` is optional but recommended for personal use because guild-scoped slash commands update quickly. Without it, commands are registered globally and can take longer to appear.

For local development, you can set:

```bash
DATABASE_PATH=./data/job-search-tracker.sqlite
CSV_EXPORT_PATH=./data/applications.csv
```

## Local Setup

```bash
npm install
cp .env.example .env
npm run check
npm run smoke:fetchers
npm run commands:register
npm run dev
```

The service also registers slash commands on startup, so `npm run commands:register` is optional if you are starting the bot right away.

## Discord Commands

- `/run` - scan active targets and post the focused low+mid open roles report to `DISCORD_CHANNEL_ID`.
- `/run mode:low` - post only low-level/accessibly titled roles.
- `/run mode:mid` - post only mid-level roles.
- `/run mode:high` - post only high-level/senior roles.
- `/run mode:all` - post every matching role, including senior/leadership roles.
- `/applications` - show active applications with Update and Close controls.
- `/history limit:<N>` - show recent closed applications.
- `/keywords` - show include/exclude terms and open add/remove modals.
- `/targets list` - list targets with last-check status.
- `/targets add` - add a target.
- `/targets disable id:<id>` - disable a target without deleting it.
- `/export` - download the current CSV export.

## Adding Targets

Examples:

```text
/targets add name:"Example Co" check_type:ats_greenhouse board_slug:"exampleco" careers_url:"https://boards.greenhouse.io/exampleco"
/targets add name:"Example Protocol" check_type:ats_ashby board_slug:"exampleprotocol" careers_url:"https://jobs.ashbyhq.com/exampleprotocol"
/targets add name:"Example Startup" check_type:ats_lever board_slug:"examplestartup" careers_url:"https://jobs.lever.co/examplestartup"
/targets add name:"Manual Flow" check_type:manual careers_url:"mailto:careers@example.com"
```

How to find common ATS slugs:

- Greenhouse: look for `boards.greenhouse.io/{slug}` or `boards-api.greenhouse.io/v1/boards/{slug}/jobs`.
- Ashby: look for `jobs.ashbyhq.com/{slug}` or `api.ashbyhq.com/posting-api/job-board/{slug}`.
- Lever: look for `jobs.lever.co/{slug}`.

Use `manual` for Notion pages, email-only flows, GitHub PR application flows, Twitter-only posts, or anything that should not be scraped. Use `html` only when the page exposes JSON-LD `JobPosting` data; otherwise the bot marks the check as failed rather than guessing.

## Importing the Crypto/Data Target Seed

This repo includes seed files from the 2026-06-16 crypto/data target inventory:

```text
data/targets/crypto-data-api-verified-2026-06-16.json
data/targets/crypto-data-manual-2026-06-16.json
```

The API seed contains the 57 API-verified Greenhouse, Ashby, and Lever rows. Aave is included as `ats_lever`; the fetcher detects `jobs.eu.lever.co` and uses Lever's EU API host for that target.

The manual seed contains the 33 manual/API-failed targets. These are imported as `manual` so the bot reports them as manual-only checks instead of pretending they can be auto-scraped.

Import the seed into the configured SQLite database:

```bash
npm run targets:import:all
```

The importer skips rows already present with the same name, check type, slug, and careers URL.

Railway also runs this import before starting the bot, so a fresh volume is seeded automatically on first deploy.

## Report Suppression And Apply Safety

Open-role reports use a daily report window in `REPORT_TIMEZONE`. The window starts at 9:00 AM America/New_York and runs until 8:59:59 AM the next day. A role shown once in that window is not shown again in later `/run` calls or the 5 PM same-day scan. At 9:00 AM the next day, the window changes and eligible roles can appear again.

Clicking `Apply` copies the role into `applications`, removes that live role from `open_roles`, records the role identity in `applied_roles`, and regenerates the CSV. That applied role is excluded from future reports even if the company keeps the posting open.

## Open Roles Refresh

`open_roles` is a current snapshot table. Every scan preserves prior `first_seen_at` values in memory, clears `open_roles`, and inserts the current successful scrape results. Failed and manual targets do not insert stale roles. Application records are copied into `applications` at apply time and are never joined back to `open_roles` for core application data.

## Keyword Matching

Seeded include terms:

```text
data engineer, analytics engineer, data analyst, data scientist, business intelligence, bi engineer, analytics, machine learning engineer, ml engineer, data infrastructure, analyst, product analyst, business analyst, operations analyst, strategy analyst, risk analyst, research analyst, growth analyst, financial analyst, reporting analyst, insights analyst, customer insights, data operations, data quality, business operations, strategy & operations, strategy and operations, growth associate, operations associate, research associate, data associate
```

Seeded exclude terms:

```text
data center, data entry, facilities, sales, recruiter
```

A role matches when its title contains at least one include term and no exclude term, case-insensitive.

## CSV Export

The CSV is regenerated after every `applications` write and by `/export`. It includes all active and closed applications ordered newest to oldest:

```text
company,role_title,apply_url,date_applied,status,sub_status,heard_back_date,interview_dates,decision_date,reason,notes
```

## Railway Deployment

1. Create a Railway service from this project directory.
2. Attach a persistent volume and mount it at `/data`.
3. Set environment variables:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_CHANNEL_ID`
   - `DISCORD_GUILD_ID` if using guild-scoped commands
   - `DATABASE_PATH=/data/job-search-tracker.sqlite`
   - `CSV_EXPORT_PATH=/data/applications.csv`
   - `REPORT_TIMEZONE=America/New_York`
4. Deploy with the included `railway.json`.

The schedules are timezone-aware and do not rely on Railway server local time:

- `0 9 * * 1-5` in `America/New_York` for the open roles report.
- `0 17 * * 1-5` in `America/New_York` for the active applications digest.

## Verification

Useful checks:

```bash
npm run check
npm run build
npm run smoke:fetchers
```

`npm run smoke:fetchers` calls live example boards for Greenhouse, Ashby, and Lever and prints each status plus matching-role count. These examples are test-only and are not inserted into your `targets` table.
