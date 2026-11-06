"use client";

import "@fontsource/inconsolata/700.css";
import "@fontsource/inconsolata/900.css";
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
import {
  MotionTracker,
  analyzeGesture,
  isHeldStill,
  tiltFromVertical,
  upAccel,
  type Sample,
} from "@/lib/lancerFranc/gesture";
import { GESTURE_WINDOW_MS, TRIGGER_UP, VERTICAL_HOLD_MS } from "@/lib/lancerFranc/settings";
import { decideShot, evaluate, isMade, type Evaluation, type Outcome, type ShotResult } from "@/lib/lancerFranc/shot";
import { C, type SceneEvent } from "@/lib/lancerFranc/scene";
import { FONT, assetsChanged } from "@/lib/lancerFranc/assets";
import { loadSponsors } from "@/lib/lancerFranc/sponsors";
import { playEvent, unlockAudio, vibrate } from "@/lib/lancerFranc/feedback";
import { ShotScene } from "./lancerFranc/ShotScene";
import { ShotFeedback } from "./lancerFranc/ShotFeedback";

// ═════════════════════════════════════════════════════════════════════════════
//  Swish 3x3 (ancien « lancer franc »).
//  Le moteur (mesure du geste, décision du tir, scène 3D) est dans lib/lancerFranc/ ;
//  tous les réglages d'équilibrage sont dans lib/lancerFranc/settings.ts.
// ═════════════════════════════════════════════════════════════════════════════

export { ShotScene, isMade };
export type { Outcome, ShotResult };

type SensorStatus = "checking" | "needs-permission" | "granted" | "denied" | "unsupported";
type GamePhase = "waiting-vertical" | "ready" | "measuring" | "animating" | "waiting-reset";

interface Stats {
  attempts: number;
  makes: number;
  streak: number;
  best: number;
}

