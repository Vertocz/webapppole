// ═════════════════════════════════════════════════════════════════════════════
//  Mesure du geste à partir des capteurs du téléphone.
//
//  Le jeu d'origine lisait l'accélération « dans le repère du téléphone » : si on le
//  tenait un peu penché, le geste était mal compris. Ici, on se place dans le repère
//  du monde (vers le haut / vers l'avant / sur le côté) grâce à la gravité, on calcule
//  la VITESSE du téléphone au moment du lâcher (et non un simple pic d'accélération),
//  et on sépare la cassure du poignet des rotations parasites.
//
//  Ce fichier ne touche ni à l'écran ni au navigateur : il est testable seul
//  (voir gesture.test.ts).
// ═════════════════════════════════════════════════════════════════════════════

import {
  GESTURE_WINDOW_MS,
  MIN_SPEED,
  TRIGGER_UP,
  VERTICAL_MAX_LINEAR,
  VERTICAL_MAX_TILT,
} from "./settings";

export type Vec3 = [number, number, number];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : [0, 1, 0];
};
/** Composante de v perpendiculaire à l'axe unitaire u. */
const reject = (v: Vec3, u: Vec3): Vec3 => sub(v, scale(u, dot(v, u)));
const deg = (rad: number) => (rad * 180) / Math.PI;

/** Un échantillon de capteur, déjà nettoyé (repère du téléphone). */
export interface Sample {
  t: number; // ms
  lin: Vec3; // accélération sans la gravité (m/s²)
  up: Vec3; // direction « vers le haut » vue par le téléphone (unitaire)
  rotX: number | null; // rotation autour de l'axe horizontal de l'écran (°/s) = cassure du poignet
  rotOther: number | null; // rotations parasites (torsion, pivot) (°/s)
}

/** Ce que l'on retient d'un geste. */
export interface GestureMeasure {
  speed: number; // vitesse au lâcher (m/s)
  arc: number; // angle de sortie au-dessus de l'horizontale (°)
  aim: number; // écart gauche/droite (°), positif = à droite
  flick: number | null; // pic de cassure du poignet (°/s), null si gyroscope absent
  flickOffsetMs: number | null; // moment de la cassure par rapport au lâcher (ms)
  flickPurity: number; // 0..1 : 1 = poignet seul, 0 = que de la torsion
  peakUp: number; // pic d'accélération vers le haut (m/s²)
  pushMs: number; // durée de la poussée jusqu'au lâcher (ms)
}

/** Repère du monde vu par le téléphone : haut, avant (vers le panier), droite. */
function worldAxes(up: Vec3): { up: Vec3; fwd: Vec3; right: Vec3 } {
  // L'écran regarde le joueur (+z vers lui) : l'avant, vers le panier, c'est −z.
  let fwd = reject([0, 0, -1], up);
  if (len(fwd) < 0.2) fwd = reject([0, -1, 0], up); // téléphone à plat : repli
  fwd = norm(fwd);
  const right = norm(reject(reject([1, 0, 0], up), fwd));
  return { up, fwd, right };
}

/** Accélération vers le haut (repère du monde) d'un échantillon. */
export function upAccel(s: Sample): number {
  return dot(s.lin, s.up);
}

/** Écart du téléphone à la verticale (°), écran face au joueur. */
export function tiltFromVertical(s: Sample): number {
  return deg(Math.acos(Math.max(-1, Math.min(1, s.up[1]))));
}

export function isHeldStill(s: Sample): boolean {
  return tiltFromVertical(s) <= VERTICAL_MAX_TILT && len(s.lin) <= VERTICAL_MAX_LINEAR;
}

/**
 * Analyse un geste complet. `samples` contient un peu d'avant-déclenchement (pour ne pas
 * rater le début de la poussée) puis toute la fenêtre d'observation.
 * Renvoie null si ce n'était pas un tir (simple secousse).
 */
