-- ============================================================
-- PARABASKET — Setup complet Supabase
-- À exécuter dans Supabase > SQL Editor
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. TABLES
-- ────────────────────────────────────────────────────────────

-- Joueuses / joueurs
create table if not exists joueuses (
  id          uuid primary key default gen_random_uuid(),
  prenom      text not null,
  nom         text not null,
  numero_tel  text unique not null,
  categorie   text,                    -- 'Masculin' | 'Féminin'
  created_at  timestamptz default now()
);

-- Staff
create table if not exists staff (
  id          uuid primary key default gen_random_uuid(),
  prenom      text not null,
  nom         text not null,
  numero_tel  text unique not null,
  masculin    boolean default false,
  feminin     boolean default false,
  created_at  timestamptz default now()
);

-- Billets de train
create table if not exists billets (
  id            uuid primary key default gen_random_uuid(),
  joueuse_id    uuid references joueuses(id) on delete cascade,
  nom_fichier   text not null,
  url_stockage  text not null,
  created_at    timestamptz default now()
);

-- Activités sportives
create table if not exists activites (
  id          uuid primary key default gen_random_uuid(),
  joueuse_id  uuid references joueuses(id) on delete cascade,
  sport       text not null,
  duree       text not null,
  difficulte  integer check (difficulte between 1 and 10),
  plaisir     integer check (plaisir between 1 and 10),
  commentaire text default '',
  date        date not null,
  created_at  timestamptz default now()
);

-- Suivi forme quotidienne
create table if not exists suivi_forme (
  id          uuid primary key default gen_random_uuid(),
  joueuse_id  uuid references joueuses(id) on delete cascade,
  date        date not null,
  fatigue     integer check (fatigue between 1 and 5),
  sommeil     integer check (sommeil between 1 and 5),
  douleur     integer check (douleur between 1 and 5),
  stress      integer check (stress between 1 and 5),
  humeur      integer check (humeur between 1 and 5),
  commentaire text default '',
  created_at  timestamptz default now()
);

-- Suivi émotions (prépa mentale)
-- IMPORTANT : la colonne 'metadata' est de type jsonb pour stocker expression + pensees_type
create table if not exists suivi_emotions (
  id          uuid primary key default gen_random_uuid(),
  joueur_id   uuid references joueuses(id) on delete cascade,
  date        date not null,
  emotion_nom text not null,
  intensite   integer check (intensite between 1 and 10),
  declencheur text default '',
  ressources  text default '',
  metadata    jsonb default '{}',      -- { expression, pensees_type }
  created_at  timestamptz default now()
);

-- Suivi respiration (prépa mentale)
create table if not exists suivi_respiration (
  id          uuid primary key default gen_random_uuid(),
  joueur_id   uuid references joueuses(id) on delete cascade,
  date        date not null,
  contexte    text,                    -- id catégorie : 'activation' | 'relaxation' | 'scan'
  exercice    text,                    -- id exercice : 'lapin' | '4-6' | 'scan-1' | 'scan-2'
  commentaire text default '',
  created_at  timestamptz default now()
);


-- ────────────────────────────────────────────────────────────
-- 2. MIGRATION — ajouter metadata si la table existe déjà sans elle
-- ────────────────────────────────────────────────────────────

alter table suivi_emotions
  add column if not exists metadata jsonb default '{}';


-- ────────────────────────────────────────────────────────────
-- 3. ACTIVER RLS SUR TOUTES LES TABLES
-- ────────────────────────────────────────────────────────────

alter table joueuses         enable row level security;
alter table staff            enable row level security;
alter table billets          enable row level security;
alter table activites        enable row level security;
alter table suivi_forme      enable row level security;
alter table suivi_emotions   enable row level security;
alter table suivi_respiration enable row level security;


-- ────────────────────────────────────────────────────────────
-- 4. POLICIES RLS
-- L'app utilise la clé anon côté client (pas d'auth Supabase).
-- On autorise toutes les opérations via anon key.
-- Si tu veux restreindre plus tard, remplace "true" par des
-- conditions basées sur auth.uid().
-- ────────────────────────────────────────────────────────────

-- Supprimer les anciennes policies si elles existent (idempotent)
drop policy if exists "anon_read_joueuses"          on joueuses;
drop policy if exists "anon_read_staff"             on staff;
drop policy if exists "anon_read_billets"           on billets;
drop policy if exists "anon_all_activites"          on activites;
drop policy if exists "anon_all_suivi_forme"        on suivi_forme;
drop policy if exists "anon_all_suivi_emotions"     on suivi_emotions;
drop policy if exists "anon_all_suivi_respiration"  on suivi_respiration;

-- joueuses : lecture seule (l'app ne crée pas de joueurs depuis le client)
create policy "anon_read_joueuses" on joueuses
  for select to anon using (true);

-- staff : lecture seule
create policy "anon_read_staff" on staff
  for select to anon using (true);

-- billets : lecture seule (les billets sont créés par le script admin)
create policy "anon_read_billets" on billets
  for select to anon using (true);

-- activites : toutes opérations (select, insert, update, delete)
create policy "anon_all_activites" on activites
  for all to anon using (true) with check (true);

-- suivi_forme : toutes opérations
create policy "anon_all_suivi_forme" on suivi_forme
  for all to anon using (true) with check (true);

-- suivi_emotions : toutes opérations
create policy "anon_all_suivi_emotions" on suivi_emotions
  for all to anon using (true) with check (true);

-- suivi_respiration : toutes opérations
create policy "anon_all_suivi_respiration" on suivi_respiration
  for all to anon using (true) with check (true);


-- ────────────────────────────────────────────────────────────
-- 5. STORAGE — bucket Billets
-- À faire dans Supabase > Storage si pas encore fait
-- ────────────────────────────────────────────────────────────

-- Créer le bucket (si pas déjà fait via l'interface)
insert into storage.buckets (id, name, public)
  values ('Billets', 'Billets', true)
  on conflict (id) do nothing;

-- Policy lecture publique sur le bucket Billets
drop policy if exists "public_read_billets" on storage.objects;
create policy "public_read_billets" on storage.objects
  for select to anon
  using (bucket_id = 'Billets');

-- Policy écriture pour la service role (script admin)
-- (la service role bypasse RLS par défaut, pas besoin de policy)


-- ────────────────────────────────────────────────────────────
-- 6. VÉRIFICATION
-- ────────────────────────────────────────────────────────────

-- Pour vérifier que les policies sont bien créées :
-- select tablename, policyname, cmd from pg_policies where schemaname = 'public';
