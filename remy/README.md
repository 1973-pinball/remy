# Remy Mux

A private nutrition journal with marathon-training context, built with Next.js, Supabase Postgres/Auth/Storage, and Vercel. The current emphasis is Eat to Live food logging, WHOOP exertion/energy context, and weekly running mileage from Strava.

The application and provider adapters are implemented. Each deployment needs its own Supabase configuration and provider authorization. The optional AI coach also needs a server-side OpenAI API key and a successful live check; its presence in the code does not establish that a deployment has AI access.

## What works in the implementation

- Meals, explicit nutrient values, Eat to Live category quantities, corrections, reusable meals, logging-complete status, an editable calorie baseline, and manual daily adjustments. Missing values remain unknown.
- A shared calculation model for the dashboard, nutrition insights, and journal helper. The optional AI coach discusses Eat to Live meals, running and recovery, and can draft meal estimates or corrections from text and a current photo. Review and confirm its proposals before they change the journal; saved totals remain application calculations.
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

Open http://127.0.0.1:5173. Choose **Explore sample** for synthetic records that are never saved as personal history. Sample mode makes no AI calls. A running preview and sample-mode interactions do not prove database persistence. Without Supabase configuration, private APIs fail closed and show setup/sign-in guidance.

For real local persistence, copy `.env.example` to ignored `.env.local` and follow [deployment and authentication setup](docs/deployment.md). Local mode can use a real configured cloud project; choose that project deliberately. Offline meal drafts are kept in this browser and require review before sending; they are not a backup or automatic background synchronization.

## Deploy on free tiers

Follow [docs/deployment.md](docs/deployment.md) to create a dedicated **Supabase Free** project and **Vercel Hobby** deployment, apply `supabase/migrations/202610070001_remy.sql`, configure the exact owner email, redirects, private server variables, and provider applications. Do not apply this bootstrap migration to an unrelated database.

The guide covers free-plan limits, email delivery restrictions, project pausing, the daily cron schedule, and first-live verification. Free hosting does not include unlimited usage, guaranteed availability, or automatic Supabase backups. Provider subscriptions and optional OpenAI API usage are separate costs.

After setup, verify sign-in, create/reload/edit/undo a disposable entry, test a small reviewed import, compare a known provider value, and inspect an actual scheduled run. A successful build alone does not verify these cloud workflows.

## Optional AI coach

Set `OPENAI_API_KEY` privately on the server and optionally `OPENAI_MODEL` (default `gpt-5.4-mini`), then restart or redeploy. The coach uses the OpenAI Responses API with image input and strict structured output. Manual logging, imports and calculated insights do not require this key. A configured key does not prove valid credentials, model access or available API balance; follow the synthetic-first acceptance checks in [deployment setup](docs/deployment.md#optional-ai-coach).

When you explicitly send a coach message, the app sends the prompt, recent conversation context and selected journal fields, including up to 28 days of aggregate running/recovery context. The context excludes raw provider responses, route/location fields, connection credentials and original imports. An attached photo is re-encoded in the browser and limited to 900 KB. Its bytes are used for that request, not saved in the journal or application logs; extracted text, estimates and proposal history can be saved.

Meal proposals expose estimated values and assumptions for review. Confirmed changes use revision checks and atomic writes; deletion guards reject stale requests. A photo cannot establish exact ingredients, portions or nutrients, and an incomplete food log does not establish under-fueling. WHOOP cycle energy stays separate from the calorie target.

Requests use `store: false`. OpenAI does not train on API data by default, but this setting does not provide zero retention; see [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) and the app's [privacy policy](https://remy-mux.vercel.app/privacy). Review [API pricing](https://developers.openai.com/api/docs/pricing) before enabling the coach.

## History, coverage, and recovery

Import a selected nutrition conversation export, retain the original privately, and review the meals, dates, corrections, and estimates before treating the history as complete. Partial exports do not establish full-history coverage. Keep source material under ignored `.local/` or in private storage. Personal data is excluded from the synthetic sample.

Historical daily tables use an explicit `dailySummaries` array, separate from `meals`. Each row needs a stable `id`, `date`, `sourceMessageId`, estimated nutrients (unknown values are `null`), `notes`, `confidence: "estimate"` and `coverage: "unknown"`; known ETL amounts are optional. Apply migration `202610200001_daily_summaries.sql` before importing these records. Food & ETL displays their provenance and date coverage. A daily summary supplies totals only when that date has no saved meals; even a partial meal ledger takes precedence, so the two sources are never added or used to fill each other's gaps. Reimport preserves existing summaries and corrections. Summary rows do not establish a complete food day, and original chat averages are not imported as intake.

Source sync is bounded to a rolling 90-day window, or events actually present in the Runna feed. Time limits, pagination, account permissions, unsupported fields, and partial exports can leave coverage incomplete. Use exports for older history. Detailed activity charts and guaranteed full Runna prescriptions remain outside the current implementation. AI context is bounded and is not a full-history audit. Some FIT variants may be unsupported by the current decoder.

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
