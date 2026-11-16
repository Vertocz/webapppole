-- Les joueurs/joueuses enregistrent leur connexion du jour par un upsert
-- (on_conflict joueur_id, joueur_type, date). Un upsert a besoin de pouvoir
-- lire la table : sans politique SELECT, Postgres refusait l'écriture (401).
create policy connexions_select_anon on public.connexions
  for select to anon using (true);
