# Smart Finance Tracker

**Turns a Google Wallet tap-to-pay notification into a categorized, queryable
expense row in Postgres — in about a second, with no bank API, no screen
scraping, and no third-party aggregator.**

![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-App_Router-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Kotlin](https://img.shields.io/badge/Kotlin-Android-7F52FF?logo=kotlin&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres-3FCF8E?logo=supabase&logoColor=white)

**Live demo:** _(deployment URL — TODO)_

## Screenshots

<!--
  Drop three PNGs into docs/images/ with exactly these filenames:
    dashboard-overview.png      — Overview tab: spending cards, trend, budgets
    dashboard-transactions.png  — Transactions tab: sortable table, category edit
    dashboard-settings.png      — Settings tab: income, savings target, budgets
-->

| Overview | Transactions |
| --- | --- |
| ![Overview tab](docs/images/dashboard-overview.png) | ![Transactions tab](docs/images/dashboard-transactions.png) |

![Settings tab](docs/images/dashboard-settings.png)

## Why it exists

Consumer bank APIs are effectively closed. Aggregators like Plaid are gated
behind commercial agreements and priced for businesses, not for one person
tracking their own spending — and handing a third party your banking credentials
to read data your phone already has is a poor trade.

Google Wallet already pushes a notification for every card transaction it
handles, naming the merchant and the amount. That is the same event stream,
delivered for free, in real time, and it works across every card added to the
wallet rather than one bank at a time. This project treats the Android
notification shade as the data source: a listener service
captures the push, a FastAPI gateway validates it, an LLM extracts structured
fields from the unstructured text, and Postgres stores it idempotently.

## Architecture

```text
  Card purchase
       │
       ▼
┌──────────────────────┐
│  Android client      │  NotificationListenerService reads Google Wallet's
│  (Kotlin)            │  title + body + postTime; offline? → Room queue →
│                      │  WorkManager drains on reconnect
└──────────┬───────────┘
           │  POST /api/v1/ingest   (Bearer token)
           ▼
┌──────────────────────┐
│  FastAPI gateway     │  Bearer auth → Pydantic v2 validation → timestamp normalization
│  (Vercel serverless) │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Groq + instructor   │  Unstructured text → { merchant_name, amount, category, confidence }
│  (Llama 3.3 70B)     │  Prior user correction for this merchant overrides the LLM
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Supabase Postgres   │  UPSERT on (merchant_name, amount, timestamp) → replay-safe
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Next.js dashboard   │  Google OAuth + email allowlist; trends, budgets, projections
└──────────────────────┘
```

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Capture | Kotlin, Room, WorkManager | Read Google Wallet notifications, queue failures, retry on reconnect |
| Ingestion | FastAPI, Pydantic v2 | Authenticate, validate, normalize timestamps |
| Classification | `instructor` + Groq | Extract typed fields from free text; apply learned corrections |
| Storage | Supabase Postgres | Idempotent writes, correction audit log, analytics RPCs |
| Dashboard | Next.js App Router, Auth.js, Recharts | Private analytics, review queue, budget planning |

## Engineering highlights

**Idempotent ingestion.** Cellular delivery duplicates requests, and the Android
client retries from its own queue, so the same transaction can arrive several
times. A composite unique constraint on `(merchant_name, amount, timestamp)`
turns that into a non-event: ingestion upserts against the constraint, traps the
collision, and returns `200 OK` for a replay versus `202 Accepted` for a genuinely
new transaction. Historical rows and charts never shift under a retry.
→ `src/core/database.py`

**Corrections are the cache.** There is no merchant cache table to keep in sync.
When you fix a miscategorized merchant, that write lands in an immutable
`corrections` audit log — and the same log is the lookup source for every future
expense. `resolve_latest_correction` matches on a normalized merchant key (a
stored generated column, so legacy rows participate) and overrides the LLM before
insert. One table serves as both the audit trail and the learned-category store,
and a correction hit deliberately *retains* the original LLM confidence so the
accuracy metric keeps measuring the model rather than flattering it.
→ `supabase/migrations/002_corrections_and_rpcs.sql`

**Integer-cents arithmetic.** Floating-point dollars drift, and drift in a
financial total is a bug you find months later. Amounts convert to integer cents
at the data boundary; every comparison, sum, and budget threshold runs in cents;
conversion back to dollars happens only at render.
→ `lib/finance-analytics.ts`

**Timezone-correct financial dates.** "Today's spending" is ambiguous across a
serverless worker in one region, a Postgres instance in another, and a browser in
a third. A single `FINANCE_TIMEZONE` drives every day/week/month boundary in all
three: `zoneinfo` validates it in Python, `Intl.DateTimeFormat` in TypeScript, and
SQL RPCs receive it as a parameter. A malformed value fails loudly instead of
silently shifting a month boundary.
→ `lib/finance-config.ts`, `src/core/finance_config.py`

**Graceful capability degradation.** Each optional dashboard read resolves to
`{ status: 'ready', data } | { status: 'unavailable', reason }`. A missing
migration disables exactly the panel that depends on it, with a named reason,
while real expense data stays visible — instead of a blank page or, worse, a
confident `$0`.
→ `lib/dashboard-data.ts`

**Offline-durable capture.** A tap-to-pay notification arrives once; if the POST fails there
is no second chance from the OS. Failed requests persist to a Room table and
drain through a `WorkManager` job constrained to `NetworkType.CONNECTED`, so a
purchase made in airplane mode still lands in Postgres on reconnect.
→ `AndroidClient/app/src/main/java/com/finance/androidclient/worker/NotificationSyncWorker.kt`

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
