-- 006 inventory
--
-- Retail stock on price_book products, the movement ledger, and the atomic adjust_stock().
--
-- Ported verbatim from the runbook in CLAUDE.md; every statement is idempotent.

alter table price_book add column if not exists track_stock boolean not null default false;
alter table price_book add column if not exists stock_qty numeric(10,2) not null default 0;
alter table price_book add column if not exists low_stock_at numeric(10,2);

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  price_book_id uuid not null references price_book(id) on delete cascade,
  movement_date date not null default current_date,
  kind text not null check (kind in ('receive','sale','adjust','return')),
  quantity numeric(10,2) not null,
  note text,
  invoice_id uuid references invoices(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table stock_movements enable row level security;
drop policy if exists "stock_movements_select" on stock_movements;
drop policy if exists "stock_movements_insert" on stock_movements;
drop policy if exists "stock_movements_update" on stock_movements;
drop policy if exists "stock_movements_delete" on stock_movements;
create policy "stock_movements_select" on stock_movements for select to authenticated using (true);
create policy "stock_movements_insert" on stock_movements for insert to authenticated with check (true);
create policy "stock_movements_update" on stock_movements for update to authenticated using (true) with check (true);
create policy "stock_movements_delete" on stock_movements for delete to authenticated using (true);

-- Receiving a delivery links the supplier bill to the stock it brought in
alter table expenses add column if not exists reference text;
alter table stock_movements add column if not exists expense_id uuid references expenses(id) on delete set null;

-- Atomic increment/decrement; returns the new quantity
create or replace function adjust_stock(p_id uuid, p_delta numeric)
returns numeric
language sql
security invoker
as $$
  update price_book
     set stock_qty = stock_qty + p_delta,
         updated_at = now()
   where id = p_id
  returning stock_qty;
$$;
grant execute on function adjust_stock(uuid, numeric) to authenticated;
