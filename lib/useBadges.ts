"use client";

import { useCallback } from "react";
import { supabase } from "./supabase";
import { BADGES, lundiDeLaSemaine } from "./badges";

type UserType = "joueur" | "staff";

// ─── Enregistrer la connexion du jour ────────────────────────────────────────
async function enregistrerConnexion(userId: string, userType: UserType) {
  const today = new Date().toISOString().split("T")[0];
  await supabase.from("connexions").upsert(
    { joueur_id: userId, joueur_type: userType, date: today },
    { onConflict: "joueur_id,joueur_type,date" }
  );
}

// ─── Calculer la série de jours consécutifs ───────────────────────────────────
async function getSerieConnexion(userId: string, userType: UserType): Promise<number> {
  const { data } = await supabase
    .from("connexions")
    .select("date")
    .eq("joueur_id", userId)
    .eq("joueur_type", userType)
    .order("date", { ascending: false })
    .limit(90);

  if (!data || data.length === 0) return 0;

  const dates = data.map(d => d.date);
  let serie = 1;
  const today = new Date().toISOString().split("T")[0];
  let current = dates[0];

  // Si la dernière connexion n'est pas aujourd'hui ou hier, série cassée
  const diff = Math.floor((new Date(today).getTime() - new Date(current).getTime()) / 86400000);
  if (diff > 1) return 0;

  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(current);
    prev.setDate(prev.getDate() - 1);
    if (dates[i] === prev.toISOString().split("T")[0]) {
      serie++;
      current = dates[i];
    } else break;
  }
  return serie;
}

// ─── Séries de semaines consécutives pour un sport ──────────────────────────
async function getSeriesSemaines(
  userId: string,
  sport: string, // "⛹️‍♀️ Basket" ou "🏋️‍♂️ Renforcement musculaire"
  minParSemaine: number
): Promise<number> {
  const { data } = await supabase
    .from("activites")
    .select("date, sport")
    .eq("joueuse_id", userId)
    .eq("sport", sport)
    .order("date", { ascending: false })
    .limit(200);

  if (!data || data.length === 0) return 0;

  // Regrouper par semaine (lundi)
  const parSemaine: Record<string, number> = {};
  for (const a of data) {
    const lundi = lundiDeLaSemaine(new Date(a.date));
    parSemaine[lundi] = (parSemaine[lundi] ?? 0) + 1;
  }

  // Semaines triées desc
  const semaines = Object.keys(parSemaine).sort((a, b) => b.localeCompare(a));

  let serie = 0;
  const lundiCette = lundiDeLaSemaine(new Date());
  const lundiPrecedent = new Date(lundiCette);
  lundiPrecedent.setDate(lundiPrecedent.getDate() - 7);
  const lundiPrecedentStr = lundiPrecedent.toISOString().split("T")[0];

  // La semaine courante ou la précédente doit avoir assez de séances
  const depart = semaines[0];
  if (depart !== lundiCette && depart !== lundiPrecedentStr) return 0;
  if ((parSemaine[depart] ?? 0) < minParSemaine) return 0;

  serie = 1;
  let current = depart;

  for (let i = 1; i < semaines.length; i++) {
    const prev = new Date(current);
    prev.setDate(prev.getDate() - 7);
    const prevStr = prev.toISOString().split("T")[0];
    if (semaines[i] === prevStr && (parSemaine[prevStr] ?? 0) >= minParSemaine) {
      serie++;
      current = prevStr;
    } else break;
  }

  return serie;
}

// ─── Suivi complet : séries de semaines ─────────────────────────────────────
async function getSeriesSuiviComplet(userId: string): Promise<number> {
  const { data: sportif } = await supabase.from("activites").select("date").eq("joueuse_id", userId);
  const { data: forme }   = await supabase.from("suivi_forme").select("date").eq("joueuse_id", userId);
  const { data: emotions } = await supabase.from("suivi_emotions").select("date").eq("joueur_id", userId);

  if (!sportif || !forme || !emotions) return 0;

  const semSportif  = new Set(sportif.map(d => lundiDeLaSemaine(new Date(d.date))));
  const semForme    = new Set(forme.map(d => lundiDeLaSemaine(new Date(d.date))));
  const semEmotions = new Set(emotions.map(d => lundiDeLaSemaine(new Date(d.date))));

  // Semaines où les 3 sont remplis
  const semCompletes = [...semSportif].filter(s => semForme.has(s) && semEmotions.has(s)).sort((a, b) => b.localeCompare(a));
  if (semCompletes.length === 0) return 0;

  const lundiCette = lundiDeLaSemaine(new Date());
  if (semCompletes[0] !== lundiCette) return 0;

  let serie = 1;
  let current = semCompletes[0];
  for (let i = 1; i < semCompletes.length; i++) {
    const prev = new Date(current);
    prev.setDate(prev.getDate() - 7);
    if (semCompletes[i] === prev.toISOString().split("T")[0]) {
      serie++; current = semCompletes[i];
    } else break;
  }
  return serie;
}

