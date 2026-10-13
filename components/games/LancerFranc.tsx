"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─── Réglages du geste (à recalibrer sur téléphone réel) ─────────────────────
const IDEAL_MOTION_MAG = 16; // m/s² d'accélération linéaire au pic pour un tir parfait
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

function qualityFromValue(value: number, ideal: number, tolerance: number): number {
  return Math.max(0, Math.min(1, 1 - Math.abs(value - ideal) / tolerance));
}

function resolveOutcome(quality: number): Outcome {
  if (quality >= OUTCOME_THRESHOLDS.swish) return "swish";
  if (quality >= OUTCOME_THRESHOLDS.made) return "made";
  if (quality >= OUTCOME_THRESHOLDS.rimout) return "rimout";
  return "miss";
}

// ─── Permission capteurs (iOS + Android) ──────────────────────────────────────
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

// ─── Rendu Canvas du tir ──────────────────────────────────────────────────────
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

    ctx.fillStyle = "#0B1120";
    ctx.fillRect(0, 0, W, H);

    // Panneau + arceau
    const rimX = W * 0.5;
    const rimY = H * 0.22;
    ctx.strokeStyle = "#E8EEF8";
    ctx.lineWidth = 4;
    ctx.strokeRect(rimX - 55, rimY - 45, 110, 45);
    ctx.strokeStyle = "#E8641C";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(rimX, rimY, 34, 8, 0, 0, Math.PI * 2);
    ctx.stroke();

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
    const ctrl = { x: (start.x + endX) / 2, y: Math.max(8, Math.min(start.y, endY) - arcHeight) };

    const tt = Math.min(1, t);
    const bx = (1 - tt) * (1 - tt) * start.x + 2 * (1 - tt) * tt * ctrl.x + tt * tt * endX;
    const by = (1 - tt) * (1 - tt) * start.y + 2 * (1 - tt) * tt * ctrl.y + tt * tt * endY;

    ctx.fillStyle = "#E8641C";
    ctx.beginPath();
    ctx.arc(bx, by, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (tt >= 1) {
      const missed = current.outcome === "miss" || current.outcome === "rimout";
      ctx.fillStyle = missed ? "#f87171" : "#4ade80";
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      const label =
        current.outcome === "swish" ? "SWISH ! 🎯" : current.outcome === "made" ? "PANIER ! 🏀" : current.outcome === "rimout" ? "AU CERCLE…" : "RATÉ";
      ctx.fillText(label, W / 2, H * 0.55);
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

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-2xl block"
      style={{ border: "1px solid var(--border)" }}
    />
  );
}

// ─── Composant principal de jeu ───────────────────────────────────────────────
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

  // Gestionnaire unique des mouvements et de l'orientation
  useEffect(() => {
    if (sensorStatus !== "granted") return;

    const handleMotion = (e: DeviceMotionEvent) => {
      const a = e.acceleration ?? e.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2);

      if (gameState === "ready") {
        // Détection d'un pic de mouvement vers le haut pour déclencher le tir
        motionBufferRef.current.push(mag);
        if (motionBufferRef.current.length > 10) motionBufferRef.current.shift();

        const peak = Math.max(...motionBufferRef.current);
        if (peak > 13) {
          // Déclenchement du tir
          const power = qualityFromValue(peak, IDEAL_MOTION_MAG, MOTION_MAG_TOLERANCE);
          const smoothness = 0.8; // Valeur par défaut propre au mouvement pur
          const angleDeg = 0;

          const angleQ = qualityFromValue(angleDeg, 0, 60);
          const jitter = (Math.random() - 0.5) * 0.12;
          const quality = Math.max(0, Math.min(1, 0.5 * power + 0.3 * angleQ + 0.2 * smoothness + jitter));
          const outcome = resolveOutcome(quality);
          const missDx = outcome === "miss" || outcome === "rimout" ? (Math.random() * 2 - 1) * (1 - quality) * 1.4 : 0;

          shotIdRef.current += 1;
          setShot({ id: shotIdRef.current, quality, outcome, missDx, power });
          setGameState("animating");
          motionBufferRef.current = [];
        }
      } else if (gameState === "result") {
        // En phase de résultat, on vérifie si le téléphone est maintenu vertical / stable
        // pour réarmer automatiquement le jeu
        const isStable = mag < 3.5; // Peu de mouvement brusque
        
        if (isStable) {
          if (!verticalHoldTimerRef.current) {
            verticalHoldTimerRef.current = window.setTimeout(() => {
              setGameState("ready");
              verticalHoldTimerRef.current = null;
            }, 350); // 350 ms immobile à la verticale pour valider le reset
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
    <div className="space-y-4">
      {sensorStatus !== "granted" && sensorStatus !== "unsupported" && (
        <button
          onClick={enableSensors}
          className="w-full py-2.5 rounded-xl text-sm font-medium"
          style={{ border: "1px solid var(--border)", color: "var(--text-main)" }}
        >
          📱 Activer les capteurs de mouvement pour jouer
        </button>
      )}
      {sensorStatus === "denied" && (
        <p className="text-xs text-center text-red-400">
          Accès aux capteurs refusé. Autorise les mouvements dans ton navigateur.
        </p>
      )}

      <ShotCanvas shot={shot} onDone={handleAnimationDone} />

      <div className="flex justify-center gap-4 text-sm">
        <Stat label="Tirs" value={stats.attempts} />
        <Stat label="Réussite" value={`${pct}%`} />
        <Stat label="Série" value={stats.streak} />
        <Stat label="Record" value={stats.best} />
      </div>

      {/* Indicateur visuel d'état (sans interaction tactile requise) */}
      <div
        className="rounded-2xl p-4 flex flex-col items-center justify-center gap-2 transition-all select-none text-center"
        style={{
          border: "1px solid var(--border)",
          background: "var(--bg-card)",
        }}
      >
        <span className="text-3xl">
          {gameState === "ready" ? "🏀" : gameState === "animating" ? "🚀" : "📱"}
        </span>
        <p className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
          {gameState === "ready" && "Téléphone prêt — Fais un mouvement sec vers le haut pour tirer !"}
          {gameState === "animating" && "Trajectoire en cours..."}
          {gameState === "result" && "Mets ton téléphone à la verticale pour retenter un tir"}
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <p className="font-display text-xl leading-none" style={{ color: "var(--accent)" }}>
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-widest mt-1" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
    </div>
  );
}