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
- `/run category:<category>` - scan only one category, such as `crypto-data`, `crypto-markets`, `data-platforms`, or `melbourne-data`.
- `/applications` - show active applications with Update and Close controls.
- `/application add` - manually track an application from a role found outside the scan.
- `/history limit:<N>` - show recent closed applications.
- `/keywords` - show include/exclude terms and open add/remove modals.
- `/targets list` - list targets with last-check status.
- `/targets add` - add a target.
- `/targets disable id:<id>` - disable a target without deleting it.
- `/targets outreach id:<id> status:<status>` - track manual/outreach status for a target.
- `/export` - download the current CSV export.

## Adding Targets

Examples:

```text
/targets add name:"Example Co" check_type:ats_greenhouse board_slug:"exampleco" careers_url:"https://boards.greenhouse.io/exampleco"
/targets add name:"Example Protocol" check_type:ats_ashby board_slug:"exampleprotocol" careers_url:"https://jobs.ashbyhq.com/exampleprotocol"
/targets add name:"Example Startup" check_type:ats_lever board_slug:"examplestartup" careers_url:"https://jobs.lever.co/examplestartup"
/targets add name:"Example Workable" check_type:ats_workable board_slug:"exampleco" careers_url:"https://apply.workable.com/exampleco/"
/targets add name:"Example Recruitee" check_type:ats_recruitee board_slug:"exampleco" careers_url:"https://exampleco.recruitee.com/"
/targets add name:"Example SmartRecruiters" check_type:ats_smartrecruiters board_slug:"ExampleCo" careers_url:"https://jobs.smartrecruiters.com/ExampleCo"
/targets add name:"Example Personio" check_type:ats_personio board_slug:"exampleco" careers_url:"https://exampleco.jobs.personio.de/xml?language=en"
/targets add name:"Melbourne Example" check_type:ats_lever board_slug:"exampleco" careers_url:"https://jobs.lever.co/exampleco" category:"melbourne-data" location_filter:"melbourne, victoria, vic, remote australia"
/targets add name:"Manual Flow" check_type:manual careers_url:"mailto:careers@example.com"
```

How to find common ATS slugs:

- Greenhouse: look for `boards.greenhouse.io/{slug}` or `boards-api.greenhouse.io/v1/boards/{slug}/jobs`.
- Ashby: look for `jobs.ashbyhq.com/{slug}` or `api.ashbyhq.com/posting-api/job-board/{slug}`.
- Lever: look for `jobs.lever.co/{slug}`.
- Workable: look for `apply.workable.com/{slug}`.
- Recruitee: look for `{slug}.recruitee.com`.
- SmartRecruiters: look for `jobs.smartrecruiters.com/{companyIdentifier}`.
- Personio: look for `{slug}.jobs.personio.de/xml`.

Use `location_filter` when a target should only show matching roles in certain locations. It is a comma-separated, case-insensitive substring filter applied to the parsed job location after title keyword matching. A Melbourne-focused target can use `melbourne, victoria, vic, remote australia`.

Use `manual` for Notion pages, email-only flows, GitHub PR application flows, Twitter-only posts, or anything that should not be scraped. Use `html` only when the page exposes JSON-LD `JobPosting` data; otherwise the bot marks the check as failed rather than guessing.

## Importing the Crypto/Data Target Seed

This repo includes seed files from the 2026-06-16 crypto/data target inventory:

```text
data/targets/crypto-data-api-verified-2026-06-16.json
data/targets/crypto-data-manual-2026-06-16.json
data/targets/expanded-watchlist-2026-06-17.json
data/targets/melbourne-data-2026-06-17.json
```

The API seed contains the 57 API-verified Greenhouse, Ashby, and Lever rows. Aave is included as `ats_lever`; the fetcher detects `jobs.eu.lever.co` and uses Lever's EU API host for that target.

The manual seed contains the 33 manual/API-failed targets. These are imported as `manual` so the bot reports them as manual-only checks instead of pretending they can be auto-scraped.

The expanded watchlist adds 36 curated targets using Workable, Recruitee, SmartRecruiters, and Personio. It intentionally avoids very broad/noisy boards by default. If you want those, add them manually with a category and use `/run category:<category>`.

The Melbourne watchlist adds API-verified Melbourne/Victoria-focused targets using a `location_filter`, so broad boards only report jobs whose parsed location lines up with Melbourne, Victoria, VIC, or remote-Australia wording. Use `/run category:melbourne-data` to run that lane on demand.

Import the seed into the configured SQLite database:

```bash
npm run targets:import:all
```

The importer skips rows already present with the same name, check type, slug, and careers URL.

Railway also runs this import before starting the bot, so a fresh volume is seeded automatically on first deploy.

## Report Suppression And Apply Safety

Open-role reports no longer suppress roles just because they appeared in an earlier run. If a role is still open and has not been applied to or hidden, it can appear again in later `/run` calls and scheduled reports.

Within each low/mid/high level section, role messages are grouped by continent first, then company, then role title.

Clicking `Apply` copies the role into `applications`, removes that live role from `open_roles`, records the role identity in `applied_roles`, and regenerates the CSV. That applied role is excluded from future reports even if the company keeps the posting open.

Each role report message has one `Apply` control and one `Hide` control. `Apply` opens a popup modal where you enter role numbers shown in the report, such as `1, 3, 5-7`. `Hide` opens a `Hide Role` popup with `Role Numbers`, then shows a `Hide Duration` dropdown with `7 Days`, `14 Days`, and `30 Days`; hidden roles are excluded from future reports until their suppression expires.

Use `/application add` for jobs found outside the bot's scan. It opens a modal for company, role title, apply URL, date applied, and notes. The resulting row is a normal active application, so it appears in `/applications`, can be updated or closed, and is exported to the CSV.

## Open Roles Refresh

`open_roles` is a current snapshot table. Every scan preserves prior `first_seen_at` values in memory, clears only the roles for the targets that were actually checked, and inserts the current successful scrape results for those targets. This allows `/run category:<category>` to refresh one category without wiping other categories from the snapshot. Failed and manual targets do not insert stale roles. Application records are copied into `applications` at apply time and are never joined back to `open_roles` for core application data.

## Manual Outreach

Manual-only targets can be tracked with a small outreach status record:

```bash
/targets outreach id:12 status:researching contact_url:"https://example.com/careers" notes:"Look for referral contact"
```

Statuses are `not_started`, `researching`, `contacted`, `applied`, and `paused`. This is target-level metadata only; application history still lives in `applications` and the CSV export.

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

`npm run smoke:fetchers` calls live example boards for Greenhouse, Ashby, Lever, Workable, Recruitee, SmartRecruiters, and Personio, then prints each status plus matching-role count. These examples are test-only and are not inserted into your `targets` table.
