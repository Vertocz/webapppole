// ═════════════════════════════════════════════════════════════════════════════
//  RÉGLAGES — tout ce qu'il faut toucher pour équilibrer le jeu est ici.
//  Astuce : active le « mode labo » dans l'app, fais quelques bons tirs avec des
//  joueurs, note les valeurs affichées et ajuste les IDEAL_* ci-dessous.
// ═════════════════════════════════════════════════════════════════════════════

/** Vitesse du téléphone au lâcher (m/s). C'est elle qui décide court / long. */
export const IDEAL_SPEED = 2.2;
export const SPEED_TOLERANCE = 0.9;

/** Angle de sortie au-dessus de l'horizontale (°). 90 = tout droit vers le haut. */
export const IDEAL_ARC = 62;
export const ARC_TOLERANCE = 26;

/** Écart gauche/droite toléré (°) avant de rater sur le côté. */
export const AIM_TOLERANCE = 16;

/** Cassure du poignet : vitesse de rotation (°/s) autour de l'axe horizontal du téléphone. */
export const IDEAL_FLICK = 300;
export const FLICK_TOLERANCE = 230;
/** Le poignet doit casser autour du lâcher : fenêtre acceptée (ms) avant / après. */
export const FLICK_EARLY_MS = 80;
export const FLICK_LATE_MS = 220;

/** Poids de chaque critère dans la note du geste (somme = 1). */
export const WEIGHTS = { speed: 0.35, aim: 0.25, arc: 0.15, flick: 0.25 };

/**
 * Chance de marquer selon la note du geste (0..1), identique pour tout le monde.
 * Sous MAKE_MIN : jamais. À partir de MAKE_MIN + MAKE_RANGE : presque toujours.
 */
export const MAKE_MIN = 0.35;
export const MAKE_RANGE = 0.5;
export const MAKE_MAX = 0.97;

// ─── Détection ───────────────────────────────────────────────────────────────
/** Le geste démarre quand l'accélération vers le haut dépasse ce seuil (m/s²). */
export const TRIGGER_UP = 3.0;
/** Durée d'observation après le début du geste (ms). */
export const GESTURE_WINDOW_MS = 450;
/** En dessous de cette vitesse (m/s), c'était une secousse, pas un tir. */
export const MIN_SPEED = 0.7;

/** Réarmement : téléphone tenu droit (écart à la verticale, °) et immobile. */
export const VERTICAL_MAX_TILT = 30;
export const VERTICAL_MAX_LINEAR = 2.5;
export const VERTICAL_HOLD_MS = 300;

// ─── Niveaux ─────────────────────────────────────────────────────────────────
export type Level = "facile" | "normal" | "expert";

/** Multiplie toutes les tolérances : plus grand = plus permissif. */
export const LEVELS: Record<Level, { label: string; tolerance: number; description: string }> = {
  facile: { label: "Facile", tolerance: 1.6, description: "Pour découvrir le geste" },
  normal: { label: "Normal", tolerance: 1, description: "Le vrai lancer franc" },
  expert: { label: "Expert", tolerance: 0.65, description: "Il faut un geste parfait" },
};