export function analyzeGesture(samples: Sample[]): GestureMeasure | null {
  if (samples.length < 4) return null;

  // Début de la poussée : dernier moment avant le déclenchement où l'on ne montait pas encore.
  const trigger = samples.findIndex((s) => upAccel(s) >= TRIGGER_UP);
  if (trigger < 0) return null;
  let start = trigger;
  while (start > 0 && upAccel(samples[start - 1]) > 0.4) start--;

  // Intégration de l'accélération → vitesse, dans le repère du monde.
  let vUp = 0;
  let vFwd = 0;
  let vRight = 0;
  let best = { vUp: 0, vFwd: 0, vRight: 0, t: samples[start].t, i: start };
  let peakUp = 0;
  let prev: { aUp: number; aFwd: number; aRight: number; t: number } | null = null;

  for (let i = start; i < samples.length; i++) {
    const s = samples[i];
    const ax = worldAxes(s.up);
    const cur = { aUp: dot(s.lin, ax.up), aFwd: dot(s.lin, ax.fwd), aRight: dot(s.lin, ax.right), t: s.t };
    peakUp = Math.max(peakUp, cur.aUp);
    if (prev) {
      const dt = Math.min(0.05, Math.max(0, (cur.t - prev.t) / 1000));
      vUp += ((cur.aUp + prev.aUp) / 2) * dt;
      vFwd += ((cur.aFwd + prev.aFwd) / 2) * dt;
      vRight += ((cur.aRight + prev.aRight) / 2) * dt;
    }
    prev = cur;
    // Le lâcher = vitesse verticale maximale (le bras commence à freiner juste après).
    if (vUp > best.vUp) best = { vUp, vFwd, vRight, t: s.t, i };
    if (s.t - samples[trigger].t > GESTURE_WINDOW_MS) break;
  }

  const speed = Math.hypot(best.vUp, best.vFwd, best.vRight);
  if (speed < MIN_SPEED) return null;
  const arc = deg(Math.atan2(best.vUp, best.vFwd));
  const aim = deg(Math.atan2(best.vRight, Math.hypot(best.vUp, best.vFwd)));

  // Poignet : rotation la plus vive autour de l'axe horizontal, près du lâcher.
  let flick: number | null = null;
  let flickT = 0;
  let twist = 0;
  for (let i = start; i < samples.length; i++) {
    const s = samples[i];
    if (s.t < best.t - 150) continue;
    if (s.rotX !== null && Math.abs(s.rotX) > (flick ?? -1)) {
      flick = Math.abs(s.rotX);
      flickT = s.t;
    }
    if (s.rotOther !== null) twist = Math.max(twist, s.rotOther);
  }
  const flickPurity = flick === null || flick + twist < 1 ? 0.5 : flick / (flick + twist);

  return {
    speed,
    arc,
    aim,
    flick,
    flickOffsetMs: flick === null ? null : flickT - best.t,
    flickPurity,
    peakUp,
    pushMs: best.t - samples[start].t,
  };
}

// ─── Conversion des événements du navigateur ─────────────────────────────────
type XYZ = { x: number | null; y: number | null; z: number | null } | null;
type Rot = { alpha: number | null; beta: number | null; gamma: number | null } | null;

const toVec = (v: XYZ): Vec3 | null =>
  v && v.x !== null && v.y !== null && v.z !== null ? [v.x, v.y, v.z] : null;

/**
 * Transforme les DeviceMotionEvent en échantillons propres.
 * Gère les téléphones sans « acceleration » (on estime alors la gravité par un filtre lent)
 * et l'inversion de signe des iPhone (détectée sur la gravité quand le téléphone est droit).
 */
export class MotionTracker {
  private gravityEstimate: Vec3 | null = null;
  private flip = 1;

  push(t: number, linRaw: XYZ, gravRaw: XYZ, rot: Rot): Sample | null {
    let lin = toVec(linRaw);
    let grav = toVec(gravRaw);
    if (!lin && !grav) return null;

    // iPhone : mêmes axes, signe inversé. Téléphone droit et calme → gravité « vers le haut » en +y.
    if (grav && Math.abs(grav[1]) > 8 && (!lin || len(lin) < 1)) this.flip = grav[1] < 0 ? -1 : 1;
    if (this.flip < 0) {
      if (lin) lin = scale(lin, -1);
      if (grav) grav = scale(grav, -1);
    }

    let up: Vec3;
    if (lin && grav) {
      up = norm(sub(grav, lin));
    } else if (grav) {
      const g = this.gravityEstimate ?? grav;
      this.gravityEstimate = [g[0] * 0.9 + grav[0] * 0.1, g[1] * 0.9 + grav[1] * 0.1, g[2] * 0.9 + grav[2] * 0.1];
      lin = sub(grav, this.gravityEstimate);
      up = norm(this.gravityEstimate);
    } else {
      up = [0, 1, 0]; // pas de gravité : on suppose le téléphone droit
    }

    const hasRot = rot && rot.alpha !== null && rot.beta !== null && rot.gamma !== null;
    return {
      t,
      lin: lin as Vec3,
      up,
      // Spécification : beta = rotation autour de l'axe x (horizontal de l'écran).
      rotX: hasRot ? (rot!.beta as number) : null,
      rotOther: hasRot ? Math.hypot(rot!.alpha as number, rot!.gamma as number) : null,
    };
  }
}
