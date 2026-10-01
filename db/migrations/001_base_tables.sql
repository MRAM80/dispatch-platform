-- 001 base tables
--
-- The tables the product cannot start without. These were originally created
-- by hand in the Supabase dashboard, which is why no migration existed for
-- them and why a brand new client could not be provisioned at all.
--
-- Reconstructed from a live project's PostgREST schema, so columns, types,
-- primary keys and foreign keys are accurate. Defaults and check constraints
-- were NOT recoverable that way and are set to sensible values here — run
-- `node scripts/doctor.mjs` against a reference project to confirm parity.
--
-- Deliberately excluded: the legacy `jobs`, `profiles`, `users`, `assignments`,
-- `config` and `pre_trip_inspections` tables that exist in older projects.
-- Nothing in the application reads them and new clients should not inherit them.

create table if not exists "customers" (
  id uuid primary key default gen_random_uuid(),
  name text,
  company_name text,
  contact_name text,
  phone text,
  email text,
  address text,
  service_address text,
  notes text,
  status text default 'active',
  is_active boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists "job_sites" (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references "customers"(id) on delete cascade,
  site_name text,
  address text,
  unit text,
  city text,
  province text default 'ON',
  postal_code text,
  notes text,
  -- Null means active. Always query with .neq('is_active', false).
  is_active boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists job_sites_customer_id_idx on "job_sites"(customer_id);

create table if not exists "dump_sites" (
  id uuid primary key default gen_random_uuid(),
  name text,
  address text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists "bins" (
  id uuid primary key default gen_random_uuid(),
  bin_number text,
  bin_size text,
  -- No bin_type here. CLAUDE.md documents one, but the reference project has
  -- none and nothing reads it; bin_type lives on "order", not on the bin.
  status text default 'available',
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists "trucks" (
  id uuid primary key default gen_random_uuid(),
  truck_number text,
  plate text,
  plate_number text,
  status text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists "drivers" (
  id uuid primary key default gen_random_uuid(),
  name text,
  phone text,
  email text,
  -- available | busy | heading_back | parked | stopped | emergency | offline
  status text default 'available',
  truck_id uuid references "trucks"(id) on delete set null,
  auth_user_id uuid,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists "user_profiles" (
  id uuid primary key default gen_random_uuid(),
  -- NB: user_id, not auth_user_id. The app queries .eq('user_id', auth.uid()).
  user_id uuid,
  role text,
  name text,
  email text,
  created_at timestamptz not null default now()
);
-- De-duplicate before enforcing uniqueness. `create unique index if not exists`
-- only skips when an index of that NAME exists -- it still builds the index, and
-- errors on duplicate data, which would abort 001 and every migration after it.
delete from "user_profiles" a
 using "user_profiles" b
 where a.user_id is not null
   and a.user_id = b.user_id
   and a.ctid < b.ctid;
create unique index if not exists user_profiles_user_id_key on "user_profiles"(user_id);

create table if not exists "order" (
  id uuid primary key default gen_random_uuid(),
  ticket_number text,
  order_type text,
  status text default 'unassigned',
  customer_id uuid references "customers"(id) on delete set null,
  customer_name text,
  customer_phone text,
  job_site_id uuid references "job_sites"(id) on delete set null,
  pickup_address text,
  service_address text,
  dropoff_address text,
  city text,
  postal_code text,
  driver_id uuid references "drivers"(id) on delete set null,
  bin_id uuid references "bins"(id) on delete set null,
  old_bin_id uuid references "bins"(id) on delete set null,
  -- Required by EXCHANGE / REMOVAL / DUMP RETURN. Without it those three job
  -- types cannot be saved at all, so a client provisioned without this column
  -- looks fine until the first exchange is booked.
  dump_site_id uuid references "dump_sites"(id) on delete set null,
  -- Integer in the reference project, while price_book.bin_size is text.
  -- The app stringifies before comparing. See db/README.md.
  bin_size integer,
  bin_type text,
  material text,
  material_type text,
  scheduled_date date,
  service_date date,
  service_time text,
  service_window text,
  route_position integer,
  notes text,
  driver_notes text,
  job_type text,
  ticket_type text,
  priority text,
  completed_by text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists order_driver_id_idx on "order"(driver_id);
create index if not exists order_customer_id_idx on "order"(customer_id);
create index if not exists order_scheduled_date_idx on "order"(scheduled_date);

create table if not exists "driver_push_subscriptions" (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid references "drivers"(id) on delete cascade,
  endpoint text,
  p256dh text,
  auth text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists driver_push_subscriptions_driver_id_idx on "driver_push_subscriptions"(driver_id);

-- Backfill for projects whose base tables already exist.
--
-- `create table if not exists` is a no-op the moment the table is there: it does
-- NOT reconcile columns. Without this block, running 001 against an older client
-- would add nothing, then record 001 as applied and never revisit it.
--
-- Generated from db/expected-schema.json so the two cannot drift. Columns that a
-- LATER migration adds are deliberately excluded -- creating them bare here would
-- turn that migration into a no-op and silently lose its foreign key.

-- customers
alter table "customers" add column if not exists address text;
alter table "customers" add column if not exists company_name text;
alter table "customers" add column if not exists contact_name text;
alter table "customers" add column if not exists created_at timestamptz;
alter table "customers" add column if not exists email text;
alter table "customers" add column if not exists is_active boolean;
alter table "customers" add column if not exists name text;
alter table "customers" add column if not exists notes text;
alter table "customers" add column if not exists phone text;
alter table "customers" add column if not exists service_address text;
alter table "customers" add column if not exists status text;
alter table "customers" add column if not exists updated_at timestamptz;

-- job_sites
alter table "job_sites" add column if not exists address text;
alter table "job_sites" add column if not exists created_at timestamptz;
alter table "job_sites" add column if not exists customer_id uuid;
alter table "job_sites" add column if not exists is_active boolean;
alter table "job_sites" add column if not exists notes text;
alter table "job_sites" add column if not exists site_name text;
alter table "job_sites" add column if not exists updated_at timestamptz;

-- dump_sites
alter table "dump_sites" add column if not exists address text;
alter table "dump_sites" add column if not exists created_at timestamptz;
alter table "dump_sites" add column if not exists name text;

-- bins
alter table "bins" add column if not exists bin_number text;
alter table "bins" add column if not exists bin_size text;
alter table "bins" add column if not exists created_at timestamptz;
alter table "bins" add column if not exists location text;
alter table "bins" add column if not exists status text;
alter table "bins" add column if not exists updated_at timestamptz;

-- trucks
alter table "trucks" add column if not exists created_at timestamptz;
alter table "trucks" add column if not exists notes text;
alter table "trucks" add column if not exists plate text;
alter table "trucks" add column if not exists plate_number text;
alter table "trucks" add column if not exists status text;
alter table "trucks" add column if not exists truck_number text;

-- drivers
alter table "drivers" add column if not exists auth_user_id uuid;
alter table "drivers" add column if not exists created_at timestamptz;
alter table "drivers" add column if not exists email text;
alter table "drivers" add column if not exists last_login_at timestamptz;
alter table "drivers" add column if not exists name text;
alter table "drivers" add column if not exists phone text;
alter table "drivers" add column if not exists status text;
alter table "drivers" add column if not exists truck_id uuid;
alter table "drivers" add column if not exists updated_at timestamptz;

-- user_profiles
alter table "user_profiles" add column if not exists created_at timestamptz;
alter table "user_profiles" add column if not exists email text;
alter table "user_profiles" add column if not exists name text;
alter table "user_profiles" add column if not exists role text;
alter table "user_profiles" add column if not exists user_id uuid;

-- order
alter table "order" add column if not exists bin_id uuid;
alter table "order" add column if not exists bin_size integer;
alter table "order" add column if not exists bin_type text;
alter table "order" add column if not exists city text;
alter table "order" add column if not exists completed_at timestamptz;
alter table "order" add column if not exists completed_by text;
alter table "order" add column if not exists created_at timestamp;
alter table "order" add column if not exists customer_id uuid;
alter table "order" add column if not exists customer_name text;
alter table "order" add column if not exists customer_phone text;
alter table "order" add column if not exists driver_id uuid;
alter table "order" add column if not exists driver_notes text;
alter table "order" add column if not exists dropoff_address text;
alter table "order" add column if not exists dump_site_id uuid;
alter table "order" add column if not exists job_site_id uuid;
alter table "order" add column if not exists job_type text;
alter table "order" add column if not exists material text;
alter table "order" add column if not exists material_type text;
alter table "order" add column if not exists notes text;
alter table "order" add column if not exists old_bin_id uuid;
alter table "order" add column if not exists order_type text;
alter table "order" add column if not exists pickup_address text;
alter table "order" add column if not exists postal_code text;
alter table "order" add column if not exists priority text;
alter table "order" add column if not exists route_position integer;
alter table "order" add column if not exists scheduled_date date;
alter table "order" add column if not exists service_address text;
alter table "order" add column if not exists service_date date;
alter table "order" add column if not exists service_time text;
alter table "order" add column if not exists service_window text;
alter table "order" add column if not exists status text;
alter table "order" add column if not exists ticket_number text;
alter table "order" add column if not exists ticket_type text;
alter table "order" add column if not exists updated_at timestamptz;

-- driver_push_subscriptions
alter table "driver_push_subscriptions" add column if not exists auth text;
alter table "driver_push_subscriptions" add column if not exists created_at timestamptz;
alter table "driver_push_subscriptions" add column if not exists driver_id uuid;
alter table "driver_push_subscriptions" add column if not exists endpoint text;
alter table "driver_push_subscriptions" add column if not exists p256dh text;
alter table "driver_push_subscriptions" add column if not exists updated_at timestamptz;

-- RLS. Every table starts publicly readable in a new Supabase project, so this
-- is not optional. Policies are `to authenticated` across the board, matching
-- the rest of the project; role separation lives in the app, except for
-- app_settings which is role-aware (see 008).
do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'customers','job_sites','dump_sites','bins','trucks','drivers',
    'user_profiles','order','driver_push_subscriptions'
  ] loop
    execute format('alter table %I enable row level security', t);

    -- Drop only the four policies this file owns. Older projects carry
    -- permissive "allow everyone" template policies that would override ours,
    -- so those are named explicitly -- but anything else a client has added
    -- deliberately is left alone. Blanket-dropping every policy on the table
    -- would destroy custom rules with no warning and no record.
    for p in select policyname from pg_policies
              where schemaname = 'public' and tablename = t
                and policyname in (
                  t || '_select', t || '_insert', t || '_update', t || '_delete',
                  'Enable read access for all users',
                  'Enable insert for all users',
                  'Enable update for all users',
                  'Enable delete for all users'
                ) loop
      execute format('drop policy if exists %I on %I', p.policyname, t);
    end loop;

    execute format('create policy %I on %I for select to authenticated using (true)', t || '_select', t);
    execute format('create policy %I on %I for insert to authenticated with check (true)', t || '_insert', t);
    execute format('create policy %I on %I for update to authenticated using (true) with check (true)', t || '_update', t);
    execute format('create policy %I on %I for delete to authenticated using (true)', t || '_delete', t);
  end loop;
end $$;
