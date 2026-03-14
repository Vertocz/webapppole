"use client";

import { useCallback } from "react";
import { supabase } from "./supabase";
import { lundiDeLaSemaine } from "./badges";

type UserType = "joueur" | "staff";

// ─── Connexion ────────────────────────────────────────────────────────────────
async function enregistrerConnexion(
  userId: string, userType: UserType, prenom: string, nom: string
) {
  const today = new Date().toISOString().split("T")[0];
  await supabase.from("connexions").upsert(
    { joueur_id: userId, joueur_type: userType, prenom, nom, date: today },
    { onConflict: "joueur_id,joueur_type,date" }
  );
}

async function getSerieConnexion(userId: string, userType: UserType): Promise<number> {
  const { data } = await supabase
    .from("connexions").select("date")
    .eq("joueur_id", userId).eq("joueur_type", userType)
    .order("date", { ascending: false }).limit(90);
  if (!data?.length) return 0;
  const today = new Date().toISOString().split("T")[0];
  const diff  = Math.floor(
    (new Date(today).getTime() - new Date(data[0].date).getTime()) / 86400000
  );
  if (diff > 1) return 0;
  let serie = 1, current = data[0].date;
  for (let i = 1; i < data.length; i++) {
    const prev = new Date(current);
    prev.setDate(prev.getDate() - 1);
    if (data[i].date === prev.toISOString().split("T")[0]) { serie++; current = data[i].date; }
    else break;
  }
  return serie;
}

// ─── Activités ────────────────────────────────────────────────────────────────
async function getTotalActivites(userId: string): Promise<number> {
  const { count } = await supabase.from("activites")
    .select("id", { count: "exact", head: true }).eq("joueuse_id", userId);
  return count ?? 0;
}

async function getTotalBasket(userId: string): Promise<number> {
  const { count } = await supabase.from("activites")
    .select("id", { count: "exact", head: true })
    .eq("joueuse_id", userId).ilike("sport", "%Basket%");
  return count ?? 0;
}

async function getSerieJoursSportif(userId: string): Promise<number> {
  const { data } = await supabase.from("activites").select("date")
    .eq("joueuse_id", userId).order("date", { ascending: false }).limit(60);
  if (!data?.length) return 0;
  const dates = [...new Set(data.map(d => d.date))];
  const today = new Date().toISOString().split("T")[0];
  const diff  = Math.floor(
    (new Date(today).getTime() - new Date(dates[0]).getTime()) / 86400000
  );
  if (diff > 1) return 0;
  let serie = 1, current = dates[0];
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(current); prev.setDate(prev.getDate() - 1);
    if (dates[i] === prev.toISOString().split("T")[0]) { serie++; current = dates[i]; }
    else break;
  }
  return serie;
}

async function hasRenfoSemaine(userId: string): Promise<boolean> {
  const lundi    = lundiDeLaSemaine(new Date());
  const dimanche = new Date(lundi); dimanche.setDate(dimanche.getDate() + 6);
  const { data } = await supabase.from("activites").select("id")
    .eq("joueuse_id", userId).eq("sport", "🏋️‍♂️ Renforcement musculaire")
    .gte("date", lundi).lte("date", dimanche.toISOString().split("T")[0]);
  return (data ?? []).length >= 3;
}

async function isDisette(userId: string): Promise<boolean> {
  const { data } = await supabase.from("activites").select("date")
    .eq("joueuse_id", userId)
    .order("date", { ascending: false })
    .limit(1);
  if (!data?.length) return false;
  const ilYa30Jours = new Date();
  ilYa30Jours.setDate(ilYa30Jours.getDate() - 30);
  return new Date(data[0].date) < ilYa30Jours;
}

// Badge "Mois plein" : au moins 1 activité chaque semaine pendant 4 semaines
async function hasMoisPlein(userId: string): Promise<boolean> {
  const semaines: Set<string>[] = [new Set(), new Set(), new Set(), new Set()];
  const { data } = await supabase.from("activites").select("date")
    .eq("joueuse_id", userId)
    .gte("date", (() => { const d = new Date(); d.setDate(d.getDate() - 28); return d.toISOString().split("T")[0]; })());
  (data ?? []).forEach(({ date }) => {
    const lundi = lundiDeLaSemaine(new Date(date));
    const idx   = Math.floor(
      (new Date().getTime() - new Date(lundi).getTime()) / (7 * 86400000)
    );
    if (idx >= 0 && idx < 4) semaines[idx].add(date);
  });
  return semaines.every(s => s.size > 0);
}

