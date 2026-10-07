# Remy on Vercel and Supabase

Remy runs as a Next.js application on Vercel, with a private Supabase Postgres journal and Supabase email sign-in. No OpenAI connection is required for logging, imports, headline training metrics, or the current rule-based nutrition insights. This document is setup guidance; it does not mean that a cloud project, database, connection, or deployment has been created.

Use your existing Vercel and Supabase accounts when available. Remy needs its own project link and environment configuration; credentials from unrelated apps should not be copied into Remy. Check available free project slots before creating a dedicated database.

## Staying on free plans

- **Vercel Hobby:** $0 for this personal, noncommercial app within its usage limits. Use the included `*.vercel.app` domain; a custom domain is optional and may cost money. Hobby features can stop until quotas reset when limits are exceeded. The checked-in schedule runs once per day, which is the Hobby limit for an individual cron schedule. Execution can occur anywhere within the scheduled hour. [Hobby plan](https://vercel.com/docs/plans/hobby), [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
- **Supabase Free:** $0 within the included 500 MB database, 1 GB file storage, and 5 GB egress. Free accounts are limited to two active projects. Check your existing projects before creating Remy; do not upgrade a plan or put Remy’s health history into another app’s database automatically. If both slots are occupied, a separate free Remy project requires freeing an unused slot or choosing an explicitly approved alternative. Automatic database backups are not included. [Supabase pricing](https://supabase.com/pricing).
- **Availability:** Free Supabase projects with low activity over a seven-day period may be paused. A daily sync does not guarantee that a project cannot pause. Restore a paused project from the Supabase dashboard before retrying sign-in or sync. [Project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).
- **Email:** Supabase’s built-in sender only sends to addresses on the Supabase organization’s team and currently allows two messages per hour. It is best-effort and intended for testing/noncritical use. The owner’s team email can be used for the initial personal setup. Reliable delivery to other addresses requires custom SMTP, with the email provider’s own free quota or charges; Remy does not provision one. [SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp).
- Existing WHOOP, Strava, Runna, or Tredict account/subscription costs are separate from Remy hosting. No AI usage is enabled or billed by this app version.

## 1. Create a dedicated Supabase project

1. Select a **Free** organization and confirm a free project slot is available. Keep the database password in your password manager.
2. Apply `supabase/migrations/202610070001_remy.sql` to the new project using the Supabase SQL editor, or apply the checked-in migrations in filename order with your existing Supabase CLI workflow. Do not run this bootstrap over an unrelated project.
3. In the project’s Connect/API settings, obtain the project URL, publishable key, and server secret key. Legacy `anon` and `service_role` keys are supported through the alternate environment names in `.env.example`.
4. In Authentication → Users, create the owner’s user account using the exact email that will become `REMY_ALLOWED_EMAIL`. Use the dashboard’s confirmed-email option after verifying this is your email. Keep any generated password private; Remy uses magic links for normal sign-in.
5. Turn off **Allow new users to sign up** in Supabase Auth settings. Remy requests links with `shouldCreateUser: false`. It never accepts first-visitor ownership.
6. Copy the owner’s UUID from Authentication → Users into `SYNC_OWNER_ID`. This is the Auth UUID, not an email or project ID.

Tables and functions are owner-scoped. Browser roles cannot write journal tables directly; server routes verify the current Supabase user and exact owner email before using the server client. Credentials are encrypted in the private secrets table and excluded from ordinary journal exports. The server secret key bypasses database row policies, so it must never be a `NEXT_PUBLIC_` value, committed file, or browser configuration.

## 2. Configure authentication

In Supabase Authentication → URL Configuration, set Site URL to the exact production origin, for example `https://your-remy.vercel.app`. Allow these exact redirect URLs:

```text
https://your-remy.vercel.app/auth/confirm
https://your-remy.vercel.app/auth/callback
http://127.0.0.1:5173/auth/confirm
http://127.0.0.1:5173/auth/callback
```

Only add the local URLs if local sign-in is needed. Do not use a broad redirect wildcard for arbitrary preview deployments. A preview that needs sign-in requires its own exact origin and environment configuration.

For the built-in free email sender, keep Supabase's default Magic Link template. Remy's server client requests a PKCE link, and `/auth/confirm` exchanges the returned `code` for a session. Open the newest link in the **same browser and device** used to request it; the exchange requires that browser's verification cookie. If an email app opens a different browser, copy the link into the original browser. Request a fresh link if the cookie or link has expired.

Supabase currently requires custom SMTP before it accepts email-template changes. If a deployment already has custom SMTP, it may instead use a token-hash Magic Link template:

```html
<h2>Sign in to Remy</h2>
<p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">Open your private journal</a></p>
```

Remy supplies the allowlisted `/auth/confirm` address as `RedirectTo` and supports both callback formats. Links are single use. Redirect destinations in incoming query parameters are ignored. Sessions use HTTP-only cookies, refresh through the Next.js proxy, and are validated with `getUser()` on each protected API request. [Passwordless sign-in](https://supabase.com/docs/guides/auth/auth-email-passwordless), [SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [email template variables](https://supabase.com/docs/guides/auth/auth-email-templates).

## 3. Configure Vercel

Import the Remy repository into a **Hobby** project. Select the folder containing Remy’s `package.json` as the root directory (`remy` if importing the parent workspace). Use Next.js, Node.js 22, `npm ci`, and `npm run build`; `vercel.json` supplies the build/install settings and daily cron.

Add environment variables in Vercel → Project Settings → Environment Variables. Use `.env.example` as the names-only checklist. The minimum live journal setup is:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | The dedicated Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable API key, or the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `SUPABASE_SECRET_KEY` | Server-only secret key, or legacy `SUPABASE_SERVICE_ROLE_KEY` |
| `REMY_ALLOWED_EMAIL` | Exact owner sign-in email; missing values fail closed |
| `APP_ORIGIN` | Exact deployed HTTPS origin, without a path or trailing query |
| `SECRET_ENCRYPTION_KEY` | At least 32 random characters; preserve securely to decrypt saved provider connections |
| `CRON_SECRET` | Independent random secret of at least 32 characters for scheduled sync |
| `SYNC_OWNER_ID` | Verified owner Auth UUID for scheduled work |

Use a password manager to generate/store private keys. Do not paste secrets into chat. Set private values only for environments that need live access; avoid connecting every preview deployment to the production health journal. Redeploy after changing environment variables. Confirm the final Vercel domain is identical to `APP_ORIGIN` and the Supabase Site URL.

For local development, copy `.env.example` to ignored `.env.local`, fill the same values using the intended project, keep `APP_ORIGIN=http://127.0.0.1:5173`, then run `npm run dev`. Missing configuration produces a setup message and HTTP 503 for private data; there is no fallback identity or fake authenticated account.

## 4. Connect training sources

Connections can be added after the owner signs in. Store user tokens/feed addresses through Remy’s Connections page where supported. Optional single-owner environment fallbacks are `TREDICT_TOKEN` and `RUNNA_FEED_URL`; both require the configured `SYNC_OWNER_ID` and never apply to another owner.

For WHOOP OAuth, create a provider developer application, configure `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET`, and register `https://your-remy.vercel.app/api/whoop` as the callback. For the optional Strava application, configure `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET`; the callback is `https://your-remy.vercel.app/api/connections?provider=strava` and the provider callback domain must match the Remy hostname. Follow the connection research document for supported scopes, source limitations, and export alternatives. Authorization and actual provider data must be verified with the owner’s live accounts before claiming a connection is working.

The Vercel schedule sends `GET /api/sync` daily during **12:00–12:59 UTC**, equivalent to **8:00–8:59 a.m. Eastern during daylight time** and **7:00–7:59 a.m. Eastern during standard time**. Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically. The handler rejects missing/invalid credentials and only syncs the configured owner. Manual sync remains available after sign-in. Review the job response/logs for provider failures; a deployed cron schedule alone does not confirm that data is arriving. [Securing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## 5. Preserve nutrition history and backups

Start by exporting the existing REMY ETL ChatGPT conversation and retaining the original export unchanged in private storage. Import the relevant conversation into Remy, review the extracted entries and dates, and confirm the import. Missing, ambiguous, or estimated values need review; the source is not treated as a new set of application instructions.

Before a large import or deletion, download Remy’s authenticated journal JSON export. Keep dated copies outside the app. This is a portable record/revision export, not a complete database backup: Auth accounts, encrypted provider credentials, and operational locks are separate. Do not assume it can restore every system setting or that an automatic full-restore workflow exists.

**Delete All** removes journal records and revisions, saved provider credentials, and private import files. The Supabase Auth account and non-health metadata used to invalidate older requests remain. In-flight writes from before deletion are rejected, and all sources stay disabled, including environment-backed Tredict and Runna connections. A later cron run cannot repopulate the journal until the owner explicitly enables or reconnects a source. Disconnecting a single source retains its previously imported history. If file cleanup fails, writes remain blocked; retry the confirmed deletion to finish cleanup.

For a complete database backup, use a manual Supabase/Postgres backup with a trusted CLI workflow and securely retain the schema, data, and required role information. Preserve `SECRET_ENCRYPTION_KEY` separately to recover encrypted connections, or reconnect providers after recovery. Do not put health exports, credentials, or dumps in Git. Free Supabase does not include automatic backups; the owner must maintain these copies. [Supabase backup guidance](https://supabase.com/docs/guides/platform/backups).

## Verify the first live setup

1. With no session, private APIs reject access and show sign-in/setup guidance.
2. Only the confirmed allowlisted owner can sign in and read/write their journal; another account is rejected.
3. Create a disposable nutrition entry, reload, and confirm it persists. Exercise edit/undo and export before importing the full history.
4. Import a small real ETL sample, review it, and check the stored dates and source labels alongside a known run/day.
5. Connect one source at a time; compare a known headline value with the provider, then check the scheduled sync result.
6. Download a dated export and confirm it contains journal records without provider tokens.

The cloud migration, sign-in email, live persistence, provider authorization, and cron execution cannot be verified until the dedicated cloud project and credentials are configured.
