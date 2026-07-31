# Non-production migration validation

`validate-non-production.ps1` rehearses migrations `001` through `004` **twice** in a disposable, empty non-production PostgreSQL/Supabase database. It first creates a legacy `public.expenses` fixture, then executes transactional SQL checks and rolls all test data back.

It never reads `.env`, has no default database target, and rejects URLs containing `prod` or `production`. That name check is only a guardrail, not proof that a target is safe: verify the project independently. Do not use a production URL or production credentials.

## Prerequisites

- The migration artifacts `001_add_expense_metadata.sql`, `002_corrections_and_rpcs.sql`, `003_accuracy_and_trend_rpcs.sql`, and `004_planning_schema.sql` must exist in this directory.
- `psql` must be installed and available on `PATH`.
- The target must be an empty, disposable non-production database. The fixture creates `public.expenses`.

## Run only after explicit non-production approval

```powershell
.\supabase\migrations\validate-non-production.ps1 `
  -NonProductionDatabaseUrl 'postgresql://…non-production…' `
  -ConfirmNonProduction
```

The runner checks artifacts before opening a connection, applies the ordered migrations twice to demonstrate idempotence, then verifies:

- preservation of legacy IDs, financial values, timestamps, and nullable historical metadata;
- atomic correction change, same-category no-op, and rollback on an induced update failure;
- canonical latest-correction ordering by `(corrected_at, id)`;
- supported-category constraints; and
- `ON DELETE RESTRICT` retention for corrected expenses; and
- planning-table category, amount, frequency, effective-date, singleton, and index constraints.

Capture the `psql` output and target project identifier in the deployment change record. A successful rehearsal is not approval to run migrations in production; production remains a separate explicit user-controlled action.