// ─── Forme ────────────────────────────────────────────────────────────────────
async function getSommeilConsecutif(userId: string): Promise<number> {
  const { data } = await supabase.from("suivi_forme").select("date, sommeil")
    .eq("joueuse_id", userId).gte("sommeil", 4)
    .order("date", { ascending: false }).limit(30);
  if (!data?.length) return 0;
  let serie = 1, current = data[0].date;
  for (let i = 1; i < data.length; i++) {
    const prev = new Date(current); prev.setDate(prev.getDate() - 1);
    if (data[i].date === prev.toISOString().split("T")[0]) { serie++; current = data[i].date; }
    else break;
  }
  return serie;
}

async function getZenSemaine(userId: string): Promise<boolean> {
  const lundi    = lundiDeLaSemaine(new Date());
  const { data } = await supabase.from("suivi_forme").select("date, stress")
    .eq("joueuse_id", userId).gte("date", lundi);
  if (!data || data.length < 7) return false;
  return data.every(d => d.stress <= 2);
}

async function getFatigueConsecutive(userId: string): Promise<number> {
  const { data } = await supabase.from("suivi_forme").select("date, fatigue")
    .eq("joueuse_id", userId).lte("fatigue", 2)
    .order("date", { ascending: false }).limit(30);
  if (!data?.length) return 0;
  let serie = 1, current = data[0].date;
  for (let i = 1; i < data.length; i++) {
    const prev = new Date(current); prev.setDate(prev.getDate() - 1);
    if (data[i].date === prev.toISOString().split("T")[0]) { serie++; current = data[i].date; }
    else break;
  }
  return serie;
}

async function getBonneHumeurSemaine(userId: string): Promise<boolean> {
  const lundi    = lundiDeLaSemaine(new Date());
  const { data } = await supabase.from("suivi_forme").select("date, humeur")
    .eq("joueuse_id", userId).gte("date", lundi);
  if (!data || data.length < 7) return false;
  return data.every(d => d.humeur >= 4);
}

// ─── Émotions ─────────────────────────────────────────────────────────────────
async function getTotalEmotions(userId: string): Promise<number> {
  const { data } = await supabase.from("suivi_emotions").select("date")
    .eq("joueur_id", userId);
  if (!data?.length) return 0;
  return new Set(data.map(d => d.date)).size;
}

// ─── Prépa mentale ────────────────────────────────────────────────────────────
async function getTotalMental(userId: string): Promise<number> {
  const { count } = await supabase.from("suivi_respiration")
    .select("id", { count: "exact", head: true }).eq("joueur_id", userId);
  return count ?? 0;
}

async function getCategoriesMentale(userId: string): Promise<Set<string>> {
  const { data } = await supabase.from("suivi_respiration")
    .select("contexte").eq("joueur_id", userId);
  return new Set((data ?? []).map(d => d.contexte));
}

async function getScanCount(userId: string): Promise<number> {
  const { count } = await supabase.from("suivi_respiration")
    .select("id", { count: "exact", head: true })
    .eq("joueur_id", userId).eq("contexte", "scan");
  return count ?? 0;
}

async function hasSectionsCompletes(userId: string, isMasculin: boolean): Promise<boolean> {
  const { data: sportif  } = await supabase.from("activites").select("id").eq("joueuse_id", userId).limit(1);
  const { data: forme    } = await supabase.from("suivi_forme").select("id").eq("joueuse_id", userId).limit(1);
  const { data: emotions } = await supabase.from("suivi_emotions").select("id").eq("joueur_id", userId).limit(1);
  if (!sportif?.length || !forme?.length || !emotions?.length) return false;
  if (!isMasculin) return true;
  const { data: mental } = await supabase.from("suivi_respiration").select("id").eq("joueur_id", userId).limit(1);
  return !!mental?.length;
}

