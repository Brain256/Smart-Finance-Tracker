# Architecture & Design Decisions

This document records the non-obvious design decisions behind the finance
tracker — the ones where a reasonable alternative existed and the reasoning for
rejecting it matters. Setup lives in the [README](../README.md); the migration
and rollout procedure lives in [DEPLOYMENT.md](DEPLOYMENT.md).

## Stack

| Layer | Technology |
| --- | --- |
| Capture | Kotlin Android app — `NotificationListenerService`, Room, WorkManager |
| Ingestion | FastAPI on Vercel serverless, Pydantic v2 validation |
| Classification | `instructor` over the OpenAI SDK, targeting Groq |
| Storage | Supabase PostgreSQL (`supabase-py`) |
| Dashboard | Next.js App Router, TypeScript, Auth.js, Recharts |

## 1. Finance-time boundary

Financial calendar math must never use the worker, server, or browser default
timezone. Deployment sets one IANA zone in `FINANCE_TIMEZONE` (default
`America/Toronto`). FastAPI validates it with `zoneinfo`; Next.js validates it
with `Intl.DateTimeFormat`. Today/week/month cards, the 90-day trend, active
income selection, budget consumption, net cash flow, projection dates,
transaction filters, and heatmap day keys all derive their `YYYY-MM-DD` keys
from that zone. SQL RPCs receive it as `p_timezone` and use
`timestamp AT TIME ZONE p_timezone`.

`REVIEW_THRESHOLD` (default `0.70`) is the low-confidence review boundary. A
malformed value for either setting makes the dependent service unavailable with
a configuration error rather than silently falling back.

## 2. Correction lookup replaces a merchant cache

There is **no merchant cache table**. The classifier calls the LLM for every
accepted notification, then `resolve_latest_correction(p_merchant_name)` finds
the newest user correction for the same canonical merchant and overrides the
category before insert. `corrections` is therefore both the immutable audit log
and the only reusable source of learned categories.

Canonical matching is one immutable SQL function,
`normalize_merchant_name(value)` (lowercase plus whitespace collapse).
`expenses.normalized_merchant` is a stored generated column over it, so legacy
and new rows share one key. Lookup ordering is deterministic:
`corrected_at desc, corrections.id desc`.

A lookup hit changes only the stored category, `reviewed = true`, and
`classification_origin = 'correction_lookup'`. It deliberately **retains the LLM
confidence** so the accuracy metric keeps measuring the model, not the user.
A miss stores the LLM category with `reviewed = confidence >= REVIEW_THRESHOLD`
and origin `'llm'`.

Because corrections hold a `on delete restrict` foreign key, an expense with
correction history cannot be deleted; the dashboard translates that constraint
violation into a retention message instead of leaking SQL detail.

## 3. Settings schema

Planning inputs are three small tables, kept separate from `expenses`:

| Table | Shape | Notes |
| --- | --- | --- |
| `category_budgets` | `category` (PK), `monthly_limit`, `updated_at` | Spending categories only; `Income` cannot hold a budget. |
| `income_records` | `id`, `amount`, `frequency`, `effective_date` (unique), timestamps | Unique effective date makes active-income selection deterministic. |
| `savings_targets` | singleton `id = 1`, `mode`, `value`, `updated_at` | `fixed` dollars or `percentage` of normalized monthly income. |

Derived values — spendable this period, daily limit, weekly limit — are never
stored. They are recalculated on every read so they cannot go stale when income
or the savings target changes mid-period. Settings edits stored values only;
Overview presents the derived ones.

## 4. Cents-based analytics

`lib/finance-analytics.ts` converts database amounts to integer cents at the
boundary, performs every comparison and aggregation in cents, and converts back
only for presentation. Income is excluded from every spending aggregate through
one predicate, `isSpendingExpense`.

Normalized monthly income is `amount * 52 / 12` (weekly), `amount * 26 / 12`
(biweekly), or `amount` (monthly). Budget state uses exact bands: green below
75%, yellow from 75% to under 100%, red at or above 100%. A zero limit is valid
and has no percentage display.

## 5. Adjusted projection baseline

```text
Average_Daily_Spending      = trailing 28 calendar days including today / 28
Remaining_Budget            = Σ(monthly_limit − configured category spend)
Unbudgeted_Spending         = current-month spend in categories with no budget
Adjusted_Remaining_Budget   = Remaining_Budget − Unbudgeted_Spending
Income_Remaining            = Spendable_This_Period − all current-month spending
Projection_Baseline         = min(Adjusted_Remaining_Budget, Income_Remaining)
Projection_Value            = Projection_Baseline − (Average_Daily_Spending × days remaining)
```

`days remaining` is inclusive of today, so it is exactly `1` on the final local
day of the month. Subtracting unbudgeted spending is what keeps a partial budget
honest: with a `$500` Food limit, `$100` of Food spend, and `$150` of unbudgeted
Shopping, the adjusted remaining budget is `$250`, not `$400`.

## 6. Capability states

`getDashboardData()` loads base expenses first. A core expense or configuration
failure keeps the existing demo fallback and disables mutations. Every optional
read — budgets, income, savings target, trend RPC, accuracy RPC — then loads
independently into:

```ts
type LoadState<T> =
  | { status: 'ready'; data: T }
  | { status: 'unavailable'; reason: string };
```

A missing migration makes only its own capability unavailable. Real expenses
stay visible, unavailable confidence is never coerced to zero, and a missing
planning prerequisite renders a named incomplete state rather than a misleading
`$0`.

## 7. Idempotent ingestion

The `expenses` table carries a composite unique constraint on
`(merchant_name, amount, timestamp)`. The Android client retries failed POSTs
from a local queue, and cellular delivery can duplicate a request on its own, so
ingestion upserts against that constraint rather than inserting blindly. A
duplicate collision is trapped and returned as HTTP `200 OK` — a successful
retry — while a genuinely new transaction returns `202 Accepted`. Historical
rows and charts are never modified by a replayed notification.
