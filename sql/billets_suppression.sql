-- Suppression de billets depuis l'espace admin (onglet Billets → « Suppression de billet »).
-- Même modèle que joueuses_delete_anon : l'app passe par la clé anon.
-- Les trajets suivent automatiquement (fk_trajets_billet ON DELETE CASCADE),
-- le PDF est retiré du bucket Billets par l'app (policy anon_delete existante).

drop policy if exists billets_delete_anon on public.billets;
create policy billets_delete_anon on public.billets
  for delete to anon
  using (true);
