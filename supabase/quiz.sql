-- Quiz : questions saisies par le staff masculin + scores des parties.
-- À exécuter une fois dans Supabase (SQL Editor).

create table if not exists public.quiz_questions (
  id          uuid primary key default gen_random_uuid(),
  question    text    not null,
  reponses    text[]  not null,            -- 2 à 4 réponses
  bonne       int     not null,            -- index (à partir de 0) de la bonne réponse
  categorie   text,
  actif       boolean not null default true,
  auteur_id   text,
  created_at  timestamptz not null default now(),
  constraint quiz_reponses_count check (array_length(reponses, 1) between 2 and 4),
  constraint quiz_bonne_range    check (bonne >= 0 and bonne < array_length(reponses, 1))
);

create table if not exists public.quiz_scores (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  prenom      text not null,
  score       int  not null,
  bonnes      int  not null,
  total       int  not null,
  created_at  timestamptz not null default now()
);

create index if not exists quiz_scores_score_idx on public.quiz_scores (score desc);

alter table public.quiz_questions enable row level security;
alter table public.quiz_scores    enable row level security;

-- Même fonctionnement que les autres tables de l'app (accès via la clé anon).
drop policy if exists "quiz_questions_all" on public.quiz_questions;
create policy "quiz_questions_all" on public.quiz_questions for all using (true) with check (true);

drop policy if exists "quiz_scores_all" on public.quiz_scores;
create policy "quiz_scores_all" on public.quiz_scores for all using (true) with check (true);
