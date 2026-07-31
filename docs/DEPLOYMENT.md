# Deployment Runbook — Finance Tracker Expansion

This runbook covers rolling out the confidence, correction, planning, and
dashboard-analytics expansion to an existing Finance Tracker database.

> **Production migrations require explicit, separate approval.** Nothing in this
> repository applies SQL automatically. Rehearse every step in a non-production
> Supabase project first.

## 1. Required environment variables

| Variable | Owner | Default | Notes |
| --- | --- | --- | --- |
| `FINANCE_TIMEZONE` | FastAPI + Next.js | `America/Toronto` | Valid IANA zone. Drives every local-date boundary. |
| `REVIEW_THRESHOLD` | FastAPI + Next.js | `0.70` | Finite decimal in `[0, 1]`. Low-confidence review boundary. |
| `SUPABASE_URL` | Server runtimes | none | Existing setting. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server runtimes | none | Server-only. Never exposed to the browser. |
| `INBOUND_SECRET_TOKEN` | FastAPI | none | Existing ingestion bearer token. |
| `AUTH_ALLOWED_EMAIL` | Next.js | none | Existing dashboard authorization boundary. |

Set the same `FINANCE_TIMEZONE` and `REVIEW_THRESHOLD` in **both** runtimes. A
malformed value makes the dependent service unavailable with a configuration
error rather than silently defaulting mid-period.

## 2. Ordered migrations

Apply in lexical filename order, once per database, from
`supabase/migrations/`:

| Order | File | Scope |
| --- | --- | --- |
| 1 | `001_add_expense_metadata.sql` | Merchant normalization function, `normalized_merchant` generated column, nullable `confidence` / `reviewed` / `classified_at` / `classification_origin`, constraints, indexes. |
| 2 | `002_corrections_and_rpcs.sql` | `corrections` table, `resolve_latest_correction`, atomic `correct_expense_category`. |
| 3 | `003_accuracy_and_trend_rpcs.sql` | `get_classification_accuracy`, `get_daily_spending_trend`. |
| 4 | `004_planning_schema.sql` | `category_budgets`, `income_records`, `savings_targets`, planning indexes. |

Rules:

- **Do not run `supabase/expenses.sql` against an existing database.** It is a
  fresh-install bootstrap only.
- Back up the database and record each applied filename before continuing.
- Stop on the first error. Migrations are idempotent, so a failed file may be
  rerun after the cause is fixed.
- Never edit, delete, or renumber an applied migration.

See [`../supabase/migrations/README.md`](../supabase/migrations/README.md) for
the full convention.

## 3. Non-production SQL verification

Run `supabase/migrations/validate_expansion_migrations.sql` (or
`validate-non-production.ps1`) against a non-production project seeded with
representative historical expenses, and confirm:

- Re-applying every migration is idempotent and raises no error.
- Existing expense IDs, merchant names, amounts, categories, and timestamps are
  unchanged; historical metadata may remain `NULL`.
- `correct_expense_category` is atomic: a changed category writes exactly one
  correction and flips `reviewed` together; submitting the current category
  writes nothing.
- `resolve_latest_correction` returns the greatest `(corrected_at, id)` match for
  a canonical merchant.
- Category and source check constraints reject unsupported values.
- Deleting an expense that has correction history is rejected.
- `get_daily_spending_trend` returns zero-filled, timezone-correct rows.

Details are in `supabase/migrations/VALIDATION.md`.

## 4. Deployment order

Deploy application code only after its prerequisite migration succeeds:

1. Migrations 001–003.
2. FastAPI ingestion (confidence, correction lookup, classification metadata).
3. Dashboard data contracts, review/correction UI, accuracy, and trend.
4. Migration 004, then Settings, budgets, limits, net cash flow, and projection.
5. Filtering and the compact heatmap.

A code-ahead-of-schema mismatch is visible rather than silent: the affected
capability renders its `unavailable` state while real expenses stay visible.

## 5. Pre-deploy gates

```powershell
.\.venv\Scripts\python.exe -m pytest
npx.cmd vitest run
npx.cmd tsc --noEmit
npm.cmd run build
```

`npm.cmd run lint` is optional; the declared `next lint` command may not be
supported by the installed Next.js release.

## 6. Rollback and disabling

There is no destructive down-migration. The expansion is additive, so recovery
is by disabling capability rather than dropping data:

- **Roll back application code** to the previous release. Added columns and
  tables are nullable or unread by older code, so prior versions keep working.
- **Disable a single capability** by reverting the code that reads it; the
  snapshot marks it `unavailable` and the rest of the dashboard is unaffected.
- **Never drop `corrections`.** It is the immutable audit record *and* the only
  source of learned categories. Dropping it silently disables correction reuse.
- **Do not drop `normalized_merchant`**; correction lookup depends on it.
- Restore from backup only if a migration corrupted financial columns, which the
  non-production checks in section 3 exist to prevent.

## 7. Post-deploy verification (non-production)

1. Ingest a confidence-bearing notification; confirm the stored row has
   `confidence`, `reviewed`, `classified_at`, and `classification_origin = 'llm'`.
2. Correct its category in Transactions; confirm one `corrections` row and
   `reviewed = true`.
3. Ingest the same merchant again; confirm the corrected category is reused with
   origin `correction_lookup` and the LLM confidence retained.
4. Configure income, savings target, and at least one budget in Settings;
   confirm derived limits, budget progress, and the projection update on reload.
5. Confirm the trend renders 90 zero-filled points, filters intersect and clear,
   and the heatmap renders one cell per date of the selected month.
6. Attempt to delete the corrected expense; confirm the retention message.
7. Confirm logs contain no notification content, merchant names, amounts,
   credentials, or service keys.
