// ─── Définition des badges ────────────────────────────────────────────────────
// Pour remplacer l'emoji par une image PNG :
// Ajouter image?: string et utiliser <img src={`/badges/${badge.image}`} />

export type BadgeCategorie =
  | "basket" | "renforcement" | "connexion"
  | "forme" | "mental" | "complet";

export interface BadgeDef {
  id: string;
  categorie: BadgeCategorie;
  nom: string;
  description: string;
  emoji: string;
  // "joueur_tous" = tous les joueurs, "joueur_masculin" = masculin seulement, "staff" = staff
  cible: "joueur_tous" | "joueur_masculin" | "staff";
}

export const BADGES: BadgeDef[] = [
  // ── Basket ────────────────────────────────────────────────────────────────
  {
    id: "basket_engage",
    categorie: "basket",
    nom: "Basketteur engagé",
    description: "10 séances de basket enregistrées",
    emoji: "🏀",
    cible: "joueur_tous",
  },

  // ── Renforcement ──────────────────────────────────────────────────────────
  {
    id: "renfo_semaine",
    categorie: "renforcement",
    nom: "Semaine chargée",
    description: "3 séances de renforcement musculaire dans la même semaine",
    emoji: "💪",
    cible: "joueur_tous",
  },

  // ── Série sportive ────────────────────────────────────────────────────────
  {
    id: "serie_feu",
    categorie: "basket",
    nom: "Série de feu",
    description: "Suivi sportif enregistré 3 jours consécutifs",
    emoji: "🔥",
    cible: "joueur_tous",
  },
  {
    id: "machine",
    categorie: "basket",
    nom: "Machine",
    description: "20 séances au total toutes disciplines confondues",
    emoji: "⚡",
    cible: "joueur_tous",
  },

  // ── Connexions joueurs ────────────────────────────────────────────────────
  {
    id: "presence_joueur",
    categorie: "connexion",
    nom: "Présence",
    description: "Connecté 7 jours de suite",
    emoji: "📅",
    cible: "joueur_tous",
  },

  // ── Connexions staff ──────────────────────────────────────────────────────
  {
    id: "presence_staff",
    categorie: "connexion",
    nom: "Présence",
    description: "Connecté 7 jours de suite",
    emoji: "📅",
    cible: "staff",
  },

  // ── Forme / bien-être ─────────────────────────────────────────────────────
  {
    id: "recuperation_pro",
    categorie: "forme",
    nom: "Récupération pro",
    description: "Sommeil ≥ 4/5 pendant 5 jours consécutifs",
    emoji: "😴",
    cible: "joueur_tous",
  },
  {
    id: "zen",
    categorie: "forme",
    nom: "Zen",
    description: "Stress ≤ 2/5 pendant une semaine entière",
    emoji: "🌿",
    cible: "joueur_tous",
  },

  // ── Prépa mentale (masculin seulement) ────────────────────────────────────
  {
    id: "mental_fer",
    categorie: "mental",
    nom: "Mental de fer",
    description: "10 séances de respiration ou scan corporel",
    emoji: "🧘",
    cible: "joueur_masculin",
  },
  {
    id: "explorateur_mental",
    categorie: "mental",
    nom: "Explorateur mental",
    description: "Avoir essayé les 3 catégories de respiration",
    emoji: "🎯",
    cible: "joueur_masculin",
  },
  {
    id: "scan_master",
    categorie: "mental",
    nom: "Scan master",
    description: "Avoir écouté le scan corporel 5 fois",
    emoji: "🌊",
    cible: "joueur_masculin",
  },

  // ── Complet ───────────────────────────────────────────────────────────────
  {
    id: "complet_masc",
    categorie: "complet",
    nom: "Complet",
    description: "Toutes les sections de l'app utilisées au moins une fois",
    emoji: "🎨",
    cible: "joueur_masculin",
  },
  {
    id: "complet_fem",
    categorie: "complet",
    nom: "Complet",
    description: "Toutes les sections de l'app utilisées au moins une fois",
    emoji: "🎨",
    cible: "joueur_tous",
  },
];

export const BADGE_MAP = Object.fromEntries(BADGES.map(b => [b.id, b]));

export const CATEGORIE_LABELS: Record<BadgeCategorie, { label: string; icon: string }> = {
  basket:       { label: "Basket & Sport",      icon: "⛹️‍♀️" },
  renforcement: { label: "Renforcement",         icon: "🏋️‍♂️" },
  connexion:    { label: "Connexions",           icon: "📅" },
  forme:        { label: "Forme & Bien-être",    icon: "💆" },
  mental:       { label: "Préparation mentale",  icon: "🧠" },
  complet:      { label: "Explorateur",          icon: "🎨" },
};

// Retourne les badges visibles selon le profil

export const CATEGORIE_COLORS: Record<BadgeCategorie, string> = {
  basket:        "#E8641C",
  renforcement:  "#63C878",
  connexion:     "#64A0FF",
  forme:         "#B478FF",
  mental:        "#FFC850",
  complet:       "#FF78B4",
};

export function getBadgesPourProfil(
  userType: "joueur" | "staff",
  categorie?: string // "Masculin" ou "Féminin"
): BadgeDef[] {
  if (userType === "staff") return BADGES.filter(b => b.cible === "staff");

  return BADGES.filter(b => {
    if (b.cible === "staff") return false;
    if (b.cible === "joueur_masculin") return categorie === "Masculin";
    // joueur_tous : visible par tous sauf "complet_fem" si masculin (on a complet_masc à la place)
    if (b.id === "complet_fem") return categorie !== "Masculin";
    if (b.id === "complet_masc") return categorie === "Masculin";
    return true;
  });
}

// Utilitaire : lundi de la semaine
export function lundiDeLaSemaine(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}
