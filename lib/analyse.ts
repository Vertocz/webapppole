// Analyse vidéo des matchs 3x3 : types, géométrie du terrain FIBA 3x3,
// calibrage (homographie) et calcul des statistiques.
// Fonctions pures, sans React ni Supabase.

// ─── Types ───────────────────────────────────────────────────────────────────

export type ModeAdversaire = "aucun" | "simple" | "position";
export type TypeAction = "tir" | "lf" | "rebond" | "ballon_gagne" | "ballon_perdu" | "repere";
export type Equipe = "nous" | "adversaire";
export type Resultat = "reussi" | "rate" | "attente";
export type Zone =
  | "sous_panier"
  | "int_gauche" | "int_axe" | "int_droite"
  | "ext_gauche" | "ext_axe" | "ext_droite";

export interface PointCalibrage { id: string; u: number; v: number }

export interface Match {
  id: string;
  pole: "masculin" | "feminin";
  date_match: string;
  adversaire: string | null;
  competition: string | null;
  effectif: string[];
  mode_adversaire: ModeAdversaire;
  video_nom: string | null;
  video_taille: number | null;
  video_debut: number;
  calibration: PointCalibrage[] | null;
  cree_par: string | null;
  cree_le?: string;
}

export interface Action {
  id: string;
  match_id: string;
  t: number;
  type: TypeAction;
  equipe: Equipe;
  joueuse_id: string | null;
  points: 1 | 2 | null;
  zone: Zone | null;
  x: number | null;
  y: number | null;
  resultat: Resultat | null;
  rebond: "off" | "def" | null;
  /** Repères uniquement : titre libre (absent des autres actions) */
  titre?: string | null;
}

// ─── Terrain FIBA 3x3 ────────────────────────────────────────────────────────
// Repère en mètres : origine au milieu de la ligne de fond, x vers la droite
// (vu depuis le milieu du terrain, face au panier), y vers le haut du terrain.

export const TERRAIN = {
  largeur: 15,
  longueur: 11,
  panierY: 1.575,          // centre du cercle, depuis la ligne de fond
  planche: 1.2,
  raquetteDemiLargeur: 2.45, // raquette de 4,90 m
  ligneLF: 5.8,
  rayonLF: 1.8,
  rayonArc: 6.75,
  arcX: 6.6,                // lignes droites de l'arc, à 0,90 m des lignes de côté
  rayonNonCharge: 1.25,     // « sous le panier »
} as const;

/** Hauteur à laquelle l'arc à 2 pts rejoint ses lignes droites. */
export const ARC_JONCTION_Y =
  TERRAIN.panierY + Math.sqrt(TERRAIN.rayonArc ** 2 - TERRAIN.arcX ** 2);

export const ZONES: { id: Zone; label: string; court: string; points: 1 | 2; cx: number; cy: number }[] = [
  { id: "sous_panier", label: "Sous le panier", court: "Panier", points: 1, cx: 0, cy: 2.35 },
  { id: "int_gauche", label: "Intérieur gauche", court: "Int. G", points: 1, cx: -4.1, cy: 3.2 },
  { id: "int_axe", label: "Intérieur axe", court: "Int. axe", points: 1, cx: 0, cy: 4.7 },
  { id: "int_droite", label: "Intérieur droite", court: "Int. D", points: 1, cx: 4.1, cy: 3.2 },
  { id: "ext_gauche", label: "Extérieur gauche", court: "Ext. G", points: 2, cx: -5.6, cy: 9.2 },
  { id: "ext_axe", label: "Extérieur axe", court: "Ext. axe", points: 2, cx: 0, cy: 9.7 },
  { id: "ext_droite", label: "Extérieur droite", court: "Ext. D", points: 2, cx: 5.6, cy: 9.2 },
];

export const zoneLabel = (z: Zone | null) => ZONES.find((x) => x.id === z)?.label ?? "";

/** Le tir à cette position vaut-il 2 points ? */
export function estDeuxPoints(x: number, y: number): boolean {
  if (y < ARC_JONCTION_Y) return Math.abs(x) > TERRAIN.arcX;
  return Math.hypot(x, y - TERRAIN.panierY) > TERRAIN.rayonArc;
}

/** Zone et valeur d'un tir pris à la position (x, y) en mètres. */
export function classerTir(x: number, y: number): { points: 1 | 2; zone: Zone } {
  const deux = estDeuxPoints(x, y);
  if (!deux && Math.hypot(x, y - TERRAIN.panierY) <= TERRAIN.rayonNonCharge) {
    return { points: 1, zone: "sous_panier" };
  }
  const cote = x < -TERRAIN.raquetteDemiLargeur ? "gauche" : x > TERRAIN.raquetteDemiLargeur ? "droite" : "axe";
  return { points: deux ? 2 : 1, zone: `${deux ? "ext" : "int"}_${cote}` as Zone };
}

/** Zone par défaut quand on change la valeur d'un tir à la main (sans position). */
export function zonePourPoints(points: 1 | 2, zone: Zone | null): Zone | null {
  if (!zone) return null;
  const cote = zone === "sous_panier" ? "axe" : zone.split("_")[1];
  if (points === 2) return `ext_${cote}` as Zone;
  return zone.startsWith("int") || zone === "sous_panier" ? zone : (`int_${cote}` as Zone);
}

