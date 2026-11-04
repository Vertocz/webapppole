// Note du geste et décision du tir. Mêmes règles pour tout le monde : seul le geste compte.

import type { GestureMeasure } from "./gesture";
import {
  AIM_TOLERANCE,
  ARC_TOLERANCE,
  FLICK_EARLY_MS,
  FLICK_LATE_MS,
  FLICK_TOLERANCE,
  IDEAL_ARC,
  IDEAL_FLICK,
  IDEAL_SPEED,
  LEVELS,
  MAKE_MAX,
  MAKE_MIN,
  MAKE_RANGE,
  SPEED_TOLERANCE,
  WEIGHTS,
  type Level,
} from "./settings";

export type Outcome = "swish" | "made" | "rimout" | "board" | "short" | "wide";

export interface ShotResult {
  id: number;
  outcome: Outcome;
  side: 1 | -1; // côté où part le ballon (−1 gauche, 1 droite)
  offset: number; // 0..1 : à quel point il s'écarte du centre
}

/** Écarts signés, en « tolérances » : 0 = parfait, ±1 = limite. */
export interface Evaluation {
  speedErr: number; // < 0 trop court, > 0 trop long
  aimErr: number; // < 0 à gauche, > 0 à droite
  arcErr: number; // < 0 trop plat, > 0 trop haut
  flickQ: number; // 0..1
  quality: number; // 0..1 note finale
  measure: GestureMeasure;
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const q = (err: number) => clamp(1 - Math.abs(err), 0, 1);

export function evaluate(m: GestureMeasure, level: Level): Evaluation {
  const tol = LEVELS[level].tolerance;
  const speedErr = (m.speed - IDEAL_SPEED) / (SPEED_TOLERANCE * tol);
  const aimErr = m.aim / (AIM_TOLERANCE * tol);
  const arcErr = (m.arc - IDEAL_ARC) / (ARC_TOLERANCE * tol);

  let flickQ = 0.5; // pas de gyroscope : on ne pénalise ni ne récompense
  if (m.flick !== null) {
    const strength = q((m.flick - IDEAL_FLICK) / (FLICK_TOLERANCE * tol));
    const off = m.flickOffsetMs ?? 0;
    const timing = off < -FLICK_EARLY_MS * tol
      ? q((off + FLICK_EARLY_MS * tol) / 150)
      : off > FLICK_LATE_MS * tol
        ? q((off - FLICK_LATE_MS * tol) / 150)
        : 1;
    flickQ = strength * timing * (0.6 + 0.4 * m.flickPurity);
  }

  const quality = clamp(
    WEIGHTS.speed * q(speedErr) + WEIGHTS.aim * q(aimErr) + WEIGHTS.arc * q(arcErr) + WEIGHTS.flick * flickQ,
    0,
    1,
  );
  return { speedErr, aimErr, arcErr, flickQ, quality, measure: m };
}

/** Chance de marquer pour une note donnée (affichée en mode labo). */
export function makeChance(quality: number): number {
  return clamp((quality - MAKE_MIN) / MAKE_RANGE, 0, MAKE_MAX);
}

/**
 * Les gros défauts décident seuls (trop court, trop long, à côté) : le joueur comprend
 * toujours pourquoi il a raté. Dans la zone correcte, un peu de hasard garde du suspense.
 */
export function decideShot(id: number, e: Evaluation, rng: () => number = Math.random): ShotResult {
  const side: 1 | -1 = Math.abs(e.aimErr) < 0.12 ? (rng() < 0.5 ? -1 : 1) : e.aimErr < 0 ? -1 : 1;
  const offset = clamp(Math.abs(e.aimErr), 0, 1.5) / 1.5;
  const res = (outcome: Outcome): ShotResult => ({ id, outcome, side, offset });

  if (Math.abs(e.aimErr) > 1) return res("wide");
  if (e.speedErr < -1) return res("short");
  if (e.speedErr > 1) return res("board");

  if (rng() < makeChance(e.quality)) {
    const swishChance = clamp((e.quality - 0.55) * 2.2, 0, 0.9);
    return res(rng() < swishChance ? "swish" : "made");
  }
  if (e.speedErr < -0.45) return res("short");
  if (e.speedErr > 0.45) return res("board");
  return res("rimout");
}

export function isMade(o: Outcome): boolean {
  return o === "swish" || o === "made";
}

export function outcomeLabel(o: Outcome): string {
  switch (o) {
    case "swish": return "SWISH !";
    case "made": return "PANIER !";
    case "rimout": return "RESSORTI…";
    case "board": return "TROP FORT";
    case "wide": return "À CÔTÉ";
    default: return "TROP COURT";
  }
}

/** Le conseil le plus utile après un tir : on corrige le plus gros défaut, un seul à la fois. */
export function tip(e: Evaluation): string {
  const issues: Array<[number, string]> = [
    [Math.abs(e.speedErr), e.speedErr < 0 ? "Pousse un peu plus fort" : "Un peu moins fort"],
    [Math.abs(e.aimErr), e.aimErr < 0 ? "Vise plus à droite" : "Vise plus à gauche"],
    [Math.abs(e.arcErr) * 0.8, e.arcErr < 0 ? "Monte plus le ballon" : "Pousse plus vers le panier"],
    [(1 - e.flickQ) * 0.9, "Casse le poignet au lâcher"],
  ];
  issues.sort((a, b) => b[0] - a[0]);
  if (issues[0][0] < 0.3) return e.quality > 0.85 ? "Geste parfait !" : "Très beau geste";
  return issues[0][1];
}
