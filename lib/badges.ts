// ─── Définition des badges ────────────────────────────────────────────────────
// Pour remplacer l'emoji par une image PNG plus tard :
// Ajouter un champ `image?: string` et utiliser <img src={`/badges/${badge.image}`} />

export type BadgeNiveau = "bronze" | "argent" | "or" | "ultime";
export type BadgeCategorie = "basket" | "renforcement" | "connexion" | "suivi_complet" | "mental";

export interface BadgeDef {
  id: string;
  categorie: BadgeCategorie;
  niveau: BadgeNiveau;
  nom: string;
  description: string;
  emoji: string; // Remplacer par image PNG plus tard
  // image?: string; // ex: "basket_bronze.png"
  // Cible : "joueur" | "staff" | "tous"
  cible: "joueur" | "staff" | "tous";
}

export const BADGES: BadgeDef[] = [
  // ── Basket ────────────────────────────────────────────────────────────────
  {
    id: "basket_bronze",    categorie: "basket",    niveau: "bronze",
    nom: "Premier dribble", description: "3 séances de basket dans la même semaine",
    emoji: "🥉", cible: "joueur",
  },
  {
    id: "basket_argent",    categorie: "basket",    niveau: "argent",
    nom: "En rythme",       description: "3+ séances de basket pendant 2 semaines de suite",
    emoji: "🥈", cible: "joueur",
  },
  {
    id: "basket_or",        categorie: "basket",    niveau: "or",
    nom: "Régularité d'élite", description: "3+ séances de basket pendant 4 semaines de suite",
    emoji: "🥇", cible: "joueur",
  },
  {
    id: "basket_ultime",    categorie: "basket",    niveau: "ultime",
    nom: "Machine à basket", description: "3+ séances de basket pendant 8 semaines de suite",
    emoji: "💎", cible: "joueur",
  },

  // ── Renforcement ──────────────────────────────────────────────────────────
  {
    id: "renfo_bronze",     categorie: "renforcement", niveau: "bronze",
    nom: "Premiers muscles", description: "3 séances de renforcement dans la même semaine",
    emoji: "🥉", cible: "joueur",
  },
  {
    id: "renfo_argent",     categorie: "renforcement", niveau: "argent",
    nom: "Corps en construction", description: "3+ séances de renforcement pendant 2 semaines de suite",
    emoji: "🥈", cible: "joueur",
  },
  {
    id: "renfo_or",         categorie: "renforcement", niveau: "or",
    nom: "Athlète complet", description: "3+ séances de renforcement pendant 4 semaines de suite",
    emoji: "🥇", cible: "joueur",
  },
  {
    id: "renfo_ultime",     categorie: "renforcement", niveau: "ultime",
    nom: "Gladiateur",      description: "3+ séances de renforcement pendant 8 semaines de suite",
    emoji: "💎", cible: "joueur",
  },

  // ── Connexions — Joueurs ──────────────────────────────────────────────────
  {
    id: "co_joueur_bronze", categorie: "connexion",   niveau: "bronze",
    nom: "Prise d'habitude", description: "Connecté 5 jours de suite",
    emoji: "🥉", cible: "joueur",
  },
  {
    id: "co_joueur_argent", categorie: "connexion",   niveau: "argent",
    nom: "Fidèle au poste",  description: "Connecté 14 jours de suite",
    emoji: "🥈", cible: "joueur",
  },
  {
    id: "co_joueur_or",     categorie: "connexion",   niveau: "or",
    nom: "Présence totale",  description: "Connecté 30 jours de suite",
    emoji: "🥇", cible: "joueur",
  },
  {
    id: "co_joueur_ultime", categorie: "connexion",   niveau: "ultime",
    nom: "Indestructible",   description: "Connecté 60 jours de suite",
    emoji: "💎", cible: "joueur",
  },

  // ── Connexions — Staff ────────────────────────────────────────────────────
  {
    id: "co_staff_bronze",  categorie: "connexion",   niveau: "bronze",
    nom: "Toujours là",      description: "Connecté 5 jours de suite",
    emoji: "🥉", cible: "staff",
  },
  {
    id: "co_staff_argent",  categorie: "connexion",   niveau: "argent",
    nom: "Encadrant modèle", description: "Connecté 14 jours de suite",
    emoji: "🥈", cible: "staff",
  },
  {
    id: "co_staff_or",      categorie: "connexion",   niveau: "or",
    nom: "Pilier du pôle",   description: "Connecté 30 jours de suite",
    emoji: "🥇", cible: "staff",
  },
  {
    id: "co_staff_ultime",  categorie: "connexion",   niveau: "ultime",
    nom: "Légende du staff", description: "Connecté 60 jours de suite",
    emoji: "💎", cible: "staff",
  },

  // ── Suivi complet — Joueurs ───────────────────────────────────────────────
  {
    id: "suivi_bronze",     categorie: "suivi_complet", niveau: "bronze",
    nom: "Vue d'ensemble",  description: "Sportif + Forme + Émotions remplis dans la même semaine",
    emoji: "🥉", cible: "joueur",
  },
  {
    id: "suivi_argent",     categorie: "suivi_complet", niveau: "argent",
    nom: "Analyse fine",    description: "Suivi complet 2 semaines de suite",
    emoji: "🥈", cible: "joueur",
  },
  {
    id: "suivi_or",         categorie: "suivi_complet", niveau: "or",
    nom: "Data athlete",    description: "Suivi complet 4 semaines de suite",
    emoji: "🥇", cible: "joueur",
  },
  {
    id: "suivi_ultime",     categorie: "suivi_complet", niveau: "ultime",
    nom: "Scientifique du sport", description: "Suivi complet 8 semaines de suite",
    emoji: "💎", cible: "joueur",
  },

  // ── Préparation mentale ───────────────────────────────────────────────────
  {
    id: "mental_bronze",    categorie: "mental",        niveau: "bronze",
    nom: "Premier souffle", description: "1ère séance de respiration ou scan enregistrée",
    emoji: "🥉", cible: "joueur",
  },
  {
    id: "mental_argent",    categorie: "mental",        niveau: "argent",
    nom: "Esprit en éveil",  description: "5 séances de préparation mentale",
    emoji: "🥈", cible: "joueur",
  },
  {
    id: "mental_or",        categorie: "mental",        niveau: "or",
    nom: "Mental de champion", description: "10 séances de préparation mentale",
    emoji: "🥇", cible: "joueur",
  },
  {
    id: "mental_ultime",    categorie: "mental",        niveau: "ultime",
    nom: "Maître du mental", description: "Activation, Relaxation et Scan corporel tous utilisés",
    emoji: "💎", cible: "joueur",
  },
];

// Helpers
export const BADGE_MAP = Object.fromEntries(BADGES.map(b => [b.id, b]));

export const NIVEAU_ORDER: Record<BadgeNiveau, number> = {
  bronze: 1, argent: 2, or: 3, ultime: 4,
};

export const NIVEAU_COLORS: Record<BadgeNiveau, string> = {
  bronze: "#CD7F32",
  argent: "#C0C0C0",
  or:     "#FFD700",
  ultime: "#A78BFA",
};

export const NIVEAU_LABELS: Record<BadgeNiveau, string> = {
  bronze: "Bronze",
  argent: "Argent",
  or:     "Or",
  ultime: "Ultime",
};

// Utilitaire : lundi de la semaine d'une date
export function lundiDeLaSemaine(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // lundi = 1
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}
