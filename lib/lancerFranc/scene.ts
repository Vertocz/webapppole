// ═════════════════════════════════════════════════════════════════════════════
//  Scène en vraie perspective.
//
//  Le terrain est décrit en mètres (dimensions FIBA 3x3) et vu par une caméra placée à
//  hauteur des yeux, juste derrière la ligne de lancer franc. Sol, planche, cercle, filet et
//  ballon passent tous par la même projection : la perspective est cohérente partout, et le
//  ballon rapetisse naturellement en s'éloignant.
//
//  Le décor fixe (gradins, panneau, sol, logo SWISH3X3) est dessiné une fois puis réutilisé.
// ═════════════════════════════════════════════════════════════════════════════

import { FONT, assetsVersion } from "./assets";
import { isMade, outcomeLabel, type ShotResult } from "./shot";
import { PLACEHOLDER, sponsorAt } from "./sponsors";

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

// ─── Palette : aplats, aucun dégradé ─────────────────────────────────────────
export const C = {
  bg: "#0F1520",
  wall: "#0C121B",
  standA: "#111924",
  standB: "#141C29",
  floorOut: "#131B28",
  court: "#1A2436",
  key: "#22314B",
  board: "#18212F",
  post: "#0A0E16",
  line: "#E9EEF7",
  orange: "#FF6A2A",
  orangeDark: "#B84418",
  ball: "#F57A2E",
  seam: "#1B0F08",
  green: "#5FE3A1",
  red: "#FF8A80",
  amber: "#FFD49B",
  crowd: ["#243049", "#2C3853", "#38303D", "#29372F", "#3F362D", "#1E293C"],
  confetti: ["#FF6A2A", "#5FE3A1", "#E9EEF7", "#FFD49B", "#6FB6FF"],
};

// ─── Le terrain, en mètres (z : distance devant la caméra, y : hauteur) ─────
const EYE = 1.9; // hauteur des yeux (le téléphone est tenu haut, comme un ballon au tir)
const FT_Z = 0.5; // ligne de lancer franc, juste devant les pieds
const BASELINE_Z = FT_Z + 5.8; // ligne de fond
const RIM_Z = BASELINE_Z - 1.575; // centre du cercle
const BOARD_Z = BASELINE_Z - 1.2; // planche
const RIM_Y = 3.05;
const RIM_R = 0.225;
const BOARD_HALF = 0.9;
const BOARD_BOTTOM = 2.9;
const BOARD_TOP = 3.95;
const NET_LEN = 0.42;
const NET_BOTTOM_R = 0.14;
const BALL_R = 0.118; // ballon de 3x3 (taille 6)
const KEY_HALF = 2.45;
const COURT_HALF = 7.5;
const LINE_W = 0.05;
const BANNER_Z = BASELINE_Z + 1.0;
const BANNER_H = 0.9;
const POST_Z = BASELINE_Z + 0.55;
const STANDS_Z = BASELINE_Z + 3.2;
const BALL_Z = 0.75; // ballon tenu devant soi

/** Part du ballon visible en bas de l'écran : quand on peut tirer, et en attendant. */
export const REST_READY = 0.42;
export const REST_WAIT = 0.14;

// ─── Caméra ──────────────────────────────────────────────────────────────────
export interface View {
  W: number;
  H: number;
  F: number; // focale, en pixels
  cx: number;
  hy: number; // ligne d'horizon (hauteur des yeux) à l'écran
  unit: number; // échelle des traits
}

/** Cadrage : le cercle à 30 % du haut de l'écran, la planche entière visible en largeur. */
export function makeView(W: number, H: number): View {
  const F = Math.min(0.97 * H, 2.44 * W);
  return { W, H, F, cx: W / 2, hy: 0.3 * H + (F * (RIM_Y - EYE)) / RIM_Z, unit: F / 700 };
}

const sx = (v: View, x: number, z: number) => v.cx + (v.F * x) / z;
const sy = (v: View, y: number, z: number) => v.hy - (v.F * (y - EYE)) / z;
const sr = (v: View, r: number, z: number) => (v.F * r) / z;

/** Position du ballon tenu en main : on n'en voit que le haut, en bas de l'écran. */
function restBall(v: View, visible: number) {
  const r = sr(v, BALL_R, BALL_Z);
  const centerY = v.H + r * (1 - 2 * visible);
  return { x: 0, y: EYE - ((centerY - v.hy) * BALL_Z) / v.F, z: BALL_Z };
}

// ─── Filet : un cône de mailles en losanges ──────────────────────────────────
const NET_ROWS = 5;
const NET_COLS = 12;

const NET = (() => {
  const row: number[] = [];
  const ang: number[] = [];
  const idx: number[][] = [];
  for (let r = 0; r < NET_ROWS; r++) {
    idx.push([]);
    for (let k = 0; k < NET_COLS; k++) {
      idx[r].push(row.length);
      row.push(r);
      ang.push((2 * Math.PI * (k + (r % 2) * 0.5)) / NET_COLS);
    }
  }
  const edges: Array<[number, number]> = [];
  for (let r = 0; r < NET_ROWS - 1; r++) {
    for (let k = 0; k < NET_COLS; k++) {
      const a = idx[r][k];
      const below = idx[r + 1];
      const pair = r % 2 === 0 ? [k, (k - 1 + NET_COLS) % NET_COLS] : [k, (k + 1) % NET_COLS];
      for (const j of pair) edges.push([a, below[j]]);
    }
  }
  return { n: row.length, row, ang, edges };
})();

