import { supabase } from "./supabase";

export type Rarete = "bleu" | "argent" | "or";
export type UserTypeCarte = "joueur" | "staff";

export interface Personne {
  slug: string;
  prenom: string;
  nom: string;
  /** Numéro de maillot, ou "COACH" — tel qu'il apparaît dans le nom de fichier */
  fichier: string;
  role: "joueur" | "coach";
}

export interface CarteGagnee {
  personne: string; // slug
  rarete: Rarete;
}

export const BUCKET = "victorinis";

/** Ordre d'affichage dans la collection */
export const PERSONNES: Personne[] = [
  { slug: "ayoub-laanait", prenom: "Ayoub", nom: "Laanait", fichier: "9", role: "joueur" },
  { slug: "davy-delusier", prenom: "Davy", nom: "Delusier", fichier: "4", role: "joueur" },
  { slug: "donovan-cadet", prenom: "Donovan", nom: "Cadet", fichier: "7", role: "joueur" },
  { slug: "erwan-cadet", prenom: "Erwan", nom: "Cadet", fichier: "5", role: "joueur" },
  { slug: "gregory-sejor", prenom: "Gregory", nom: "Sejor", fichier: "10", role: "joueur" },
  { slug: "safia-haddadj", prenom: "Safia", nom: "Haddadj", fichier: "COACH", role: "coach" },
  { slug: "thierry-fabbro", prenom: "Thierry", nom: "Fabbro", fichier: "COACH", role: "coach" },
];

export const RARETES: Rarete[] = ["bleu", "argent", "or"];

export const RARETE_LABEL: Record<Rarete, string> = {
  bleu: "bleue",
  argent: "argent",
  or: "or",
};

export const RARETE_COLOR: Record<Rarete, string> = {
  bleu: "#3B7BFF",
  argent: "#C9D1DE",
  or: "#F2B90F",
};

export const TOTAL_CARTES = PERSONNES.length * RARETES.length; // 21

export function getPersonne(slug: string): Personne | undefined {
  return PERSONNES.find((p) => p.slug === slug);
}

/**
 * Passer à true si les "Image Transformations" sont activées sur le projet
 * Supabase (plan Pro) : les miniatures de la collection seront alors beaucoup
 * plus légères (les originaux font ~1,4 Mo chacun).
 */
const SUPABASE_TRANSFORMS = false;

export function getCarteUrl(personne: string, rarete: Rarete, width?: number): string {
  const p = getPersonne(personne);
  const path = `carte-${personne}-${p?.fichier ?? ""}-${rarete}.png`;
  const options =
    SUPABASE_TRANSFORMS && width ? { transform: { width, quality: 75 } } : undefined;
  return supabase.storage.from(BUCKET).getPublicUrl(path, options).data.publicUrl;
}

/** Tirage côté serveur (RPC). Renvoie null si la personne n'est pas éligible ou en cas d'erreur. */
export async function tirerCarte(
  userId: string,
  userType: UserTypeCarte
): Promise<CarteGagnee | null> {
  const { data, error } = await supabase.rpc("tirer_carte", {
    p_user_id: userId,
    p_user_type: userType,
  });
  if (error) {
    console.error("[victorinis] tirage:", error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return { personne: row.out_personne, rarete: row.out_rarete as Rarete };
}

/** Tirage unique à la connexion du staff (une fois par session, pas à chaque rechargement). */
export async function tirerCarteConnexion(
  userId: string,
  userType: UserTypeCarte
): Promise<CarteGagnee | null> {
  const key = "victorinis_tirage_connexion";
  if (sessionStorage.getItem(key)) return null;
  sessionStorage.setItem(key, "1");
  return tirerCarte(userId, userType);
}

/** Nombre d'exemplaires par carte : clé "slug|rarete" */
export async function getCollection(
  userId: string,
  userType: UserTypeCarte
): Promise<Record<string, number>> {
  const { data } = await supabase
    .from("victorinis_cartes")
    .select("personne, rarete")
    .eq("user_id", userId)
    .eq("user_type", userType);
  const counts: Record<string, number> = {};
  (data ?? []).forEach((r) => {
    const k = `${r.personne}|${r.rarete}`;
    counts[k] = (counts[k] ?? 0) + 1;
  });
  return counts;
}
