"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  getIdentity,
  loadLocalStats,
  saveLocalStats,
  mergeStats,
  pushStats,
  pullMyStats,
  fetchStreakRecord,
  pickStreakRecord,
  type LFIdentity,
} from "@/lib/lancerFrancStats";

// ═════════════════════════════════════════════════════════════════════════════
//  RÉGLAGES — tout ce qu'il faut toucher pour équilibrer le jeu est ici
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Mêmes règles pour tout le monde : la chance de marquer ne dépend QUE de la qualité du geste
 * (0..1), jamais de l'historique du joueur. p = (qualité − MAKE_MIN_QUALITY) / MAKE_RANGE.
 * Sous MAKE_MIN_QUALITY on ne marque jamais ; à partir de MAKE_MIN_QUALITY + MAKE_RANGE on
 * marque presque toujours (plafond MAKE_MAX).
 */
const MAKE_MIN_QUALITY = 0.3;
const MAKE_RANGE = 0.6;
const MAKE_MAX = 0.95;

// Geste : poussée vers le haut (accélération Y du téléphone) puis cassure du poignet.
const IDEAL_PUSH = 14; // m/s² au pic de la poussée
const PUSH_TOLERANCE = 7;
const IDEAL_FLICK = 320; // °/s de rotation au moment de la cassure du poignet
const FLICK_TOLERANCE = 240;
const ANGLE_TOLERANCE_DEG = 40; // écart max à la verticale
const TRIGGER_Y = 3.2; // début de geste détecté au-delà de cette poussée
const MIN_PUSH = 4.5; // en dessous, ce n'était pas un tir (simple secousse)
const GESTURE_WINDOW_MS = 420; // durée d'observation après le début du geste

// Réarmement : téléphone à la verticale et stable.
const VERTICAL_MAX_Z = 4.5; // gravité perpendiculaire à l'écran (≈ 27° max)
const VERTICAL_HOLD_MS = 250;
const VERTICAL_MAX_LINEAR = 3.5;

// ═════════════════════════════════════════════════════════════════════════════

export type Outcome = "swish" | "made" | "rimout" | "board" | "short";
type SensorStatus = "checking" | "needs-permission" | "granted" | "denied" | "unsupported";
type GamePhase = "waiting-vertical" | "ready" | "measuring" | "animating" | "waiting-reset";

export interface ShotResult {
  id: number;
  outcome: Outcome;
  side: 1 | -1;
}

interface MotionSample {
  x: number;
  y: number;
  z: number;
  mag: number;
  rot: number | null;
  t: number;
}