// ─── Repères de calibrage ────────────────────────────────────────────────────
// Ordre pensé pour le calibrage : les 4 coins de la raquette d'abord (toujours
// visibles et jamais alignés), puis les repères plus lointains.
export const REPERES: { id: string; label: string; x: number; y: number }[] = [
  { id: "raq_fond_g", label: "Raquette sur ligne de fond, gauche", x: -2.45, y: 0 },
  { id: "raq_fond_d", label: "Raquette sur ligne de fond, droite", x: 2.45, y: 0 },
  { id: "raq_lf_d", label: "Coin raquette / ligne LF, droite", x: 2.45, y: 5.8 },
  { id: "raq_lf_g", label: "Coin raquette / ligne LF, gauche", x: -2.45, y: 5.8 },
  { id: "arc_haut", label: "Haut de l'arc 2 pts (axe)", x: 0, y: TERRAIN.panierY + TERRAIN.rayonArc },
  { id: "fond_g", label: "Coin ligne de fond, gauche", x: -7.5, y: 0 },
  { id: "fond_d", label: "Coin ligne de fond, droite", x: 7.5, y: 0 },
  { id: "arc_fond_g", label: "Départ arc 2 pts sur ligne de fond, gauche", x: -6.6, y: 0 },
  { id: "arc_fond_d", label: "Départ arc 2 pts sur ligne de fond, droite", x: 6.6, y: 0 },
  { id: "haut_g", label: "Coin haut du terrain, gauche", x: -7.5, y: 11 },
  { id: "haut_d", label: "Coin haut du terrain, droite", x: 7.5, y: 11 },
];

// ─── Homographie ─────────────────────────────────────────────────────────────

export type Homographie = number[]; // 9 coefficients, h[8] = 1

/** Résout A·x = b (Gauss avec pivot partiel). Renvoie null si le système est singulier. */
function resoudre(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Homographie qui envoie src[i] sur dst[i] (au moins 4 couples, moindres carrés au-delà). */
export function calculerHomographie(
  src: { x: number; y: number }[],
  dst: { x: number; y: number }[],
): Homographie | null {
  if (src.length < 4 || src.length !== dst.length) return null;
  const rows: number[][] = [];
  const rhs: number[] = [];
  src.forEach((s, i) => {
    const d = dst[i];
    rows.push([s.x, s.y, 1, 0, 0, 0, -d.x * s.x, -d.x * s.y]); rhs.push(d.x);
    rows.push([0, 0, 0, s.x, s.y, 1, -d.y * s.x, -d.y * s.y]); rhs.push(d.y);
  });
  // Équations normales : (AᵀA) h = Aᵀb
  const AtA = Array.from({ length: 8 }, (_, i) =>
    Array.from({ length: 8 }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)));
  const Atb = Array.from({ length: 8 }, (_, i) => rows.reduce((s, r, k) => s + r[i] * rhs[k], 0));
  const h = resoudre(AtA, Atb);
  return h && h.every(Number.isFinite) ? [...h, 1] : null;
}

export function appliquer(H: Homographie, x: number, y: number): { x: number; y: number } | null {
  const w = H[6] * x + H[7] * y + H[8];
  if (Math.abs(w) < 1e-9) return null;
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}

export interface Calibrage {
  /** image (u, v ∈ 0..1) → terrain (m) */
  versTerrain: Homographie;
  /** terrain (m) → image (u, v) */
  versImage: Homographie;
  /** Écart moyen en cm entre les repères cliqués et leur position recalculée */
  erreurCm: number;
}

/** Construit le calibrage à partir des repères cliqués. Null si moins de 4 repères ou s'ils sont alignés. */
export function construireCalibrage(points: PointCalibrage[] | null): Calibrage | null {
  if (!points) return null;
  const couples = points
    .map((p) => ({ p, r: REPERES.find((r) => r.id === p.id) }))
    .filter((c): c is { p: PointCalibrage; r: (typeof REPERES)[number] } => !!c.r);
  if (couples.length < 4) return null;
  const img = couples.map((c) => ({ x: c.p.u, y: c.p.v }));
  const ter = couples.map((c) => ({ x: c.r.x, y: c.r.y }));
  const versTerrain = calculerHomographie(img, ter);
  const versImage = calculerHomographie(ter, img);
  if (!versTerrain || !versImage) return null;
  let somme = 0;
  for (const c of couples) {
    const q = appliquer(versTerrain, c.p.u, c.p.v);
    if (!q) return null;
    somme += Math.hypot(q.x - c.r.x, q.y - c.r.y);
  }
  return { versTerrain, versImage, erreurCm: Math.round((somme / couples.length) * 100) };
}