function netRest(dy = 0): Float32Array {
  const pos = new Float32Array(NET.n * 3);
  for (let i = 0; i < NET.n; i++) {
    const p = NET.row[i] / (NET_ROWS - 1);
    const rr = RIM_R + (NET_BOTTOM_R - RIM_R) * p;
    pos[i * 3] = rr * Math.cos(NET.ang[i]);
    pos[i * 3 + 1] = RIM_Y - NET_LEN * p + dy;
    pos[i * 3 + 2] = RIM_Z + rr * Math.sin(NET.ang[i]);
  }
  return pos;
}

/**
 * Le filet suit le ballon avec deux mouvements amortis : un balancement (entraîné par le
 * ballon puis relâché) et un étirement vers le bas qui rebondit ensuite vers le haut.
 * Les mailles touchées par le ballon sont repoussées sur sa surface.
 */
function simulateNet(pts: Pt[], dt: number, tCollide: number, kick: number): Float32Array {
  const n = NET.n;
  const rest = netRest();
  const frames = new Float32Array(pts.length * n * 3);
  let swX = 0, swXv = 0, swZ = 0, swZv = 0, st = 0, stv = 0;

  for (let s = 0; s < pts.length; s++) {
    const b = pts[s];
    const inNet = s * dt >= tCollide
      && b.y < RIM_Y + BALL_R
      && b.y > RIM_Y - NET_LEN - BALL_R * 2
      && Math.hypot(b.x, b.z - RIM_Z) < RIM_R * 1.6;
    const k = inNet ? 900 : 340;
    const c = inNet ? 26 : 4.5;
    const tX = inNet ? b.x * 0.6 : 0;
    const tZ = inNet ? (b.z - RIM_Z) * 0.6 : 0;
    const tSt = inNet ? clamp((RIM_Y - b.y) / NET_LEN, 0, 1.2) * NET_LEN * 0.22 * kick : 0;
    swXv += ((tX - swX) * k - c * swXv) * dt;
    swX += swXv * dt;
    swZv += ((tZ - swZ) * k - c * swZv) * dt;
    swZ += swZv * dt;
    stv += ((tSt - st) * k - c * stv) * dt;
    st += stv * dt;

    const base = s * n * 3;
    for (let i = 0; i < n; i++) {
      const p = NET.row[i] / (NET_ROWS - 1);
      let x = rest[i * 3];
      let y = rest[i * 3 + 1];
      let z = rest[i * 3 + 2];
      if (p > 0) {
        const narrow = 1 - (0.8 * st * p) / NET_LEN;
        x = x * narrow + swX * Math.pow(p, 1.2);
        z = RIM_Z + (z - RIM_Z) * narrow + swZ * Math.pow(p, 1.2);
        y -= st * Math.pow(p, 1.5);
        if (inNet) {
          const br = BALL_R * 1.08;
          const dx = x - b.x, dy = y - b.y, dz = z - b.z;
          const d = Math.hypot(dx, dy, dz);
          if (d < br && d > 1e-6) {
            x = b.x + (dx / d) * br;
            y = b.y + (dy / d) * br;
            z = b.z + (dz / d) * br;
          }
        }
      }
      frames[base + i * 3] = x;
      frames[base + i * 3 + 1] = y;
      frames[base + i * 3 + 2] = z;
    }
  }
  return frames;
}

// ─── Trajectoire en 3D : calculée une fois par tir, puis simplement relue ────
interface Pt {
  x: number;
  y: number;
  z: number;
  rot: number; // rotation du ballon (effet rétro)
  behind: boolean; // le ballon est dans le cercle : il passe derrière l'avant du cercle
}

export type SceneEventType = "rim" | "board" | "net" | "bounce";
export interface SceneEvent { t: number; type: SceneEventType; strength: number }

interface Particle { x: number; y: number; vx: number; vy: number; color: string; size: number; spin: number }

export interface Traj {
  id: number;
  W: number;
  H: number;
  dt: number;
  pts: Pt[];
  net: Float32Array | null;
  tResult: number;
  tContact: number | null;
  contactType: "rim" | "board" | null;
  duration: number;
  events: SceneEvent[];
  confetti: Particle[] | null;
}

const DT = 1 / 120;
const MAX_DURATION = 4.2;
const G = 9.81;
const TF = 0.9; // durée du vol jusqu'au panier (s)

