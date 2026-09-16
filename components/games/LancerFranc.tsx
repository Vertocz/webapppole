"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import RoomConnect, { RoomContext } from "./RoomConnect";
import type { NetMessage } from "@/lib/p2pRoom";

// ─── Réglages du geste (à recalibrer après tests sur téléphone réel) ──────────
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

// ─── Permission capteurs (obligatoire sur iOS, no-op ailleurs) ────────────────
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
  // La ref évite de remettre l'effet d'animation en dépendance de onDone,
  // qui change d'identité à chaque rendu du parent (setState des stats) —
  // sans ça, l'animation du même tir se relançait indéfiniment en boucle.
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

    // Point d'arrivée : différent selon le résultat, pour donner une vraie
    // sensation de profondeur (dans le filet / trop court / trop long).
    const start = { x: W * 0.5, y: H * 0.88 };
    const missDxPx = current.missDx === 0 ? 1 : current.missDx;
    let endX = rimX;
    let endY = rimY;

    if (current.outcome === "swish" || current.outcome === "made") {
      endX = rimX + current.missDx * 12;
      endY = rimY + 18; // la balle descend sous l'arceau, dans le filet
    } else if (current.outcome === "rimout") {
      endX = rimX + missDxPx * 55;
      endY = rimY - 6; // touche l'arceau, ne rentre pas
    } else if (current.power < 0.4) {
      endX = rimX + current.missDx * 40;
      endY = rimY + (start.y - rimY) * 0.45; // trop court : retombe avant
    } else {
      endX = rimX + missDxPx * 90;
      endY = rimY - 35; // trop fort : passe au-dessus / à côté
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

// ─── Zone de tir tactile (+ capteurs si dispo) ─────────────────────────────────
function ShootZone({ disabled, onShoot }: { disabled: boolean; onShoot: (power: number, angleDeg: number, smoothness: number) => void }) {
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

    const swipeSpeed = dy / zoneHeight / durationS; // hauteurs de zone / seconde
    const angleDeg = (Math.atan2(Math.abs(dx), Math.max(1, dy)) * 180) / Math.PI;

    // Régularité du tracé (plus les segments sont réguliers, plus la note est haute)
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

    // Fusion avec les données accéléromètre si dispo et significatives
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
      className="rounded-2xl flex flex-col items-center justify-center gap-2 transition-all select-none"
      style={{
        height: 200,
        touchAction: "none",
        background: armed
          ? "linear-gradient(135deg,var(--accent),var(--accent2))"
          : disabled
          ? "var(--bg-input)"
          : "var(--bg-card)",
        border: `1px solid ${armed ? "transparent" : "var(--border)"}`,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span className="text-4xl">{armed ? "🏀" : "🖐️"}</span>
      <p className="text-sm font-medium text-center px-6" style={{ color: armed ? "white" : "var(--text-main)" }}>
        {armed ? "Fais ton geste de tir, relâche en haut !" : "Maintiens, lève le téléphone, tire vers le haut"}
      </p>
    </div>
  );
}

// ─── Composant de jeu ─────────────────────────────────────────────────────────
function LancerFrancGame({ ctx }: { ctx: RoomContext }) {
  const solo = ctx.role === "solo";
  const isHost = ctx.role === "host" || solo;

  const [sensorStatus, setSensorStatus] = useState<"unknown" | "granted" | "denied" | "unsupported">("unknown");
  const [shot, setShot] = useState<ShotResult | null>(null);
  const [animating, setAnimating] = useState(false);
  const [stats, setStats] = useState({ attempts: 0, makes: 0, streak: 0, best: 0 });
  const [tally, setTally] = useState<Record<string, { attempts: number; makes: number }>>({});
  const shotIdRef = useRef(0);
  const tallyRef = useRef(tally);
  tallyRef.current = tally;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.DeviceMotionEvent === "undefined") {
      setSensorStatus("unsupported");
    }
  }, []);

  const enableSensors = async () => {
    const ok = await requestMotionPermission();
    setSensorStatus(ok ? "granted" : "denied");
  };

  const recordShot = useCallback((playerId: string, made: boolean) => {
    setTally((prev) => {
      const entry = prev[playerId] ?? { attempts: 0, makes: 0 };
      const next = { ...prev, [playerId]: { attempts: entry.attempts + 1, makes: entry.makes + (made ? 1 : 0) } };
      if (isHost) ctx.broadcast({ type: "state", payload: next });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost]);

  useEffect(() => {
    ctx.onMessage((msg: NetMessage, from?: string) => {
      if (msg.type === "state" && !isHost) {
        setTally(msg.payload as Record<string, { attempts: number; makes: number }>);
      }
      if (msg.type === "move" && isHost && from) {
        const made = (msg.payload as { made: boolean }).made;
        recordShot(from, made);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, recordShot]);

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

    if (!solo) {
      if (isHost) recordShot(ctx.myId, made);
      else ctx.send({ type: "move", payload: { made }, from: ctx.myId });
    }

    setAnimating(false);
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
          📱 Activer les capteurs de mouvement (plus réaliste)
        </button>
      )}
      {sensorStatus === "denied" && (
        <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
          Capteurs refusés — tu peux quand même jouer, uniquement au geste tactile.
        </p>
      )}

      <ShotCanvas shot={shot} onDone={handleAnimationDone} />

      <div className="flex justify-center gap-4 text-sm">
        <Stat label="Tirs" value={stats.attempts} />
        <Stat label="Réussite" value={`${pct}%`} />
        <Stat label="Série" value={stats.streak} />
        <Stat label="Record" value={stats.best} />
      </div>

      <ShootZone disabled={animating} onShoot={handleShoot} />

      {!solo && (
        <div className="rounded-xl p-3 space-y-1.5" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-sub)" }}>
            Classement de la session
          </p>
          {ctx.players
            .map((p) => ({ p, t: tally[p.id] ?? { attempts: 0, makes: 0 } }))
            .sort((a, b) => b.t.makes - a.t.makes)
            .map(({ p, t }) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <span style={{ color: "var(--text-main)" }}>{p.name}</span>
                <span style={{ color: "var(--text-muted)" }}>
                  {t.makes}/{t.attempts}
                </span>
              </div>
            ))}
        </div>
      )}
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

export default function LancerFranc() {
  return (
    <RoomConnect gameName="Lancer franc" minPlayers={1}>
      {(ctx) => <LancerFrancGame ctx={ctx} />}
    </RoomConnect>
  );
}
