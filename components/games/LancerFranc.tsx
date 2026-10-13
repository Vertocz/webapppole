"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─── Équilibrage du tir ──────────────────────────────────────────────────────
// Les seuils de résultat et les poids de la note restent ceux du jeu d'origine.
const IDEAL_MOTION_MAG = 14; // m/s² au pic du geste
const MOTION_MAG_TOLERANCE = 10;
const IDEAL_ANGLE_DEG = 0;
const ANGLE_TOLERANCE_DEG = 60;
const OUTCOME_THRESHOLDS = { swish: 0.8, made: 0.5, rimout: 0.28 };

// Détection du geste : à recalibrer après essais sur les téléphones cibles.
const SHOT_TRIGGER_Y = 3.8; // accélération vers le haut, m/s²
const SHOT_TRIGGER_MAG = 5.8;
const GESTURE_MIN_MS = 135;
const GESTURE_MAX_MS = 310;
const GESTURE_QUIET_MS = 65;
const VERTICAL_HOLD_MS = 350;
const VERTICAL_MAX_Z = 3.6; // composante de gravité perpendiculaire à l'écran
const MAX_LINEAR_MAG_FOR_RESET = 2.8;
const SHOT_ANIMATION_MS = 760;

type Outcome = "swish" | "made" | "rimout" | "miss";
type SensorStatus = "checking" | "needs-permission" | "granted" | "denied" | "unsupported";
type GamePhase = "waiting-vertical" | "ready" | "measuring" | "animating" | "waiting-reset";

interface ShotResult {
  id: number;
  quality: number;
  outcome: Outcome;
  missDx: number;
  power: number;
}

