-- 008 app settings
--
-- System Setup: the per-client module switches behind /setup.
--
-- Ported verbatim from the runbook in CLAUDE.md; every statement is idempotent.

-- One row only; the boolean primary key with check(id) enforces it.
create table if not exists app_settings (
  id boolean primary key default true check (id),
  modules jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table app_settings enable row level security;
drop policy if exists "app_settings_select" on app_settings;
drop policy if exists "app_settings_insert" on app_settings;
drop policy if exists "app_settings_update" on app_settings;
drop policy if exists "app_settings_delete" on app_settings;

-- Everyone signed in must read it: the sidebar is built from it.
create policy "app_settings_select" on app_settings
  for select to authenticated using (true);

-- Only owner/manager may reshape the app. Note this is the first table in the
-- project whose policy is role-aware rather than `using (true)`.
create policy "app_settings_insert" on app_settings
  for insert to authenticated with check (
    exists (select 1 from user_profiles up
            where up.user_id = auth.uid() and up.role in ('owner','manager'))
  );

create policy "app_settings_update" on app_settings
  for update to authenticated using (
    exists (select 1 from user_profiles up
            where up.user_id = auth.uid() and up.role in ('owner','manager'))
  ) with check (
    exists (select 1 from user_profiles up
            where up.user_id = auth.uid() and up.role in ('owner','manager'))
  );

-- Deliberately no delete policy: the setup row is never removed.
