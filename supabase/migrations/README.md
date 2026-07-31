# Forward-only migration convention

`supabase/migrations/` contains the **only** schema upgrades for an existing
Finance Tracker database. Migration files use a three-digit, zero-padded
sequence and are committed once; never edit, delete, or renumber a migration
that has been applied anywhere.

## Existing databases

1. Back up the target database and rehearse the complete ordered sequence in a
   non-production Supabase project with representative historical expenses.
2. **Do not run [`../expenses.sql`](../expenses.sql).** It is a fresh-install
   bootstrap and `create if not exists` cannot bring an existing database to the
   final schema.
3. Start with the current legacy `public.expenses` table, then apply every
   committed `*.sql` migration in lexical filename order, once per database.
4. Record each successfully applied filename in the deployment change record
   before applying the next file. Stop on an error; diagnose and rerun only the
   failed idempotent migration after the issue is resolved.
5. Verify that existing expense IDs, merchant names, amounts, categories,
   creation times, and transaction timestamps are unchanged. Historical
   metadata may remain `NULL`.
6. Deploy application code only after its prerequisite migration succeeds.
7. Production migration application requires separate, explicit approval; this
   repository does not apply migrations automatically.

## Reserved ordering

| Sequence | Filename | Scope |
| --- | --- | --- |
| 001 | `001_add_expense_metadata.sql` | Merchant normalization, optional expense metadata, constraints, and indexes. |
| 002 | `002_corrections_and_rpcs.sql` | Immutable corrections, correction lookup, and atomic correction RPC. |
| 003 | `003_accuracy_and_trend_rpcs.sql` | Classification accuracy and zero-filled spending trend RPCs. |
| 004 | `004_planning_schema.sql` | Budgets, income records, savings target, and planning indexes. |

Subsequent schema work must receive the next unused sequence number and be
idempotent (`if exists`/`if not exists`, `create or replace`, or guarded SQL as
appropriate). Each migration must be additive and preserve existing financial
columns and rows.

## Fresh installations

Run [`../expenses.sql`](../expenses.sql) once only when `public.expenses` and
all expansion tables are absent. It defines the final schema represented by the
ordered migration sequence, including tables, indexes, constraints, and RPCs.
It is intentionally not an upgrade or repair mechanism.