/** Lignes du demi-terrain (polylignes en mètres), pour les superposer à la vidéo. */
export function lignesTerrain(): { x: number; y: number }[][] {
  const T = TERRAIN;
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 40) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = a0 + ((a1 - a0) * i) / n;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });
  const aJ = Math.asin((ARC_JONCTION_Y - T.panierY) / T.rayonArc);
  return [
    [{ x: -7.5, y: 0 }, { x: 7.5, y: 0 }, { x: 7.5, y: 11 }, { x: -7.5, y: 11 }, { x: -7.5, y: 0 }],
    [{ x: -2.45, y: 0 }, { x: -2.45, y: 5.8 }, { x: 2.45, y: 5.8 }, { x: 2.45, y: 0 }],
    [{ x: -6.6, y: 0 }, { x: -6.6, y: ARC_JONCTION_Y }, ...arc(0, T.panierY, T.rayonArc, Math.PI - aJ, aJ), { x: 6.6, y: 0 }],
    arc(0, T.ligneLF, T.rayonLF, Math.PI, 0, 24),
    arc(0, T.panierY, T.rayonNonCharge, Math.PI, 0, 20),
  ];
}

// ─── Score et statistiques ───────────────────────────────────────────────────

export const estTir = (a: Action) => a.type === "tir" || a.type === "lf";

export function score(actions: Action[]): { nous: number; adversaire: number } {
  const s = { nous: 0, adversaire: 0 };
  for (const a of actions) if (estTir(a) && a.resultat === "reussi") s[a.equipe] += a.points ?? 1;
  return s;
}

export interface Ligne { reussis: number; tentes: number }
const ligne = (): Ligne => ({ reussis: 0, tentes: 0 });
export const pct = (l: Ligne) => (l.tentes ? Math.round((l.reussis / l.tentes) * 100) : null);
export const fmtLigne = (l: Ligne) => (l.tentes ? `${l.reussis}/${l.tentes}` : "–");
export const fmtPct = (l: Ligne) => { const p = pct(l); return p === null ? "–" : `${p} %`; };

export interface StatsBloc {
  points: number;
  tirs1: Ligne;
  tirs2: Ligne;
  lf: Ligne;
  /** Tirs en jeu (1 + 2 pts, hors LF) */
  tirs: Ligne;
  rebOff: number;
  rebDef: number;
  gagnes: number;
  perdus: number;
  zones: Record<Zone, Ligne>;
  enAttente: number;
}

function blocVide(): StatsBloc {
  return {
    points: 0, tirs1: ligne(), tirs2: ligne(), lf: ligne(), tirs: ligne(),
    rebOff: 0, rebDef: 0, gagnes: 0, perdus: 0, enAttente: 0,
    zones: Object.fromEntries(ZONES.map((z) => [z.id, ligne()])) as Record<Zone, Ligne>,
  };
}

function ajouter(b: StatsBloc, a: Action) {
  if (estTir(a)) {
    if (a.resultat === "attente" || !a.resultat) { b.enAttente++; return; }
    const ok = a.resultat === "reussi";
    const compte = (l: Ligne) => { l.tentes++; if (ok) l.reussis++; };
    if (a.type === "lf") compte(b.lf);
    else {
      compte(a.points === 2 ? b.tirs2 : b.tirs1);
      compte(b.tirs);
      if (a.zone) compte(b.zones[a.zone]);
    }
    if (ok) b.points += a.points ?? 1;
  } else if (a.type === "rebond") {
    if (a.rebond === "off") b.rebOff++; else if (a.rebond === "def") b.rebDef++;
  } else if (a.type === "ballon_gagne") b.gagnes++;
  else if (a.type === "ballon_perdu") b.perdus++;
}

export interface StatsMatch {
  equipe: StatsBloc;
  adversaire: StatsBloc;
  joueurs: Record<string, StatsBloc>;
}

export function calculerStats(actions: Action[], effectif: string[]): StatsMatch {
  const res: StatsMatch = {
    equipe: blocVide(),
    adversaire: blocVide(),
    joueurs: Object.fromEntries(effectif.map((id) => [id, blocVide()])),
  };
  for (const a of actions) {
    if (a.equipe === "adversaire") { ajouter(res.adversaire, a); continue; }
    ajouter(res.equipe, a);
    if (a.joueuse_id) {
      res.joueurs[a.joueuse_id] ??= blocVide();
      ajouter(res.joueurs[a.joueuse_id], a);
    }
  }
  return res;
}

/**
 * Rebond offensif ou défensif, déduit du dernier tir raté ou en attente
 * dans les 10 secondes qui précèdent. Null si on ne peut pas savoir.
 */
export function deduireRebond(actions: Action[], t: number, equipeRebond: Equipe): "off" | "def" | null {
  const precedents = actions.filter((a) => a.t <= t + 0.01).sort((a, b) => b.t - a.t);
  const dernier = precedents.find((a) => estTir(a) || a.type === "rebond");
  if (!dernier || !estTir(dernier) || dernier.resultat === "reussi" || t - dernier.t > 10) return null;
  return dernier.equipe === equipeRebond ? "off" : "def";
}

/** Temps affiché (mm:ss) depuis le début du match dans la vidéo. */
export function fmtTemps(t: number): string {
  const neg = t < 0;
  const s = Math.floor(Math.abs(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  const core = h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  return neg ? `-${core}` : core;
}

export function nouvelId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
