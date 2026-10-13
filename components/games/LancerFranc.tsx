"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─── Réglages du geste ────────────────────────────────────────────────────────
const IDEAL_MOTION_MAG = 16;
const MOTION_MAG_TOLERANCE = 12;
const OUTCOME_THRESHOLDS = { swish: 0.8, made: 0.5, rimout: 0.28 };

type Outcome = "swish" | "made" | "rimout" | "miss";
type GameState = "ready" | "animating" | "result";

interface ShotResult {
  id: number;
  quality: number;
  outcome: Outcome;
  missDx: number;
  power: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  life: number;
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

// ─── Rendu Canvas ultra-polis (Panneau, Panier, Filet dynamique, Particules) ─
function ShotCanvas({ shot, onDone }: { shot: ShotResult | null; onDone: (o: Outcome) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const draw = useCallback((t: number, current: ShotResult) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 1. Ambiance Playground Nuit (Dégradé urbain)
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, "#060913");
    bgGrad.addColorStop(0.5, "#0F172A");
    bgGrad.addColorStop(1, "#1E1B4B");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Lignes de terrain au sol (perspective subtile)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(W * 0.5, H * 0.95, W * 0.4, Math.PI, 0, false);
    ctx.stroke();

    // 2. Panneau de basket (verre / plexi stylisé)
    const rimX = W * 0.5;
    const rimY = H * 0.22;
    
    // Structure du panneau
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.fillRect(rimX - 65, rimY - 55, 130, 55);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 3;
    ctx.strokeRect(rimX - 65, rimY - 55, 130, 55);
    
    // Carré de mire sur le panneau
    ctx.strokeStyle = "#F97316";
    ctx.lineWidth = 2;
    ctx.strokeRect(rimX - 25, rimY - 45, 50, 35);

    // Fixation de l'arceau
    ctx.fillStyle = "#475569";
    ctx.fillRect(rimX - 8, rimY - 8, 16, 10);

    // 3. Calcul de la trajectoire de la balle
    const start = { x: W * 0.5, y: H * 0.9 };
    const missDxPx = current.missDx === 0 ? 1 : current.missDx;
    let endX = rimX;
    let endY = rimY;

    if (current.outcome === "swish" || current.outcome === "made") {
      endX = rimX + current.missDx * 10;
      endY = rimY + 28; // Pénètre dans le filet
    } else if (current.outcome === "rimout") {
      endX = rimX + missDxPx * 50;
      endY = rimY - 4;
    } else if (current.power < 0.4) {
      endX = rimX + current.missDx * 35;
      endY = rimY + (start.y - rimY) * 0.4;
    } else {
      endX = rimX + missDxPx * 85;
      endY = rimY - 30;
    }

    const travel = start.y - endY;
    const arcHeight = Math.max(35, travel * (0.32 + current.power * 0.18));
    const ctrl = { x: (start.x + endX) / 2, y: Math.max(10, Math.min(start.y, endY) - arcHeight) };

    const tt = Math.min(1, t);
    // Effet de profondeur : la balle est plus grosse au départ qu'à l'arrivée
    const scale = 1 - tt * 0.25; 
    const bx = (1 - tt) * (1 - tt) * start.x + 2 * (1 - tt) * tt * ctrl.x + tt * tt * endX;
    const by = (1 - tt) * (1 - tt) * start.y + 2 * (1 - tt) * tt * ctrl.y + tt * tt * endY;

    // 4. Dessin du filet dynamique (sous l'arceau arrière)
    const netTopY = rimY;
    const netBotY = rimY + 35;
    const netWidth = 32;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = 1.5;

    // Déformation du filet si la balle traverse l'arceau
    let netDeform = 0;
    if (tt > 0.65 && tt <= 1 && (current.outcome === "swish" || current.outcome === "made")) {
      netDeform = Math.sin((tt - 0.65) * Math.PI * 4) * 12;
    }

    for (let i = -3; i <= 3; i++) {
      const xTop = rimX + (i / 3) * netWidth;
      const xBot = rimX + (i / 3) * (netWidth * 0.7) + netDeform;
      ctx.beginPath();
      ctx.moveTo(xTop, netTopY);
      ctx.lineTo(xBot, netBotY);
      ctx.stroke();
    }
    // Mailles horizontales du filet
    for (let h = 10; h <= 30; h += 10) {
      ctx.beginPath();
      ctx.arc(rimX + netDeform * (h / 30), netTopY + h, netWidth * (1 - h/45), 0, Math.PI);
      ctx.stroke();
    }

    // 5. Dessin de l'arceau (partie avant, par-dessus la balle si elle passe derrière, ou dessous)
    ctx.strokeStyle = "#EA580C";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(rimX, rimY, 34, 9, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 6. Dessin du Ballon de basket texturé
    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(scale, scale);

    // Corps du ballon (Dégradé orange)
    const ballGrad = ctx.createRadialGradient(-3, -3, 2, 0, 0, 16);
    ballGrad.addColorStop(0, "#FB923C");
    ballGrad.addColorStop(0.7, "#EA580C");
    ballGrad.addColorStop(1, "#9A3412");
    ctx.fillStyle = ballGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fill();

    // Lignes / coutures noires du ballon
    ctx.strokeStyle = "#1C1917";
    ctx.lineWidth = 1.2;
    // Ligne centrale verticale
    ctx.beginPath();
    ctx.arc(0, 0, 15, -Math.PI*0.4, Math.PI*0.4);
    ctx.stroke();
    // Ligne centrale horizontale
    ctx.beginPath();
    ctx.arc(0, 0, 15, Math.PI*0.1, Math.PI*0.9);
    ctx.stroke();
    // Lignes courbes caractéristiques
    ctx.beginPath();
    ctx.moveTo(-12, -8);
    ctx.quadraticCurveTo(0, -2, 12, -8);
    ctx.moveTo(-12, 8);
    ctx.quadraticCurveTo(0, 2, 12, 8);
    ctx.stroke();

    ctx.restore();

    // 7. Particules lumineuses en cas de SWISH / PANIER parfait au moment de l'impact
    if (tt >= 0.95 && (current.outcome === "swish" || current.outcome === "made")) {
      ctx.fillStyle = "#38BDF8";
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const dist = 15 + (t * 10);
        ctx.beginPath();
        ctx.arc(rimX + Math.cos(angle) * dist, rimY + Math.sin(angle) * dist, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 8. Affichage du résultat final à la fin de l'animation
    if (tt >= 1) {
      const missed = current.outcome === "miss" || current.outcome === "rimout";
      
      // Bandeau semi-transparent stylisé
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      ctx.fillRect(W * 0.2, H * 0.48, W * 0.6, 50);
      ctx.strokeStyle = missed ? "rgba(248, 113, 113, 0.4)" : "rgba(74, 222, 128, 0.4)";
      ctx.lineWidth = 2;
      ctx.strokeRect(W * 0.2, H * 0.48, W * 0.6, 50);

      ctx.fillStyle = missed ? "#F87171" : "#4ADE80";
      ctx.font = "bold 20px system-ui, sans-serif";
      ctx.textAlign = "center";
      const label =
        current.outcome === "swish" ? "SWISH ! 🎯" : current.outcome === "made" ? "PANIER ! 🏀" : current.outcome === "rimout" ? "SUR LE CERCLE…" : "RATÉ…";
      ctx.fillText(label, W / 2, H * 0.55);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !shot) return;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientWidth * 0.8;

    const duration = 700;
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

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-2xl block shadow-2xl"
      style={{ border: "1px solid rgba(255, 255, 255, 0.1)" }}
    />
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function LancerFranc() {
  const [sensorStatus, setSensorStatus] = useState<"unknown" | "granted" | "denied" | "unsupported">("unknown");
  const [gameState, setGameState] = useState<GameState>("ready");
  const [shot, setShot] = useState<ShotResult | null>(null);
  const [stats, setStats] = useState({ attempts: 0, makes: 0, streak: 0, best: 0 });
  
  const shotIdRef = useRef(0);
  const motionBufferRef = useRef<number[]>([]);
  const verticalHoldTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.DeviceMotionEvent === "undefined") {
      setSensorStatus("unsupported");
    }
  }, []);

  const enableSensors = async () => {
    const ok = await requestMotionPermission();
    setSensorStatus(ok ? "granted" : "denied");
  };

  useEffect(() => {
    if (sensorStatus !== "granted") return;

    const handleMotion = (e: DeviceMotionEvent) => {
      const a = e.acceleration ?? e.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2);

      if (gameState === "ready") {
        motionBufferRef.current.push(mag);
        if (motionBufferRef.current.length > 10) motionBufferRef.current.shift();

        const peak = Math.max(...motionBufferRef.current);
        if (peak > 13) {
          const power = qualityFromValue(peak, IDEAL_MOTION_MAG, MOTION_MAG_TOLERANCE);
          const quality = Math.max(0, Math.min(1, 0.6 * power + 0.4 * (Math.random() * 0.4 + 0.6)));
          const outcome = resolveOutcome(quality);
          const missDx = outcome === "miss" || outcome === "rimout" ? (Math.random() * 2 - 1) * (1 - quality) * 1.4 : 0;

          shotIdRef.current += 1;
          setShot({ id: shotIdRef.current, quality, outcome, missDx, power });
          setGameState("animating");
          motionBufferRef.current = [];
        }
      } else if (gameState === "result") {
        const isStable = mag < 3.5;
        if (isStable) {
          if (!verticalHoldTimerRef.current) {
            verticalHoldTimerRef.current = window.setTimeout(() => {
              setGameState("ready");
              verticalHoldTimerRef.current = null;
            }, 350);
          }
        } else {
          if (verticalHoldTimerRef.current) {
            clearTimeout(verticalHoldTimerRef.current);
            verticalHoldTimerRef.current = null;
          }
        }
      }
    };

    window.addEventListener("devicemotion", handleMotion);
    return () => {
      window.removeEventListener("devicemotion", handleMotion);
      if (verticalHoldTimerRef.current) clearTimeout(verticalHoldTimerRef.current);
    };
  }, [sensorStatus, gameState]);

  const handleAnimationDone = (outcome: Outcome) => {
    const made = outcome === "swish" || outcome === "made";
    setStats((prev) => {
      const streak = made ? prev.streak + 1 : 0;
      return {
        attempts: prev.attempts + 1,
        makes: prev.makes + (made ? 1 : 0),
        streak,
        best: Math.max(prev.best, streak),
      };
    });
    setGameState("result");
  };

  const pct = stats.attempts > 0 ? Math.round((stats.makes / stats.attempts) * 100) : 0;

  return (
    <div className="space-y-4 max-w-md mx-auto p-4 font-sans text-white">
      {sensorStatus !== "granted" && sensorStatus !== "unsupported" && (
        <button
          onClick={enableSensors}
          className="w-full py-3 rounded-2xl text-sm font-semibold bg-gradient-to-r from-orange-600 to-amber-600 shadow-lg active:scale-95 transition-all"
        >
          📱 Activer les capteurs de mouvement
        </button>
      )}
      {sensorStatus === "denied" && (
        <p className="text-xs text-center text-red-400">
          Accès aux capteurs refusé dans les paramètres du navigateur.
        </p>
      )}

      <ShotCanvas shot={shot} onDone={handleAnimationDone} />

      {/* Tableau des scores stylisé */}
      <div className="grid grid-cols-4 gap-2 bg-slate-900/80 p-3 rounded-2xl border border-slate-800">
        <Stat label="Tirs" value={stats.attempts} />
        <Stat label="Réussite" value={`${pct}%`} />
        <Stat label="Série" value={stats.streak} />
        <Stat label="Record" value={stats.best} />
      </div>

      {/* Indicateur d'état épuré */}
      <div className="rounded-2xl p-4 text-center bg-slate-900/50 border border-slate-800 flex flex-col items-center gap-1">
        <span className="text-3xl">
          {gameState === "ready" ? "🏀" : gameState === "animating" ? "🚀" : "📱"}
        </span>
        <p className="text-xs font-medium text-slate-300">
          {gameState === "ready" && "Téléphone prêt — Fais un mouvement sec vers le haut !"}
          {gameState === "animating" && "Trajectoire en cours..."}
          {gameState === "result" && "Mets ton téléphone à la verticale pour enchaîner"}
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <p className="text-xl font-bold text-orange-500">
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wider text-slate-400 mt-0.5">
        {label}
      </p>
    </div>
  );
}