function seeded(seed: number) {
  let s = (seed * 9301 + 49297) % 233280;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function buildTrajectory(shot: ShotResult, W: number, H: number, celebrate: boolean): Traj {
  const v = makeView(W, H);
  const S = restBall(v, REST_READY);
  const side = shot.side;
  const off = shot.offset;
  const made = isMade(shot.outcome);
  const events: SceneEvent[] = [];

  // Point visé à la fin du vol, et ce qui s'y passe.
  let P = { x: 0, y: 0, z: 0 };
  let contactType: Traj["contactType"] = null;
  switch (shot.outcome) {
    case "swish": P = { x: side * 0.03 * off, y: RIM_Y + 0.02, z: RIM_Z }; break;
    case "made": P = { x: side * (RIM_R - 0.05), y: RIM_Y + 0.09, z: RIM_Z - 0.04 }; contactType = "rim"; break;
    case "rimout": P = { x: side * (RIM_R + 0.03), y: RIM_Y + 0.1, z: RIM_Z - 0.06 }; contactType = "rim"; break;
    case "board": P = { x: side * (0.3 + 0.4 * off), y: 3.6, z: BOARD_Z - BALL_R }; contactType = "board"; break;
    case "wide": P = { x: side * (0.5 + 0.25 * off), y: RIM_Y - 0.02, z: RIM_Z + 0.05 }; break;
    default: P = { x: side * 0.15 * off, y: 2.3, z: RIM_Z - 1.0 }; break; // trop court : airball
  }
  const v0 = { x: (P.x - S.x) / TF, y: (P.y - S.y + 0.5 * G * TF * TF) / TF, z: (P.z - S.z) / TF };

  const pts: Pt[] = [];
  let x = S.x, y = S.y, z = S.z;
  let vx = v0.x, vy = v0.y, vz = v0.z;
  let rot = 0;
  let spin = -13; // effet rétro
  let contacted = false;
  let tEnter: number | null = null;
  let exited = false;
  let still = 0;
  let end = MAX_DURATION;
  const steps = Math.ceil(MAX_DURATION / DT);

  for (let i = 0; i <= steps; i++) {
    const t = i * DT;
    if (t <= TF) {
      // Vol balistique exact jusqu'au panier.
      x = S.x + v0.x * t;
      y = S.y + v0.y * t - 0.5 * G * t * t;
      z = S.z + v0.z * t;
      vx = v0.x;
      vy = v0.y - G * t;
      vz = v0.z;
    } else {
      if (!contacted) {
        contacted = true;
        x = P.x; y = P.y; z = P.z;
        if (shot.outcome === "made") { vx = -side * 0.8; vy = 0.9; vz = 0.1; } // effleure le cercle puis tombe dedans
        else if (shot.outcome === "rimout") { vx = side * 1.2; vy = 2.2; vz = -0.5; } // ressort sur le côté
        else if (shot.outcome === "board") { vx = side * 0.35; vy = 0.4; vz = -1.8; } // revient de la planche
        if (contactType) events.push({ t, type: contactType, strength: shot.outcome === "made" ? 0.45 : 1 });
        if (contactType) spin = 0;
      }
      vy -= G * DT;
      if (made && !exited) {
        const dx = x, dz = z - RIM_Z;
        const d = Math.hypot(dx, dz);
        if (y > RIM_Y - 0.05 && y < RIM_Y + 0.5 && d < 0.45) {
          // Le cercle ramène le ballon vers le centre.
          vx += (-dx * 30 - vx * 4) * DT;
          vz += (-dz * 30 - vz * 4) * DT;
        }
        if (y <= RIM_Y + 0.02 && y > RIM_Y - NET_LEN - BALL_R * 0.5) {
          // Dans le filet : il guide et freine le ballon sans l'arrêter.
          vx += (-dx * 120 - vx * 14) * DT;
          vz += (-dz * 120 - vz * 14) * DT;
          vy *= 1 - 6 * DT;
          vy = clamp(vy, -2.4, -0.8);
          const maxD = RIM_R * 0.7;
          if (d > maxD) { x = (dx / d) * maxD; z = RIM_Z + (dz / d) * maxD; }
        }
      }
      x += vx * DT;
      y += vy * DT;
      z += vz * DT;
      if (y < BALL_R && vy < 0) {
        // Sol : le ballon rebondit franchement, plusieurs fois.
        y = BALL_R;
        if (-vy > 0.8) {
          events.push({ t, type: "bounce", strength: clamp(-vy / 6, 0.1, 1) });
          vy = -vy * 0.66;
        } else vy = 0;
        vx *= 0.85;
        vz *= 0.85;
        spin = vz / BALL_R * 0.5;
      }
      if (vy === 0 && y <= BALL_R + 1e-6) {
        vx *= 1 - 1.4 * DT;
        vz *= 1 - 1.4 * DT;
        still = Math.hypot(vx, vz) < 0.06 ? still + 1 : 0;
      }
      if (z > BANNER_Z - BALL_R && y < BANNER_H + BALL_R && vz > 0) {
        // Panneau derrière la ligne de fond.
        z = BANNER_Z - BALL_R;
        vz = -vz * 0.45;
        events.push({ t, type: "bounce", strength: 0.4 });
      }
      if (Math.abs(x) > COURT_HALF) vx = -vx * 0.5;
      if (z < 2 && vz < 0) vz *= 1 - 3 * DT;
      spin *= 1 - 0.6 * DT;
    }
    rot += spin * DT;

    if (made && t >= TF - 0.05) {
      if (tEnter === null && y < RIM_Y) {
        tEnter = t;
        events.push({ t, type: "net", strength: shot.outcome === "swish" ? 1 : 0.6 });
      }
      if (tEnter !== null && !exited && y < RIM_Y - NET_LEN - BALL_R * 0.5) exited = true;
    }
    const behind = made && !exited && t >= TF - 0.12 && y < RIM_Y + BALL_R;
    pts.push({ x, y, z, rot, behind });
    if (still >= 10) { end = t; break; }
  }

  const tResult = made ? (tEnter ?? TF) + 0.08 : shot.outcome === "short" ? TF + 0.1 : TF + 0.3;
  const net = made ? simulateNet(pts, DT, TF - 0.12, shot.outcome === "swish" ? 1.25 : 1) : null;

  let confetti: Particle[] | null = null;
  if (made && celebrate) {
    const rnd = seeded(shot.id);
    const ox = v.cx;
    const oy = sy(v, RIM_Y, RIM_Z);
    confetti = Array.from({ length: 60 }, () => {
      const a = -Math.PI / 2 + (rnd() - 0.5) * 2.2;
      const sp = H * (0.5 + rnd() * 0.9);
      return {
        x: ox + (rnd() - 0.5) * sr(v, RIM_R * 2, RIM_Z),
        y: oy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        color: C.confetti[Math.floor(rnd() * C.confetti.length)],
        size: (4 + rnd() * 5) * v.unit,
        spin: (rnd() - 0.5) * 20,
      };
    });
  }

  return {
    id: shot.id, W, H, dt: DT, pts, net, tResult,
    tContact: contactType ? TF : null,
    contactType,
    duration: Math.min(end + 0.4, MAX_DURATION),
    events,
    confetti,
  };
}

// ─── Décor fixe (dessiné une fois) ───────────────────────────────────────────
/** Un quadrilatère posé au sol, donné en mètres (x, z). */
function floorQuad(ctx: CanvasRenderingContext2D, v: View, pts: Array<[number, number]>, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  pts.forEach(([x, z], i) => {
    const X = sx(v, x, z);
    const Y = sy(v, 0, z);
    if (i === 0) ctx.moveTo(X, Y);
    else ctx.lineTo(X, Y);
  });
  ctx.closePath();
  ctx.fill();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxH: number) {
  let size = Math.max(6, Math.floor(maxH));
  ctx.font = `900 ${size}px ${FONT}`;
  while (size > 6 && ctx.measureText(text).width > maxW) {
    size -= 1;
    ctx.font = `900 ${size}px ${FONT}`;
  }
}

function drawLogo(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const k = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * k;
  const dh = img.naturalHeight * k;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** Le logo SWISH3X3 peint au sol, dans la raquette, devant la ligne de fond. */
function drawFloorLogo(ctx: CanvasRenderingContext2D, v: View, dpr: number) {
  // 1. On écrit le logo à plat dans une image.
  const tex = document.createElement("canvas");
  const fs = 160;
  const t = tex.getContext("2d")!;
  t.font = `900 ${fs}px ${FONT}`;
  const wA = t.measureText("SWISH").width;
  const wB = t.measureText("3X3").width;
  tex.width = Math.ceil(wA + wB + fs * 0.2);
  tex.height = Math.ceil(fs * 0.86);
  t.font = `900 ${fs}px ${FONT}`;
  t.textBaseline = "alphabetic";
  const base = tex.height - fs * 0.08;
  t.fillStyle = C.line;
  t.fillText("SWISH", fs * 0.1, base);
  t.fillStyle = C.orange;
  t.fillText("3X3", fs * 0.1 + wA, base);

  // 2. On la plaque au sol, ligne d'écran par ligne d'écran (perspective exacte).
  const zFar = BASELINE_Z - 0.18;
  const zNear = BASELINE_Z - 1.0;
  const width = 2.4;
  const yTop = Math.floor(sy(v, 0, zFar) * dpr);
  const yBot = Math.ceil(sy(v, 0, zNear) * dpr);
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.imageSmoothingEnabled = true;
  for (let j = yTop; j < yBot; j++) {
    const Y = (j + 0.5) / dpr;
    const z = (v.F * EYE) / (Y - v.hy);
    const vv = (zFar - z) / (zFar - zNear);
    if (vv < 0 || vv > 1) continue;
    const row = Math.min(tex.height - 1, Math.floor(vv * tex.height));
    const x0 = sx(v, -width / 2, z);
    ctx.drawImage(tex, 0, row, tex.width, 1, x0, j / dpr, sx(v, width / 2, z) - x0, 1 / dpr + 0.01);
  }
  ctx.restore();
}

/** Gradins et public, derrière le terrain. */
function drawStands(ctx: CanvasRenderingContext2D, v: View) {
  const rnd = seeded(7);
  const rows = 18;
  for (let i = rows - 1; i >= 0; i--) {
    const z = STANDS_Z + 0.85 * i;
    const yTop = 0.6 + 0.45 * i;
    const top = sy(v, yTop, z);
    if (top > v.H) continue;
    ctx.fillStyle = i % 2 === 0 ? C.standA : C.standB;
    ctx.fillRect(0, top, v.W, sy(v, 0, z) - top);
    // Spectateurs : des têtes, avec des places vides.
    const half = (v.W / 2) * (z / v.F) + 1;
    const r = sr(v, 0.11, z + 0.35);
    ctx.globalAlpha = 0.45;
    for (let x = -half; x <= half; x += 0.6) {
      if (rnd() < 0.35) continue;
      ctx.fillStyle = C.crowd[Math.floor(rnd() * C.crowd.length)];
      ctx.beginPath();
      ctx.arc(sx(v, x + (rnd() - 0.5) * 0.15, z + 0.35), sy(v, yTop + 0.34, z + 0.35), r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/** Panneau lumineux derrière la ligne de fond : un sponsor, ou SWISH3X3 par défaut. */
function drawBanner(ctx: CanvasRenderingContext2D, v: View) {
  const top = sy(v, BANNER_H, BANNER_Z);
  const bottom = sy(v, 0, BANNER_Z);
  const h = bottom - top;
  ctx.fillStyle = "#080C13";
  ctx.fillRect(0, top, v.W, h);
  ctx.fillStyle = "#1B2536";
  ctx.fillRect(0, top, v.W, Math.max(1, h * 0.05));

  const s = sponsorAt("mur");
  const placeholder = s?.label === PLACEHOLDER && !s.img;
  const label = s ? s.label : "SWISH3X3";
  // Les cases commencent au centre : le poteau du panier tombe entre deux textes.
  const cell = sr(v, 2.1, BANNER_Z);
  const half = Math.ceil(v.W / 2 / cell) + 1;
  const count = half * 2;
  const start = v.cx - cell * half;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < count; i++) {
    const x = start + i * cell;
    if (s?.img) {
      drawLogo(ctx, s.img, x + cell * 0.12, top + h * 0.18, cell * 0.76, h * 0.64);
    } else {
      fitText(ctx, label, cell * 0.78, h * 0.5);
      ctx.fillStyle = placeholder ? "rgba(233,238,247,0.4)" : s ? C.amber : C.orange;
      ctx.fillText(label, x + cell / 2, top + h * 0.53);
    }
  }
  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D, v: View, dpr: number) {
  ctx.fillStyle = C.wall;
  ctx.fillRect(0, 0, v.W, v.H);
  drawStands(ctx, v);

  // Sol hors du terrain, puis le terrain, la raquette et les lignes.
  const floorTop = sy(v, 0, STANDS_Z);
  ctx.fillStyle = C.floorOut;
  ctx.fillRect(0, floorTop, v.W, v.H - floorTop);
  const NEAR = 0.3;
  floorQuad(ctx, v, [[-COURT_HALF, BASELINE_Z], [COURT_HALF, BASELINE_Z], [COURT_HALF, NEAR], [-COURT_HALF, NEAR]], C.court);
  floorQuad(ctx, v, [[-KEY_HALF, BASELINE_Z], [KEY_HALF, BASELINE_Z], [KEY_HALF, FT_Z], [-KEY_HALF, FT_Z]], C.key);
  const line = "rgba(233,238,247,0.85)";
  floorQuad(ctx, v, [[-COURT_HALF, BASELINE_Z], [COURT_HALF, BASELINE_Z], [COURT_HALF, BASELINE_Z - LINE_W], [-COURT_HALF, BASELINE_Z - LINE_W]], line);
  for (const s of [-1, 1]) {
    const a = s * KEY_HALF;
    const b = s * (KEY_HALF - LINE_W);
    floorQuad(ctx, v, [[a, BASELINE_Z], [b, BASELINE_Z], [b, FT_Z], [a, FT_Z]], line);
  }
  floorQuad(ctx, v, [[-KEY_HALF, FT_Z + LINE_W], [KEY_HALF, FT_Z + LINE_W], [KEY_HALF, FT_Z], [-KEY_HALF, FT_Z]], line);
  drawFloorLogo(ctx, v, dpr);

  drawBanner(ctx, v);

  // Poteau du panier, derrière la planche.
  const pw = sr(v, 0.09, POST_Z);
  const pTop = sy(v, BOARD_BOTTOM + 0.2, POST_Z);
  const pBot = sy(v, 0, POST_Z);
  ctx.fillStyle = C.post;
  ctx.fillRect(v.cx - pw, pTop, pw * 2, pBot - pTop);
  ctx.fillStyle = "#1B2536";
  ctx.fillRect(v.cx - pw * 1.8, pBot - sr(v, 0.5, POST_Z), pw * 3.6, sr(v, 0.5, POST_Z)); // protection en mousse
}

let cache: { key: string; canvas: HTMLCanvasElement } | null = null;

function background(v: View, dpr: number): HTMLCanvasElement {
  const key = `${v.W}x${v.H}@${dpr}#${assetsVersion()}`;
  if (cache && cache.key === key) return cache.canvas;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(v.W * dpr);
  canvas.height = Math.round(v.H * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBackground(ctx, v, dpr);
  cache = { key, canvas };
  return canvas;
}

// ─── Éléments animés ─────────────────────────────────────────────────────────
type StickerContent = ReturnType<typeof sponsorAt>;

/** Sticker blanc à coins arrondis ; emplacement libre en mode démo : cadre en pointillés. */
function drawSticker(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: StickerContent, unit: number) {
  if (!s) return;
  const placeholder = !s.img && s.label === PLACEHOLDER;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 5 * unit);
  if (placeholder) {
    ctx.setLineDash([4 * unit, 3 * unit]);
    ctx.strokeStyle = "rgba(233,238,247,0.45)";
    ctx.lineWidth = 1.2 * unit;
    ctx.stroke();
    ctx.fillStyle = "rgba(233,238,247,0.55)";
  } else {
    ctx.fillStyle = "#F4F7FC";
    ctx.fill();
    ctx.fillStyle = "#121A27";
  }
  const pad = Math.min(w, h) * 0.14;
  if (s.img) {
    drawLogo(ctx, s.img, x + pad, y + pad, w - pad * 2, h - pad * 2);
  } else {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    fitText(ctx, s.label, w - pad * 2, (h - pad * 2) * 0.6);
    ctx.fillText(s.label, x + w / 2, y + h / 2);
  }
  ctx.restore();
}

function drawBoard(ctx: CanvasRenderingContext2D, v: View, dy: number, success: boolean) {
  const x0 = sx(v, -BOARD_HALF, BOARD_Z);
  const x1 = sx(v, BOARD_HALF, BOARD_Z);
  const y0 = sy(v, BOARD_TOP + dy, BOARD_Z);
  const y1 = sy(v, BOARD_BOTTOM + dy, BOARD_Z);
  const lw = Math.max(2, sr(v, 0.05, BOARD_Z));
  ctx.fillStyle = C.board;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = lw;
  ctx.strokeRect(x0 + lw / 2, y0 + lw / 2, x1 - x0 - lw, y1 - y0 - lw);
  // Petit rectangle au-dessus du cercle : passe au vert sur un panier.
  ctx.strokeStyle = success ? C.green : C.orange;
  const rx0 = sx(v, -0.295, BOARD_Z);
  const rx1 = sx(v, 0.295, BOARD_Z);
  const ry0 = sy(v, RIM_Y + 0.45 + dy, BOARD_Z);
  const ry1 = sy(v, RIM_Y + dy, BOARD_Z);
  ctx.strokeRect(rx0 + lw / 2, ry0 + lw / 2, rx1 - rx0 - lw, ry1 - ry0 - lw);
  // Stickers des sponsors, en haut à gauche et à droite.
  const w = sr(v, 0.46, BOARD_Z);
  const h = sr(v, 0.28, BOARD_Z);
  const top = sy(v, BOARD_TOP - 0.1 + dy, BOARD_Z);
  drawSticker(ctx, sx(v, -0.84, BOARD_Z), top, w, h, sponsorAt("planche-gauche"), v.unit);
  drawSticker(ctx, sx(v, 0.84, BOARD_Z) - w, top, w, h, sponsorAt("planche-droite"), v.unit);
  // Fixation du cercle.
  ctx.fillStyle = "#3A4458";
  const fw = sr(v, 0.12, BOARD_Z);
  ctx.fillRect(v.cx - fw / 2, sy(v, RIM_Y + 0.03 + dy, BOARD_Z), fw, sr(v, 0.12, BOARD_Z));
}

/** Une moitié du cercle : la moitié avant (côté joueur) se dessine par-dessus le ballon. */
function drawRimHalf(ctx: CanvasRenderingContext2D, v: View, dy: number, front: boolean, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(3, sr(v, front ? 0.032 : 0.026, RIM_Z));
  ctx.beginPath();
  const a0 = front ? Math.PI : 0;
  for (let i = 0; i <= 32; i++) {
    const a = a0 + (Math.PI * i) / 32;
    const z = RIM_Z + RIM_R * Math.sin(a);
    const X = sx(v, RIM_R * Math.cos(a), z);
    const Y = sy(v, RIM_Y + dy, z);
    if (i === 0) ctx.moveTo(X, Y);
    else ctx.lineTo(X, Y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Les mailles du fond (derrière le ballon) ou celles de devant. */
function drawNet(ctx: CanvasRenderingContext2D, v: View, nodes: ArrayLike<number>, front: boolean) {
  ctx.save();
  ctx.strokeStyle = front ? C.line : "rgba(233,238,247,0.55)";
  ctx.lineWidth = Math.max(1.3, sr(v, 0.012, RIM_Z));
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const [a, b] of NET.edges) {
    const za = nodes[a * 3 + 2];
    const zb = nodes[b * 3 + 2];
    if ((za + zb) / 2 < RIM_Z !== front) continue;
    ctx.moveTo(sx(v, nodes[a * 3], za), sy(v, nodes[a * 3 + 1], za));
    ctx.lineTo(sx(v, nodes[b * 3], zb), sy(v, nodes[b * 3 + 1], zb));
  }
  ctx.stroke();
  ctx.restore();
}

// ─── Ballon ──────────────────────────────────────────────────────────────────
// Un vrai ballon de basket a deux coutures droites qui se croisent (deux grands cercles) et une
// seule couture courbe, de la même forme que celle d'une balle de tennis. On les place sur une
// sphère qui tourne vraiment : l'effet rétro se voit de dos, comme sur le terrain.

type V3 = [number, number, number];

/** Couture courbe « balle de tennis » (sur la sphère unité), tournée de 45° pour croiser les grands cercles. */
function curvedSeam(N: number): V3[] {
  const b = 0.3;
  const a = 1 - b;
  const h = 2 * Math.sqrt(a * b);
  const c = Math.SQRT1_2;
  const pts: V3[] = [];
  for (let i = 0; i <= N; i++) {
    const t = (2 * Math.PI * i) / N;
    const x = a * Math.cos(t) + b * Math.cos(3 * t);
    const y = a * Math.sin(t) - b * Math.sin(3 * t);
    pts.push([c * (x - y), c * (x + y), h * Math.sin(2 * t)]);
  }
  return pts;
}

function greatCircle(N: number, axis: 0 | 1): V3[] {
  const pts: V3[] = [];
  for (let i = 0; i <= N; i++) {
    const t = (2 * Math.PI * i) / N;
    // Cercle dans le plan perpendiculaire à x (axis 0) ou à y (axis 1).
    pts.push(axis === 0 ? [0, Math.cos(t), Math.sin(t)] : [Math.cos(t), 0, Math.sin(t)]);
  }
  return pts;
}

/** Orientation de départ : la croix des coutures légèrement relevée vers le joueur. */
const BALL_TILT = 0.55;
const SEAMS: V3[][] = [greatCircle(96, 0), greatCircle(96, 1), curvedSeam(160)].map((curve) =>
  curve.map(([x, y, z]) => [x, y * Math.cos(BALL_TILT) - z * Math.sin(BALL_TILT), y * Math.sin(BALL_TILT) + z * Math.cos(BALL_TILT)] as V3),
);

/** Grain du cuir : petits points fixes, tirés une fois pour toutes. */
const PEBBLES: Array<[number, number, number]> = (() => {
  const rnd = seeded(42);
  const out: Array<[number, number, number]> = [];
  while (out.length < 420) {
    const x = rnd() * 2 - 1;
    const y = rnd() * 2 - 1;
    if (x * x + y * y < 0.97) out.push([x, y, 0.5 + rnd() * 0.8]);
  }
  return out;
})();

export function drawBall(ctx: CanvasRenderingContext2D, X: number, Y: number, R: number, rot: number) {
  if (R < 0.5) return;
  ctx.save();
  ctx.translate(X, Y);

  // Cuir.
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fillStyle = C.ball;
  ctx.fill();
  ctx.save();
  ctx.clip();

  // Grain (seulement quand le ballon est assez gros pour qu'on le voie).
  if (R > 28) {
    ctx.fillStyle = "rgba(150,58,16,0.35)";
    const d = Math.max(0.8, R * 0.011);
    for (const [px, py, k] of PEBBLES) {
      ctx.beginPath();
      ctx.arc(px * R, py * R, d * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Volume : un reflet doux en haut à gauche, une ombre en bas à droite (aplats).
  ctx.fillStyle = "rgba(255,190,140,0.22)";
  ctx.beginPath();
  ctx.ellipse(-R * 0.32, -R * 0.36, R * 0.42, R * 0.3, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(110,36,8,0.32)";
  ctx.beginPath();
  ctx.rect(-R, -R, R * 2, R * 2);
  ctx.arc(-R * 0.13, -R * 0.13, R * 1.03, 0, Math.PI * 2, true); // trou : il reste un croissant en bas à droite
  ctx.fill();

  // Coutures : on ne garde que la face tournée vers la caméra, coupée net au bord.
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  ctx.strokeStyle = C.seam;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1.2, R * 0.058);
  ctx.beginPath();
  for (const seam of SEAMS) {
    let prev: V3 | null = null;
    for (const [x, y0, z0] of seam) {
      const p: V3 = [x, y0 * c - z0 * s, y0 * s + z0 * c];
      if (prev) {
        const va = prev[2] <= 0;
        const vb = p[2] <= 0;
        if (va || vb) {
          let a = prev;
          let b = p;
          if (!va || !vb) {
            // Point exact où la couture passe derrière le ballon.
            const k = prev[2] / (prev[2] - p[2]);
            const m: V3 = [prev[0] + (p[0] - prev[0]) * k, prev[1] + (p[1] - prev[1]) * k, 0];
            if (va) b = m;
            else a = m;
          }
          ctx.moveTo(a[0] * R, -a[1] * R);
          ctx.lineTo(b[0] * R, -b[1] * R);
        }
      }
      prev = p;
    }
  }
  ctx.stroke();
  ctx.restore();

  // Contour.
  ctx.strokeStyle = "rgba(40,16,6,0.85)";
  ctx.lineWidth = Math.max(1, R * 0.03);
  ctx.beginPath();
  ctx.arc(0, 0, R - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawBallAt(ctx: CanvasRenderingContext2D, v: View, b: { x: number; y: number; z: number; rot: number }) {
  if (b.z < 0.3) return;
  drawBall(ctx, sx(v, b.x, b.z), sy(v, b.y, b.z), sr(v, BALL_R, b.z), b.rot);
}

function drawShadow(ctx: CanvasRenderingContext2D, v: View, b: { x: number; y: number; z: number }) {
  if (b.z < 2) return;
  const fade = 1 - clamp((b.y - BALL_R) / 3, 0, 1);
  const rx = sr(v, BALL_R * (0.7 + 0.5 * fade), b.z);
  ctx.fillStyle = `rgba(0,0,0,${0.4 * fade})`;
  ctx.beginPath();
  ctx.ellipse(sx(v, b.x, b.z), sy(v, 0, b.z), rx, rx * (EYE / b.z), 0, 0, Math.PI * 2);
  ctx.fill();
}

// ─── Image complète ──────────────────────────────────────────────────────────
export function drawScene(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  dpr: number,
  shot: ShotResult | null,
  traj: Traj | null,
  t: number,
  restVisible: number,
) {
  const v = makeView(W, H);
  ctx.drawImage(background(v, dpr), 0, 0, W, H);

  const made = !!shot && isMade(shot.outcome);
  const showResult = !!(shot && traj && t >= traj.tResult);
  const success = showResult && made;

  // Vibration du cercle / de la planche après un choc (ressort amorti), en mètres.
  let shake = 0;
  if (traj && traj.tContact !== null && t >= traj.tContact) {
    const dt = t - traj.tContact;
    shake = Math.sin(dt * 55) * Math.exp(-dt * 9) * 0.012;
  }
  const rimDy = traj?.contactType === "rim" ? shake : traj?.contactType === "board" ? shake * 0.5 : 0;
  const boardDy = traj?.contactType === "board" ? shake : 0;

  // Ballon à l'instant t (au repos : tenu en main, en bas de l'écran).
  let ball: Pt;
  let frame = -1;
  if (traj && shot) {
    frame = clamp(Math.floor(t / traj.dt), 0, traj.pts.length - 1);
    ball = traj.pts[frame];
  } else {
    const rest = restBall(v, restVisible);
    const breathe = Math.sin(performance.now() / 420) * 0.004;
    ball = { ...rest, y: rest.y + breathe, rot: 0, behind: false };
  }

  drawShadow(ctx, v, ball);

  // Mot du résultat, derrière le ballon.
  if (shot && traj && showResult) {
    const a = clamp((t - traj.tResult) / 0.18, 0, 1);
    const pop = shot.outcome === "swish" ? 1 + 0.25 * Math.max(0, 1 - (t - traj.tResult) / 0.25) : 1;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(W / 2, H * 0.52 - (1 - a) * 10);
    ctx.scale(pop, pop);
    ctx.font = `900 ${clamp(W * 0.12, 34, 56)}px ${FONT}`;
    ctx.lineWidth = 6;
    ctx.strokeStyle = C.bg;
    ctx.lineJoin = "round";
    const label = outcomeLabel(shot.outcome);
    ctx.strokeText(label, 0, 0);
    ctx.fillStyle = made ? C.green : shot.outcome === "rimout" ? C.amber : C.red;
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  // Ordre de dessin, du plus loin au plus près.
  const behindBoard = ball.z > BOARD_Z + 0.02;
  if (behindBoard) drawBallAt(ctx, v, ball);
  drawBoard(ctx, v, boardDy, success);
  drawRimHalf(ctx, v, rimDy, false, C.orangeDark);
  const nodes = traj && traj.net && frame >= 0
    ? traj.net.subarray(frame * NET.n * 3, (frame + 1) * NET.n * 3)
    : netRest(rimDy);
  drawNet(ctx, v, nodes, false);
  if (ball.behind) drawBallAt(ctx, v, ball);
  drawNet(ctx, v, nodes, true);
  drawRimHalf(ctx, v, rimDy, true, success ? C.green : C.orange);
  if (!ball.behind && !behindBoard) drawBallAt(ctx, v, ball);

  // Confettis.
  if (traj?.confetti && t >= traj.tResult - 0.1) {
    const tc = t - (traj.tResult - 0.1);
    const g = 1.6 * H;
    ctx.save();
    ctx.globalAlpha = clamp(1 - (tc - 1.2) / 0.8, 0, 1);
    for (const p of traj.confetti) {
      const drag = Math.exp(-1.5 * tc);
      const px = p.x + (p.vx * (1 - drag)) / 1.5;
      const py = p.y + (p.vy * (1 - drag)) / 1.5 + 0.25 * g * tc * tc;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(p.spin * tc);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    ctx.restore();
  }
}