interface Stats {
  attempts: number;
  makes: number;
  streak: number;
  best: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function qualityFromValue(value: number, ideal: number, tolerance: number): number {
  return clamp(1 - Math.abs(value - ideal) / tolerance, 0, 1);
}

export function isMade(outcome: Outcome): boolean {
  return outcome === "swish" || outcome === "made";
}

function outcomeLabel(outcome: Outcome): string {
  switch (outcome) {
    case "swish": return "SWISH !";
    case "made": return "PANIER !";
    case "rimout": return "RESSORTI…";
    case "board": return "TROP FORT";
    default: return "TROP COURT";
  }
}

async function requestMotionPermission(): Promise<boolean> {
  try {
    const DME = window.DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (typeof DME?.requestPermission === "function") {
      return (await DME.requestPermission()) === "granted";
    }
    return typeof window.DeviceMotionEvent !== "undefined";
  } catch {
    return false;
  }
}

// ─── Décision du tir ─────────────────────────────────────────────────────────
// Même fonction pour tous les joueurs. Pour les ratés, la force du geste dit pourquoi
// (trop faible → trop court, trop fort → planche) : le retour est lisible.
function decideShot(id: number, peakPush: number, angleDeg: number, flick: number | null): ShotResult {
  const pushQ = qualityFromValue(peakPush, IDEAL_PUSH, PUSH_TOLERANCE);
  const angleQ = qualityFromValue(angleDeg, 0, ANGLE_TOLERANCE_DEG);
  const flickQ = flick === null ? 0.5 : qualityFromValue(flick, IDEAL_FLICK, FLICK_TOLERANCE);
  const quality = clamp(0.4 * pushQ + 0.3 * flickQ + 0.3 * angleQ, 0, 1);
  const p = clamp((quality - MAKE_MIN_QUALITY) / MAKE_RANGE, 0, MAKE_MAX);

  const side: 1 | -1 = Math.random() < 0.5 ? -1 : 1;
  if (Math.random() < p) {
    const swishChance = 0.2 + 0.5 * quality;
    return { id, outcome: Math.random() < swishChance ? "swish" : "made", side };
  }
  const ratio = peakPush / IDEAL_PUSH;
  let outcome: Outcome;
  if (ratio < 0.75) outcome = "short";
  else if (ratio > 1.35) outcome = "board";
  else if (Math.random() < 0.7) outcome = "rimout";
  else outcome = ratio < 1 ? "short" : "board";
  return { id, outcome, side };
}

// ─── Palette : aplats, aucun dégradé ─────────────────────────────────────────
const C_BG = "#0F1520";
const C_FLOOR = "#161E2C";
const C_BOARD = "#18212F";
const C_LINE = "#E9EEF7";
const C_ORANGE = "#FF6A2A";
const C_ORANGE_DARK = "#B84418";
const C_BALL = "#F57A2E";
const C_SEAM = "#1B0F08";
const C_GREEN = "#5FE3A1";
const C_RED = "#FF8A80";

// ─── Géométrie de la scène (partagée entre trajectoire et dessin) ────────────
interface Layout {
  unit: number;
  rimX: number;
  rimY: number;
  rimRX: number;
  rimRY: number;
  boardX: number;
  boardY: number;
  boardW: number;
  boardH: number;
  netBottomY: number;
  floorY: number;
  rNear: number; // rayon du ballon au sol (au départ)
  rFar: number; // rayon du ballon à hauteur du cercle
  start: { x: number; y: number };
}

function layout(W: number, H: number): Layout {
  const unit = clamp(W / 390, 0.8, 1.5);
  const rimX = W * 0.5;
  const rimY = H * 0.3;
  const rimRX = W * 0.2;
  const rimRY = rimRX * 0.22;
  const boardW = Math.min(W * 0.7, 290 * unit);
  const boardH = boardW * 0.62;
  return {
    unit,
    rimX,
    rimY,
    rimRX,
    rimRY,
    boardX: rimX - boardW / 2,
    boardY: rimY - boardH * 0.78,
    boardW,
    boardH,
    netBottomY: rimY + rimRY + rimRX * 1.5,
    floorY: H * 0.8,
    rNear: W * 0.1,
    rFar: W * 0.085,
    start: { x: W * 0.5, y: H * 0.84 },
  };
}

/** Le ballon rapetisse en montant vers le cercle : taille déduite de la hauteur seulement. */
function radiusAtY(L: Layout, y: number): number {
  const k = clamp((L.start.y - y) / (L.start.y - L.rimY), 0, 1);
  return L.rNear + (L.rFar - L.rNear) * k;
}

// ─── Filet : maillage en losanges simulé (verlet) ────────────────────────────
const NET_ROWS = 6;
const NET_COLS = 6;

interface NetTopo {
  n: number;
  rowOf: number[];
  offOf: number[]; // position horizontale en unités de colonne (0..NET_COLS)
  edges: Array<[number, number, boolean]>; // [a, b, dessiné]
}

function netTopology(): NetTopo {
  const rowOf: number[] = [];
  const offOf: number[] = [];
  const index: number[][] = [];
  for (let r = 0; r < NET_ROWS; r++) {
    const count = r % 2 === 0 ? NET_COLS + 1 : NET_COLS;
    index.push([]);
    for (let k = 0; k < count; k++) {
      index[r].push(rowOf.length);
      rowOf.push(r);
      offOf.push(r % 2 === 0 ? k : k + 0.5);
    }
  }
  const edges: Array<[number, number, boolean]> = [];
  for (let r = 0; r < NET_ROWS; r++) {
    const row = index[r];
    for (let k = 0; k < row.length; k++) {
      if (k + 1 < row.length) edges.push([row[k], row[k + 1], false]); // structure, invisible
      if (r + 1 >= NET_ROWS) continue;
      const below = index[r + 1];
      const lower = r % 2 === 0 ? [k - 1, k] : [k, k + 1];
      for (const j of lower) {
        if (j >= 0 && j < below.length) edges.push([row[k], below[j], true]);
      }
    }
  }
  return { n: rowOf.length, rowOf, offOf, edges };
}

const NET_TOPO = netTopology();

function netRestPositions(L: Layout): Float32Array {
  const pos = new Float32Array(NET_TOPO.n * 2);
  const topW = L.rimRX * 2 * 0.97;
  const botW = L.rimRX * 2 * 0.62;
  const top = L.rimY + L.rimRY * 0.2;
  const len = L.netBottomY - top;
  for (let i = 0; i < NET_TOPO.n; i++) {
    const p = NET_TOPO.rowOf[i] / (NET_ROWS - 1);
    const u = (NET_TOPO.offOf[i] / NET_COLS) * 2 - 1;
    const w = topW + (botW - topW) * p;
    pos[i * 2] = L.rimX + (u * w) / 2;
    // La première rangée suit l'arc avant du cercle, le reste pend.
    pos[i * 2 + 1] = p === 0 ? L.rimY + L.rimRY * Math.sqrt(Math.max(0, 1 - u * u)) : top + len * p;
  }
  return pos;
}

/**
 * Rejoue le filet pas à pas, avec deux mouvements doux (deux ressorts amortis) plutôt qu'une
 * simulation maille par maille, qui finissait toujours en chiffon :
 *  - un balancement latéral, entraîné par le ballon puis relâché ;
 *  - un étirement vertical : le filet s'allonge sous le ballon, puis rebondit vers le haut
 *    (et s'élargit quand il se raccourcit).
 * Pendant que le ballon est dedans, les mailles qu'il touche sont repoussées sur son contour.
 */
function simulateNet(L: Layout, pts: TrajPoint[], dt: number, tCollide: number): Float32Array {
  const n = NET_TOPO.n;
  const rest = netRestPositions(L);
  const frames = new Float32Array(pts.length * n * 2);
  const netLen = L.netBottomY - L.rimY;
  let sway = 0;
  let swayV = 0;
  let lift = 0;
  let liftV = 0;

  for (let s = 0; s < pts.length; s++) {
    const ball = pts[s];
    const inNet = s * dt >= tCollide
      && ball.y > L.rimY - ball.r * 0.3
      && ball.y < L.netBottomY + ball.r * 2
      && Math.abs(ball.x - L.rimX) < L.rimRX * 1.4;

    const k = inNet ? 900 : 340;
    const c = inNet ? 26 : 4.5;
    const targetSway = inNet ? (ball.x - L.rimX) * 0.7 : 0;
    const targetLift = inNet ? clamp((ball.y - L.rimY) / netLen, 0, 1.2) * netLen * 0.24 : 0;
    swayV += ((targetSway - sway) * k - c * swayV) * dt;
    sway += swayV * dt;
    liftV += ((targetLift - lift) * k - c * liftV) * dt;
    lift += liftV * dt;

    const base = s * n * 2;
    for (let i = 0; i < n; i++) {
      const p = NET_TOPO.rowOf[i] / (NET_ROWS - 1);
      let x = rest[i * 2];
      let y = rest[i * 2 + 1];
      if (p > 0) {
        x = L.rimX + (x - L.rimX) * (1 - (0.8 * lift * p) / netLen) + sway * Math.pow(p, 1.2);
        y += lift * Math.pow(p, 1.5);
        if (inNet) {
          const br = ball.r * 1.1;
          const dx = x - ball.x;
          const dy = y - ball.y;
          const d = Math.hypot(dx, dy);
          if (d < br && d > 1e-6) {
            x = ball.x + (dx / d) * br;
            y = ball.y + (dy / d) * br;
          }
        }
      }
      frames[base + i * 2] = x;
      frames[base + i * 2 + 1] = y;
    }
  }
  return frames;
}

// ─── Trajectoire : calculée une fois par tir, puis simplement relue ──────────
interface TrajPoint {
  x: number;
  y: number;
  r: number;
  rot: number;
  behind: boolean; // le ballon est dans le cercle : il passe derrière l'avant du cercle
}

interface Traj {
  id: number;
  W: number;
  H: number;
  dt: number;
  pts: TrajPoint[];
  net: Float32Array | null; // positions du filet à chaque pas (tirs réussis seulement)
  tResult: number;
  duration: number;
  tEnter: number | null;
  tExit: number | null;
}

const DT = 1 / 120;
const MAX_DURATION = 3.8;
const BOUNCE = 0.7; // part de vitesse conservée à chaque rebond sur le sol

function buildTrajectory(shot: ShotResult, W: number, H: number): Traj {
  const L = layout(W, H);
  const g = 4.5 * H;
  const TF = 0.72; // durée du vol jusqu'au panier
  const S = L.start;
  const side = shot.side;
  const madeShot = isMade(shot.outcome);
  const isShort = shot.outcome === "short";

  // Point de contact avec le cercle / la planche (ou le sommet pour un tir trop court).
  let ax = 0;
  let ay = 0;
  switch (shot.outcome) {
    case "swish": ax = L.rimX + side * L.rimRX * 0.08; ay = L.rimY - L.rFar * 0.3; break;
    case "made": ax = L.rimX + side * L.rimRX * 0.8; ay = L.rimY - L.rFar * 0.6; break;
    case "rimout": ax = L.rimX + side * L.rimRX * 1.0; ay = L.rimY - L.rFar * 0.5; break;
    case "board": ax = L.rimX + side * W * 0.26; ay = L.boardY + L.boardH * 0.3; break;
    default: break;
  }

  let vx0: number;
  let vy0: number;
  let tShort = 1;
  if (isShort) {
    vy0 = -Math.sqrt(2 * g * H * 0.34);
    vx0 = side * W * 0.1;
    tShort = (2 * -vy0) / g;
  } else {
    vx0 = (ax - S.x) / TF;
    vy0 = (ay - S.y - 0.5 * g * TF * TF) / TF;
  }

  const pts: TrajPoint[] = [];
  let x = S.x;
  let y = S.y;
  let vx = vx0;
  let vy = vy0;
  let rot = 0;
  let contacted = false;
  let tEnter: number | null = null;
  let tExit: number | null = null;
  let still = 0;
  let end = MAX_DURATION;
  const steps = Math.ceil(MAX_DURATION / DT);

  for (let i = 0; i <= steps; i++) {
    const t = i * DT;
    let r = radiusAtY(L, y);

    if (!isShort && t <= TF) {
      // Vol balistique exact jusqu'au point de contact.
      x = S.x + vx0 * t;
      y = S.y + vy0 * t + 0.5 * g * t * t;
      vx = vx0;
      vy = vy0 + g * t;
      rot += 7 * side * DT;
    } else {
      if (!isShort && !contacted) {
        contacted = true;
        x = ax;
        y = ay;
        if (shot.outcome === "made") { vx = -side * W * 0.12; vy = -0.45 * H; } // effleure le cercle puis tombe dedans
        else if (shot.outcome === "rimout") { vx = side * W * 0.11; vy = -0.8 * H; } // ressort sur le côté
        else if (shot.outcome === "board") { vx = side * W * 0.03; vy = -0.2 * H; } // claque sur la planche
      }
      r = radiusAtY(L, y);
      vy += g * DT;
      if (madeShot && y > L.rimY && y < L.netBottomY + r * 0.5 && Math.abs(x - L.rimX) < L.rimRX * 1.2) {
        // Dans le filet : il guide et freine le ballon sans l'arrêter.
        vx += (L.rimX - x) * 60 * DT - vx * 6 * DT;
        vy *= 1 - 7 * DT;
        vy = Math.max(vy, 0.34 * H);
      }
      x += vx * DT;
      y += vy * DT;
      rot += (vx / r) * DT + (isShort ? 7 * side * DT : 0);
      if (y >= S.y && vy > 0) {
        // Sol : le ballon rebondit franchement, plusieurs fois.
        y = S.y;
        vy = vy > 0.2 * H ? -vy * BOUNCE : 0;
        vx *= 0.9;
      }
      if (y >= S.y - 0.5 && vy === 0) {
        vx *= 1 - 2.5 * DT;
        still = Math.abs(vx) < W * 0.012 ? still + 1 : 0;
      }
    }

    r = radiusAtY(L, y);
    if (madeShot && t >= TF - 0.05) {
      if (tEnter === null && y > L.rimY) tEnter = t;
      if (tEnter !== null && tExit === null && y > L.netBottomY) tExit = t;
    }
    const behind = madeShot && tExit === null && t >= TF - 0.12 && y > L.rimY - r;
    pts.push({ x, y, r, rot, behind });

    if (still >= 10) {
      end = t;
      break;
    }
  }

  const tResult = madeShot ? (tEnter ?? TF) + 0.1 : isShort ? tShort * 0.6 : TF + 0.35;
  const net = madeShot ? simulateNet(L, pts, DT, TF - 0.12) : null;
  return {
    id: shot.id, W, H, dt: DT, pts, net, tResult,
    duration: Math.min(end + 0.4, MAX_DURATION), tEnter, tExit,
  };
}

// ─── Dessin ──────────────────────────────────────────────────────────────────
function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, rotation: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.fillStyle = C_BALL;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = C_SEAM;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.6, radius * 0.08);
  ctx.beginPath();
  ctx.moveTo(-radius, 0);
  ctx.lineTo(radius, 0);
  ctx.moveTo(0, -radius);
  ctx.lineTo(0, radius);
  ctx.moveTo(-radius * 0.74, -radius * 0.68);
  ctx.bezierCurveTo(-radius * 0.3, -radius * 0.25, -radius * 0.3, radius * 0.25, -radius * 0.74, radius * 0.68);
  ctx.moveTo(radius * 0.74, -radius * 0.68);
  ctx.bezierCurveTo(radius * 0.3, -radius * 0.25, radius * 0.3, radius * 0.25, radius * 0.74, radius * 0.68);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawNet(ctx: CanvasRenderingContext2D, L: Layout, nodes: ArrayLike<number>) {
  ctx.save();
  ctx.strokeStyle = C_LINE;
  ctx.lineWidth = 2.2 * L.unit;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (const [a, b, visible] of NET_TOPO.edges) {
    if (!visible) continue;
    ctx.moveTo(nodes[a * 2], nodes[a * 2 + 1]);
    ctx.lineTo(nodes[b * 2], nodes[b * 2 + 1]);
  }
  ctx.stroke();
  ctx.restore();
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  shot: ShotResult | null,
  traj: Traj | null,
  t: number,
) {
  const L = layout(W, H);
  const { unit, rimX, rimY, rimRX, rimRY } = L;

  ctx.fillStyle = C_BG;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C_FLOOR;
  ctx.fillRect(0, L.floorY, W, H - L.floorY);

  const showResult = !!(shot && traj && t >= traj.tResult);
  const success = !!(shot && showResult && isMade(shot.outcome));

  // Planche : un aplat, un cadre, le carré cible qui passe au vert sur un panier.
  ctx.fillStyle = C_BOARD;
  ctx.fillRect(L.boardX, L.boardY, L.boardW, L.boardH);
  ctx.strokeStyle = C_LINE;
  ctx.lineWidth = 3 * unit;
  ctx.strokeRect(L.boardX, L.boardY, L.boardW, L.boardH);
  ctx.strokeStyle = success ? C_GREEN : C_ORANGE;
  ctx.lineWidth = 3 * unit;
  ctx.strokeRect(rimX - L.boardW * 0.17, rimY - L.boardH * 0.38, L.boardW * 0.34, L.boardH * 0.38);

  // Ballon à l'instant t (au repos : à sa place de départ).
  let ball: TrajPoint;
  let frame = -1;
  if (traj && shot) {
    frame = clamp(Math.floor(t / traj.dt), 0, traj.pts.length - 1);
    ball = traj.pts[frame];
  } else {
    ball = { x: L.start.x, y: L.start.y, r: L.rNear, rot: 0, behind: false };
  }

  // Ombre sur le sol.
  const height = Math.max(0, L.start.y - ball.y);
  const fade = 1 - clamp(height / (H * 0.6), 0, 1);
  ctx.fillStyle = `rgba(0,0,0,${0.35 * fade})`;
  ctx.beginPath();
  ctx.ellipse(ball.x, L.start.y + L.rNear * 0.92, L.rNear * (0.5 + 0.6 * fade), L.rNear * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Résultat : un mot, derrière le ballon, qui reste jusqu'au tir suivant.
  if (shot && traj && showResult) {
    const made = isMade(shot.outcome);
    const a = clamp((t - traj.tResult) / 0.18, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${clamp(W * 0.1, 30, 46)}px system-ui, sans-serif`;
    ctx.fillStyle = made ? C_GREEN : shot.outcome === "rimout" ? "#FFD49B" : C_RED;
    ctx.fillText(outcomeLabel(shot.outcome), W / 2, H * 0.6 - (1 - a) * 10);
    ctx.restore();
  }

  // Ordre : arrière du cercle → ballon (s'il est dans le panier) → filet → avant du cercle → ballon.
  ctx.lineCap = "round";
  ctx.strokeStyle = C_ORANGE_DARK;
  ctx.lineWidth = 6 * unit;
  ctx.beginPath();
  ctx.ellipse(rimX, rimY, rimRX, rimRY, 0, Math.PI, Math.PI * 2);
  ctx.stroke();

  if (ball.behind) drawBall(ctx, ball.x, ball.y, ball.r, ball.rot);
  const nodes = traj && traj.net && frame >= 0
    ? traj.net.subarray(frame * NET_TOPO.n * 2, (frame + 1) * NET_TOPO.n * 2)
    : netRestPositions(L);
  drawNet(ctx, L, nodes);

  ctx.strokeStyle = C_ORANGE;
  ctx.lineWidth = 7 * unit;
  ctx.beginPath();
  ctx.ellipse(rimX, rimY, rimRX, rimRY, 0, 0, Math.PI);
  ctx.stroke();
  if (!ball.behind) drawBall(ctx, ball.x, ball.y, ball.r, ball.rot);
}

// ─── Scène animée ────────────────────────────────────────────────────────────
export function ShotScene({
  shot,
  onResult,
  onDone,
}: {
  shot: ShotResult | null;
  onResult: (outcome: Outcome) => void;
  onDone: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shotRef = useRef<ShotResult | null>(shot);
  const trajRef = useRef<Traj | null>(null);
  const tRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const onResultRef = useRef(onResult);
  const onDoneRef = useRef(onDone);
  shotRef.current = shot;
  onResultRef.current = onResult;
  onDoneRef.current = onDone;

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const cw = Math.round(rect.width * dpr);
    const ch = Math.round(rect.height * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const s = shotRef.current;
    let traj = trajRef.current;
    if (s && (!traj || traj.id !== s.id || traj.W !== rect.width || traj.H !== rect.height)) {
      traj = buildTrajectory(s, rect.width, rect.height);
      trajRef.current = traj;
    }
    drawScene(ctx, rect.width, rect.height, s, s ? traj : null, tRef.current);
  }, []);

  useEffect(() => {
    render();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(render) : null;
    observer?.observe(canvas);
    window.addEventListener("resize", render);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", render);
    };
  }, [render]);

  // Une animation ne démarre que pour un nouveau tir (changement d'id).
  useEffect(() => {
    if (!shot) {
      trajRef.current = null;
      tRef.current = 0;
      render();
      return;
    }
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!rect || rect.width < 1) return;
    const traj = buildTrajectory(shot, rect.width, rect.height);
    trajRef.current = traj;

    const start = performance.now();
    let resultSent = false;
    const frame = (now: number) => {
      const t = Math.min((now - start) / 1000, traj.duration);
      tRef.current = t;
      render();
      if (!resultSent && t >= traj.tResult) {
        resultSent = true;
        onResultRef.current(shot.outcome);
      }
      if (t < traj.duration) {
        rafRef.current = requestAnimationFrame(frame);
      } else {
        rafRef.current = null;
        onDoneRef.current();
      }
    };
    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [shot?.id, render]);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Panier de basket et animation du lancer"
      className="block h-full w-full"
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}

// ─── Garde l'écran allumé pendant la partie ──────────────────────────────────
type WakeSentinel = { release: () => Promise<void> };
type WakeNavigator = { wakeLock?: { request: (type: "screen") => Promise<WakeSentinel> } };

function useScreenWakeLock() {
  useEffect(() => {
    let sentinel: WakeSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible" || sentinel) return;
      try {
        const api = (navigator as unknown as WakeNavigator).wakeLock;
        if (!api) return;
        const s = await api.request("screen");
        if (cancelled) {
          void s.release();
          return;
        }
        sentinel = s;
        (s as unknown as EventTarget).addEventListener?.("release", () => {
          sentinel = null;
        });
      } catch {
        /* refusé (économie d'énergie, onglet masqué) : on réessaiera */
      }
    };

    const onVisibility = () => void acquire();
    // Certains navigateurs n'acceptent la demande qu'après une interaction : on réessaie au premier toucher.
    const onFirstTouch = () => void acquire();

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointerdown", onFirstTouch);
    window.addEventListener("touchstart", onFirstTouch);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", onFirstTouch);
      window.removeEventListener("touchstart", onFirstTouch);
      void sentinel?.release();
      sentinel = null;
    };
  }, []);
}

// ─── Jeu piloté par le mouvement du téléphone, sans geste tactile ────────────
/**
 * Mode duel : le composant ne gère plus de statistiques, il signale seulement chaque tir
 * (réussi ou non) et n'accepte de geste que lorsque `enabled` est vrai.
 */
export interface DuelOptions {
  enabled: boolean;
  /** Change à chaque nouveau duel : remet le ballon en place et exige la verticale. */
  duelKey: number;
  onShot: (made: boolean, duelKey: number) => void;
  /** Appelé dès que le tir part (pour que les autres le voient en direct). */
  onShotFired?: (shot: ShotResult, duelKey: number) => void;
  /** Contenu affiché par-dessus le terrain (messages, attente…). */
  overlay?: ReactNode;
  /** Remplace le bandeau de statistiques. */
  footer?: ReactNode;
}

function LancerFrancGame({ onExit, duel }: { onExit?: () => void; duel?: DuelOptions }) {
  const duelRef = useRef<DuelOptions | undefined>(duel);
  duelRef.current = duel;
  const shotDuelKeyRef = useRef(0);
  const [sensorStatus, setSensorStatus] = useState<SensorStatus>("checking");
  const [phase, setPhaseState] = useState<GamePhase>("waiting-vertical");
  const [shot, setShot] = useState<ShotResult | null>(null);
  const [stats, setStats] = useState<Stats>({ attempts: 0, makes: 0, streak: 0, best: 0 });
  // Meilleure série connue sur le serveur (tous joueurs) : sert à afficher le recordman.
  const [topStreak, setTopStreak] = useState<{ label: string; best: number; id: string | null } | null>(null);
  const statsRef = useRef<Stats>(stats);
  const whoRef = useRef<LFIdentity>({ id: "local", label: "Moi" });
  const shotIdRef = useRef(0);
  const phaseRef = useRef<GamePhase>("waiting-vertical");

  useScreenWakeLock();

  const changePhase = useCallback((next: GamePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  // Stats « de tout le temps » : locales d'abord, fusionnées avec le serveur si le réseau répond.
  useEffect(() => {
    if (duelRef.current) return;
    const who = getIdentity();
    whoRef.current = who;
    const local = loadLocalStats(who.id);
    const init: Stats = { attempts: local.attempts, makes: local.makes, streak: 0, best: local.best };
    statsRef.current = init;
    setStats(init);
    void pullMyStats(who).then((remote) => {
      if (!remote) return;
      const cur = statsRef.current;
      const merged = mergeStats({ makes: cur.makes, attempts: cur.attempts, best: cur.best }, remote);
      const next: Stats = { ...merged, streak: cur.streak };
      statsRef.current = next;
      setStats(next);
      saveLocalStats(who.id, merged);
    });
    void fetchStreakRecord(who).then((top) => setTopStreak(top));
  }, []);

  const duelEnabled = duel?.enabled ?? true;
  const duelKey = duel?.duelKey ?? 0;
  useEffect(() => {
    if (!duelRef.current) return;
    setShot(null);
    changePhase("waiting-vertical");
  }, [duelEnabled, duelKey, changePhase]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.DeviceMotionEvent === "undefined") {
      setSensorStatus("unsupported");
      return;
    }
    const DME = window.DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    setSensorStatus(typeof DME.requestPermission === "function" ? "needs-permission" : "granted");
  }, []);

  const activateSensors = useCallback(async () => {
    const ok = await requestMotionPermission();
    if (ok) {
      changePhase("waiting-vertical");
      setSensorStatus("granted");
    } else {
      setSensorStatus("denied");
    }
  }, [changePhase]);

  const handleShoot = useCallback((peakPush: number, angleDeg: number, flick: number | null) => {
    if (phaseRef.current !== "measuring") return;
    if (duelRef.current && !duelRef.current.enabled) return;
    shotDuelKeyRef.current = duelRef.current?.duelKey ?? 0;
    shotIdRef.current += 1;
    const next = decideShot(shotIdRef.current, peakPush, angleDeg, flick);
    duelRef.current?.onShotFired?.(next, shotDuelKeyRef.current);
    changePhase("animating");
    setShot(next);
  }, [changePhase]);
  const handleShootRef = useRef(handleShoot);
  handleShootRef.current = handleShoot;

  // Le résultat compte dès que le ballon est dans le filet (ou a raté), sans attendre la fin du rebond.
  const handleResult = useCallback((outcome: Outcome) => {
    if (phaseRef.current !== "animating") return;
    const made = isMade(outcome);
    if (duelRef.current) {
      duelRef.current.onShot(made, shotDuelKeyRef.current);
      return;
    }
    const prev = statsRef.current;
    const streak = made ? prev.streak + 1 : 0;
    const next: Stats = {
      attempts: prev.attempts + 1,
      makes: prev.makes + (made ? 1 : 0),
      streak,
      best: Math.max(prev.best, streak),
    };
    statsRef.current = next;
    setStats(next);
    const persisted = { makes: next.makes, attempts: next.attempts, best: next.best };
    saveLocalStats(whoRef.current.id, persisted);
    void pushStats(whoRef.current, persisted);
  }, []);

  // Le résultat reste à l'écran : il suffit de remettre le téléphone à la verticale pour rejouer.
  const handleAnimationDone = useCallback(() => {
    if (phaseRef.current !== "animating") return;
    changePhase("waiting-reset");
  }, [changePhase]);

  useEffect(() => {
    if (sensorStatus !== "granted") return;

    let gravityEstimate: { x: number; y: number; z: number } | null = null;
    let verticalSince: number | null = null;
    let gestureStartedAt = 0;
    let samples: MotionSample[] = [];

    const onMotion = (event: DeviceMotionEvent) => {
      const now = performance.now();
      if (duelRef.current && !duelRef.current.enabled) {
        verticalSince = null;
        return;
      }
      const gravity = event.accelerationIncludingGravity;
      const linear = event.acceleration;
      let ax = 0;
      let ay = 0;
      let az = 0;

      if (linear && linear.x !== null && linear.y !== null && linear.z !== null) {
        ax = linear.x;
        ay = linear.y;
        az = linear.z;
      } else if (gravity && gravity.x !== null && gravity.y !== null && gravity.z !== null) {
        // Repli : on estime la gravité par un filtre lent, la différence donne le mouvement.
        const gx = gravity.x;
        const gy = gravity.y;
        const gz = gravity.z;
        if (!gravityEstimate) gravityEstimate = { x: gx, y: gy, z: gz };
        gravityEstimate = {
          x: gravityEstimate.x * 0.88 + gx * 0.12,
          y: gravityEstimate.y * 0.88 + gy * 0.12,
          z: gravityEstimate.z * 0.88 + gz * 0.12,
        };
        ax = gx - gravityEstimate.x;
        ay = gy - gravityEstimate.y;
        az = gz - gravityEstimate.z;
      } else {
        return;
      }

      const rr = event.rotationRate;
      const rot = rr && rr.alpha !== null && rr.beta !== null && rr.gamma !== null
        ? Math.hypot(rr.alpha, rr.beta, rr.gamma)
        : null;
      const mag = Math.hypot(ax, ay, az);
      const sample: MotionSample = { x: ax, y: ay, z: az, mag, rot, t: now };
      const gzAbs = gravity && gravity.z !== null ? Math.abs(gravity.z) : null;
      const currentPhase = phaseRef.current;

      // Départ et réarmement : téléphone à la verticale et stable quelques dixièmes de seconde.
      if (currentPhase === "waiting-vertical" || currentPhase === "waiting-reset") {
        const vertical = (gzAbs === null || gzAbs < VERTICAL_MAX_Z) && mag < VERTICAL_MAX_LINEAR;
        if (vertical) {
          if (verticalSince === null) verticalSince = now;
          if (now - verticalSince >= VERTICAL_HOLD_MS) {
            verticalSince = null;
            setShot(null); // le ballon revient à sa place, le résultat disparaît
            changePhase("ready");
          }
        } else {
          verticalSince = null;
        }
        return;
      }

      if (currentPhase === "ready") {
        const phoneOk = gzAbs === null || gzAbs < 6.5;
        if (phoneOk && ay >= TRIGGER_Y) {
          samples = [sample];
          gestureStartedAt = now;
          changePhase("measuring");
        }
        return;
      }

      if (currentPhase === "measuring") {
        samples.push(sample);
        if (now - gestureStartedAt < GESTURE_WINDOW_MS) return;

        const peak = samples.reduce((best, s) => (s.y > best.y ? s : best), samples[0]);
        if (peak.y < MIN_PUSH) {
          samples = [];
          changePhase("ready"); // simple secousse : on ne compte pas de tir
          return;
        }
        // Cassure du poignet : rotation la plus vive à partir du pic de poussée.
        let flick: number | null = null;
        for (const s of samples) {
          if (s.rot !== null && s.t >= peak.t - 30) flick = Math.max(flick ?? 0, s.rot);
        }
        const angleDeg = (Math.atan2(Math.hypot(peak.x, peak.z * 0.6), Math.max(1, Math.abs(peak.y))) * 180) / Math.PI;
        samples = [];
        handleShootRef.current(peak.y, angleDeg, flick);
      }
    };

    window.addEventListener("devicemotion", onMotion, { passive: true });
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [sensorStatus, changePhase]);

  // Le record suit mes séries en direct : si je bats le recordman, mon prénom prend sa place.
  const record = pickStreakRecord(topStreak, whoRef.current, stats.best);
  const pct = stats.attempts > 0 ? Math.round((stats.makes / stats.attempts) * 100) : 0;
  let hint: string | null = null;
  if (sensorStatus === "granted" && (duel ? duel.enabled : stats.attempts < 3)) {
    if (phase === "waiting-vertical") hint = "TIENS LE TÉLÉPHONE À LA VERTICALE";
    else if (phase === "ready") hint = "POUSSE VERS LE HAUT, CASSE LE POIGNET";
    else if (phase === "waiting-reset") hint = "REMETS LE TÉLÉPHONE À LA VERTICALE";
  }

  return (
    // Plein écran par-dessus la page : le jeu ne dépend plus de la hauteur de son conteneur,
    // le bandeau de stats est donc toujours visible en bas.
    <main
      className="fixed inset-0 flex flex-col overflow-hidden"
      style={{ zIndex: 100, background: C_BG, color: "#F4F7FC", overscrollBehavior: "none", touchAction: "none" }}
    >
      <section className="relative min-h-0 flex-1" aria-label="Terrain et panier de basket">
        {onExit && (
          <button
            type="button"
            onClick={onExit}
            aria-label="Quitter le jeu"
            className="absolute left-2 z-10 flex h-11 w-11 items-center justify-center rounded-full text-2xl leading-none"
            style={{ top: "calc(env(safe-area-inset-top) + 8px)", color: "rgba(233,238,247,0.55)" }}
          >
            ‹
          </button>
        )}
        <ShotScene shot={shot} onResult={handleResult} onDone={handleAnimationDone} />
        {duel?.overlay}

        {hint && (
          <div
            aria-live="polite"
            className="pointer-events-none absolute inset-x-3 bottom-3 text-center"
            style={{ color: "rgba(229,238,250,0.6)", fontSize: 10, fontWeight: 700, letterSpacing: "0.17em", textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}
          >
            {hint}
          </div>
        )}

        {sensorStatus !== "granted" && (
          <div
            className="absolute inset-0 flex items-center justify-center px-6"
            style={{ background: "rgba(4,9,17,0.78)", backdropFilter: "blur(8px)" }}
          >
            <div
              className="w-full max-w-sm rounded-3xl px-6 py-7 text-center"
              style={{ background: C_BOARD, border: "1px solid rgba(233,238,247,0.12)" }}
            >
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: "rgba(245,126,48,0.13)", fontSize: 34 }} aria-hidden="true">
                🏀
              </div>
              <h1 className="text-xl font-black tracking-tight" style={{ color: "#F7F9FC" }}>
                {sensorStatus === "unsupported" ? "Capteurs indisponibles" : sensorStatus === "checking" ? "Préparation du terrain" : "Le jeu se pilote au mouvement"}
              </h1>
              <p className="mx-auto mt-3 max-w-xs text-sm leading-6" style={{ color: "#AAB9CC" }}>
                {sensorStatus === "checking"
                  ? "Initialisation des capteurs du téléphone…"
                  : sensorStatus === "unsupported"
                    ? "Ce navigateur ne donne pas accès aux mouvements du téléphone. Ouvre le jeu dans un navigateur mobile compatible, en HTTPS."
                    : sensorStatus === "denied"
                      ? "L'accès aux mouvements a été refusé. Autorise les capteurs dans le navigateur puis réessaie."
                      : "Autorise les capteurs une seule fois. Ensuite, tout se joue en bougeant le téléphone, sans toucher l'écran."}
              </p>
              {(sensorStatus === "needs-permission" || sensorStatus === "denied") && (
                <button
                  type="button"
                  onClick={activateSensors}
                  className="mt-6 w-full rounded-xl px-5 py-3.5 text-sm font-extrabold tracking-wide active:scale-[0.99]"
                  style={{ background: "linear-gradient(135deg,#FFA45D,#F16D2A)", color: "#171018" }}
                >
                  {sensorStatus === "denied" ? "Réessayer l'autorisation" : "Activer les capteurs"}
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {duel ? duel.footer : <footer
        className="relative grid grid-cols-4 items-start"
        aria-label="Statistiques"
        style={{
          padding: "14px 20px calc(14px + env(safe-area-inset-bottom))",
          background: "#0A0F18",
          borderTop: "1px solid rgba(233,238,247,0.08)",
        }}
      >
        <Stat label="Réussite" value={`${pct}%`} accent={C_ORANGE} />
        <Stat label="Série" value={stats.streak} accent={stats.streak > 0 ? C_GREEN : C_LINE} />
        <Stat label="Perso" value={stats.best} accent={stats.best > 0 && stats.streak >= stats.best ? C_GREEN : C_LINE} />
        <Stat label="Record" value={record?.best ?? 0} accent={C_LINE} sub={record?.label} subAccent={record?.mine ? C_GREEN : undefined} />
      </footer>}
    </main>
  );
}

function Stat({
  label,
  value,
  accent,
  sub,
  subAccent,
}: {
  label: string;
  value: string | number;
  accent: string;
  sub?: string;
  subAccent?: string;
}) {
  return (
    <div className="min-w-0 text-center">
      <div className="text-[30px] font-black leading-none tracking-tight tabular-nums" style={{ color: accent }}>
        {value}
      </div>
      <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "rgba(233,238,247,0.5)" }}>
        {label}
      </div>
      {sub && (
        <div className="mt-1 truncate text-[11px] font-semibold" style={{ color: subAccent ?? "rgba(233,238,247,0.75)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export function LancerFrancDuel({ onExit, duel }: { onExit?: () => void; duel: DuelOptions }) {
  return <LancerFrancGame onExit={onExit} duel={duel} />;
}

export default function LancerFranc({ onExit }: { onExit?: () => void }) {
  return <LancerFrancGame onExit={onExit} />;
}
