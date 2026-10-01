-- 007 order items
--
-- Material and charges carried by an order. Needs invoices (004) and stock_movements (006).
--
-- Ported verbatim from the runbook in CLAUDE.md; every statement is idempotent.

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references "order"(id) on delete cascade,
  price_book_id uuid references price_book(id) on delete set null,
  kind text not null default 'product' check (kind in ('product','charge')),
  description text not null,
  unit text,
  quantity numeric(10,2) not null default 1,
  rate numeric(10,2) not null default 0,
  amount numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists order_items_order_id_idx on order_items(order_id);

alter table order_items enable row level security;
drop policy if exists "order_items_select" on order_items;
drop policy if exists "order_items_insert" on order_items;
drop policy if exists "order_items_update" on order_items;
drop policy if exists "order_items_delete" on order_items;
create policy "order_items_select" on order_items for select to authenticated using (true);
create policy "order_items_insert" on order_items for insert to authenticated with check (true);
create policy "order_items_update" on order_items for update to authenticated using (true) with check (true);
create policy "order_items_delete" on order_items for delete to authenticated using (true);

-- Which invoice settled this order, and whether it was paid when placed
alter table "order" add column if not exists invoice_id uuid references invoices(id) on delete set null;
alter table "order" add column if not exists prepaid boolean not null default false;

-- ⚠ PENDING 2026-08-01 — run in BOTH projects. When the money actually arrived,
-- as opposed to when the invoice was raised. The code tolerates its absence
-- (app/invoices/page.tsx falls back to a select and an update without it), so
-- deploy order does not matter — but no payment date is recorded until it runs.
alter table invoices add column if not exists paid_at date;

-- Stock movements can be caused by an order, not just a counter invoice
alter table stock_movements add column if not exists order_id uuid references "order"(id) on delete set null;
