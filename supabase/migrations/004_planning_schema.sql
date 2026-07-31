-- Requires: 001_add_expense_metadata.sql through 003_accuracy_and_trend_rpcs.sql.
-- Forward-only, additive planning inputs; do not apply to production automatically.

begin;

create table if not exists public.category_budgets (
  category varchar primary key check (category in (
    'Food', 'Transport', 'Entertainment', 'Bills', 'Shopping', 'Miscellaneous'
  )),
  monthly_limit numeric(12, 2) not null check (monthly_limit >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.income_records (
  id bigserial primary key,
  amount numeric(12, 2) not null check (amount > 0),
  frequency varchar not null check (frequency in ('weekly', 'biweekly', 'monthly')),
  effective_date date not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Supports selection of the latest record whose effective date is not later
-- than the finance-local calculation date.
create index if not exists income_records_effective_date_idx
  on public.income_records (effective_date desc);

create table if not exists public.savings_targets (
  id smallint primary key default 1 check (id = 1),
  mode varchar not null check (mode in ('fixed', 'percentage')),
  value numeric(12, 4) not null check (value >= 0),
  updated_at timestamptz not null default now()
);

-- Supports current-month spending reads for configured budget categories.
-- Migration 001 normally creates this index; keep this migration independently
-- idempotent when replayed against a schema missing that supporting index.
create index if not exists expenses_category_timestamp_idx
  on public.expenses (category, timestamp);

commit;
