create table if not exists public.expenses (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  merchant_name varchar not null,
  amount numeric(10, 2) not null,
  category varchar not null,
  timestamp timestamptz not null,
  constraint unique_transaction_signature unique (
    merchant_name,
    amount,
    timestamp
  )
);
