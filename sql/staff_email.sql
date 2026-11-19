-- Bilans hebdomadaires par mail (route /api/cron/bilan-hebdo).
-- Chaque membre du staff qui a une adresse e-mail reçoit le bilan
-- « Forme & suivi sportif » du ou des pôles cochés (colonnes masculin / feminin).
-- Laisser l'e-mail vide pour ne pas recevoir le bilan.
alter table public.staff add column if not exists email text;
