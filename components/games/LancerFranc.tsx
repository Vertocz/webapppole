"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getIdentity,
  loadLocalStats,
  saveLocalStats,
  mergeStats,
  pushStats,
  pullMyStats,
  type LFIdentity,
} from "@/lib/lancerFrancStats";

// ═════════════════════════════════════════════════════════════════════════════
//  RÉGLAGES — tout ce qu'il faut toucher pour équilibrer le jeu est ici
// ═════════════════════════════════════════════════════════════════════════════

/** Taux de réussite visé sur la durée (le jeu se « recale » doucement vers cette valeur). */
const TARGET_RATE = 0.6;
/** Chance de base de marquer : BASE + SLOPE × qualité du geste (0..1). */
const MAKE_BASE = 0.15;
const MAKE_SLOPE = 0.8;
/** Force maximale du recalage vers TARGET_RATE (sur les 10 derniers tirs). */
const RUBBER_BAND_MAX = 0.15;

// Geste : poussée vers le haut (accélération Y du téléphone) puis cassure du poignet.
const IDEAL_PUSH = 14; // m/s² au pic de la poussée
const PUSH_TOLERANCE = 10;
const IDEAL_FLICK = 320; // °/s de rotation au moment de la cassure du poignet
const FLICK_TOLERANCE = 300;
const ANGLE_TOLERANCE_DEG = 55; // écart max à la verticale
const TRIGGER_Y = 3.2; // début de geste détecté au-delà de cette poussée
const MIN_PUSH = 4.5; // en dessous, ce n'était pas un tir (simple secousse)
const GESTURE_WINDOW_MS = 420; // durée d'observation après le début du geste

// Réarmement : téléphone à la verticale et stable.
const VERTICAL_MAX_Z = 4.5; // gravité perpendiculaire à l'écran (≈ 27° max)
const VERTICAL_HOLD_MS = 250;
const VERTICAL_MAX_LINEAR = 3.5;

// ═════════════════════════════════════════════════════════════════════════════

type Outcome = "swish" | "made" | "rimout" | "board" | "short";
type SensorStatus = "checking" | "needs-permission" | "granted" | "denied" | "unsupported";
type GamePhase = "waiting-vertical" | "ready" | "measuring" | "animating" | "waiting-reset";