/** Un peu d'historique avant le déclenchement, pour ne pas rater le début de la poussée. */
const PREROLL_MS = 250;

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
    const onFirstTouch = () => {
      unlockAudio(); // le son aussi n'est autorisé qu'après un toucher
      void acquire();
    };

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
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
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

  // Le dessin du terrain utilise la police et les logos des sponsors : on le refait dès qu'ils sont prêts.
  useEffect(() => {
    unlockAudio();
    void loadSponsors();
    void Promise.all([document.fonts.load(`900 40px Inconsolata`), document.fonts.load(`700 20px Inconsolata`)])
      .then(assetsChanged)
      .catch(() => undefined);
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
    // On ne remet le ballon en place qu'au DÉBUT d'un duel : à la fin, le dernier tir
    // (souvent le panier gagnant) doit finir son animation.
    if (!duelRef.current || !duelEnabled) return;
    setShot(null);
    setShowFeedback(false);
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
    unlockAudio();
    const ok = await requestMotionPermission();
    if (ok) {
      changePhase("waiting-vertical");
      setSensorStatus("granted");
    } else {
      setSensorStatus("denied");
    }
  }, [changePhase]);

  const handleShoot = useCallback((next: ShotResult, e: Evaluation) => {
    if (phaseRef.current !== "measuring") return;
    if (duelRef.current && !duelRef.current.enabled) return;
    shotDuelKeyRef.current = duelRef.current?.duelKey ?? 0;
    duelRef.current?.onShotFired?.(next, shotDuelKeyRef.current);
    setEvaluation(e);
    changePhase("animating");
    setShot(next);
  }, [changePhase]);
  const handleShootRef = useRef(handleShoot);
  handleShootRef.current = handleShoot;

  // Le résultat compte dès que le ballon est dans le filet (ou a raté), sans attendre la fin du rebond.
  const handleResult = useCallback((outcome: Outcome) => {
    if (phaseRef.current !== "animating") return;
    const made = isMade(outcome);
    vibrate(made ? "success" : "error");
    // Pas besoin d'attendre la fin des rebonds pour retirer.
    setTimeout(() => {
      if (phaseRef.current === "animating") changePhase("waiting-reset");
    }, 700);
    if (duelRef.current) {
      duelRef.current.onShot(made, shotDuelKeyRef.current);
      return;
    }
    setShowFeedback(true);
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
  }, [changePhase]);

  const handleAnimationDone = useCallback(() => {
    if (phaseRef.current !== "animating") return;
    changePhase("waiting-reset");
  }, [changePhase]);

  const handleSceneEvent = useCallback((e: SceneEvent) => playEvent(e.type, e.strength), []);

  // ─── Lecture des capteurs ───────────────────────────────────────────────────
  useEffect(() => {
    if (sensorStatus !== "granted") return;

    const tracker = new MotionTracker();
    const history: Sample[] = [];
    let gesture: Sample[] = [];
    let gestureStart = 0;
    let stillSince: number | null = null;

    const onMotion = (ev: DeviceMotionEvent) => {
      const now = performance.now();
      if (duelRef.current && !duelRef.current.enabled) {
        stillSince = null;
        return;
      }
      const s = tracker.push(now, ev.acceleration, ev.accelerationIncludingGravity, ev.rotationRate);
      if (!s) return;
      history.push(s);
      while (history.length && now - history[0].t > PREROLL_MS) history.shift();

      const p = phaseRef.current;
      // Départ et réarmement : téléphone droit et immobile quelques dixièmes de seconde.
      if (p === "waiting-vertical" || p === "waiting-reset") {
        if (isHeldStill(s)) {
          stillSince ??= now;
          if (now - stillSince >= VERTICAL_HOLD_MS) {
            stillSince = null;
            setShot(null); // un nouveau ballon arrive en main, le résultat disparaît
            setShowFeedback(false);
            changePhase("ready");
            vibrate("tick"); // on sent qu'on peut tirer sans regarder l'écran
          }
        } else {
          stillSince = null;
        }
        return;
      }

      if (p === "ready") {
        if (upAccel(s) >= TRIGGER_UP && tiltFromVertical(s) < 60) {
          gesture = [...history];
          gestureStart = now;
          changePhase("measuring");
        }
        return;
      }

      if (p === "measuring") {
        gesture.push(s);
        if (now - gestureStart < GESTURE_WINDOW_MS) return;
        const m = analyzeGesture(gesture);
        gesture = [];
        if (!m) {
          changePhase("ready"); // simple secousse : on ne compte pas de tir
          return;
        }
        const e = evaluate(m, "normal");
        shotIdRef.current += 1;
        handleShootRef.current(decideShot(shotIdRef.current, e), e);
      }
    };

    window.addEventListener("devicemotion", onMotion, { passive: true });
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [sensorStatus, changePhase]);

  // Le record suit mes séries en direct : si je bats le recordman, mon prénom prend sa place.
  const record = pickStreakRecord(topStreak, whoRef.current, stats.best);
  const pct = stats.attempts > 0 ? Math.round((stats.makes / stats.attempts) * 100) : 0;
  let status: { text: string; color: string } | null = null;
  if (sensorStatus === "granted" && (duel ? duel.enabled : true)) {
    if (phase === "waiting-vertical" || phase === "waiting-reset") status = { text: "TIENS LE TÉLÉPHONE DROIT", color: C.amber };
    else if (phase === "ready") status = { text: "PRÊT ! TIRE", color: C.green };
  }

  return (
    // Plein écran par-dessus la page : le jeu ne dépend plus de la hauteur de son conteneur,
    // le bandeau de stats est donc toujours visible en bas.
    <main
      className="fixed inset-0 flex flex-col overflow-hidden"
      style={{ zIndex: 100, background: C.bg, color: "#F4F7FC", overscrollBehavior: "none", touchAction: "none", fontFamily: FONT, fontWeight: 700 }}
    >
      <section className="relative min-h-0 flex-1" aria-label="Terrain et panier de basket">
        <ShotScene
          shot={shot}
          ready={phase === "ready"}
          celebrate={(!duel && stats.streak >= 3) || shot?.outcome === "swish"}
          onResult={handleResult}
          onDone={handleAnimationDone}
          onEvent={handleSceneEvent}
        />
        {onExit && (
          <button
            type="button"
            onClick={onExit}
            aria-label="Quitter le jeu"
            className="absolute left-2 z-10 flex h-11 w-11 items-center justify-center rounded-full text-2xl leading-none"
            style={{ top: "calc(env(safe-area-inset-top) + 8px)", color: "rgba(233,238,247,0.7)", background: "rgba(0,0,0,0.25)" }}
          >
            ‹
          </button>
        )}

        {/* En haut : le message d'état (ou la série en cours), sans gêner la scène. */}
        <div
          aria-live="polite"
          className="pointer-events-none absolute flex justify-center"
          style={{ left: 56, right: 56, top: "calc(env(safe-area-inset-top) + 14px)" }}
        >
          {status ? (
            <div
              style={{
                padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 900, letterSpacing: "0.08em", textAlign: "center",
                color: status.color, background: "rgba(0,0,0,0.5)", border: `1px solid ${status.color}55`,
              }}
            >
              {status.text}
            </div>
          ) : !duel && stats.streak >= 2 ? (
            <div style={{ fontSize: 15, fontWeight: 900, color: C.orange, letterSpacing: "0.08em" }}>
              🔥 {stats.streak} D'AFFILÉE
            </div>
          ) : null}
        </div>

        {!duel && showFeedback && evaluation && <ShotFeedback e={evaluation} />}
        {duel?.overlay}

        {sensorStatus !== "granted" && (
          <div
            className="absolute inset-0 flex items-center justify-center px-6"
            style={{ background: "rgba(4,9,17,0.78)", backdropFilter: "blur(8px)" }}
          >
            <div
              className="w-full max-w-sm rounded-3xl px-6 py-7 text-center"
              style={{ background: C.board, border: "1px solid rgba(233,238,247,0.12)" }}
            >
              <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1, letterSpacing: "-0.03em" }}>
                SWISH<span style={{ color: C.orange }}>3X3</span>
              </div>
              <h1 className="mt-4 text-xl" style={{ color: "#F7F9FC", fontWeight: 900 }}>
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
                  className="mt-6 w-full rounded-xl px-5 py-3.5 text-sm tracking-wide active:scale-[0.99]"
                  style={{ background: C.orange, color: "#1A0E06", fontWeight: 900 }}
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
          padding: "14px 12px calc(14px + env(safe-area-inset-bottom))",
          background: "#0A0F18",
          borderTop: "1px solid rgba(233,238,247,0.08)",
        }}
      >
        <Stat label="Réussite" value={`${pct}%`} accent={C.orange} />
        <Stat label="Série" value={stats.streak} accent={stats.streak > 0 ? C.green : C.line} />
        <Stat label="Perso" value={stats.best} accent={stats.best > 0 && stats.streak >= stats.best ? C.green : C.line} />
        <Stat label="Record" value={record?.best ?? 0} accent={C.line} sub={record?.label} subAccent={record?.mine ? C.green : undefined} />
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
      <div style={{ fontSize: 32, fontWeight: 900, lineHeight: 1, color: accent }}>
        {value}
      </div>
      <div style={{ marginTop: 6, fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(233,238,247,0.5)" }}>
        {label}
      </div>
      {sub && (
        <div className="mt-1 truncate" style={{ fontSize: 12, fontWeight: 900, color: subAccent ?? "rgba(233,238,247,0.75)" }}>
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
