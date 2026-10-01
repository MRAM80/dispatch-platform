-- 009 storage
--
-- The delivery-photos bucket. Must be public for getPublicUrl, and upload uses upsert so UPDATE is required too.
--
-- Ported verbatim from the runbook in CLAUDE.md; every statement is idempotent.

insert into storage.buckets (id, name, public)
values ('delivery-photos', 'delivery-photos', true)
on conflict (id) do update set public = true;
drop policy if exists "delivery_photos_insert" on storage.objects;
drop policy if exists "delivery_photos_update" on storage.objects;
drop policy if exists "delivery_photos_select" on storage.objects;
create policy "delivery_photos_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'delivery-photos');
create policy "delivery_photos_update" on storage.objects
  for update to authenticated using (bucket_id = 'delivery-photos') with check (bucket_id = 'delivery-photos');
create policy "delivery_photos_select" on storage.objects
  for select to authenticated using (bucket_id = 'delivery-photos');
