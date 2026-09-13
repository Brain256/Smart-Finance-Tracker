-- Complete schema. Run once against an empty Supabase project to create every
-- table, index, constraint, trigger, and RPC the application expects.
--
-- Idempotent by construction (create if not exists / create or replace), so a
-- rerun against an already-provisioned database is a no-op. It does not migrate
-- an existing table whose columns differ from the definitions below.

begin;

create or replace function public.normalize_merchant_name(value text)
returns text
language sql
immutable
strict
as $$
  select lower(regexp_replace(btrim(value), E'\\s+', ' ', 'g'))
$$;

create table if not exists public.expenses (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  merchant_name varchar not null,
  normalized_merchant text generated always as (
    public.normalize_merchant_name(merchant_name)
  ) stored,
  amount numeric(10, 2) not null check (amount > 0),
  category varchar not null check (category in (
    'Food', 'Transport', 'Entertainment', 'Bills', 'Shopping', 'Income', 'Miscellaneous'
  )),
  timestamp timestamptz not null,
  confidence numeric(4, 3) check (confidence >= 0 and confidence <= 1),
  reviewed boolean,
  classified_at timestamptz,
  classification_origin text check (classification_origin in ('llm', 'correction_lookup')),
  constraint unique_transaction_signature unique (merchant_name, amount, timestamp)
);

create index if not exists expenses_normalized_merchant_idx
  on public.expenses (normalized_merchant);
create index if not exists expenses_normalized_merchant_timestamp_idx
  on public.expenses (normalized_merchant, timestamp);
create index if not exists expenses_classified_at_idx
  on public.expenses (classified_at);
create index if not exists expenses_timestamp_idx
  on public.expenses (timestamp);
create index if not exists expenses_category_timestamp_idx
  on public.expenses (category, timestamp);

create table if not exists public.corrections (
  id bigserial primary key,
  expense_id bigint not null references public.expenses(id) on delete restrict,
  original_category varchar not null check (original_category in (
    'Food', 'Transport', 'Entertainment', 'Bills', 'Shopping', 'Income', 'Miscellaneous'
  )),
  corrected_category varchar not null check (corrected_category in (
    'Food', 'Transport', 'Entertainment', 'Bills', 'Shopping', 'Income', 'Miscellaneous'
  )),
  corrected_at timestamptz not null default now()
);

create or replace function public.reject_correction_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'corrections are immutable' using errcode = '55000';
end;
$$;

drop trigger if exists corrections_reject_mutation on public.corrections;
create trigger corrections_reject_mutation
before update or delete on public.corrections
for each row execute function public.reject_correction_mutation();

create index if not exists corrections_expense_corrected_at_id_idx
  on public.corrections (expense_id, corrected_at desc, id desc);

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

create index if not exists income_records_effective_date_idx
  on public.income_records (effective_date desc);

create table if not exists public.savings_targets (
  id smallint primary key default 1 check (id = 1),
  mode varchar not null check (mode in ('fixed', 'percentage')),
  value numeric(12, 4) not null check (value >= 0),
  updated_at timestamptz not null default now()
);

create or replace function public.resolve_latest_correction(p_merchant_name text)
returns table (corrected_category varchar)
language sql
stable
strict
set search_path = public
as $$
  select correction.corrected_category
  from public.corrections as correction
  join public.expenses as expense on expense.id = correction.expense_id
  where expense.normalized_merchant = public.normalize_merchant_name(p_merchant_name)
  order by correction.corrected_at desc, correction.id desc
  limit 1
$$;

create or replace function public.correct_expense_category(
  p_expense_id bigint,
  p_corrected_category text
)
returns table (
  id bigint,
  merchant_name varchar,
  amount numeric,
  category varchar,
  -- Quoted: "timestamp" is a reserved type keyword, so an unquoted column of
  -- that name is a syntax error inside a returns-table list.
  "timestamp" timestamptz,
  confidence numeric,
  reviewed boolean,
  classified_at timestamptz,
  classification_origin text,
  changed boolean,
  correction_id bigint
)
language plpgsql
set search_path = public
as $$
declare
  v_expense public.expenses%rowtype;
  v_correction_id bigint;
begin
  if p_corrected_category is null or p_corrected_category not in (
    'Food', 'Transport', 'Entertainment', 'Bills', 'Shopping', 'Income', 'Miscellaneous'
  ) then
    raise exception 'corrected category is not supported' using errcode = '23514';
  end if;

  select expense.*
  into v_expense
  from public.expenses as expense
  where expense.id = p_expense_id
  for update;

  if not found then
    raise exception 'expense % not found', p_expense_id using errcode = 'P0002';
  end if;

  if v_expense.category = p_corrected_category then
    return query
    select
      v_expense.id,
      v_expense.merchant_name,
      v_expense.amount,
      v_expense.category,
      v_expense.timestamp,
      v_expense.confidence,
      v_expense.reviewed,
      v_expense.classified_at,
      v_expense.classification_origin,
      false,
      null::bigint;
    return;
  end if;

  insert into public.corrections (expense_id, original_category, corrected_category)
  values (v_expense.id, v_expense.category, p_corrected_category)
  returning corrections.id into v_correction_id;

  update public.expenses as expense
  set category = p_corrected_category,
      reviewed = true
  where expense.id = v_expense.id
  returning expense.* into v_expense;

  return query
  select
    v_expense.id,
    v_expense.merchant_name,
    v_expense.amount,
    v_expense.category,
    v_expense.timestamp,
    v_expense.confidence,
    v_expense.reviewed,
    v_expense.classified_at,
    v_expense.classification_origin,
    true,
    v_correction_id;
end;
$$;

create or replace function public.get_classification_accuracy(
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  total_classified bigint,
  corrected_count bigint
)
language sql
stable
strict
as $$
  select
    count(*)::bigint as total_classified,
    count(*) filter (
      where exists (
        select 1
        from public.corrections as correction
        where correction.expense_id = expense.id
      )
    )::bigint as corrected_count
  from public.expenses as expense
  where expense.classified_at >= p_start
    and expense.classified_at < p_end
$$;

create or replace function public.get_daily_spending_trend(
  p_start_date date,
  p_end_date date,
  p_timezone text
)
returns table (
  local_date date,
  total numeric
)
language sql
stable
strict
as $$
  with days as (
    select generate_series(p_start_date, p_end_date, interval '1 day')::date as local_date
  )
  select
    days.local_date,
    coalesce(sum(expense.amount), 0)::numeric as total
  from days
  left join public.expenses as expense
    on (expense.timestamp at time zone p_timezone)::date = days.local_date
   and expense.category <> 'Income'
  group by days.local_date
  order by days.local_date
$$;

commit;
