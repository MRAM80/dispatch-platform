-- 003 price book
--
-- Rates for bin services and products. The base for every invoice.
--
-- Ported verbatim from the runbook in CLAUDE.md; every statement is idempotent.

create table if not exists price_book (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('service','product')),
  service_type text,
  bin_size text,
  name text,
  unit text,
  price numeric(10,2) not null default 0,
  customer_id uuid references customers(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table price_book enable row level security;
drop policy if exists "price_book_select" on price_book;
drop policy if exists "price_book_insert" on price_book;
drop policy if exists "price_book_update" on price_book;
drop policy if exists "price_book_delete" on price_book;
create policy "price_book_select" on price_book for select to authenticated using (true);
create policy "price_book_insert" on price_book for insert to authenticated with check (true);
create policy "price_book_update" on price_book for update to authenticated using (true) with check (true);
create policy "price_book_delete" on price_book for delete to authenticated using (true);
