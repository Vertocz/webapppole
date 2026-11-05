-- ============================================================
-- ANALYSE VIDÉO — matchs tagués par le staff (pôle masculin)
-- À exécuter dans Supabase > SQL Editor (une seule fois, ré-exécutable)
-- ============================================================

-- 1) Un match = une rencontre, avec ses 4 joueurs et sa vidéo locale
create table if not exists analyse_matchs (
  id               uuid primary key default gen_random_uuid(),
  pole             text not null default 'masculin' check (pole in ('masculin', 'feminin')),
  date_match       date not null,
  adversaire       text,
  competition      text,
  -- ids des 4 joueurs (table joueuses)
  effectif         text[] not null default '{}',
  -- Tirs adverses : 'aucun' (rien), 'simple' (1 pt / 2 pts / LF), 'position' (comme nous)
  mode_adversaire  text not null default 'simple' check (mode_adversaire in ('aucun', 'simple', 'position')),
  -- Fichier vidéo sur le PC du coach (jamais envoyé) : sert à le reconnaître
  video_nom        text,
  video_taille     bigint,
  -- Début du match dans la vidéo, en secondes (utile pour une vidéo d'une journée entière)
  video_debut      real not null default 0,
  -- Repères du calibrage : [{ "id": "...", "u": 0..1, "v": 0..1 }]
  calibration      jsonb,
  cree_par         text,
  cree_le          timestamptz not null default now(),
  modifie_le       timestamptz not null default now()
);

create index if not exists analyse_matchs_pole_idx on analyse_matchs (pole, date_match desc);

-- 2) Une action = un événement tagué sur la vidéo
create table if not exists analyse_actions (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references analyse_matchs(id) on delete cascade,
  -- Instant dans la vidéo, en secondes
  t           real not null,
  type        text not null,
  equipe      text not null default 'nous' check (equipe in ('nous', 'adversaire')),
  joueuse_id  text,
  -- Tirs : 1 ou 2 points (lancer franc = 1)
  points      smallint check (points in (1, 2)),
  zone        text check (zone in ('sous_panier', 'int_gauche', 'int_axe', 'int_droite',
                                   'ext_gauche', 'ext_axe', 'ext_droite')),
  -- Position du tir sur le demi-terrain, en mètres (x : -7,5 à 7,5 ; y : 0 = ligne de fond)
  x           real,
  y           real,
  resultat    text check (resultat in ('reussi', 'rate', 'attente')),
  rebond      text check (rebond in ('off', 'def')),
  -- Repères : titre libre donné par le coach
  titre       text,
  cree_le     timestamptz not null default now()
);

-- Mise à jour d'une table déjà créée : colonne titre et type « repere »
alter table analyse_actions add column if not exists titre text;
alter table analyse_actions drop constraint if exists analyse_actions_type_check;
alter table analyse_actions add constraint analyse_actions_type_check
  check (type in ('tir', 'lf', 'rebond', 'ballon_gagne', 'ballon_perdu', 'repere'));

create index if not exists analyse_actions_match_idx on analyse_actions (match_id, t);

-- 3) Accès : même modèle que le reste de l'app (pas de Supabase Auth,
--    l'accès à l'onglet est filtré dans l'interface staff).
alter table analyse_matchs  enable row level security;
alter table analyse_actions enable row level security;

drop policy if exists "analyse_matchs_all" on analyse_matchs;
create policy "analyse_matchs_all" on analyse_matchs for all using (true) with check (true);

drop policy if exists "analyse_actions_all" on analyse_actions;
create policy "analyse_actions_all" on analyse_actions for all using (true) with check (true);
