# Remy

A private nutrition journal with marathon-training context, built with Next.js, Supabase Postgres/Auth/Storage, and Vercel. The current emphasis is Eat to Live food logging, WHOOP exertion/energy context, and weekly running mileage from Strava.

The application and provider adapters are implemented. Each deployment needs its own Supabase configuration and provider authorization. Live OpenAI chat is deferred.

## What works in the implementation

- Meals, explicit nutrient values, Eat to Live category quantities, corrections, reusable meals, logging-complete status, an editable calorie baseline, and manual daily adjustments. Missing values remain unknown.
- A shared calculation model for the dashboard, nutrition insights, and a deterministic journal helper. Limited text commands can log supplied meal values or mark a day complete; this is not an AI chat integration or food-photo analyzer.
- Reviewed imports of selected ChatGPT nutrition exports/transcripts, structured meals, Strava activities CSV, Runna ICS, and supported FIT/FIT.GZ files. Import candidates require review. Source identities support replay, run matching, local corrections, and revision history.
- Headline running totals and WHOOP cycle context. Cycle energy retains its original boundaries and is not silently treated as calendar-day expenditure or added to calorie targets.
- Server-side WHOOP and Strava OAuth adapters, optional Tredict personal-token reads, Runna feed reads, manual sync, and a configured daily Vercel cron endpoint. A connection is useful only after credentials, authorization, and real data are verified.
- Owner-only Supabase sign-in, server-checked writes, RLS, encrypted connection secrets, private original-import storage, optimistic revisions, undo, journal JSON export, and confirmed deletion. Generation/version checks prevent requests already in flight from recreating deleted records or disconnected credentials.

## Local preview

Use Node.js 22 (22.13 or newer within that major version) and npm:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. Choose **Explore sample** for synthetic records that are never saved as personal history. A running preview and sample-mode interactions do not prove database persistence. Without Supabase configuration, private APIs fail closed and show setup/sign-in guidance.

For real local persistence, copy `.env.example` to ignored `.env.local` and follow [deployment and authentication setup](docs/deployment.md). Local mode can use a real configured cloud project; choose that project deliberately. Offline meal drafts are kept in this browser and require review before sending; they are not a backup or automatic background synchronization.

## Deploy on free tiers

Follow [docs/deployment.md](docs/deployment.md) to create a dedicated **Supabase Free** project and **Vercel Hobby** deployment, apply `supabase/migrations/202610070001_remy.sql`, configure the exact owner email, redirects, private server variables, and provider applications. Do not apply this bootstrap migration to an unrelated database.

The guide covers free-plan limits, email delivery restrictions, project pausing, the daily cron schedule, and first-live verification. Free hosting does not include unlimited usage, guaranteed availability, or automatic Supabase backups. Provider subscriptions are separate. No AI API usage is enabled.

After setup, verify sign-in, create/reload/edit/undo a disposable entry, test a small reviewed import, compare a known provider value, and inspect an actual scheduled run. A successful build alone does not verify these cloud workflows.

## History, coverage, and recovery

Import a selected nutrition conversation export, retain the original privately, and review the meals, dates, corrections, and estimates before treating the history as complete. Partial exports do not establish full-history coverage. Keep source material under ignored `.local/` or in private storage. Personal data is excluded from the synthetic sample.

Source sync is bounded to a rolling 90-day window, or events actually present in the Runna feed. Time limits, pagination, account permissions, unsupported fields, and partial exports can leave coverage incomplete. Use exports for older history. Detailed activity charts, guaranteed full Runna prescriptions, robust photo interpretation, and general AI conversation are deferred. Some FIT variants may be unsupported by the current decoder.

The journal JSON export includes records, revisions, and original-file paths. It does **not** contain original file bytes, Auth accounts, encrypted credentials, or a one-click full restore. Keep private original exports and manual Supabase backups outside the app. Preserve the encryption key securely or reconnect sources after recovery.

Delete All removes journal records, revisions, credentials, and private import files. The sign-in account and non-health invalidation metadata remain; sources require explicit reconnection before automatic retrieval resumes. Disconnecting a source retains already imported history.

## Checks

```sh
npm run typecheck
npm test
npm run test:postgres
npm run build
```

Tests cover nutrition/date semantics, imports and correction preservation, owner-access rules, stale-request guards, encrypted secrets, and deletion ordering. `test:postgres` runs the migration in isolated PGlite with minimal Supabase-owned schema fixtures; it uses no hosted database or credentials. Hosted Auth/Storage behavior and provider integrations still need the live verification described above.
