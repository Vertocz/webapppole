"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─── Réglages du geste (mécanique conservée) ──────────────────────────────────
const IDEAL_SWIPE_SPEED = 2.0; // hauteurs de zone de tir / seconde
const SWIPE_SPEED_TOLERANCE = 2.2;
const IDEAL_ANGLE_DEG = 0; // 0° = tracé parfaitement vertical
const ANGLE_TOLERANCE_DEG = 60;
const IDEAL_MOTION_MAG = 14; // m/s² d'accélération linéaire au pic
const MOTION_MAG_TOLERANCE = 10;

const OUTCOME_THRESHOLDS = { swish: 0.8, made: 0.5, rimout: 0.28 };

type Outcome = "swish" | "made" | "rimout" | "miss";

interface ShotResult {
  id: number;
  quality: number;
  outcome: Outcome;
  missDx: number; // -1 (gauche) à 1 (droite)
  power: number; // 0..1, influence la hauteur de l'arc et la portée
}

function qualityFromValue(value: number, ideal: number, tolerance: number): number {
  return Math.max(0, Math.min(1, 1 - Math.abs(value - ideal) / tolerance));
}

function resolveOutcome(quality: number): Outcome {
  if (quality >= OUTCOME_THRESHOLDS.swish) return "swish";
  if (quality >= OUTCOME_THRESHOLDS.made) return "made";
  if (quality >= OUTCOME_THRESHOLDS.rimout) return "rimout";
  return "miss";
}

function outcomeLabel(outcome: Outcome): string {
  if (outcome === "swish") return "SWISH !";
  if (outcome === "made") return "PANIER !";
  if (outcome === "rimout") return "AU CERCLE…";
  return "RATÉ";
}

function outcomeHint(outcome: Outcome): string {
  if (outcome === "swish") return "Parfait. Garde ce geste !";
  if (outcome === "made") return "Bien joué, le geste fonctionne.";
  if (outcome === "rimout") return "Tout près. Soigne ton relâchement.";
  return "Recommence en visant un geste plus régulier.";
}

function isMade(outcome: Outcome): boolean {
  return outcome === "swish" || outcome === "made";
}

// ─── Permission capteurs (mécanisme conservé) ─────────────────────────────────
async function requestMotionPermission(): Promise<boolean> {
  try {
    const DME = window.DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (typeof DME?.requestPermission === "function") {
      const res = await DME.requestPermission();
      return res === "granted";
    }
    return typeof window.DeviceMotionEvent !== "undefined";
  } catch {
    return false;
  }
}

