# Remy

A private Eat to Live nutrition journal with running and recovery context. The source is public; each deployed journal requires its owner's sign-in.

The Next.js application lives in [`remy/`](remy/). See the [application README](remy/README.md) for features and local development, and the [Vercel + Supabase setup guide](remy/docs/deployment.md) for deployment.

Only synthetic sample data is included. Nutrition exports, personal records, provider credentials, and local configuration are excluded from this repository.

## Architecture

The application infrastructure is live. Dashed connections show data integrations awaiting setup; Strava is the selected running source.

```mermaid
flowchart LR
    G[Public GitHub repo] -->|Automatic deployment| R[Remy on Vercel]
    U[You: browser or phone] <--> R
    R <--> S[Private Supabase database and sign-in]
    ST[Strava: completed runs] -. Pending .-> R
    W[WHOOP: exertion and energy] -. Pending .-> R
    RN[Runna: planned training] -. Pending .-> R
    E[REMY ETL chat export] -. Reviewed import pending .-> R
```
