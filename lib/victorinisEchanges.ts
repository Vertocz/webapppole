import { supabase } from "./supabase";
import {
  PERSONNES,
  RARETES,
  RARETE_LABEL,
  getPersonne,
  type Rarete,
  type UserTypeCarte,
} from "./victorinis";

export interface Participant {
  id: string;
  type: UserTypeCarte;
  prenom: string;
  nom: string;
}

export interface Ligne {
  personne: string;
  rarete: Rarete;
  quantite: number;
}

export type StatutEchange = "en_attente" | "acceptee" | "refusee" | "annulee" | "indisponible";

export interface Echange {
  id: string;
  de_id: string;
  de_type: UserTypeCarte;
  a_id: string;
  a_type: UserTypeCarte;
  statut: StatutEchange;
  cree_le: string;
  vu_par_proposeur: boolean;
  offre: Ligne[];
  demande: Ligne[];
}

/** Sélection de cartes : clé "slug|rarete" → quantité */
export type Selection = Record<string, number>;
/** Collections de tous : clé "id|type" → Sélection */
export type Collections = Record<string, Selection>;

export const cleCarte = (personne: string, rarete: Rarete) => `${personne}|${rarete}`;
export const cleUser = (id: string, type: UserTypeCarte) => `${id}|${type}`;

export function selectionVersLignes(sel: Selection): Ligne[] {
  const lignes: Ligne[] = [];
  for (const p of PERSONNES) {
    for (const r of RARETES) {
      const q = sel[cleCarte(p.slug, r)] ?? 0;
      if (q > 0) lignes.push({ personne: p.slug, rarete: r, quantite: q });
    }
  }
  return lignes;
}

export function libelleCarte(personne: string, rarete: Rarete): string {
  const p = getPersonne(personne);
  return `${p?.prenom ?? ""} ${p?.nom ?? ""} (${RARETE_LABEL[rarete]})`.trim();
}

export async function getParticipants(): Promise<Participant[]> {
  const { data, error } = await supabase.rpc("victorinis_participants");
  if (error) {
    console.error("[victorinis] participants:", error.message);
    return [];
  }
  return (data ?? []).map(
    (r: { out_id: string; out_type: UserTypeCarte; out_prenom: string; out_nom: string }) => ({
      id: r.out_id,
      type: r.out_type,
      prenom: r.out_prenom,
      nom: r.out_nom,
    })
  );
}

export async function getCollections(): Promise<Collections> {
  const { data, error } = await supabase.rpc("victorinis_collections");
  if (error) {
    console.error("[victorinis] collections:", error.message);
    return {};
  }
  const res: Collections = {};
  (data ?? []).forEach(
    (r: { out_id: string; out_type: UserTypeCarte; out_personne: string; out_rarete: Rarete; out_n: number }) => {
      const k = cleUser(r.out_id, r.out_type);
      (res[k] ??= {})[cleCarte(r.out_personne, r.out_rarete)] = r.out_n;
    }
  );
  return res;
}

interface EchangeBrut {
  id: string;
  de_id: string;
  de_type: UserTypeCarte;
  a_id: string;
  a_type: UserTypeCarte;
  statut: StatutEchange;
  cree_le: string;
  vu_par_proposeur: boolean;
  cartes: { sens: "offre" | "demande"; personne: string; rarete: Rarete; quantite: number }[];
}

function normaliser(e: EchangeBrut): Echange {
  const lignes = (sens: "offre" | "demande") =>
    (e.cartes ?? [])
      .filter((c) => c.sens === sens)
      .map((c) => ({ personne: c.personne, rarete: c.rarete, quantite: c.quantite }));
  return {
    id: e.id,
    de_id: e.de_id,
    de_type: e.de_type,
    a_id: e.a_id,
    a_type: e.a_type,
    statut: e.statut,
    cree_le: e.cree_le,
    vu_par_proposeur: e.vu_par_proposeur,
    offre: lignes("offre"),
    demande: lignes("demande"),
  };
}

const SELECT = "*, cartes:victorinis_echange_cartes(sens, personne, rarete, quantite)";

/** Propositions reçues, en attente de réponse */
export async function getRecues(userId: string, userType: UserTypeCarte): Promise<Echange[]> {
  const { data } = await supabase
    .from("victorinis_echanges")
    .select(SELECT)
    .eq("a_id", userId)
    .eq("a_type", userType)
    .eq("statut", "en_attente")
    .order("cree_le", { ascending: true });
  return ((data ?? []) as EchangeBrut[]).map(normaliser);
}

/** Propositions envoyées : en attente, ou traitées mais pas encore vues */
export async function getEnvoyees(userId: string, userType: UserTypeCarte): Promise<Echange[]> {
  const { data } = await supabase
    .from("victorinis_echanges")
    .select(SELECT)
    .eq("de_id", userId)
    .eq("de_type", userType)
    .or("statut.eq.en_attente,and(vu_par_proposeur.eq.false,statut.in.(acceptee,refusee,indisponible))")
    .order("cree_le", { ascending: true });
  return ((data ?? []) as EchangeBrut[]).map(normaliser);
}

export async function proposerEchange(
  de: { id: string; type: UserTypeCarte },
  a: { id: string; type: UserTypeCarte },
  offre: Ligne[],
  demande: Ligne[]
): Promise<{ id?: string; error?: string }> {
  const { data, error } = await supabase.rpc("proposer_echange", {
    p_de_id: de.id,
    p_de_type: de.type,
    p_a_id: a.id,
    p_a_type: a.type,
    p_offre: offre,
    p_demande: demande,
  });
  if (error) return { error: error.message };
  return { id: data as string };
}

export async function repondreEchange(
  echangeId: string,
  userId: string,
  userType: UserTypeCarte,
  accepte: boolean
): Promise<{ statut?: "acceptee" | "refusee" | "indisponible"; error?: string }> {
  const { data, error } = await supabase.rpc("repondre_echange", {
    p_echange_id: echangeId,
    p_user_id: userId,
    p_user_type: userType,
    p_accepte: accepte,
  });
  if (error) return { error: error.message };
  return { statut: data as "acceptee" | "refusee" | "indisponible" };
}

export async function annulerEchange(echangeId: string, userId: string, userType: UserTypeCarte) {
  await supabase.rpc("annuler_echange", {
    p_echange_id: echangeId,
    p_user_id: userId,
    p_user_type: userType,
  });
}

export async function marquerEchangeVu(echangeId: string, userId: string, userType: UserTypeCarte) {
  await supabase.rpc("marquer_echange_vu", {
    p_echange_id: echangeId,
    p_user_id: userId,
    p_user_type: userType,
  });
}

/** Notification push au destinataire (best effort : un échec ne bloque rien) */
export async function notifierEchange(echangeId: string) {
  try {
    await fetch("/api/victorinis/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ echange_id: echangeId }),
    });
  } catch {
    /* pas grave : la modale s'affichera quand même à la prochaine visite */
  }
}
