// Sons (synthétisés : aucun fichier audio à fournir) et vibrations (Android ; l'iPhone ne
// permet pas aux sites de faire vibrer).

import type { SceneEventType } from "./scene";

let ctx: AudioContext | null = null;
let muted = false;

/** À appeler sur un toucher de l'écran : les navigateurs bloquent le son avant. */
export function unlockAudio() {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function setMuted(m: boolean) {
  muted = m;
}

function noise(duration: number): AudioBuffer | null {
  if (!ctx) return null;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function env(gain: GainNode, at: number, peak: number, attack: number, decay: number) {
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
}

/** Filet : un souffle filtré. */
function swish(strength: number) {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = noise(0.5);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.8;
  const now = ctx.currentTime;
  bp.frequency.setValueAtTime(2600, now);
  bp.frequency.exponentialRampToValueAtTime(900, now + 0.35);
  const g = ctx.createGain();
  env(g, now, 0.5 * strength, 0.03, 0.35);
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start(now);
  src.stop(now + 0.5);
}

/** Cercle : métal qui sonne (quelques partiels non harmoniques). */
function clank(strength: number) {
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const [f, a] of [[520, 1], [1180, 0.6], [1730, 0.35], [2650, 0.2]] as const) {
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = f;
    const g = ctx.createGain();
    env(g, now, 0.18 * a * strength, 0.002, 0.5);
    o.connect(g).connect(ctx.destination);
    o.start(now);
    o.stop(now + 0.6);
  }
}

/** Planche, rebond : un « tonk » sourd. */
function thud(strength: number, freq = 140) {
  if (!ctx) return;
  const now = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(freq, now);
  o.frequency.exponentialRampToValueAtTime(freq * 0.45, now + 0.15);
  const g = ctx.createGain();
  env(g, now, 0.6 * strength, 0.004, 0.18);
  o.connect(g).connect(ctx.destination);
  o.start(now);
  o.stop(now + 0.25);
}

export function playEvent(type: SceneEventType, strength: number) {
  if (muted || !ctx) return;
  switch (type) {
    case "net": swish(strength); break;
    case "rim": clank(strength); break;
    case "board": thud(strength, 120); clank(strength * 0.3); break;
    case "bounce": thud(strength * 0.8, 90); break;
  }
  if (type === "rim" || type === "board") vibrate("impact");
}

const PATTERNS: Record<"impact" | "success" | "error" | "tick", number | number[]> = {
  tick: 15,
  impact: 30,
  success: [40, 60, 40],
  error: 120,
};

export function vibrate(kind: "impact" | "success" | "error" | "tick") {
  try {
    navigator.vibrate?.(PATTERNS[kind]);
  } catch {
    /* pas de vibreur : tant pis */
  }
}
