-- Additive upgrade for legacy public.expenses tables. Apply only through the
-- ordered, non-production rehearsal process described in migrations/README.md.

begin;

create or replace function public.normalize_merchant_name(value text)
returns text
language sql
immutable
strict
as $$
  select lower(regexp_replace(btrim(value), E'\\s+', ' ', 'g'))
$$;

alter table public.expenses
  add column if not exists normalized_merchant text
    generated always as (public.normalize_merchant_name(merchant_name)) stored,
  add column if not exists confidence numeric(4, 3),
  add column if not exists reviewed boolean,
  add column if not exists classified_at timestamptz,
  add column if not exists classification_origin text;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.expenses'::regclass
      and conname = 'expenses_category_supported_check'
  ) then
    alter table public.expenses add constraint expenses_category_supported_check
      check (category in ('Food', 'Transport', 'Entertainment', 'Bills', 'Shopping', 'Income', 'Miscellaneous'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.expenses'::regclass
      and conname = 'expenses_confidence_range_check'
  ) then
    alter table public.expenses add constraint expenses_confidence_range_check
      check (confidence >= 0 and confidence <= 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.expenses'::regclass
      and conname = 'expenses_classification_origin_check'
  ) then
    alter table public.expenses add constraint expenses_classification_origin_check
      check (classification_origin in ('llm', 'correction_lookup'));
  end if;
end;
$migration$;

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

commit;