// ─── Canvas du tir : nouveau rendu, animation et résultat conservés ───────────
function ShotCanvas({
  shot,
  onDone,
}: {
  shot: ShotResult | null;
  onDone: (o: Outcome) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Évite de relancer l'animation quand le callback du parent change d'identité.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const draw = useCallback((t: number, current: ShotResult) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Fond bleu nuit, halo de projecteurs et parquet stylisé.
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#101B31");
    bg.addColorStop(0.62, "#0B1324");
    bg.addColorStop(1, "#111C2B");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W * 0.5, H * 0.2, 4, W * 0.5, H * 0.2, W * 0.62);
    glow.addColorStop(0, "rgba(255,142,55,0.14)");
    glow.addColorStop(1, "rgba(255,142,55,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H * 0.72);

    const floorY = H * 0.66;
    const floor = ctx.createLinearGradient(0, floorY, 0, H);
    floor.addColorStop(0, "rgba(38,57,78,0.04)");
    floor.addColorStop(1, "rgba(68,91,116,0.2)");
    ctx.fillStyle = floor;
    ctx.fillRect(0, floorY, W, H - floorY);
    ctx.strokeStyle = "rgba(147,173,202,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W * 0.08, H);
    ctx.lineTo(W * 0.37, floorY);
    ctx.moveTo(W * 0.92, H);
    ctx.lineTo(W * 0.63, floorY);
    ctx.moveTo(0, H * 0.88);
    ctx.lineTo(W, H * 0.88);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(W * 0.5, H * 1.04, W * 0.42, H * 0.28, 0, Math.PI, Math.PI * 2);
    ctx.stroke();

    const rimX = W * 0.5;
    const rimY = H * 0.22;

    // Support du panier et panneau.
    ctx.strokeStyle = "rgba(184,202,224,0.25)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(rimX + 42, rimY - 28);
    ctx.lineTo(rimX + 62, rimY - 28);
    ctx.lineTo(rimX + 62, rimY + 58);
    ctx.stroke();

    const boardX = rimX - 55;
    const boardY = rimY - 45;
    const boardFill = ctx.createLinearGradient(boardX, boardY, boardX + 110, boardY + 45);
    boardFill.addColorStop(0, "rgba(229,239,251,0.1)");
    boardFill.addColorStop(1, "rgba(229,239,251,0.025)");
    ctx.fillStyle = boardFill;
    ctx.fillRect(boardX, boardY, 110, 45);
    ctx.strokeStyle = "rgba(230,239,250,0.88)";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(boardX, boardY, 110, 45);
    ctx.strokeStyle = "rgba(230,239,250,0.6)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rimX - 19, rimY - 22, 38, 21);

    // Arceau, avec un léger halo orange.
    ctx.save();
    ctx.strokeStyle = "rgba(244,111,42,0.18)";
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.ellipse(rimX, rimY, 35, 8.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#FF8742";
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.ellipse(rimX, rimY, 34, 8, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Filet tressé : il se prolonge sous l'arceau et reste visible pendant le tir.
    ctx.save();
    ctx.strokeStyle = "rgba(236,243,251,0.72)";
    ctx.lineWidth = 1.15;
    const netBottomY = rimY + 35;
    const netTopLeft = rimX - 31;
    const netTopRight = rimX + 31;
    const netBottomLeft = rimX - 18;
    const netBottomRight = rimX + 18;
    for (let i = 0; i <= 6; i++) {
      const ratio = i / 6;
      const x1 = netTopLeft + (netTopRight - netTopLeft) * ratio;
      const x2 = netBottomLeft + (netBottomRight - netBottomLeft) * ratio;
      ctx.beginPath();
      ctx.moveTo(x1, rimY + 4);
      ctx.lineTo(x2, netBottomY);
      ctx.stroke();
    }
    for (let j = 1; j <= 3; j++) {
      const p = j / 4;
      const y = rimY + 4 + (netBottomY - rimY - 4) * p;
      const left = netTopLeft + (netBottomLeft - netTopLeft) * p;
      const right = netTopRight + (netBottomRight - netTopRight) * p;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }
    ctx.restore();

    // La destination dépend toujours du résultat d'origine.
    const start = { x: W * 0.5, y: H * 0.88 };
    const missDxPx = current.missDx === 0 ? 1 : current.missDx;
    let endX = rimX;
    let endY = rimY;

    if (current.outcome === "swish" || current.outcome === "made") {
      endX = rimX + current.missDx * 12;
      endY = rimY + 18;
    } else if (current.outcome === "rimout") {
      endX = rimX + missDxPx * 55;
      endY = rimY - 6;
    } else if (current.power < 0.4) {
      endX = rimX + current.missDx * 40;
      endY = rimY + (start.y - rimY) * 0.45;
    } else {
      endX = rimX + missDxPx * 90;
      endY = rimY - 35;
    }

    const travel = start.y - endY;
    const arcHeight = Math.max(30, travel * (0.3 + current.power * 0.2));
    const ctrl = {
      x: (start.x + endX) / 2,
      y: Math.max(8, Math.min(start.y, endY) - arcHeight),
    };

    const tt = Math.min(1, t);
    const pointAt = (p: number) => ({
      x: (1 - p) * (1 - p) * start.x + 2 * (1 - p) * p * ctrl.x + p * p * endX,
      y: (1 - p) * (1 - p) * start.y + 2 * (1 - p) * p * ctrl.y + p * p * endY,
    });
    const ballPoint = pointAt(tt);

    // Trace lumineux discret derrière la balle, sans modifier sa trajectoire.
    if (tt > 0) {
      ctx.save();
      ctx.beginPath();
      const steps = Math.max(2, Math.floor(tt * 34));
      for (let i = 0; i <= steps; i++) {
        const p = pointAt((i / steps) * tt);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = "rgba(255,151,77,0.48)";
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 6]);
      ctx.stroke();
      ctx.restore();
    }

    // Ombre et ballon avec volume et coutures.
    const radius = 9 + (1 - tt) * 6;
    const shadowScale = 0.85 + tt * 0.25;
    ctx.fillStyle = `rgba(0,0,0,${0.2 + (1 - tt) * 0.16})`;
    ctx.beginPath();
    ctx.ellipse(ballPoint.x + 5, ballPoint.y + radius * 0.95, radius * shadowScale, radius * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(ballPoint.x, ballPoint.y);
    ctx.rotate(tt * 2.4);
    const ballFill = ctx.createRadialGradient(-radius * 0.42, -radius * 0.5, 1, 0, 0, radius * 1.25);
    ballFill.addColorStop(0, "#FFB16B");
    ballFill.addColorStop(0.48, "#F47A2A");
    ballFill.addColorStop(1, "#B93F13");
    ctx.fillStyle = ballFill;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#713014";
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.strokeStyle = "rgba(70,29,12,0.88)";
    ctx.lineWidth = Math.max(1, radius * 0.095);
    ctx.beginPath();
    ctx.moveTo(-radius * 0.92, -radius * 0.04);
    ctx.quadraticCurveTo(0, radius * 0.28, radius * 0.92, radius * 0.04);
    ctx.moveTo(-radius * 0.04, -radius * 0.95);
    ctx.quadraticCurveTo(-radius * 0.45, 0, -radius * 0.04, radius * 0.95);
    ctx.moveTo(radius * 0.04, -radius * 0.95);
    ctx.quadraticCurveTo(radius * 0.45, 0, radius * 0.04, radius * 0.95);
    ctx.stroke();
    ctx.restore();

    if (tt >= 1) {
      const made = isMade(current.outcome);
      const label = outcomeLabel(current.outcome);
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = "900 22px system-ui, sans-serif";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(5,10,20,0.72)";
      ctx.strokeText(label, W / 2, H * 0.55);
      ctx.fillStyle = made ? "#7CF0AE" : current.outcome === "rimout" ? "#FFD08A" : "#FF8E8E";
      ctx.fillText(label, W / 2, H * 0.55);
      ctx.font = "600 10px system-ui, sans-serif";
      ctx.fillStyle = "rgba(233,241,251,0.72)";
      ctx.fillText(made ? "BIEN JOUÉ" : "PROCHAIN TIR", W / 2, H * 0.55 + 21);
      ctx.restore();
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !shot) return;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientWidth * 0.75;

    const duration = 650;
    const startTime = performance.now();
    let raf = 0;

    function frame(now: number) {
      const t = (now - startTime) / duration;
      draw(t, shot as ShotResult);
      if (t < 1) {
        raf = requestAnimationFrame(frame);
      } else {
        onDoneRef.current(shot!.outcome);
      }
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [shot, draw]);

  // Visuel d'attente : l'animation réelle commence au premier tir.
  useEffect(() => {
    if (shot) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientWidth * 0.75;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#101B31");
    bg.addColorStop(1, "#0B1324");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const halo = ctx.createRadialGradient(W / 2, H * 0.22, 0, W / 2, H * 0.22, W * 0.55);
    halo.addColorStop(0, "rgba(255,135,66,0.14)");
    halo.addColorStop(1, "rgba(255,135,66,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);
    const rimX = W / 2;
    const rimY = H * 0.22;
    ctx.strokeStyle = "rgba(230,239,250,0.8)";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(rimX - 55, rimY - 45, 110, 45);
    ctx.strokeStyle = "#FF8742";
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.ellipse(rimX, rimY, 34, 8, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(236,243,251,0.72)";
    ctx.lineWidth = 1.1;
    for (let i = 0; i <= 6; i++) {
      const p = i / 6;
      ctx.beginPath();
      ctx.moveTo(rimX - 30 + p * 60, rimY + 4);
      ctx.lineTo(rimX - 18 + p * 36, rimY + 35);
      ctx.stroke();
    }
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(232,240,250,0.64)";
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.fillText("PRÊT POUR LE LANCER FRANC", W / 2, H * 0.77);
    ctx.fillStyle = "#F47A2A";
    ctx.beginPath();
    ctx.arc(W / 2, H * 0.88, 10, 0, Math.PI * 2);
    ctx.fill();
  }, [shot]);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Animation du lancer franc"
      className="block w-full rounded-2xl"
      style={{ border: "1px solid rgba(142,164,194,0.24)", boxShadow: "0 18px 48px rgba(0,0,0,0.22)" }}
    />
  );
}

// ─── Zone de tir tactile : détection et calculs conservés ─────────────────────
function ShootZone({
  disabled,
  onShoot,
}: {
  disabled: boolean;
  onShoot: (power: number, angleDeg: number, smoothness: number) => void;
}) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const pointsRef = useRef<{ x: number; y: number; t: number }[]>([]);
  const motionSamplesRef = useRef<number[]>([]);
  const motionHandlerRef = useRef<((e: DeviceMotionEvent) => void) | null>(null);
  const [armed, setArmed] = useState(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    pointsRef.current = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    motionSamplesRef.current = [];
    setArmed(true);

    const handler = (ev: DeviceMotionEvent) => {
      const a = ev.acceleration ?? ev.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2);
      motionSamplesRef.current.push(mag);
    };
    motionHandlerRef.current = handler;
    window.addEventListener("devicemotion", handler);

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!armed) return;
    pointsRef.current.push({ x: e.clientX, y: e.clientY, t: performance.now() });
  };

  const finish = () => {
    if (!armed) return;
    setArmed(false);
    if (motionHandlerRef.current) {
      window.removeEventListener("devicemotion", motionHandlerRef.current);
      motionHandlerRef.current = null;
    }

    const zone = zoneRef.current;
    const points = pointsRef.current;
    if (!zone || points.length < 2) return;

    const first = points[0];
    const last = points[points.length - 1];
    const dy = first.y - last.y; // positif = mouvement vers le haut
    const dx = last.x - first.x;
    const durationS = Math.max(0.05, (last.t - first.t) / 1000);
    const zoneHeight = zone.clientHeight || 1;

    const swipeSpeed = dy / zoneHeight / durationS;
    const angleDeg = (Math.atan2(Math.abs(dx), Math.max(1, dy)) * 180) / Math.PI;

    // Régularité du tracé : formule d'origine inchangée.
    let smoothness = 0.6;
    if (points.length >= 3) {
      const speeds: number[] = [];
      for (let i = 1; i < points.length; i++) {
        const seg = points[i];
        const prev = points[i - 1];
        const dt = Math.max(1, seg.t - prev.t);
        const dist = Math.hypot(seg.x - prev.x, seg.y - prev.y);
        speeds.push(dist / dt);
      }
      const mean = speeds.reduce((s, v) => s + v, 0) / speeds.length;
      const variance = speeds.reduce((s, v) => s + (v - mean) ** 2, 0) / speeds.length;
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
      smoothness = Math.max(0, Math.min(1, 1 - cv / 1.5));
    }

    // Fusion accéléromètre : formules d'origine inchangées.
    const motion = motionSamplesRef.current;
    let power = qualityFromValue(swipeSpeed, IDEAL_SWIPE_SPEED, SWIPE_SPEED_TOLERANCE);
    if (motion.length >= 5) {
      const peak = Math.max(...motion);
      const motionPowerQ = qualityFromValue(peak, IDEAL_MOTION_MAG, MOTION_MAG_TOLERANCE);
      power = 0.6 * motionPowerQ + 0.4 * power;

      let jerkSum = 0;
      for (let i = 1; i < motion.length; i++) jerkSum += Math.abs(motion[i] - motion[i - 1]);
      const avgJerk = jerkSum / (motion.length - 1);
      const motionSmoothQ = Math.max(0, Math.min(1, 1 - avgJerk / 8));
      smoothness = 0.5 * motionSmoothQ + 0.5 * smoothness;
    }

    onShoot(power, angleDeg, smoothness);
  };

  useEffect(() => {
    return () => {
      if (motionHandlerRef.current) window.removeEventListener("devicemotion", motionHandlerRef.current);
    };
  }, []);

  return (
    <div
      ref={zoneRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      aria-label="Zone tactile de lancer franc"
      className="relative flex select-none flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl px-5 text-center transition-all duration-200"
      style={{
        height: 184,
        touchAction: "none",
        background: armed
          ? "linear-gradient(145deg,#FF9A4A 0%,#F16C27 52%,#C94718 100%)"
          : disabled
            ? "linear-gradient(145deg,#131F32,#111A2A)"
            : "linear-gradient(145deg,#17253A 0%,#121D30 100%)",
        border: `1px solid ${armed ? "rgba(255,190,133,0.9)" : "rgba(142,164,194,0.24)"}`,
        boxShadow: armed ? "0 0 0 4px rgba(244,124,48,0.13), 0 16px 36px rgba(238,104,34,0.2)" : "0 12px 30px rgba(0,0,0,0.12)",
        opacity: disabled ? 0.56 : 1,
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage: "radial-gradient(circle at center, transparent 0 32px, rgba(255,255,255,0.06) 33px 34px, transparent 35px), linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 100% 28px",
        }}
      />
      <div
        className="relative flex h-14 w-14 items-center justify-center rounded-full"
        style={{
          background: armed ? "rgba(255,255,255,0.18)" : "rgba(244,124,48,0.12)",
          border: `1px solid ${armed ? "rgba(255,255,255,0.34)" : "rgba(244,124,48,0.24)"}`,
        }}
      >
        <span className="text-3xl" aria-hidden="true">{armed ? "🏀" : disabled ? "⏳" : "☝️"}</span>
        {!armed && !disabled && (
          <span
            className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full text-sm font-black"
            style={{ background: "#F47A2A", color: "#101827" }}
          >↑</span>
        )}
      </div>
      <div className="relative space-y-1">
        <p className="text-sm font-bold tracking-wide" style={{ color: "#F6F8FC" }}>
          {armed ? "LÈVE ET RELÂCHE !" : disabled ? "TIR EN COURS…" : "MAINTIENS, PUIS TIRE"}
        </p>
        <p className="text-xs" style={{ color: armed ? "rgba(255,255,255,0.88)" : "#A8B7CC" }}>
          {armed
            ? "Effectue un geste fluide vers le haut"
            : disabled
              ? "Le terrain se prépare pour le prochain tir"
              : "Garde le doigt posé, monte vers le haut et relâche"}
        </p>
      </div>
      {!armed && !disabled && (
        <div className="relative flex items-center gap-1" aria-hidden="true">
          {[0, 1, 2].map((step) => (
            <span
              key={step}
              className="block h-1 rounded-full"
              style={{ width: step === 1 ? 24 : 12, background: step === 1 ? "#F47A2A" : "rgba(244,122,42,0.36)" }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Jeu solo ────────────────────────────────────────────────────────────────
function LancerFrancGame() {
  const [sensorStatus, setSensorStatus] = useState<"unknown" | "granted" | "denied" | "unsupported">("unknown");
  const [shot, setShot] = useState<ShotResult | null>(null);
  const [animating, setAnimating] = useState(false);
  const [stats, setStats] = useState({ attempts: 0, makes: 0, streak: 0, best: 0 });
  const shotIdRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.DeviceMotionEvent === "undefined") {
      setSensorStatus("unsupported");
    }
  }, []);

  const enableSensors = async () => {
    const ok = await requestMotionPermission();
    setSensorStatus(ok ? "granted" : "denied");
  };

  const handleShoot = (power: number, angleDeg: number, smoothness: number) => {
    if (animating) return;
    const angleQ = qualityFromValue(angleDeg, IDEAL_ANGLE_DEG, ANGLE_TOLERANCE_DEG);
    const jitter = (Math.random() - 0.5) * 0.12;
    const quality = Math.max(0, Math.min(1, 0.45 * power + 0.3 * angleQ + 0.25 * smoothness + jitter));
    const outcome = resolveOutcome(quality);
    const missDx = outcome === "miss" || outcome === "rimout" ? (Math.random() * 2 - 1) * (1 - quality) * 1.4 : 0;

    shotIdRef.current += 1;
    setShot({ id: shotIdRef.current, quality, outcome, missDx, power });
    setAnimating(true);
  };

  const handleAnimationDone = (outcome: Outcome) => {
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
    setAnimating(false);
  };

  const pct = stats.attempts > 0 ? Math.round((stats.makes / stats.attempts) * 100) : 0;

  return (
    <div className="min-h-screen w-full" style={{ background: "linear-gradient(180deg,#0B1120 0%,#0E1728 100%)" }}>
      <main
        className="mx-auto w-full max-w-md space-y-4 px-4 py-5 sm:py-7"
        style={{ color: "var(--text-main, #F3F6FC)" }}
      >
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl"
            style={{ background: "linear-gradient(145deg,#FF9A4A,#E45D1D)", boxShadow: "0 8px 22px rgba(228,93,29,0.22)" }}
          >
            🏀
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.24em]" style={{ color: "#F47A2A" }}>
              Entraînement
            </p>
            <h1 className="truncate text-xl font-black tracking-tight" style={{ color: "var(--text-main, #F3F6FC)" }}>
              Lancer franc
            </h1>
          </div>
        </div>
        <div
          className="shrink-0 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest"
          style={{ background: "rgba(244,122,42,0.11)", border: "1px solid rgba(244,122,42,0.25)", color: "#FFAA70" }}
        >
          Mode solo
        </div>
      </header>

      <div className="flex items-center justify-between px-1">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-main, #F3F6FC)" }}>
            À toi de jouer
          </p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted, #91A0B7)" }}>
            Trouve ton geste, enchaîne les paniers.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: animating ? "#FFAA70" : "#7BDCA3" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: animating ? "#FFAA70" : "#7BDCA3" }} />
          {animating ? "Tir en cours" : "Prêt"}
        </div>
      </div>

      {sensorStatus !== "granted" && sensorStatus !== "unsupported" && (
        <button
          onClick={enableSensors}
          className="flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors"
          style={{ background: "rgba(26,42,63,0.78)", border: "1px solid rgba(142,164,194,0.22)", color: "#E7EDF6" }}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg" style={{ background: "rgba(244,122,42,0.12)" }}>
            📱
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold">Activer les capteurs</span>
            <span className="mt-0.5 block text-[11px]" style={{ color: "#9EADC2" }}>Un mouvement plus réaliste sur téléphone</span>
          </span>
          <span aria-hidden="true" className="text-lg" style={{ color: "#F47A2A" }}>›</span>
        </button>
      )}
      {sensorStatus === "denied" && (
        <p className="rounded-lg px-3 py-2 text-xs" style={{ color: "#BAC5D5", background: "rgba(142,164,194,0.08)" }}>
          Capteurs refusés : tu peux continuer à jouer avec le geste tactile.
        </p>
      )}
      {sensorStatus === "granted" && (
        <p className="text-[11px]" style={{ color: "#7BDCA3" }}>✓ Capteurs de mouvement activés</p>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "#94A6BF" }}>Le panier</p>
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#637791" }}>Vue de tir</p>
        </div>
        <div className="rounded-[20px] p-1.5" style={{ background: "linear-gradient(145deg,rgba(255,255,255,0.055),rgba(255,255,255,0.015))", border: "1px solid rgba(142,164,194,0.18)" }}>
          <ShotCanvas shot={shot} onDone={handleAnimationDone} />
        </div>
      </section>

      <section className="grid grid-cols-4 gap-2" aria-label="Statistiques de la partie">
        <Stat label="Tirs" value={stats.attempts} icon="🎯" />
        <Stat label="Réussite" value={`${pct}%`} icon="📈" />
        <Stat label="Série" value={stats.streak} icon="🔥" />
        <Stat label="Record" value={stats.best} icon="🏆" />
      </section>

      {shot && !animating && (
        <section
          className="rounded-2xl p-3.5"
          style={{
            background: isMade(shot.outcome) ? "rgba(49,164,105,0.09)" : "rgba(244,122,42,0.07)",
            border: `1px solid ${isMade(shot.outcome) ? "rgba(91,220,151,0.22)" : "rgba(244,122,42,0.2)"}`,
          }}
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-extrabold" style={{ color: isMade(shot.outcome) ? "#7BDCA3" : "#FFAA70" }}>
                {outcomeLabel(shot.outcome)}
              </p>
              <p className="mt-1 text-xs" style={{ color: "#AAB8CC" }}>{outcomeHint(shot.outcome)}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-lg font-black tabular-nums" style={{ color: "#F3F6FC" }}>{Math.round(shot.quality * 100)}%</p>
              <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "#91A0B7" }}>Qualité du geste</p>
            </div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(142,164,194,0.16)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.round(shot.quality * 100)}%`, background: isMade(shot.outcome) ? "#5BDC97" : "linear-gradient(90deg,#E45D1D,#FFAA70)" }}
            />
          </div>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "#94A6BF" }}>À toi de tirer</p>
          <p className="text-[10px]" style={{ color: "#637791" }}>Maintenir · Monter · Relâcher</p>
        </div>
        <ShootZone disabled={animating} onShoot={handleShoot} />
      </section>

      <p className="pb-1 text-center text-[10px]" style={{ color: "#62738B" }}>
        Astuce : privilégie un mouvement vertical et régulier.
      </p>
      </main>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div
      className="min-w-0 rounded-xl px-1.5 py-3 text-center"
      style={{ background: "linear-gradient(145deg,rgba(25,40,61,0.95),rgba(17,28,44,0.95))", border: "1px solid rgba(142,164,194,0.17)" }}
    >
      <p className="mb-1 text-[10px]" aria-hidden="true">{icon}</p>
      <p className="text-xl font-black leading-none tracking-tight tabular-nums" style={{ color: "#FF9A4A" }}>
        {value}
      </p>
      <p className="mt-1.5 truncate text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: "#94A6BF" }}>
        {label}
      </p>
    </div>
  );
}

export default function LancerFranc() {
  return <LancerFrancGame />;
}
