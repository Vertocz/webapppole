-- ============================================================
-- VICTORINIS — bouton « Ouvrir » : 3 cartes, une fois par heure
-- À exécuter dans Supabase > SQL Editor (après victorinis_echanges.sql)
-- ============================================================

create table if not exists victorinis_ouvertures (
  user_id   text not null,
  user_type text not null check (user_type in ('joueur', 'staff')),
  derniere  timestamptz not null,
  primary key (user_id, user_type)
);

alter table victorinis_ouvertures enable row level security;

drop policy if exists "victorinis_ouvertures_lecture" on victorinis_ouvertures;
create policy "victorinis_ouvertures_lecture" on victorinis_ouvertures for select using (true);

create or replace function ouvrir_paquet(p_user_id text, p_user_type text)
returns table (out_personne text, out_rarete text)
language plpgsql security definer set search_path = public as $$
declare
  v_ok        boolean := false;
  v_ts        timestamptz;
  v_r         double precision;
  v_rarete    text;
  v_personne  text;
  v_personnes text[] := victorinis_personnes();
  i           int;
begin
  -- Même éligibilité que le tirage normal
  if p_user_type = 'joueur' then
    select exists (select 1 from joueuses where id::text = p_user_id and victorinis) into v_ok;
  elsif p_user_type = 'staff' then
    select exists (select 1 from staff where id::text = p_user_id and coalesce(masculin, false)) into v_ok;
  end if;
  if not v_ok then
    raise exception 'Tu ne peux pas ouvrir de paquet';
  end if;

  -- Une ouverture par heure, vérifiée et enregistrée en une seule opération
  insert into victorinis_ouvertures (user_id, user_type, derniere)
  values (p_user_id, p_user_type, now())
  on conflict (user_id, user_type) do update set derniere = now()
  where victorinis_ouvertures.derniere <= now() - interval '1 hour'
  returning derniere into v_ts;

  if v_ts is null then
    raise exception 'Prochain paquet pas encore disponible';
  end if;

  -- 3 cartes, mêmes probabilités que d'habitude : 10 % or, 30 % argent, 60 % bleu
  for i in 1..3 loop
    v_r := random();
    v_rarete := case when v_r < 0.10 then 'or' when v_r < 0.40 then 'argent' else 'bleu' end;
    v_personne := v_personnes[1 + floor(random() * array_length(v_personnes, 1))::int];

    insert into victorinis_cartes (user_id, user_type, personne, rarete)
    values (p_user_id, p_user_type, v_personne, v_rarete);

    out_personne := v_personne;
    out_rarete := v_rarete;
    return next;
  end loop;
end;
$$;

grant execute on function ouvrir_paquet(text, text) to anon, authenticated;
