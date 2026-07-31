-- Read-only analytics RPCs. Apply after 001_add_expense_metadata.sql and
-- 002_corrections_and_rpcs.sql; this migration does not modify financial data.
begin;

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
