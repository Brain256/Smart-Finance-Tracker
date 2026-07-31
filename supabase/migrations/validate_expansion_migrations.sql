\set ON_ERROR_STOP on

-- Execute only after migrations 001–004 in a disposable non-production database.
-- All fixtures and test-side objects are rolled back at the end of this file.
begin;

create function pg_temp.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_condition is distinct from true then
    raise exception '%', p_message;
  end if;
end;
$$;

create function pg_temp.assert_raises(p_statement text, p_expected_state text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlstate = p_expected_state then
      return;
    end if;
    raise exception 'expected SQLSTATE %, received %', p_expected_state, sqlstate;
  end;
  raise exception 'statement did not fail with SQLSTATE %', p_expected_state;
end;
$$;

do $$
declare
  preserved public.expenses%rowtype;
begin
  select * into preserved from public.expenses where id = 101;
  perform pg_temp.assert_true(
    preserved.id = 101
    and preserved.merchant_name = 'LEGACY PRESERVE'
    and preserved.amount = 12.34
    and preserved.category = 'Food'
    and preserved.created_at = '2024-01-02 03:04:05+00'
    and preserved.timestamp = '2024-01-02 03:04:05+00',
    'financial fields changed during migration'
  );
  perform pg_temp.assert_true(
    preserved.confidence is null and preserved.reviewed is null
    and preserved.classified_at is null and preserved.classification_origin is null,
    'historical metadata must remain nullable'
  );
end;
$$;

insert into public.expenses (merchant_name, amount, category, timestamp, reviewed)
values ('ATOMIC CHANGE', 10.00, 'Food', '2025-01-01 00:00:00+00', false);

insert into public.expenses (merchant_name, amount, category, timestamp, reviewed)
values ('ATOMIC ROLLBACK', 11.00, 'Food', '2025-01-01 00:01:00+00', false);

do $$
declare
  changed_row record;
  no_op_row record;
  before_count bigint;
  changed_id bigint;
begin
  select count(*) into before_count from public.corrections;
  select * into changed_row
  from public.correct_expense_category(
    (select id from public.expenses where merchant_name = 'ATOMIC CHANGE'),
    'Transport'
  );
  changed_id := (select id from public.expenses where merchant_name = 'ATOMIC CHANGE');
  perform pg_temp.assert_true(
    changed_row.changed and changed_row.correction_id is not null
    and changed_row.category = 'Transport' and changed_row.reviewed,
    'correction change was not atomic'
  );
  perform pg_temp.assert_true(
    (select count(*) from public.corrections where expense_id = changed_id) = 1
    and (select original_category from public.corrections where expense_id = changed_id) = 'Food'
    and (select corrected_category from public.corrections where expense_id = changed_id) = 'Transport'
    and (select count(*) from public.corrections) = before_count + 1,
    'correction audit record is incorrect'
  );

  select * into no_op_row
  from public.correct_expense_category(changed_id, 'Transport');
  perform pg_temp.assert_true(
    not no_op_row.changed and no_op_row.correction_id is null
    and (select count(*) from public.corrections where expense_id = changed_id) = 1,
    'same-category correction was not a no-op'
  );
end;
$$;

create function pg_temp.reject_validation_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'intentional migration validation update failure';
end;
$$;

create trigger migration_validation_reject_update
before update of category on public.expenses
for each row
when (old.merchant_name = 'ATOMIC ROLLBACK')
execute function pg_temp.reject_validation_update();

do $$
declare
  rollback_id bigint;
begin
  select id into rollback_id from public.expenses where merchant_name = 'ATOMIC ROLLBACK';
  perform pg_temp.assert_raises(
    format('select * from public.correct_expense_category(%s, ''Entertainment'')', rollback_id),
    'P0001'
  );
  perform pg_temp.assert_true(
    (select category = 'Food' and reviewed = false from public.expenses where id = rollback_id)
    and (select count(*) from public.corrections where expense_id = rollback_id) = 0,
    'failed correction did not roll back'
  );
end;
$$;

insert into public.expenses (merchant_name, amount, category, timestamp)
values ('LOOKUP MARKET', 20.00, 'Food', '2025-01-02 00:00:00+00');

do $$
declare
  lookup_id bigint;
begin
  select id into lookup_id from public.expenses where merchant_name = 'LOOKUP MARKET';
  insert into public.corrections (expense_id, original_category, corrected_category, corrected_at)
  values
    (lookup_id, 'Food', 'Transport', '2025-01-03 00:00:00+00'),
    (lookup_id, 'Food', 'Bills', '2025-01-03 00:00:00+00');
  perform pg_temp.assert_true(
    (select corrected_category from public.resolve_latest_correction('  lookup   market  ')) = 'Bills',
    'latest correction ordering is incorrect'
  );
  perform pg_temp.assert_raises(
    format(
      'insert into public.corrections (expense_id, original_category, corrected_category) values (%s, ''Invalid'', ''Food'')',
      lookup_id
    ),
    '23514'
  );
  perform pg_temp.assert_raises(
    format('select * from public.correct_expense_category(%s, ''Invalid'')', lookup_id),
    '23514'
  );
  perform pg_temp.assert_true(
    (select count(*) from public.corrections where expense_id = lookup_id) = 2,
    'unsupported correction category was accepted'
  );
  perform pg_temp.assert_raises(
    format('delete from public.expenses where id = %s', lookup_id),
    '23503'
  );
  perform pg_temp.assert_true(
    exists (select 1 from public.expenses where id = lookup_id),
    'corrected expense deletion was not restricted'
  );
end;
$$;

do $$
declare
  income_record_id bigint;
begin
  insert into public.category_budgets (category, monthly_limit)
  values ('Food', 250.00);
  perform pg_temp.assert_true(
    (select monthly_limit = 250.00 from public.category_budgets where category = 'Food'),
    'category budget was not stored'
  );
  perform pg_temp.assert_raises(
    $statement$insert into public.category_budgets (category, monthly_limit) values ('Income', 1.00)$statement$,
    '23514'
  );
  perform pg_temp.assert_raises(
    $statement$insert into public.category_budgets (category, monthly_limit) values ('Bills', -0.01)$statement$,
    '23514'
  );

  insert into public.income_records (amount, frequency, effective_date)
  values (1000.00, 'monthly', '2025-01-01')
  returning id into income_record_id;
  perform pg_temp.assert_true(income_record_id is not null, 'income record was not stored');
  perform pg_temp.assert_raises(
    $statement$insert into public.income_records (amount, frequency, effective_date) values (0, 'monthly', '2025-02-01')$statement$,
    '23514'
  );
  perform pg_temp.assert_raises(
    $statement$insert into public.income_records (amount, frequency, effective_date) values (1, 'daily', '2025-02-01')$statement$,
    '23514'
  );
  perform pg_temp.assert_raises(
    $statement$insert into public.income_records (amount, frequency, effective_date) values (1, 'weekly', '2025-01-01')$statement$,
    '23505'
  );

  insert into public.savings_targets (mode, value) values ('fixed', 100.00);
  perform pg_temp.assert_raises(
    $statement$insert into public.savings_targets (id, mode, value) values (2, 'percentage', 10.00)$statement$,
    '23514'
  );
  perform pg_temp.assert_raises(
    $statement$insert into public.savings_targets (mode, value) values ('monthly', 1.00)$statement$,
    '23514'
  );
  perform pg_temp.assert_raises(
    $statement$insert into public.savings_targets (mode, value) values ('fixed', -0.0001)$statement$,
    '23514'
  );

  perform pg_temp.assert_true(
    to_regclass('public.income_records_effective_date_idx') is not null,
    'active-income lookup index is missing'
  );
  perform pg_temp.assert_true(
    to_regclass('public.expenses_category_timestamp_idx') is not null,
    'current-month budget read index is missing'
  );
end;
$$;

rollback;