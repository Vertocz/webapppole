-- ============================================================
-- VICTORINIS — échanges de cartes
-- À exécuter dans Supabase > SQL Editor (après victorinis.sql)
-- ============================================================

-- 1) Qui peut échanger : les 5 joueurs (joueuses.victorinis) + les 2 coachs
alter table staff add column if not exists victorinis_echange boolean not null default false;

update staff set victorinis_echange = true
where (prenom ilike 'safia'   and nom ilike 'haddadj')
   or (prenom ilike 'thierry' and nom ilike 'fabbro');

-- Vérification : doit renvoyer 2 lignes (Safia et Thierry)
select prenom, nom, victorinis_echange from staff where victorinis_echange;

-- 2) Tables
create table if not exists victorinis_echanges (
  id                 uuid primary key default gen_random_uuid(),
  de_id              text not null,
  de_type            text not null check (de_type in ('joueur', 'staff')),
  a_id               text not null,
  a_type             text not null check (a_type in ('joueur', 'staff')),
  statut             text not null default 'en_attente'
                     check (statut in ('en_attente', 'acceptee', 'refusee', 'annulee', 'indisponible')),
  cree_le            timestamptz not null default now(),
  traite_le          timestamptz,
  vu_par_proposeur   boolean not null default false,
  notifie            boolean not null default false
);

create index if not exists victorinis_echanges_a_idx  on victorinis_echanges (a_id, a_type, statut);
create index if not exists victorinis_echanges_de_idx on victorinis_echanges (de_id, de_type, statut);

create table if not exists victorinis_echange_cartes (
  id          uuid primary key default gen_random_uuid(),
  echange_id  uuid not null references victorinis_echanges(id) on delete cascade,
  sens        text not null check (sens in ('offre', 'demande')),
  personne    text not null,
  rarete      text not null check (rarete in ('bleu', 'argent', 'or')),
  quantite    int  not null check (quantite > 0)
);

create index if not exists victorinis_echange_cartes_idx on victorinis_echange_cartes (echange_id);

-- Lecture ouverte (pas de Supabase Auth dans l'app), aucune écriture directe :
-- tout passe par les fonctions ci-dessous.
alter table victorinis_echanges       enable row level security;
alter table victorinis_echange_cartes enable row level security;

drop policy if exists "victorinis_echanges_lecture" on victorinis_echanges;
create policy "victorinis_echanges_lecture" on victorinis_echanges for select using (true);

drop policy if exists "victorinis_echange_cartes_lecture" on victorinis_echange_cartes;
create policy "victorinis_echange_cartes_lecture" on victorinis_echange_cartes for select using (true);

-- 3) Fonctions utilitaires
create or replace function victorinis_personnes() returns text[]
language sql immutable as $$
  select array['ayoub-laanait','davy-delusier','donovan-cadet','erwan-cadet',
               'gregory-sejor','safia-haddadj','thierry-fabbro']
$$;

create or replace function victorinis_participants()
returns table (out_id text, out_type text, out_prenom text, out_nom text)
language sql security definer set search_path = public as $$
  select id::text, 'joueur'::text, prenom, nom from joueuses where victorinis
  union all
  select id::text, 'staff'::text, prenom, nom from staff where coalesce(victorinis_echange, false)
$$;

create or replace function victorinis_est_participant(p_id text, p_type text)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from victorinis_participants() where out_id = p_id and out_type = p_type)
$$;

create or replace function victorinis_possede(p_id text, p_type text, p_personne text, p_rarete text)
returns int language sql security definer set search_path = public as $$
  select count(*)::int from victorinis_cartes
  where user_id = p_id and user_type = p_type and personne = p_personne and rarete = p_rarete
$$;

-- Collections de tous les participants (agrégées : 7 x 21 lignes maximum)
create or replace function victorinis_collections()
returns table (out_id text, out_type text, out_personne text, out_rarete text, out_n int)
language sql security definer set search_path = public as $$
  select c.user_id, c.user_type, c.personne, c.rarete, count(*)::int
  from victorinis_cartes c
  join victorinis_participants() p on p.out_id = c.user_id and p.out_type = c.user_type
  group by c.user_id, c.user_type, c.personne, c.rarete
$$;

