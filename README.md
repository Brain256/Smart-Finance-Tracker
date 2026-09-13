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
service, which classifies them and stores structured transactions in Postgres (Supabase). 
A Next.js dashboard displays the transaction data and cash projections along with an AI assistant
that answers open-ended questions through tool calling. 

https://github.com/user-attachments/assets/66682f14-ce1d-45fc-9ae2-adc13714ec51

## Project structure

```text
api/              FastAPI entrypoint (Vercel serverless handler)
src/
  core/           Security, database client, finance configuration
  schemas/        Pydantic v2 request/response contracts
  services/       LLM extraction layer
scripts/          Schema export utility
app/              Next.js App Router — dashboard, auth, server actions, chat endpoint
components/       React UI, including the finance panel components
lib/              Analytics, data loading, mutations, shared types
auth.ts           Auth.js configuration
proxy.ts          Route middleware enforcing the session gate
schema.json       Generated Pydantic contract export
supabase/         Complete database schema
AndroidClient/    Kotlin notification capture app
tests/            Python test suite (pytest + Hypothesis)
docs/             Architecture, Android setup, assistant design, roadmap
```

TypeScript tests live beside the modules they cover as `*.test.ts` / `*.test.tsx`
rather than in a separate tree.

## Architecture

```mermaid
flowchart TB
  subgraph sources["Sources"]
    wallet["Google Wallet<br/>notification"]
    user["User browser"]
  end

  subgraph clients["Clients"]
    android["Android client<br/>Notification listener<br/>Offline queue"]
    dashboard["Next.js dashboard<br/>Google OAuth<br/>Budgets + projections<br/>AI chat assistant"]
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
| Assistant | Groq tool calling, TypeScript | Answer questions through whitelisted read-only queries; never composes SQL |


## Chat assistant

The **Assistant** tab answers natural-language questions about recorded
transactions using tool calling such as "how much did I spend at Tim Hortons last month," "which merchant
cost me the most this year." A Groq model
picks from two read-only tools and fills in their arguments; the tools run
parameterized Supabase queries.

```mermaid
flowchart LR
  panel["Assistant panel"] -->|"messages"| route["POST /api/chat<br/>session gate"]
  route --> agent["chat-agent<br/>system prompt + tool loop"]
  agent -->|"tool schemas"| groq["Groq<br/>gpt-oss-120b"]
  groq -->|"tool calls"| agent
  agent --> tools["chat-tools<br/>validate + query"]
  tools --> db["Supabase<br/>expenses"]
  db --> tools
  tools --> agent
  agent -->|"reply + lookups"| route
```

| Tool | Returns |
| --- | --- |
| `search_transactions` | Individual rows, newest first, up to 50 |
| `aggregate_spending` | Total, transaction count, per-category breakdown, optional top-10 merchant ranking |

Design rationale and the full list of known limitations are in
[`docs/ASSISTANT.md`](docs/ASSISTANT.md).

## Testing

```powershell
python -m pytest      # 49 passed — ingestion, schemas, AI layer, database
npx.cmd vitest run    # 365 passed — analytics, data loading, server actions, assistant, UI
```

Groq and Supabase are mocked throughout, so the full suite runs with no network
access and no API keys.

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
| `GROQ_API_KEY` | Both | — | Groq API key, used for classification and the chat assistant |
| `GROQ_MODEL` | FastAPI | `openai/gpt-oss-20b` | Notification classification model |
| `CHAT_GROQ_MODEL` | Next.js | `openai/gpt-oss-120b` | Chat assistant model |
| `SUPABASE_URL` | Both | — | Project URL from **Project Settings → API** |
| `SUPABASE_SERVICE_ROLE_KEY` | Both | — | Server-only; bypasses row-level security |
| `FINANCE_TIMEZONE` | Both | `America/Toronto` | IANA zone driving every date boundary |
| `REVIEW_THRESHOLD` | Both | `0.70` | Confidence below this flags an expense for review |
| `AUTH_SECRET` | Next.js | — | Auth.js session secret |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Next.js | — | Google OAuth credentials |
| `AUTH_ALLOWED_EMAIL` | Next.js | — | The single address permitted to sign in |

Set `FINANCE_TIMEZONE` and `REVIEW_THRESHOLD` **identically** in both runtimes.
Never prefix any of these with `NEXT_PUBLIC_` — the service role key bypasses
row-level security and must stay server-side, and `GROQ_API_KEY` is now read by
both runtimes.

Groq retires models on roughly a quarterly cadence, so both model names are
configuration rather than constants. Check the
[deprecation schedule](https://console.groq.com/docs/deprecations) before
pinning a version.

For Google OAuth, register the redirect URI
`https://your-domain.vercel.app/api/auth/callback/google` (and
`http://localhost:3000/api/auth/callback/google` for local testing) in the Google
Cloud Console.

### Database

Run [`supabase/expenses.sql`](supabase/expenses.sql) once in the Supabase SQL
Editor. It creates every table, index, constraint, trigger, and RPC the
application expects, and is idempotent, so a rerun is a no-op.

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
| `POST /api/chat` | Session-authenticated. Accepts `{ messages: [{ role, content }] }` and returns the assistant reply plus the lookups behind it. |
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

## Documentation

- [Architecture & design decisions](docs/ARCHITECTURE.md) — why the schema and
  analytics work the way they do
- [Android client setup](docs/ANDROID_CLIENT.md) — capture layer walkthrough
- [Chat assistant](docs/ASSISTANT.md) — tool-calling design, security model, and
  known limitations
- [Roadmap](docs/ROADMAP.md) — shipped and planned expansion work