interface MotionSample {
  x: number;
  y: number;
  z: number;
  mag: number;
  t: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function qualityFromValue(value: number, ideal: number, tolerance: number): number {
  return clamp(1 - Math.abs(value - ideal) / tolerance, 0, 1);
}

function resolveOutcome(quality: number): Outcome {
  if (quality >= OUTCOME_THRESHOLDS.swish) return "swish";
  if (quality >= OUTCOME_THRESHOLDS.made) return "made";
  if (quality >= OUTCOME_THRESHOLDS.rimout) return "rimout";
  return "miss";
}

function isMade(outcome: Outcome): boolean {
  return outcome === "swish" || outcome === "made";
}

function outcomeLabel(outcome: Outcome): string {
  switch (outcome) {
    case "swish": return "SWISH !";
    case "made": return "PANIER !";
    case "rimout": return "AU CERCLE…";
    default: return "RATÉ";
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

// ─── Illustration Canvas : terrain, panier, filet et ballon ──────────────────
function drawBall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  rotation: number,
  alpha = 1,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rotation);

  // Ombre douce sous le ballon.
  const shadow = ctx.createRadialGradient(radius * 0.18, radius * 0.78, 1, 0, radius * 0.8, radius * 1.45);
  shadow.addColorStop(0, "rgba(0,0,0,0.5)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(radius * 0.16, radius * 0.8, radius * 1.35, radius * 0.53, 0, 0, Math.PI * 2);
  ctx.fill();

  const ball = ctx.createRadialGradient(-radius * 0.42, -radius * 0.52, radius * 0.04, radius * 0.05, radius * 0.1, radius * 1.28);
  ball.addColorStop(0, "#FFD08A");
  ball.addColorStop(0.24, "#FF9A43");
  ball.addColorStop(0.72, "#ED681F");
  ball.addColorStop(1, "#9F3514");
  ctx.fillStyle = ball;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(68,25,11,0.95)";
  ctx.lineWidth = Math.max(1.2, radius * 0.085);
  ctx.stroke();

  // Coutures dessinées comme de vraies rainures courbes.
  ctx.strokeStyle = "rgba(75,29,13,0.95)";
  ctx.lineWidth = Math.max(1.1, radius * 0.075);
  ctx.beginPath();
  ctx.moveTo(-radius * 0.94, -radius * 0.12);
  ctx.bezierCurveTo(-radius * 0.25, radius * 0.28, radius * 0.25, -radius * 0.28, radius * 0.94, radius * 0.12);
  ctx.moveTo(-radius * 0.18, -radius * 0.98);
  ctx.bezierCurveTo(-radius * 0.62, -radius * 0.32, -radius * 0.62, radius * 0.32, -radius * 0.18, radius * 0.98);
  ctx.moveTo(radius * 0.18, -radius * 0.98);
  ctx.bezierCurveTo(radius * 0.62, -radius * 0.32, radius * 0.62, radius * 0.32, radius * 0.18, radius * 0.98);
  ctx.stroke();
  ctx.restore();
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  progress: number,
  shot: ShotResult | null,
) {
  ctx.clearRect(0, 0, W, H);
  const unit = clamp(W / 390, 0.78, 1.45);

  // Arène sombre, halo de lumière et vignettage.
  const background = ctx.createLinearGradient(0, 0, 0, H);
  background.addColorStop(0, "#08101D");
  background.addColorStop(0.43, "#111E31");
  background.addColorStop(0.78, "#101A2A");
  background.addColorStop(1, "#070D17");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);

  const spot = ctx.createRadialGradient(W * 0.5, H * 0.24, 1, W * 0.5, H * 0.27, W * 0.8);
  spot.addColorStop(0, "rgba(255,151,76,0.19)");
  spot.addColorStop(0.4, "rgba(86,126,177,0.075)");
  spot.addColorStop(1, "rgba(7,13,23,0)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, W, H * 0.83);

  // Projecteurs et petits points de lumière d'arène, dessinés de façon déterministe.
  for (let i = 0; i < 12; i++) {
    const side = i < 6 ? 1 : -1;
    const n = i % 6;
    const x = side === 1 ? W * (0.045 + n * 0.027) : W * (0.955 - n * 0.027);
    const y = H * (0.105 + (n % 3) * 0.018);
    const r = (2.1 + (n % 3) * 0.7) * unit;
    const light = ctx.createRadialGradient(x, y, 0, x, y, r * 5.5);
    light.addColorStop(0, "rgba(225,235,250,0.65)");
    light.addColorStop(1, "rgba(155,186,225,0)");
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.arc(x, y, r * 5.5, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 54; i++) {
    const x = ((i * 73 + (i % 5) * 19) % 997) / 997 * W;
    const y = H * (0.34 + ((i * 31) % 100) / 100 * 0.22);
    const r = (i % 7 === 0 ? 1.8 : 0.8) * unit;
    ctx.fillStyle = i % 4 === 0 ? "rgba(255,165,98,0.34)" : "rgba(169,195,227,0.19)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sol et lignes de terrain très discrètes.
  const floorY = H * 0.72;
  const floor = ctx.createLinearGradient(0, floorY, 0, H);
  floor.addColorStop(0, "rgba(27,44,64,0.12)");
  floor.addColorStop(1, "rgba(5,10,18,0.9)");
  ctx.fillStyle = floor;
  ctx.fillRect(0, floorY, W, H - floorY);
  ctx.strokeStyle = "rgba(170,193,219,0.13)";
  ctx.lineWidth = 1.1 * unit;
  ctx.beginPath();
  ctx.moveTo(W * 0.08, H);
  ctx.lineTo(W * 0.38, floorY);
  ctx.moveTo(W * 0.92, H);
  ctx.lineTo(W * 0.62, floorY);
  ctx.moveTo(0, H * 0.91);
  ctx.lineTo(W, H * 0.91);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(W * 0.5, H * 1.03, W * 0.38, H * 0.19, 0, Math.PI, Math.PI * 2);
  ctx.stroke();

  const rimX = W * 0.5;
  const rimY = H * 0.285;
  const boardW = Math.min(W * 0.56, 230 * unit);
  const boardH = boardW * 0.39;
  const boardX = rimX - boardW / 2;
  const boardY = rimY - boardH * 0.9;
  const rimRX = W * 0.155;
  const rimRY = 8 * unit;

  // Montant métallique et support en retrait.
  ctx.save();
  ctx.strokeStyle = "rgba(2,5,11,0.65)";
  ctx.lineWidth = 14 * unit;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(boardX + boardW * 0.88, boardY + boardH * 0.27);
  ctx.lineTo(W * 0.84, boardY + boardH * 0.28);
  ctx.lineTo(W * 0.84, H * 0.76);
  ctx.stroke();
  ctx.strokeStyle = "rgba(130,153,184,0.42)";
  ctx.lineWidth = 5 * unit;
  ctx.beginPath();
  ctx.moveTo(boardX + boardW * 0.88, boardY + boardH * 0.27);
  ctx.lineTo(W * 0.84, boardY + boardH * 0.28);
  ctx.lineTo(W * 0.84, H * 0.76);
  ctx.stroke();
  ctx.restore();

  // Lueur derrière le panier.
  const rimGlow = ctx.createRadialGradient(rimX, rimY + 4 * unit, 2, rimX, rimY + 4 * unit, W * 0.38);
  const successful = shot !== null && isMade(shot.outcome);
  rimGlow.addColorStop(0, successful ? "rgba(91,243,163,0.2)" : "rgba(255,126,54,0.15)");
  rimGlow.addColorStop(1, "rgba(255,126,54,0)");
  ctx.fillStyle = rimGlow;
  ctx.fillRect(rimX - W * 0.4, rimY - W * 0.25, W * 0.8, W * 0.72);

  // Panneau en verre avec liseré lumineux.
  const glass = ctx.createLinearGradient(boardX, boardY, boardX + boardW, boardY + boardH);
  glass.addColorStop(0, "rgba(219,235,255,0.14)");
  glass.addColorStop(0.45, "rgba(182,212,247,0.035)");
  glass.addColorStop(1, "rgba(232,242,255,0.09)");
  ctx.fillStyle = glass;
  ctx.fillRect(boardX, boardY, boardW, boardH);
  ctx.strokeStyle = "rgba(226,239,255,0.82)";
  ctx.lineWidth = 2.2 * unit;
  ctx.strokeRect(boardX, boardY, boardW, boardH);
  ctx.strokeStyle = "rgba(197,220,248,0.62)";
  ctx.lineWidth = 1.4 * unit;
  ctx.strokeRect(rimX - boardW * 0.17, rimY - boardH * 0.48, boardW * 0.34, boardH * 0.48);
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillRect(boardX + 4 * unit, boardY + 4 * unit, boardW - 8 * unit, 2 * unit);

  // Filet, avec une petite déformation lorsque le ballon tombe dedans.
  const netTopY = rimY + 4 * unit;
  const netBottomY = rimY + W * 0.115;
  const netTopW = rimRX * 1.68;
  const netBottomW = rimRX * 0.9;
  const netSwing = successful && progress >= 0.76 ? Math.sin((progress - 0.76) * 23) * W * 0.012 : 0;
  ctx.save();
  ctx.strokeStyle = "rgba(238,245,255,0.68)";
  ctx.lineWidth = 1.05 * unit;
  for (let i = 0; i <= 8; i++) {
    const p = i / 8;
    const topX = rimX - netTopW / 2 + p * netTopW;
    const bottomX = rimX - netBottomW / 2 + p * netBottomW + netSwing * (p - 0.5) * 2;
    ctx.beginPath();
    ctx.moveTo(topX, netTopY);
    ctx.quadraticCurveTo((topX + bottomX) / 2 + netSwing, (netTopY + netBottomY) / 2, bottomX, netBottomY);
    ctx.stroke();
  }
  for (let row = 1; row <= 4; row++) {
    const p = row / 5;
    const y = netTopY + (netBottomY - netTopY) * p;
    const halfWidth = (netTopW * (1 - p) + netBottomW * p) / 2;
    ctx.beginPath();
    ctx.moveTo(rimX - halfWidth, y);
    ctx.quadraticCurveTo(rimX + netSwing * p, y + 2.2 * unit, rimX + halfWidth, y);
    ctx.stroke();
  }
  ctx.restore();

  // Arceau en perspective : bord arrière, corps orange et reflet frontal.
  ctx.strokeStyle = "rgba(15,7,4,0.72)";
  ctx.lineWidth = 10 * unit;
  ctx.beginPath();
  ctx.ellipse(rimX, rimY, rimRX, rimRY, 0, 0, Math.PI * 2);
  ctx.stroke();
  const rimGradient = ctx.createLinearGradient(rimX - rimRX, rimY, rimX + rimRX, rimY);
  rimGradient.addColorStop(0, "#C94D1F");
  rimGradient.addColorStop(0.28, "#FF9B4B");
  rimGradient.addColorStop(0.65, "#FF6D2C");
  rimGradient.addColorStop(1, "#B83E18");
  ctx.strokeStyle = rimGradient;
  ctx.lineWidth = 5.5 * unit;
  ctx.beginPath();
  ctx.ellipse(rimX, rimY, rimRX, rimRY, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,205,157,0.9)";
  ctx.lineWidth = 1.25 * unit;
  ctx.beginPath();
  ctx.ellipse(rimX, rimY - 1.3 * unit, rimRX * 0.96, rimRY * 0.78, 0, Math.PI * 1.02, Math.PI * 1.92);
  ctx.stroke();

  // Ballon en mouvement, ou prêt à être lancé au premier écran.
  const start = { x: W * 0.5, y: H * 0.79 };
  let ballX = start.x;
  let ballY = start.y;
  let ballRotation = 0;
  let ballRadius = W * 0.052;
  let drawTrail = false;

  if (shot) {
    let endX = rimX;
    let endY = rimY + W * 0.055;
    if (shot.outcome === "swish" || shot.outcome === "made") {
      endX = rimX + shot.missDx * W * 0.035;
      endY = rimY + W * 0.105;
    } else if (shot.outcome === "rimout") {
      endX = rimX + (shot.missDx === 0 ? 1 : shot.missDx) * W * 0.22;
      endY = rimY - W * 0.02;
    } else if (shot.power < 0.4) {
      endX = rimX + shot.missDx * W * 0.15;
      endY = rimY + (start.y - rimY) * 0.48;
    } else {
      endX = rimX + (shot.missDx === 0 ? 1 : shot.missDx) * W * 0.28;
      endY = rimY - H * 0.105;
    }

    const travel = start.y - endY;
    const ctrl = {
      x: (start.x + endX) / 2 + shot.missDx * W * 0.05,
      y: Math.max(boardY - W * 0.16, Math.min(start.y, endY) - Math.max(W * 0.2, travel * (0.31 + shot.power * 0.18))),
    };
    const t = clamp(progress, 0, 1);
    const ease = 1 - Math.pow(1 - t, 1.35);
    const pointAt = (p: number) => ({
      x: (1 - p) * (1 - p) * start.x + 2 * (1 - p) * p * ctrl.x + p * p * endX,
      y: (1 - p) * (1 - p) * start.y + 2 * (1 - p) * p * ctrl.y + p * p * endY,
    });
    const p = pointAt(ease);
    ballX = p.x;
    ballY = p.y;
    ballRotation = ease * 6.3;
    ballRadius = W * (0.052 - ease * 0.007);
    drawTrail = t > 0 && t < 0.98;

    if (drawTrail) {
      ctx.save();
      for (let i = 7; i >= 1; i--) {
        const back = pointAt(Math.max(0, ease - i * 0.018));
        const alpha = (1 - i / 8) * 0.32;
        ctx.fillStyle = `rgba(255,157,87,${alpha})`;
        ctx.beginPath();
        ctx.arc(back.x, back.y, ballRadius * (0.2 + (1 - i / 8) * 0.24), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // Lueur de sol sous le ballon de départ / ombre de trajectoire.
  if (!shot) {
    const floorGlow = ctx.createRadialGradient(start.x, start.y + ballRadius * 1.15, 0, start.x, start.y + ballRadius * 1.15, W * 0.18);
    floorGlow.addColorStop(0, "rgba(255,132,60,0.18)");
    floorGlow.addColorStop(1, "rgba(255,132,60,0)");
    ctx.fillStyle = floorGlow;
    ctx.fillRect(start.x - W * 0.18, start.y - W * 0.06, W * 0.36, W * 0.28);
  }
  drawBall(ctx, ballX, ballY, ballRadius, ballRotation);

  if (shot && progress >= 1) {
    const made = isMade(shot.outcome);
    const label = outcomeLabel(shot.outcome);
    const labelY = H * 0.565;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowBlur = made ? 24 * unit : 13 * unit;
    ctx.shadowColor = made ? "rgba(80,255,164,0.42)" : "rgba(255,130,71,0.32)";
    ctx.font = `900 ${clamp(W * 0.075, 25, 34)}px system-ui, sans-serif`;
    ctx.lineWidth = 5 * unit;
    ctx.strokeStyle = "rgba(3,8,15,0.8)";
    ctx.strokeText(label, W / 2, labelY);
    ctx.fillStyle = made ? "#90FFC0" : shot.outcome === "rimout" ? "#FFD49B" : "#FFAAA3";
    ctx.fillText(label, W / 2, labelY);
    ctx.shadowBlur = 0;
    ctx.font = `700 ${clamp(W * 0.027, 10, 12)}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(237,244,253,0.78)";
    ctx.fillText(`${Math.round(shot.quality * 100)} % DE QUALITÉ`, W / 2, labelY + 28 * unit);

    // Petites étincelles persistantes sur les paniers : récompense discrète, pas de modal.
    if (made) {
      for (let i = 0; i < 13; i++) {
        const angle = (i / 13) * Math.PI * 2;
        const radius = W * (0.14 + (i % 3) * 0.025);
        const x = rimX + Math.cos(angle) * radius;
        const y = rimY + Math.sin(angle) * radius * 0.72;
        ctx.globalAlpha = i % 3 === 0 ? 0.9 : 0.48;
        ctx.fillStyle = i % 2 === 0 ? "#FFD59D" : "#7DFFC0";
        ctx.beginPath();
        ctx.arc(x, y, (i % 3 === 0 ? 2.3 : 1.3) * unit, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

function ShotScene({ shot, onDone }: { shot: ShotResult | null; onDone: (outcome: Outcome) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shotRef = useRef<ShotResult | null>(shot);
  const progressRef = useRef(0);
  const onDoneRef = useRef(onDone);
  const animationRef = useRef<number | null>(null);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  shotRef.current = shot;
  onDoneRef.current = onDone;

  const renderFrame = useCallback((progress: number, currentShot: ShotResult | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (rect.width < 1 || rect.height < 1) return;

    if (
      canvas.width !== Math.round(rect.width * dpr) ||
      canvas.height !== Math.round(rect.height * dpr)
    ) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }
    sizeRef.current = { width: rect.width, height: rect.height, dpr };
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(ctx, rect.width, rect.height, progress, currentShot);
  }, []);

  // Premier dessin et adaptation au redimensionnement / à la rotation de l'écran.
  useEffect(() => {
    renderFrame(progressRef.current, shotRef.current);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => renderFrame(progressRef.current, shotRef.current))
      : null;
    observer?.observe(canvas);
    const onResize = () => renderFrame(progressRef.current, shotRef.current);
    window.addEventListener("resize", onResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [renderFrame]);

  // Une nouvelle animation ne démarre que lorsqu'un nouveau tir est réellement créé.
  // Les changements de phase / les statistiques ne peuvent donc jamais la relancer.
  useEffect(() => {
    if (!shot) {
      progressRef.current = 0;
      renderFrame(0, null);
      return;
    }

    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    const start = performance.now();
    let completed = false;
    const frame = (now: number) => {
      const raw = clamp((now - start) / SHOT_ANIMATION_MS, 0, 1);
      progressRef.current = raw;
      renderFrame(raw, shot);
      if (raw < 1) {
        animationRef.current = requestAnimationFrame(frame);
      } else {
        animationRef.current = null;
        if (!completed) {
          completed = true;
          onDoneRef.current(shot.outcome);
        }
      }
    };
    animationRef.current = requestAnimationFrame(frame);
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    };
  }, [shot?.id, renderFrame]);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Panier de basket et animation du lancer"
      className="block h-full w-full"
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}

// ─── Jeu piloté par le mouvement du téléphone, sans geste tactile ────────────
function LancerFrancGame() {
  const [sensorStatus, setSensorStatus] = useState<SensorStatus>("checking");
  const [phase, setPhaseState] = useState<GamePhase>("waiting-vertical");
  const [shot, setShot] = useState<ShotResult | null>(null);
  const [stats, setStats] = useState({ attempts: 0, makes: 0, streak: 0, best: 0 });
  const shotIdRef = useRef(0);
  const phaseRef = useRef<GamePhase>("waiting-vertical");

  const changePhase = useCallback((next: GamePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.DeviceMotionEvent === "undefined") {
      setSensorStatus("unsupported");
      return;
    }
    const DME = window.DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    // iOS exige un appel explicite déclenché par l'utilisateur. Ailleurs, on démarre sans bouton.
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

  const handleShoot = useCallback((power: number, angleDeg: number, smoothness: number) => {
    if (phaseRef.current !== "measuring") return;
    const angleQ = qualityFromValue(angleDeg, IDEAL_ANGLE_DEG, ANGLE_TOLERANCE_DEG);
    // L'aléatoire léger d'origine est conservé pour éviter des seuils trop mécaniques.
    const jitter = (Math.random() - 0.5) * 0.12;
    const quality = clamp(0.45 * power + 0.3 * angleQ + 0.25 * smoothness + jitter, 0, 1);
    const outcome = resolveOutcome(quality);
    const missDx = outcome === "miss" || outcome === "rimout"
      ? (Math.random() * 2 - 1) * (1 - quality) * 1.4
      : 0;
    shotIdRef.current += 1;
    changePhase("animating");
    setShot({ id: shotIdRef.current, quality, outcome, missDx, power });
  }, [changePhase]);
  const handleShootRef = useRef(handleShoot);
  handleShootRef.current = handleShoot;

  const handleAnimationDone = useCallback((outcome: Outcome) => {
    if (phaseRef.current !== "animating") return;
    const made = isMade(outcome);
    setStats((prev) => {
      const streak = made ? prev.streak + 1 : 0;
      return {
        attempts: prev.attempts + 1,
        makes: prev.makes + (made ? 1 : 0),
        streak,
        best: Math.max(prev.best, streak),
      };
    });
    // Le résultat reste sur le terrain. Le joueur doit simplement remettre le téléphone
    // à la verticale quelques dixièmes de seconde pour armer le prochain geste.
    changePhase("waiting-reset");
  }, [changePhase]);

  useEffect(() => {
    if (sensorStatus !== "granted") return;

    let gravityEstimate: { x: number; y: number; z: number } | null = null;
    let verticalSince: number | null = null;
    let gestureStartedAt = 0;
    let quietSince: number | null = null;
    let gestureSamples: MotionSample[] = [];

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
        // Repli pour les navigateurs qui ne fournissent pas l'accélération sans gravité.
        // Le filtre lent estime la gravité ; la différence donne le mouvement du téléphone.
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

      const mag = Math.hypot(ax, ay, az);
      const sample: MotionSample = { x: ax, y: ay, z: az, mag, t: now };
      const currentPhase = phaseRef.current;

      // Départ et réarmement : le téléphone doit être posé en position verticale
      // (gravité presque dans le plan de l'écran) et rester stable pendant 350 ms.
      if (currentPhase === "waiting-vertical" || currentPhase === "waiting-reset") {
        const vertical = gravity !== null && gravity.z !== null
          && Math.abs(gravity.z) < VERTICAL_MAX_Z
          && mag < MAX_LINEAR_MAG_FOR_RESET;
        if (vertical) {
          if (verticalSince === null) verticalSince = now;
          if (now - verticalSince >= VERTICAL_HOLD_MS) {
            verticalSince = null;
            changePhase("ready");
          }
        } else {
          verticalSince = null;
        }
        return;
      }

      if (currentPhase === "ready") {
        // Le jeu n'écoute que l'impulsion vers le haut, jamais le doigt.
        const phoneNearVertical = !gravity || gravity.z === null || Math.abs(gravity.z) < 5.2;
        if (phoneNearVertical && ay >= SHOT_TRIGGER_Y && mag >= SHOT_TRIGGER_MAG) {
          gestureSamples = [sample];
          gestureStartedAt = now;
          quietSince = null;
          changePhase("measuring");
        }
        return;
      }

      if (currentPhase === "measuring") {
        gestureSamples.push(sample);
        const elapsed = now - gestureStartedAt;
        if (mag < 2.2) {
          if (quietSince === null) quietSince = now;
        } else {
          quietSince = null;
        }

        const settled = quietSince !== null && now - quietSince >= GESTURE_QUIET_MS;
        if (elapsed >= GESTURE_MIN_MS && (settled || elapsed >= GESTURE_MAX_MS)) {
          const peak = gestureSamples.reduce((best, item) => item.mag > best.mag ? item : best, gestureSamples[0]);
          const power = qualityFromValue(peak.mag, IDEAL_MOTION_MAG, MOTION_MAG_TOLERANCE);
          const angleDeg = (Math.atan2(Math.abs(peak.x), Math.max(1, Math.abs(peak.y))) * 180) / Math.PI;

          let changes = 0;
          for (let i = 1; i < gestureSamples.length; i++) {
            const before = gestureSamples[i - 1];
            const after = gestureSamples[i];
            changes += Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
          }
          const avgChange = gestureSamples.length > 1 ? changes / (gestureSamples.length - 1) : 0;
          const smoothness = clamp(1 - avgChange / 8, 0, 1);
          gestureSamples = [];
          handleShootRef.current(power, angleDeg, smoothness);
        }
      }
    };

    window.addEventListener("devicemotion", onMotion, { passive: true });
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [sensorStatus, changePhase]);

  const pct = stats.attempts > 0 ? Math.round((stats.makes / stats.attempts) * 100) : 0;
  let hint: string | null = null;
  if (sensorStatus === "granted") {
    if (phase === "waiting-vertical") hint = "TIENS LE TÉLÉPHONE À LA VERTICALE";
    else if (phase === "ready" && !shot) hint = "UN GESTE VERS LE HAUT POUR TIRER";
    else if (phase === "waiting-reset") hint = "TÉLÉPHONE À LA VERTICALE POUR REJOUER";
  }

  return (
    <main
      className="relative flex h-[100dvh] min-h-[100dvh] w-full flex-col overflow-hidden"
      style={{ background: "#080F1B", color: "#F4F7FC", overscrollBehavior: "none" }}
    >
      <section className="relative min-h-0 flex-1" aria-label="Terrain et panier de basket">
        <ShotScene shot={shot} onDone={handleAnimationDone} />

        {hint && (
          <div
            aria-live="polite"
            className="pointer-events-none absolute inset-x-3 bottom-4 text-center"
            style={{ color: "rgba(229,238,250,0.62)", fontSize: 10, fontWeight: 700, letterSpacing: "0.17em", textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}
          >
            {hint}
          </div>
        )}

        {sensorStatus !== "granted" && (
          <div
            className="absolute inset-0 flex items-center justify-center px-6"
            style={{ background: "rgba(4,9,17,0.74)", backdropFilter: "blur(8px)" }}
          >
            <div
              className="w-full max-w-sm rounded-3xl px-6 py-7 text-center"
              style={{ background: "rgba(16,29,46,0.96)", border: "1px solid rgba(172,194,224,0.18)", boxShadow: "0 24px 70px rgba(0,0,0,0.42)" }}
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
                    ? "Ce navigateur ne donne pas accès aux mouvements du téléphone. Ouvre le jeu dans un navigateur mobile compatible, en HTTPS. Le tir tactile n'est pas activé."
                    : sensorStatus === "denied"
                      ? "L'accès aux mouvements a été refusé. Autorise les capteurs dans le navigateur puis réessaie."
                      : "Autorise les capteurs une seule fois. Ensuite, chaque tir et chaque reprise se feront en bougeant le téléphone, sans toucher l'écran."}
              </p>
              {(sensorStatus === "needs-permission" || sensorStatus === "denied") && (
                <button
                  type="button"
                  onClick={activateSensors}
                  className="mt-6 w-full rounded-xl px-5 py-3.5 text-sm font-extrabold tracking-wide active:scale-[0.99]"
                  style={{ background: "linear-gradient(135deg,#FFA45D,#F16D2A)", color: "#171018", boxShadow: "0 10px 28px rgba(241,109,42,0.22)" }}
                >
                  {sensorStatus === "denied" ? "Réessayer l'autorisation" : "Activer les capteurs"}
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Bandeau inférieur volontairement léger : trois stats, aucun bouton de jeu. */}
      <footer
        className="relative grid grid-cols-3 items-center"
        aria-label="Statistiques"
        style={{
          minHeight: 78,
          padding: "10px 20px calc(10px + env(safe-area-inset-bottom))",
          background: "rgba(6,12,21,0.92)",
          borderTop: "1px solid rgba(164,188,221,0.13)",
          boxShadow: "0 -12px 32px rgba(0,0,0,0.16)",
          backdropFilter: "blur(18px)",
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
      <div className="text-[23px] font-black leading-none tracking-tight tabular-nums" style={{ color: accent }}>
        {value}
      </div>
      <div className="mt-2 text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: "rgba(177,194,217,0.66)" }}>
        {label}
      </div>
    </div>
  );
}

export default function LancerFranc() {
  return <LancerFrancGame />;
}