-- 4) Proposer un échange
-- p_offre / p_demande : [{"personne":"gregory-sejor","rarete":"or","quantite":1}, ...]
-- p_offre peut être vide ; p_demande doit contenir au moins une carte.
create or replace function proposer_echange(
  p_de_id text, p_de_type text, p_a_id text, p_a_type text,
  p_offre jsonb, p_demande jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id      uuid;
  v_attente int;
  l         record;
begin
  p_offre   := coalesce(p_offre, '[]'::jsonb);
  p_demande := coalesce(p_demande, '[]'::jsonb);

  if not victorinis_est_participant(p_de_id, p_de_type) then
    raise exception 'Tu ne participes pas aux échanges';
  end if;
  if not victorinis_est_participant(p_a_id, p_a_type) then
    raise exception 'Ce destinataire ne participe pas aux échanges';
  end if;
  if p_de_id = p_a_id and p_de_type = p_a_type then
    raise exception 'Tu ne peux pas échanger avec toi-même';
  end if;
  if jsonb_array_length(p_demande) = 0 then
    raise exception 'Choisis au moins une carte à demander';
  end if;

  select count(*) into v_attente from victorinis_echanges
  where de_id = p_de_id and de_type = p_de_type and statut = 'en_attente';
  if v_attente >= 10 then
    raise exception 'Trop de propositions en attente (10 maximum)';
  end if;

  for l in
    select personne, rarete, sum(quantite)::int as q
    from jsonb_to_recordset(p_offre) as x(personne text, rarete text, quantite int)
    group by personne, rarete
  loop
    if l.personne is null or not (l.personne = any (victorinis_personnes()))
       or l.rarete not in ('bleu', 'argent', 'or') or l.q is null or l.q <= 0 then
      raise exception 'Carte invalide dans ton offre';
    end if;
    if victorinis_possede(p_de_id, p_de_type, l.personne, l.rarete) < l.q then
      raise exception 'Tu n''as pas assez d''exemplaires d''une carte que tu offres';
    end if;
  end loop;

  for l in
    select personne, rarete, sum(quantite)::int as q
    from jsonb_to_recordset(p_demande) as x(personne text, rarete text, quantite int)
    group by personne, rarete
  loop
    if l.personne is null or not (l.personne = any (victorinis_personnes()))
       or l.rarete not in ('bleu', 'argent', 'or') or l.q is null or l.q <= 0 then
      raise exception 'Carte invalide dans ta demande';
    end if;
    if victorinis_possede(p_a_id, p_a_type, l.personne, l.rarete) < l.q then
      raise exception 'Cette personne n''a plus toutes les cartes demandées';
    end if;
  end loop;

  insert into victorinis_echanges (de_id, de_type, a_id, a_type)
  values (p_de_id, p_de_type, p_a_id, p_a_type)
  returning id into v_id;

  insert into victorinis_echange_cartes (echange_id, sens, personne, rarete, quantite)
  select v_id, 'offre', personne, rarete, sum(quantite)::int
  from jsonb_to_recordset(p_offre) as x(personne text, rarete text, quantite int)
  group by personne, rarete;

  insert into victorinis_echange_cartes (echange_id, sens, personne, rarete, quantite)
  select v_id, 'demande', personne, rarete, sum(quantite)::int
  from jsonb_to_recordset(p_demande) as x(personne text, rarete text, quantite int)
  group by personne, rarete;

  return v_id;
end;
$$;

-- 5) Répondre à une proposition : renvoie 'acceptee', 'refusee' ou 'indisponible'
create or replace function repondre_echange(
  p_echange_id uuid, p_user_id text, p_user_type text, p_accepte boolean
) returns text
language plpgsql security definer set search_path = public as $$
declare
  e record;
  l record;
  v_ok boolean := true;
begin
  -- Une seule réponse à la fois : évite que deux acceptations utilisent la même carte
  perform pg_advisory_xact_lock(hashtext('victorinis_echange'));

  select * into e from victorinis_echanges where id = p_echange_id for update;
  if not found then
    raise exception 'Proposition introuvable';
  end if;
  if e.a_id <> p_user_id or e.a_type <> p_user_type then
    raise exception 'Cette proposition ne t''est pas destinée';
  end if;
  if e.statut <> 'en_attente' then
    raise exception 'Cette proposition n''est plus en attente';
  end if;

  if not p_accepte then
    update victorinis_echanges set statut = 'refusee', traite_le = now() where id = e.id;
    return 'refusee';
  end if;

  -- Vérifie que chacun a toujours ce qu'il doit donner
  for l in select * from victorinis_echange_cartes where echange_id = e.id loop
    if l.sens = 'offre' and victorinis_possede(e.de_id, e.de_type, l.personne, l.rarete) < l.quantite then
      v_ok := false;
    elsif l.sens = 'demande' and victorinis_possede(e.a_id, e.a_type, l.personne, l.rarete) < l.quantite then
      v_ok := false;
    end if;
  end loop;

  if not v_ok then
    update victorinis_echanges set statut = 'indisponible', traite_le = now() where id = e.id;
    return 'indisponible';
  end if;

  -- Transferts : la demande va du destinataire vers le proposeur, l'offre dans l'autre sens
  for l in select * from victorinis_echange_cartes where echange_id = e.id loop
    if l.sens = 'demande' then
      update victorinis_cartes set user_id = e.de_id, user_type = e.de_type
      where id in (
        select id from victorinis_cartes
        where user_id = e.a_id and user_type = e.a_type and personne = l.personne and rarete = l.rarete
        order by obtenue_le limit l.quantite for update
      );
    else
      update victorinis_cartes set user_id = e.a_id, user_type = e.a_type
      where id in (
        select id from victorinis_cartes
        where user_id = e.de_id and user_type = e.de_type and personne = l.personne and rarete = l.rarete
        order by obtenue_le limit l.quantite for update
      );
    end if;
  end loop;

  update victorinis_echanges set statut = 'acceptee', traite_le = now() where id = e.id;
  return 'acceptee';
end;
$$;

-- 6) Annuler une proposition envoyée (tant qu'elle est en attente)
create or replace function annuler_echange(p_echange_id uuid, p_user_id text, p_user_type text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update victorinis_echanges
  set statut = 'annulee', traite_le = now(), vu_par_proposeur = true
  where id = p_echange_id and de_id = p_user_id and de_type = p_user_type and statut = 'en_attente';
  return found;
end;
$$;

-- 7) Le proposeur a vu la réponse (acceptée / refusée / indisponible)
create or replace function marquer_echange_vu(p_echange_id uuid, p_user_id text, p_user_type text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update victorinis_echanges set vu_par_proposeur = true
  where id = p_echange_id and de_id = p_user_id and de_type = p_user_type;
end;
$$;

grant execute on function victorinis_participants()                              to anon, authenticated;
grant execute on function victorinis_collections()                               to anon, authenticated;
grant execute on function proposer_echange(text, text, text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function repondre_echange(uuid, text, text, boolean)            to anon, authenticated;
grant execute on function annuler_echange(uuid, text, text)                      to anon, authenticated;
grant execute on function marquer_echange_vu(uuid, text, text)                   to anon, authenticated;
