-- 004 invoices
--
-- The invoice register. Numbers come from a DB sequence so concurrent tills cannot collide.
--
-- Ported verbatim from the runbook in CLAUDE.md; every statement is idempotent.

create sequence if not exists invoice_number_seq start 1;

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique
    default ('INV-' || lpad(nextval('invoice_number_seq')::text, 5, '0')),
  kind text not null default 'counter' check (kind in ('counter','account')),
  customer_id uuid references customers(id) on delete set null,
  customer_name text,
  issue_date date not null default current_date,
  subtotal numeric(10,2) not null default 0,
  tax_rate numeric(5,2) not null default 13,
  tax_amount numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  status text not null default 'paid' check (status in ('draft','sent','paid','void')),
  payment_method text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  description text not null,
  unit text,
  quantity numeric(10,2) not null default 1,
  rate numeric(10,2) not null default 0,
  amount numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);

alter table invoices enable row level security;
alter table invoice_items enable row level security;
drop policy if exists "invoices_select" on invoices;
drop policy if exists "invoices_insert" on invoices;
drop policy if exists "invoices_update" on invoices;
drop policy if exists "invoices_delete" on invoices;
create policy "invoices_select" on invoices for select to authenticated using (true);
create policy "invoices_insert" on invoices for insert to authenticated with check (true);
create policy "invoices_update" on invoices for update to authenticated using (true) with check (true);
create policy "invoices_delete" on invoices for delete to authenticated using (true);
drop policy if exists "invoice_items_select" on invoice_items;
drop policy if exists "invoice_items_insert" on invoice_items;
drop policy if exists "invoice_items_update" on invoice_items;
drop policy if exists "invoice_items_delete" on invoice_items;
create policy "invoice_items_select" on invoice_items for select to authenticated using (true);
create policy "invoice_items_insert" on invoice_items for insert to authenticated with check (true);
create policy "invoice_items_update" on invoice_items for update to authenticated using (true) with check (true);
create policy "invoice_items_delete" on invoice_items for delete to authenticated using (true);