// ─── Badges mentale ──────────────────────────────────────────────────────────
async function getBadgesMentale(userId: string): Promise<string[]> {
  const { data } = await supabase.from("suivi_respiration").select("contexte").eq("joueur_id", userId);
  if (!data || data.length === 0) return [];

  const ids: string[] = ["mental_bronze"]; // 1ère séance
  if (data.length >= 5)  ids.push("mental_argent");
  if (data.length >= 10) ids.push("mental_or");

  const contextes = new Set(data.map(d => d.contexte));
  if (contextes.has("activation") && contextes.has("relaxation") && contextes.has("scan")) {
    ids.push("mental_ultime");
  }
  return ids;
}

// ─── Badge connexion selon série ─────────────────────────────────────────────
function badgesConnexion(serie: number, prefix: string): string[] {
  const ids: string[] = [];
  if (serie >= 5)  ids.push(`${prefix}_bronze`);
  if (serie >= 14) ids.push(`${prefix}_argent`);
  if (serie >= 30) ids.push(`${prefix}_or`);
  if (serie >= 60) ids.push(`${prefix}_ultime`);
  return ids;
}

function badgesSerie(serie: number, prefix: string): string[] {
  const ids: string[] = [];
  if (serie >= 1) ids.push(`${prefix}_bronze`);
  if (serie >= 2) ids.push(`${prefix}_argent`);
  if (serie >= 4) ids.push(`${prefix}_or`);
  if (serie >= 8) ids.push(`${prefix}_ultime`);
  return ids;
}

// ─── Hook principal ───────────────────────────────────────────────────────────
export function useBadges() {
  const checkAndAward = useCallback(async (
    userId: string,
    userType: UserType,
    onNewBadges: (badgeIds: string[]) => void
  ) => {
    // 1. Enregistrer connexion
    await enregistrerConnexion(userId, userType);

    // 2. Récupérer badges déjà acquis
    const { data: existing } = await supabase
      .from("badges_joueur")
      .select("badge_id")
      .eq("joueur_id", userId)
      .eq("joueur_type", userType);
    const deja = new Set((existing ?? []).map(b => b.badge_id));

    // 3. Calculer badges mérités
    const merited = new Set<string>();

    if (userType === "joueur") {
      // Connexion
      const serieConn = await getSerieConnexion(userId, userType);
      badgesConnexion(serieConn, "co_joueur").forEach(id => merited.add(id));

      // Basket
      const serieBasket = await getSeriesSemaines(userId, "⛹️‍♀️ Basket", 3);
      badgesSerie(serieBasket, "basket").forEach(id => merited.add(id));

      // Renforcement
      const serieRenfo = await getSeriesSemaines(userId, "🏋️‍♂️ Renforcement musculaire", 3);
      badgesSerie(serieRenfo, "renfo").forEach(id => merited.add(id));

      // Suivi complet
      const serieSuivi = await getSeriesSuiviComplet(userId);
      badgesSerie(serieSuivi, "suivi").forEach(id => merited.add(id));

      // Mental
      const mentalIds = await getBadgesMentale(userId);
      mentalIds.forEach(id => merited.add(id));
    }

    if (userType === "staff") {
      const serieConn = await getSerieConnexion(userId, userType);
      badgesConnexion(serieConn, "co_staff").forEach(id => merited.add(id));
    }

    // 4. Nouveaux badges = mérités mais pas encore acquis
    const nouveaux = [...merited].filter(id => !deja.has(id) && BADGES.find(b => b.id === id));

    if (nouveaux.length > 0) {
      await supabase.from("badges_joueur").insert(
        nouveaux.map(badge_id => ({
          joueur_id: userId,
          joueur_type: userType,
          badge_id,
          unlocked_at: new Date().toISOString(),
        }))
      );
      onNewBadges(nouveaux);
    }
  }, []);

  return { checkAndAward };
}
