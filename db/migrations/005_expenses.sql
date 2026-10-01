-- 005 expenses
--
-- Supplier bills. Must exist before 006, which links stock movements to them.
--
-- Ported verbatim from the runbook in CLAUDE.md; every statement is idempotent.

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  supplier text,
  category text,
  description text,
  subtotal numeric(10,2) not null default 0,
  tax_amount numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  payment_method text,
  receipt_url text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table expenses enable row level security;
drop policy if exists "expenses_select" on expenses;
drop policy if exists "expenses_insert" on expenses;
drop policy if exists "expenses_update" on expenses;
drop policy if exists "expenses_delete" on expenses;
create policy "expenses_select" on expenses for select to authenticated using (true);
create policy "expenses_insert" on expenses for insert to authenticated with check (true);
create policy "expenses_update" on expenses for update to authenticated using (true) with check (true);
create policy "expenses_delete" on expenses for delete to authenticated using (true);