// ─── Hook principal ───────────────────────────────────────────────────────────
export function useBadges() {
  const checkAndAward = useCallback(async (
    userId: string,
    userType: UserType,
    categorie: string | undefined,
    prenom: string,
    nom: string,
    onNewBadges: (badgeIds: string[]) => void
  ) => {
    await enregistrerConnexion(userId, userType, prenom, nom);

    // Badges déjà obtenus
    const { data: existing } = await supabase.from("badges_joueur").select("badge_id")
      .eq("joueur_id", userId).eq("joueur_type", userType);
    const deja = new Set((existing ?? []).map(b => b.badge_id));

    const merited    = new Set<string>();
    const isMasculin = categorie === "Masculin";

    // ── Connexion (cible "tous" → joueurs ET staff) ────────────────────────────
    const serieConn = await getSerieConnexion(userId, userType);
    if (serieConn >= 7) merited.add("presence");

    // Le staff ne peut gagner que les badges "cible: tous" (ex: présence)
    if (userType === "staff") {
      const candidats = [...merited].filter(id => !deja.has(id));
      if (candidats.length === 0) return;

      const { data: existing_badges } = await supabase
        .from("badges").select("id").in("id", candidats);
      const validIds = new Set((existing_badges ?? []).map(b => b.id));
      const nouveaux = candidats.filter(id => validIds.has(id));

      if (nouveaux.length > 0) {
        const { error } = await supabase.from("badges_joueur").insert(
          nouveaux.map(badge_id => ({
            joueur_id:   userId,
            joueur_type: userType,
            badge_id,
            unlocked_at: new Date().toISOString(),
          }))
        );
        if (!error) onNewBadges(nouveaux);
        else console.error("[useBadges] Erreur insert staff:", error.message);
      }
      return;
    }

    // ── Forme ─────────────────────────────────────────────────────────────────
    const [sommeil, zen, fatigue, humeur] = await Promise.all([
      getSommeilConsecutif(userId),
      getZenSemaine(userId),
      getFatigueConsecutive(userId),
      getBonneHumeurSemaine(userId),
    ]);
    if (sommeil >= 5) merited.add("recuperation_pro");
    if (zen)          merited.add("zen");
    if (fatigue >= 5) merited.add("pile_rechargee");
    if (humeur)       merited.add("bonne_humeur");

    // ── Sport ─────────────────────────────────────────────────────────────────
    const [total, basket, serieDays, renfo, emotions, disette, moisPlein] = await Promise.all([
      getTotalActivites(userId),
      getTotalBasket(userId),
      getSerieJoursSportif(userId),
      hasRenfoSemaine(userId),
      getTotalEmotions(userId),
      isDisette(userId),
      hasMoisPlein(userId),
    ]);

    if (basket >= 10)   merited.add("basket_engage");
    if (renfo)          merited.add("renfo_semaine");
    if (serieDays >= 3) merited.add("serie_feu");
    if (total >= 20)    merited.add("machine");
    if (total >= 30)    merited.add("sans_faille");
    if (disette)        merited.add("disette");
    if (moisPlein)      merited.add("mois_plein");

    // ── Masculin uniquement ───────────────────────────────────────────────────
    if (isMasculin) {
      if (emotions >= 12) merited.add("emotions_master");

      const [totalMental, scanCount] = await Promise.all([
        getTotalMental(userId),
        getScanCount(userId),
      ]);
      if (totalMental >= 10) merited.add("mental_fer");
      if (scanCount >= 5)    merited.add("scan_master");

      const cats = await getCategoriesMentale(userId);
      if (cats.has("activation") && cats.has("relaxation") && cats.has("scan"))
        merited.add("explorateur_mental");
    }

    // ── Complet ───────────────────────────────────────────────────────────────
    const complet = await hasSectionsCompletes(userId, isMasculin);
    if (complet) merited.add("complet");

    // ── Filtre : seulement les nouveaux, vérifiés en DB ──────────────────────
    const candidats = [...merited].filter(id => !deja.has(id));
    if (candidats.length === 0) return;

    // Vérifier que ces IDs existent bien dans la table badges
    const { data: existing_badges } = await supabase
      .from("badges")
      .select("id")
      .in("id", candidats);
    const validIds = new Set((existing_badges ?? []).map(b => b.id));
    const nouveaux = candidats.filter(id => validIds.has(id));

    if (nouveaux.length > 0) {
      const { error } = await supabase.from("badges_joueur").insert(
        nouveaux.map(badge_id => ({
          joueur_id:   userId,
          joueur_type: userType,
          badge_id,
          unlocked_at: new Date().toISOString(),
        }))
      );
      if (!error) onNewBadges(nouveaux);
      else console.error("[useBadges] Erreur insert:", error.message);
    }
  }, []);

  return { checkAndAward };
}