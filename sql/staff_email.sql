-- Bilans hebdomadaires par mail (route /api/cron/bilan-hebdo).
-- Reçoivent le bilan « Forme & suivi sportif » de leur pôle (colonnes masculin / feminin)
-- les membres du staff cochés bilan_hebdo et dont l'e-mail est renseigné.
alter table public.staff add column if not exists email text;
alter table public.staff add column if not exists bilan_hebdo boolean not null default false;
alter table public.staff add column if not exists bilan_mental boolean not null default false; -- bilan prépa mentale
