# Smart Finance Tracker

**Turns a Google Wallet tap-to-pay notification into a categorized, queryable
expense row in Postgres.**

![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-App_Router-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Kotlin](https://img.shields.io/badge/Kotlin-Android-7F52FF?logo=kotlin&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres-3FCF8E?logo=supabase&logoColor=white)

## Overview

Smart Finance Tracker uses Google Wallet notifications as a real-time transaction
source, so expenses can be captured across multiple cards without connecting to
individual bank APIs. The Android client forwards notifications to a FastAPI
service, which classifies them and stores structured transactions in Postgres.

## Screenshot

<p align="center">
  <img src="docs/images/overview.jpg" alt="Dashboard overview" width="60%" />
</p>

## Architecture

```mermaid
flowchart TB
  subgraph sources["Sources"]
    wallet["Google Wallet<br/>notification"]
    user["User browser"]
  end

  subgraph clients["Clients"]
    android["Android client<br/>Notification listener<br/>Offline queue"]
    dashboard["Next.js dashboard<br/>Google OAuth<br/>Budgets + projections"]
  end

  subgraph backend["FastAPI ingestion service"]
    api["FastAPI<br/>Auth + validation"]
    classifier["Groq + instructor<br/>Transaction extraction<br/>Corrections"]
  end

  subgraph data["Data layer"]
    postgres["Supabase Postgres<br/>Idempotent writes<br/>Analytics"]
  end

  wallet -->|"notification"| android
  android -->|"ingest"| api
  api -->|"transaction"| classifier
  classifier -->|"classified data"| postgres
  user -->|"sign in"| dashboard
  dashboard -->|"queries"| postgres
```

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Capture | Kotlin, Room, WorkManager | Read Google Wallet notifications, queue failures, retry on reconnect |
| Ingestion | FastAPI, Pydantic v2 | Authenticate, validate, normalize timestamps |
| Classification | `instructor` + Groq | Extract typed fields from free text; apply learned corrections |
| Storage | Supabase Postgres | Idempotent writes, correction audit log, analytics RPCs |
| Dashboard | Next.js App Router, Auth.js, Recharts | Private analytics, review queue, budget planning |

## Testing

```powershell
python -m pytest      # 51 passed — ingestion, schemas, AI layer, database
npx.cmd vitest run    # 75 passed — analytics, data loading, server actions, UI
```

Groq and Supabase are mocked throughout, so the full suite runs with no network
access and no API keys.

Beyond example-based tests, the correctness-critical logic is covered by
property-based tests — Hypothesis on the Python side
(`tests/test_analytics_properties.py`) and fast-check on the TypeScript side
(`lib/finance-analytics.properties.test.ts`), 100 generated examples each. These
assert invariants rather than fixtures: income never leaks into a spending
aggregate, cents-based sums never drift, budget state bands never overlap, and
configuration parsing either yields a valid value or raises.

## Getting started

**Prerequisites:** Python 3.11+, Node.js 18+, a Supabase project, a Groq API key.

```powershell
git clone <repo-url>
cd Smart-Finance-Tracker

python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .[dev]

npm.cmd install

Copy-Item .env.example .env
```

Generate the two secrets and paste them into `.env`:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"   # INBOUND_SECRET_TOKEN
npx auth secret                                                 # AUTH_SECRET
```

### Environment variables

| Variable | Used by | Default | Purpose |
| --- | --- | --- | --- |
| `INBOUND_SECRET_TOKEN` | FastAPI | — | Bearer token the Android client must present |
| `GROQ_API_KEY` | FastAPI | — | Classification API key |
| `GROQ_MODEL` | FastAPI | `llama-3.3-70b-versatile` | Optional model override |
| `SUPABASE_URL` | Both | — | Project URL from **Project Settings → API** |
| `SUPABASE_SERVICE_ROLE_KEY` | Both | — | Server-only; bypasses row-level security |
| `FINANCE_TIMEZONE` | Both | `America/Toronto` | IANA zone driving every date boundary |
| `REVIEW_THRESHOLD` | Both | `0.70` | Confidence below this flags an expense for review |
| `AUTH_SECRET` | Next.js | — | Auth.js session secret |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Next.js | — | Google OAuth credentials |
| `AUTH_ALLOWED_EMAIL` | Next.js | — | The single address permitted to sign in |

Set `FINANCE_TIMEZONE` and `REVIEW_THRESHOLD` **identically** in both runtimes.
Never prefix any of these with `NEXT_PUBLIC_` — the service role key bypasses
row-level security and must stay server-side.

For Google OAuth, register the redirect URI
`https://your-domain.vercel.app/api/auth/callback/google` (and
`http://localhost:3000/api/auth/callback/google` for local testing) in the Google
Cloud Console.

