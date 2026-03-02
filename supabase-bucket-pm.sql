-- ────────────────────────────────────────────────────────────
-- Bucket "pm" — accès public en lecture
-- À exécuter dans Supabase > SQL Editor
-- ────────────────────────────────────────────────────────────

-- 1. Rendre le bucket public
update storage.buckets
  set public = true
  where id = 'pm';

-- 2. Policy lecture publique sur les objets du bucket
drop policy if exists "public_read_pm" on storage.objects;
create policy "public_read_pm" on storage.objects
  for select to anon
  using (bucket_id = 'pm');

-- Vérification
select id, name, public from storage.buckets where id = 'pm';