interface ShotResult {
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

function isMade(outcome: Outcome): boolean {
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
// La qualité du geste fait monter ou descendre la probabilité de marquer, avec un
// léger recalage vers TARGET_RATE. Pour les ratés, la force du geste dit pourquoi
// (trop faible → trop court, trop fort → plan­che) : le retour est lisible.
function decideShot(id: number, peakPush: number, angleDeg: number, flick: number | null, recent: boolean[]): ShotResult {
  const pushQ = qualityFromValue(peakPush, IDEAL_PUSH, PUSH_TOLERANCE);
  const angleQ = qualityFromValue(angleDeg, 0, ANGLE_TOLERANCE_DEG);
  const flickQ = flick === null ? 0.6 : qualityFromValue(flick, IDEAL_FLICK, FLICK_TOLERANCE);
  const quality = clamp(0.4 * pushQ + 0.3 * flickQ + 0.3 * angleQ, 0, 1);

  let p = MAKE_BASE + MAKE_SLOPE * quality;
  if (recent.length >= 4) {
    const last = recent.slice(-10);
    const rate = last.filter(Boolean).length / last.length;
    p += clamp((TARGET_RATE - rate) * 0.6, -RUBBER_BAND_MAX, RUBBER_BAND_MAX);
  }
  p = clamp(p, 0.12, 0.92);

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
  netTopY: number;
  netBottomY: number;
  netTopW: number;
  netBottomW: number;
  floorY: number;
  start: { x: number; y: number };
}

function layout(W: number, H: number): Layout {
  const unit = clamp(W / 390, 0.78, 1.45);
  const rimX = W * 0.5;
  const rimY = H * 0.28;
  const rimRX = W * 0.17;
  const rimRY = rimRX * 0.2;
  const boardW = Math.min(W * 0.6, 250 * unit);
  const boardH = boardW * 0.6;
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
    netTopY: rimY + rimRY * 0.4,
    netBottomY: rimY + rimRY * 0.4 + rimRX * 1.35,
    netTopW: rimRX * 1.9,
    netBottomW: rimRX * 1.2,
    floorY: H * 0.76,
    start: { x: W * 0.5, y: H * 0.8 },
  };
}

// ─── Trajectoire : calculée une fois par tir, puis simplement relue ──────────
interface TrajPoint {
  x: number;
  y: number;
  r: number;
  rot: number;
  behind: boolean; // le ballon est dans le cercle : il passe derrière le filet et l'avant du cercle
}

interface Traj {
  id: number;
  W: number;
  H: number;
  dt: number;
  pts: TrajPoint[];
  tResult: number;
  duration: number;
  tEnter: number | null;
  tExit: number | null;
}

const DT = 1 / 120;

function buildTrajectory(shot: ShotResult, W: number, H: number): Traj {
  const L = layout(W, H);
  const g = 4.5 * H;
  const TF = 0.72; // durée du vol jusqu'au panier
  const S = L.start;
  const side = shot.side;
  const rNear = W * 0.085;
  const rFar = W * 0.06;
  const rAt = (d: number) => rNear + (rFar - rNear) * d;
  const madeShot = isMade(shot.outcome);
  const isShort = shot.outcome === "short";

  // Point de contact avec le cercle / la planche (ou le sommet pour un tir trop court).
  let ax = 0;
  let ay = 0;
  switch (shot.outcome) {
    case "swish": ax = L.rimX + side * L.rimRX * 0.1; ay = L.rimY - rFar * 0.3; break;
    case "made": ax = L.rimX + side * L.rimRX * 0.78; ay = L.rimY - rFar * 0.6; break;
    case "rimout": ax = L.rimX + side * L.rimRX * 0.98; ay = L.rimY - rFar * 0.5; break;
    case "board": ax = L.rimX + side * W * 0.25; ay = L.boardY + L.boardH * 0.3; break;
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
  let rest = 0;
  let end = 3.2;
  const floor = isShort ? S.y : L.floorY;
  const steps = Math.ceil(3.2 / DT);

  for (let i = 0; i <= steps; i++) {
    const t = i * DT;
    const d = isShort ? 0.7 * Math.sin(Math.PI * clamp(t / tShort, 0, 1)) : clamp(t / TF, 0, 1);

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
      vy += g * DT;
      const r = rAt(d);
      if (madeShot && y > L.rimY && y < L.netBottomY + r * 0.5 && Math.abs(x - L.rimX) < L.rimRX * 1.2) {
        // Dans le filet : il guide et freine le ballon.
        vx += (L.rimX - x) * 60 * DT - vx * 6 * DT;
        vy *= 1 - 7 * DT;
        vy = Math.max(vy, 0.28 * H);
      }
      x += vx * DT;
      y += vy * DT;
      rot += (vx / r) * DT + (isShort ? 7 * side * DT : 0);
      if (y >= floor && vy > 0 && i > 0) {
        y = floor;
        vy = vy > 0.18 * H ? -vy * 0.42 : 0;
        vx *= 0.82;
      }
      if (y >= floor - 0.5 && vy === 0) {
        vx *= 1 - 3 * DT;
        rest = Math.abs(vx) < W * 0.01 ? rest + 1 : 0;
      }
    }

    const r = rAt(d);
    if (madeShot) {
      // Seulement une fois arrivé au panier (le ballon part plus bas que le cercle).
      if (t >= TF - 0.05) {
        if (tEnter === null && y > L.rimY) tEnter = t;
        if (tEnter !== null && tExit === null && y > L.netBottomY) tExit = t;
      }
    }
    const behind = madeShot && tExit === null && t >= TF - 0.12 && y > L.rimY - r;
    pts.push({ x, y, r, rot, behind });

    if (rest >= 10) {
      end = t;
      break;
    }
  }

  const tResult = madeShot ? (tEnter ?? TF) + 0.1 : isShort ? tShort * 0.6 : TF + 0.35;
  return { id: shot.id, W, H, dt: DT, pts, tResult, duration: Math.min(end + 0.35, 3.2), tEnter, tExit };
}

// ─── Dessin ──────────────────────────────────────────────────────────────────
function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, rotation: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  const body = ctx.createRadialGradient(-radius * 0.4, -radius * 0.5, radius * 0.05, 0, 0, radius * 1.15);
  body.addColorStop(0, "#FFB066");
  body.addColorStop(0.45, "#F07A2A");
  body.addColorStop(1, "#A8400F");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(48,18,6,0.9)";
  ctx.lineWidth = Math.max(1.2, radius * 0.07);
  ctx.beginPath();
  ctx.moveTo(-radius, 0);
  ctx.lineTo(radius, 0);
  ctx.moveTo(0, -radius);
  ctx.lineTo(0, radius);
  ctx.moveTo(-radius * 0.72, -radius * 0.7);
  ctx.bezierCurveTo(-radius * 0.28, -radius * 0.25, -radius * 0.28, radius * 0.25, -radius * 0.72, radius * 0.7);
  ctx.moveTo(radius * 0.72, -radius * 0.7);
  ctx.bezierCurveTo(radius * 0.28, -radius * 0.25, radius * 0.28, radius * 0.25, radius * 0.72, radius * 0.7);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawNet(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  W: number,
  t: number,
  shot: ShotResult | null,
  traj: Traj | null,
  ball: TrajPoint | null,
) {
  const COLS = 7;
  const ROWS = 8;
  const netH = L.netBottomY - L.netTopY;

  // Le ballon dans le filet le gonfle ; une fois sorti, le filet balance en s'amortissant.
  const ballIn = !!(
    ball && traj && shot && isMade(shot.outcome) && traj.tEnter !== null &&
    t >= traj.tEnter - 0.05 && (traj.tExit === null || t < traj.tExit)
  );
  let swing = 0;
  if (traj && shot && traj.tExit !== null && t >= traj.tExit) {
    const k = t - traj.tExit;
    swing = Math.exp(-k * 3) * Math.sin(k * 24) * W * (shot.outcome === "swish" ? 0.032 : 0.024);
  }
  const ext = ball && ballIn ? clamp(ball.y + ball.r * 0.6 - L.netBottomY, 0, ball.r * 0.9) : 0;

  const pointAt = (u: number, p: number) => {
    const baseW = L.netTopW + (L.netBottomW - L.netTopW) * p;
    let widen = 0;
    let shift = swing * Math.sin(p * Math.PI * 0.5) * p;
    if (ball && ballIn) {
      const dy = (L.netTopY + netH * p - ball.y) / (ball.r * 1.3);
      const gauss = Math.exp(-dy * dy);
      widen = ball.r * 1.1 * gauss;
      shift += (ball.x - L.rimX) * gauss * 0.5 * p;
    }
    return {
      x: L.rimX + (u - 0.5) * (baseW + widen) + shift,
      y: L.netTopY + netH * p + ext * p * p,
    };
  };

  ctx.save();
  ctx.strokeStyle = "rgba(240,246,255,0.8)";
  ctx.lineWidth = 1.1 * L.unit;
  ctx.lineJoin = "round";
  for (let i = 0; i <= COLS; i++) {
    for (const dir of [1, -1]) {
      ctx.beginPath();
      let started = false;
      for (let r = 0; r <= ROWS; r++) {
        const p = r / ROWS;
        const u = i / COLS + (dir * p) / COLS;
        if (u < 0 || u > 1) { started = false; continue; }
        const pt = pointAt(u, p);
        if (!started) { ctx.moveTo(pt.x, pt.y); started = true; } else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    }
  }
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
  ctx.clearRect(0, 0, W, H);

  // Fond sobre : dégradé sombre + halo derrière le panier.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0A1220");
  bg.addColorStop(0.6, "#111D30");
  bg.addColorStop(1, "#070D17");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const showResult = !!(shot && traj && t >= traj.tResult);
  const success = !!(shot && showResult && isMade(shot.outcome));
  const glow = ctx.createRadialGradient(rimX, rimY, 4, rimX, rimY, W * 0.62);
  glow.addColorStop(0, success ? "rgba(90,235,160,0.22)" : "rgba(255,140,70,0.16)");
  glow.addColorStop(1, "rgba(255,140,70,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Sol.
  const floorGrad = ctx.createLinearGradient(0, L.floorY, 0, H);
  floorGrad.addColorStop(0, "rgba(40,62,90,0.25)");
  floorGrad.addColorStop(1, "rgba(5,10,18,0.9)");
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, L.floorY, W, H - L.floorY);
  ctx.strokeStyle = "rgba(170,193,219,0.16)";
  ctx.lineWidth = 1.2 * unit;
  ctx.beginPath();
  ctx.moveTo(0, L.floorY);
  ctx.lineTo(W, L.floorY);
  ctx.stroke();

  // Bras de support, en retrait derrière la planche.
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(120,140,170,0.55)";
  ctx.lineWidth = 7 * unit;
  ctx.beginPath();
  ctx.moveTo(L.boardX + L.boardW * 0.9, L.boardY + L.boardH * 0.3);
  ctx.lineTo(W * 0.9, L.boardY + L.boardH * 0.3);
  ctx.lineTo(W * 0.9, L.floorY);
  ctx.stroke();
  ctx.restore();

  // Planche.
  ctx.fillStyle = "rgba(210,228,250,0.12)";
  ctx.fillRect(L.boardX, L.boardY, L.boardW, L.boardH);
  ctx.strokeStyle = "rgba(232,242,255,0.9)";
  ctx.lineWidth = 2.4 * unit;
  ctx.strokeRect(L.boardX, L.boardY, L.boardW, L.boardH);
  ctx.strokeStyle = "rgba(255,150,80,0.85)";
  ctx.lineWidth = 2 * unit;
  ctx.strokeRect(rimX - L.boardW * 0.17, rimY - L.boardH * 0.36, L.boardW * 0.34, L.boardH * 0.36);

  // Position du ballon à l'instant t.
  let ball: TrajPoint | null = null;
  if (traj && shot) {
    const idx = clamp(Math.floor(t / traj.dt), 0, traj.pts.length - 1);
    ball = traj.pts[idx];
  } else {
    ball = { x: L.start.x, y: L.start.y, r: W * 0.085, rot: 0, behind: false };
  }

  const rimBack = () => {
    ctx.strokeStyle = "#B8441A";
    ctx.lineWidth = 5 * unit;
    ctx.beginPath();
    ctx.ellipse(rimX, rimY, rimRX, rimRY, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
  };
  const rimFront = () => {
    ctx.strokeStyle = "#FF7A30";
    ctx.lineWidth = 6 * unit;
    ctx.beginPath();
    ctx.ellipse(rimX, rimY, rimRX, rimRY, 0, 0, Math.PI);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,215,175,0.8)";
    ctx.lineWidth = 1.4 * unit;
    ctx.beginPath();
    ctx.ellipse(rimX, rimY + 0.8 * unit, rimRX * 0.97, rimRY * 0.9, 0, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  };

  // Ombre portée du ballon sur le sol.
  if (ball) {
    const height = Math.max(0, L.floorY - ball.y);
    const a = 0.32 * (1 - clamp(height / (H * 0.5), 0, 1));
    const sy = Math.max(ball.y + ball.r * 0.9, L.floorY + 3 * unit);
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.beginPath();
    ctx.ellipse(ball.x, sy, ball.r * (1 - 0.3 * clamp(height / H, 0, 1)), ball.r * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ordre de dessin : arrière du cercle → ballon (s'il est dans le panier) → filet → avant du cercle → ballon.
  rimBack();
  if (ball && ball.behind) drawBall(ctx, ball.x, ball.y, ball.r, ball.rot);
  drawNet(ctx, L, W, t, shot, traj, ball);
  rimFront();
  if (ball && !ball.behind) drawBall(ctx, ball.x, ball.y, ball.r, ball.rot);

  // Résultat : une ligne, qui reste affichée jusqu'au tir suivant.
  if (shot && traj && showResult) {
    const made = isMade(shot.outcome);
    const fade = clamp((t - traj.tResult) / 0.2, 0, 1);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${clamp(W * 0.085, 26, 38)}px system-ui, sans-serif`;
    ctx.lineWidth = 6 * unit;
    ctx.strokeStyle = "rgba(3,8,15,0.8)";
    const ly = H * 0.52 - (1 - fade) * 8;
    ctx.strokeText(outcomeLabel(shot.outcome), W / 2, ly);
    ctx.fillStyle = made ? "#90FFC0" : shot.outcome === "rimout" ? "#FFD49B" : "#FFAAA3";
    ctx.fillText(outcomeLabel(shot.outcome), W / 2, ly);
    ctx.restore();
  }
}

// ─── Scène animée ────────────────────────────────────────────────────────────
function ShotScene({
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
function LancerFrancGame() {
  const [sensorStatus, setSensorStatus] = useState<SensorStatus>("checking");
  const [phase, setPhaseState] = useState<GamePhase>("waiting-vertical");
  const [shot, setShot] = useState<ShotResult | null>(null);
  const [stats, setStats] = useState<Stats>({ attempts: 0, makes: 0, streak: 0, best: 0 });
  const statsRef = useRef<Stats>(stats);
  const whoRef = useRef<LFIdentity>({ id: "local", label: "Moi" });
  const recentRef = useRef<boolean[]>([]);
  const shotIdRef = useRef(0);
  const phaseRef = useRef<GamePhase>("waiting-vertical");

  useScreenWakeLock();

  const changePhase = useCallback((next: GamePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  // Stats « de tout le temps » : locales d'abord, fusionnées avec le serveur si le réseau répond.
  useEffect(() => {
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
  }, []);

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
    shotIdRef.current += 1;
    const next = decideShot(shotIdRef.current, peakPush, angleDeg, flick, recentRef.current);
    changePhase("animating");
    setShot(next);
  }, [changePhase]);
  const handleShootRef = useRef(handleShoot);
  handleShootRef.current = handleShoot;

  // Le résultat compte dès que le ballon est dans le filet (ou a raté), sans attendre la fin du rebond.
  const handleResult = useCallback((outcome: Outcome) => {
    if (phaseRef.current !== "animating") return;
    const made = isMade(outcome);
    recentRef.current = [...recentRef.current, made].slice(-20);
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

  const pct = stats.attempts > 0 ? Math.round((stats.makes / stats.attempts) * 100) : 0;
  let hint: string | null = null;
  if (sensorStatus === "granted" && stats.attempts < 3) {
    if (phase === "waiting-vertical") hint = "TIENS LE TÉLÉPHONE À LA VERTICALE";
    else if (phase === "ready") hint = "POUSSE VERS LE HAUT, CASSE LE POIGNET";
    else if (phase === "waiting-reset") hint = "REMETS LE TÉLÉPHONE À LA VERTICALE";
  }

  return (
    <main
      className="relative flex h-[100dvh] min-h-[100dvh] w-full flex-col overflow-hidden"
      style={{ background: "#080F1B", color: "#F4F7FC", overscrollBehavior: "none" }}
    >
      <section className="relative min-h-0 flex-1" aria-label="Terrain et panier de basket">
        <ShotScene shot={shot} onResult={handleResult} onDone={handleAnimationDone} />

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
              style={{ background: "rgba(16,29,46,0.96)", border: "1px solid rgba(172,194,224,0.18)" }}
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

      <footer
        className="relative grid grid-cols-3 items-center"
        aria-label="Statistiques"
        style={{
          minHeight: 70,
          padding: "8px 20px calc(8px + env(safe-area-inset-bottom))",
          background: "rgba(6,12,21,0.94)",
          borderTop: "1px solid rgba(164,188,221,0.13)",
        }}
      >
        <Stat label="Réussite" value={`${pct}%`} accent="#FF9B55" />
        <Stat label="Série" value={stats.streak} accent={stats.streak > 0 ? "#8AFFBD" : "#EDF3FC"} />
        <Stat label="Record" value={stats.best} accent="#EDF3FC" />
      </footer>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className="min-w-0 text-center">
      <div className="text-[22px] font-black leading-none tracking-tight tabular-nums" style={{ color: accent }}>
        {value}
      </div>
      <div className="mt-1.5 text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: "rgba(177,194,217,0.66)" }}>
        {label}
      </div>
    </div>
  );
}

export default function LancerFranc() {
  return <LancerFrancGame />;
}