### Database

For a **new, empty Supabase project**, run
[`supabase/expenses.sql`](supabase/expenses.sql) once in the SQL Editor — it is
the complete fresh-install schema.

For an **existing database**, do not run that file. Apply the ordered migrations
in [`supabase/migrations/`](supabase/migrations/README.md) instead, following
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

### Run it

```powershell
python -m uvicorn api.index:app --reload   # API  → http://127.0.0.1:8000
npm.cmd run dev                            # Dashboard → http://localhost:3000/dashboard
```

Send a test transaction:

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8000/api/v1/ingest" `
  -Method Post `
  -Headers @{ Authorization = "Bearer YOUR_INBOUND_SECRET_TOKEN" } `
  -ContentType "application/json" `
  -Body '{
    "notification_title": "TIM HORTONS #4920",
    "notification_text": "BMO Credit Card ending in 1234: Approved $14.50",
    "timestamp": "2026-06-17T20:55:00Z"
  }'
```

The server logs a normalized transaction and a row appears in Supabase:

```text
Extracted transaction: {"merchant_name":"Tim Hortons","amount":14.5,"category":"Food"}
```

### Phone capture

The capture layer is a native Kotlin app in [`AndroidClient/`](AndroidClient/)
that forwards Google Wallet notifications to `/api/v1/ingest`. It ships
allowlisting `com.google.android.apps.walletnfcrel`, so it needs two things:
`BASE_URL` and `API_TOKEN` set as Gradle properties, and Android's **Notification
access** permission granted. Full walkthrough in
[`docs/ANDROID_CLIENT.md`](docs/ANDROID_CLIENT.md).

## API

| Endpoint | Description |
| --- | --- |
| `GET /api/v1/health` | Returns `{"status": "healthy"}` |
| `POST /api/v1/ingest` | Bearer-authenticated. Accepts `notification_title`, `notification_text`, and `timestamp` (ISO 8601, Unix seconds, or Unix milliseconds). Returns `202` for a new transaction, `200` for a duplicate retry. |
| `GET /dashboard` | Private Next.js dashboard behind Google OAuth |

```json
{
  "status": "accepted",
  "timestamp": "2026-06-17T20:55:00Z",
  "transaction": {
    "merchant_name": "Tim Hortons",
    "amount": 14.5,
    "category": "Food"
  }
}
```

## Project structure

```text
api/              FastAPI entrypoint (Vercel serverless handler)
src/
  core/           Security, database client, finance configuration
  schemas/        Pydantic v2 request/response contracts
  services/       LLM extraction layer
app/              Next.js App Router — dashboard, auth, server actions
components/       React UI, including the finance panel components
lib/              Analytics, data loading, mutations, shared types
supabase/         Fresh-install schema plus ordered migrations
AndroidClient/    Kotlin notification capture app
tests/            Python test suite (pytest + Hypothesis)
docs/             Architecture, deployment, Android setup, roadmap
```

## Documentation

- [Architecture & design decisions](docs/ARCHITECTURE.md) — why the schema and
  analytics work the way they do
- [Deployment runbook](docs/DEPLOYMENT.md) — ordered migrations, verification,
  rollback
- [Android client setup](docs/ANDROID_CLIENT.md) — capture layer walkthrough
- [Roadmap](docs/ROADMAP.md) — shipped and planned expansion work
