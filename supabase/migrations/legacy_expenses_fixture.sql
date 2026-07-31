-- Disposable non-production fixture for validating additive migrations.
-- Run only in an empty database dedicated to this rehearsal.

create table public.expenses (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  merchant_name varchar not null,
  amount numeric(10, 2) not null check (amount > 0),
  category varchar not null check (category in (
    'Food', 'Transport', 'Entertainment', 'Bills', 'Shopping', 'Income', 'Miscellaneous'
  )),
  timestamp timestamptz not null,
  constraint unique_transaction_signature unique (merchant_name, amount, timestamp)
);

insert into public.expenses (id, created_at, merchant_name, amount, category, timestamp)
values
  (101, '2024-01-02 03:04:05+00', 'LEGACY PRESERVE', 12.34, 'Food', '2024-01-02 03:04:05+00'),
  (102, '2024-02-03 04:05:06+00', 'HISTORICAL NULL', 56.78, 'Shopping', '2024-02-03 04:05:06+00');

select setval(pg_get_serial_sequence('public.expenses', 'id'), 102, true);