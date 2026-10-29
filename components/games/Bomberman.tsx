"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomContext } from "./RoomConnect";
import type { NetMessage } from "@/lib/p2pRoom";
import {
  BOMB_FUSE_TICKS,
  COLS,
  COUNTDOWN_TICKS,
  CRATE,
  FLAME_TICKS,
  ITEM_BOMB,
  ITEM_FIRE,
  ITEM_SPEED,
  MAX_PLAYERS,
  ROWS,
  SPIRAL,
  SUDDEN_DEATH_AFTER_TICKS,
  TICK_MS,
  WALL,
  createGame,
  fromSnapshot,
  moveLocal,
  overlappedBombCells,
  secondsBeforeSudden,
  step,
  toSnapshot,
  type Cell,
  type ClientMsg,
  type Dir,
  type GameState,
  type Snapshot,
} from "@/lib/bombermanEngine";

const NEXT_ROUND_DELAY_MS = 5000;
const POS_SEND_MS = 66; // ~15 envois / s quand on bouge
const POS_HEARTBEAT_MS = 200; // même à l'arrêt : une position perdue est vite rattrapée
const GRID_RESEND_TICKS = 20;

interface Hud {
  round: number;
  status: GameState["status"];
  players: { id: string; name: string; color: string; alive: boolean; wins: number }[];
  me: { bombsMax: number; range: number; speed: number; alive: boolean } | null;
  bombsLeft: number;
  winnerId: string | null;
  suddenIn: number | null;
  sudden: boolean;
  spectator: boolean;
}

function buildHud(s: GameState, myId: string): Hud {
  const me = s.players.find((p) => p.id === myId) ?? null;
  return {
    round: s.round,
    status: s.status,
    players: s.players.map((p) => ({ id: p.id, name: p.name, color: p.color, alive: p.alive, wins: s.wins[p.id] ?? 0 })),
    me: me ? { bombsMax: me.bombsMax, range: me.range, speed: me.speed, alive: me.alive } : null,
    bombsLeft: me ? me.bombsMax - s.bombs.filter((b) => b.owner === myId).length : 0,
    winnerId: s.winnerId,
    suddenIn: secondsBeforeSudden(s),
    sudden: s.status === "playing" && s.tick - COUNTDOWN_TICKS >= SUDDEN_DEATH_AFTER_TICKS,
    spectator: !me,
  };
}

// ─── Rendu ───────────────────────────────────────────────────────────────────
const C = {
  floorA: "#111A29",
  floorB: "#0E1623",
  wall: "#2B3754",
  wallTop: "#3C4A6E",
  wallShade: "#1C2539",
  crate: "#B87436",
  crateDark: "#7E4B1F",
  crateLight: "#D99A55",
};

interface View {
  /** Positions affichées (lissées) des joueurs. */
  shown: Map<string, { row: number; col: number }>;
  /** Moment de réception du dernier état, pour animer les mèches entre deux messages. */
  stateAt: number;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawGame(
  ctx: CanvasRenderingContext2D,
  W: number,
  s: GameState,
  view: View,
  myId: string,
  now: number,
) {
  const cs = W / COLS;
  const H = cs * ROWS;
  const elapsedTicks = Math.min(4, (now - view.stateAt) / TICK_MS);

  // Sol
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      ctx.fillStyle = (r + c) % 2 ? C.floorA : C.floorB;
      ctx.fillRect(c * cs, r * cs, cs + 0.5, cs + 0.5);
    }
  }

  // Prochain bloc de la mort subite : la case clignote.
  const suddenActive = s.status === "playing" && s.tick - COUNTDOWN_TICKS >= SUDDEN_DEATH_AFTER_TICKS && s.sudden < SPIRAL.length;
  if (suddenActive) {
    const [r, c] = SPIRAL[s.sudden];
    ctx.fillStyle = `rgba(255,60,60,${0.25 + 0.25 * Math.sin(now / 60)})`;
    ctx.fillRect(c * cs, r * cs, cs, cs);
  }

  // Murs, caisses, bonus
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = s.grid[r * COLS + c] as Cell;
      const x = c * cs;
      const y = r * cs;
      if (v === WALL) {
        ctx.fillStyle = C.wallShade;
        ctx.fillRect(x, y, cs, cs);
        ctx.fillStyle = C.wall;
        ctx.fillRect(x + 1, y + 1, cs - 2, cs - cs * 0.16);
        ctx.fillStyle = C.wallTop;
        ctx.fillRect(x + 1, y + 1, cs - 2, cs * 0.14);
      } else if (v === CRATE) {
        const p = cs * 0.07;
        ctx.fillStyle = C.crateDark;
        roundRect(ctx, x + p, y + p, cs - 2 * p, cs - 2 * p, cs * 0.12);
        ctx.fill();
        ctx.fillStyle = C.crate;
        roundRect(ctx, x + p * 2, y + p * 2, cs - 4 * p, cs - 4 * p, cs * 0.08);
        ctx.fill();
        ctx.strokeStyle = C.crateDark;
        ctx.lineWidth = Math.max(1, cs * 0.06);
        ctx.beginPath();
        ctx.moveTo(x + p * 2, y + cs / 2);
        ctx.lineTo(x + cs - p * 2, y + cs / 2);
        ctx.stroke();
        ctx.fillStyle = C.crateLight;
        ctx.fillRect(x + p * 2.5, y + p * 2.5, cs - 5 * p, cs * 0.06);
      } else if (v === ITEM_BOMB || v === ITEM_FIRE || v === ITEM_SPEED) {
        const pulse = 1 + 0.06 * Math.sin(now / 180 + r + c);
        const size = cs * 0.72 * pulse;
        const tint = v === ITEM_BOMB ? "#6EA8FF" : v === ITEM_FIRE ? "#FF7A3D" : "#4BE39A";
        ctx.save();
        ctx.shadowColor = tint;
        ctx.shadowBlur = cs * 0.35;
        ctx.fillStyle = "rgba(15,22,35,0.9)";
        roundRect(ctx, x + (cs - size) / 2, y + (cs - size) / 2, size, size, cs * 0.18);
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = tint;
        ctx.lineWidth = Math.max(1.5, cs * 0.07);
        roundRect(ctx, x + (cs - size) / 2, y + (cs - size) / 2, size, size, cs * 0.18);
        ctx.stroke();
        ctx.font = `${Math.floor(cs * 0.44)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.fillText(v === ITEM_BOMB ? "💣" : v === ITEM_FIRE ? "🔥" : "⚡", x + cs / 2, y + cs / 2 + cs * 0.02);
      }
    }
  }

  // Bombes
  for (const b of s.bombs) {
    const timer = Math.max(0, b.timer - elapsedTicks);
    const urgency = 1 - timer / BOMB_FUSE_TICKS; // 0 → 1
    const freq = 0.006 + urgency * 0.02;
    const scale = 1 + (0.05 + urgency * 0.07) * Math.sin(now * freq);
    const cx = (b.col + 0.5) * cs;
    const cy = (b.row + 0.55) * cs;
    const rad = cs * 0.34 * scale;
    // ombre
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(cx, (b.row + 0.88) * cs, rad * 0.9, rad * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    // corps
    const g = ctx.createRadialGradient(cx - rad * 0.35, cy - rad * 0.4, rad * 0.1, cx, cy, rad);
    g.addColorStop(0, "#6B7280");
    g.addColorStop(0.35, "#2A2F3A");
    g.addColorStop(1, "#0B0D12");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
    // contour rouge qui s'intensifie
    ctx.strokeStyle = `rgba(255,70,70,${0.25 + 0.7 * urgency})`;
    ctx.lineWidth = Math.max(1.5, cs * 0.06);
    ctx.stroke();
    // mèche + étincelle
    const fx = cx + rad * 0.55;
    const fy = cy - rad * 0.85;
    ctx.strokeStyle = "#C9A26B";
    ctx.lineWidth = Math.max(1.5, cs * 0.05);
    ctx.beginPath();
    ctx.moveTo(cx + rad * 0.3, cy - rad * 0.75);
    ctx.quadraticCurveTo(fx, fy - rad * 0.1, fx + rad * 0.15, fy - rad * 0.25);
    ctx.stroke();
    const spark = cs * (0.09 + 0.05 * Math.abs(Math.sin(now / 40 + b.id)));
    ctx.fillStyle = "#FFE27A";
    ctx.beginPath();
    ctx.arc(fx + rad * 0.15, fy - rad * 0.25, spark, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#FF7A1A";
    ctx.beginPath();
    ctx.arc(fx + rad * 0.15, fy - rad * 0.25, spark * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Flammes
  for (const f of s.flames) {
    const life = Math.max(0, (f.ttl - elapsedTicks) / FLAME_TICKS);
    const x = f.col * cs;
    const y = f.row * cs;
    const grow = 0.75 + 0.25 * Math.min(1, (1 - life) * 6);
    const layers: [string, number][] = [
      ["#FF5A1F", 0.86],
      ["#FFB02E", 0.6],
      ["#FFF3B0", 0.3],
    ];
    ctx.globalAlpha = Math.min(1, life * 1.6);
    for (const [color, k] of layers) {
      const t = cs * k * grow;
      ctx.fillStyle = color;
      if (f.kind === 0) {
        roundRect(ctx, x + (cs - t) / 2, y + (cs - t) / 2, t, t, t * 0.35);
      } else if (f.kind === 1) {
        roundRect(ctx, x - 0.5, y + (cs - t) / 2, cs + 1, t, t * 0.3);
      } else {
        roundRect(ctx, x + (cs - t) / 2, y - 0.5, t, cs + 1, t * 0.3);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Joueurs
  for (const p of s.players) {
    if (!p.alive) continue;
    const pos = view.shown.get(p.id) ?? { row: p.row, col: p.col };
    const cx = pos.col * cs;
    const cy = pos.row * cs;
    const rad = cs * 0.36;
    const mine = p.id === myId;
    const bob = Math.sin(now / 110 + p.color.length) * cs * 0.02;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + rad * 0.95, rad * 0.85, rad * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    if (mine) {
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = Math.max(2, cs * 0.07);
      ctx.beginPath();
      ctx.arc(cx, cy + bob, rad + cs * 0.06, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(cx, cy + bob, rad, 0, Math.PI * 2);
    ctx.fill();
    // reflet
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.beginPath();
    ctx.ellipse(cx - rad * 0.32, cy + bob - rad * 0.4, rad * 0.35, rad * 0.2, -0.6, 0, Math.PI * 2);
    ctx.fill();
    // yeux tournés vers la direction
    const fx = p.face === "left" ? -1 : p.face === "right" ? 1 : 0;
    const fy = p.face === "up" ? -1 : p.face === "down" ? 1 : 0;
    const ex = rad * 0.3;
    const eyeY = cy + bob - rad * 0.1 + fy * rad * 0.15;
    for (const side of [-1, 1]) {
      const exx = cx + side * ex + fx * rad * 0.25;
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.ellipse(exx, eyeY, rad * 0.17, rad * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0B0D12";
      ctx.beginPath();
      ctx.arc(exx + fx * rad * 0.07, eyeY + fy * rad * 0.08, rad * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
    // marqueur au-dessus de mon joueur
    if (mine) {
      ctx.fillStyle = "#FFFFFF";
      const ty = cy + bob - rad - cs * 0.22;
      ctx.beginPath();
      ctx.moveTo(cx - cs * 0.1, ty - cs * 0.1);
      ctx.lineTo(cx + cs * 0.1, ty - cs * 0.1);
      ctx.lineTo(cx, ty + cs * 0.02);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Compte à rebours
  if (s.status === "countdown") {
    const left = Math.max(0, COUNTDOWN_TICKS - s.tick - elapsedTicks);
    const n = Math.ceil((left * TICK_MS) / 1000);
    ctx.fillStyle = "rgba(5,8,15,0.45)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `900 ${Math.floor(cs * 3)}px system-ui, sans-serif`;
    ctx.fillText(n > 0 ? String(n) : "GO !", W / 2, H / 2);
  }
}

// ─── Joystick ────────────────────────────────────────────────────────────────
function Joystick({ onDir }: { onDir: (d: Dir | null) => void }) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0, active: false });
  const lastDir = useRef<Dir | null>(null);
  const SIZE = 148;
  const MAX = 44;

  const update = (clientX: number, clientY: number) => {
    const el = zoneRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const dist = Math.hypot(dx, dy);
    const k = dist > MAX ? MAX / dist : 1;
    setKnob({ x: dx * k, y: dy * k, active: true });
    let d: Dir | null = null;
    if (dist > 14) d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    if (d !== lastDir.current) {
      lastDir.current = d;
      onDir(d);
    }
  };

  const release = () => {
    setKnob({ x: 0, y: 0, active: false });
    if (lastDir.current !== null) {
      lastDir.current = null;
      onDir(null);
    }
  };

  return (
    <div
      ref={zoneRef}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) update(e.clientX, e.clientY);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      className="relative select-none rounded-full"
      aria-label="Joystick de déplacement"
      style={{
        width: SIZE,
        height: SIZE,
        touchAction: "none",
        background: "radial-gradient(circle, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 70%)",
        border: "1px solid var(--border)",
      }}
    >
      {(["↑", "→", "↓", "←"] as const).map((a, i) => (
        <span
          key={a}
          className="absolute text-xs"
          style={{
            color: "var(--text-muted)",
            opacity: 0.6,
            left: i === 1 ? SIZE - 18 : i === 3 ? 8 : SIZE / 2 - 4,
            top: i === 0 ? 6 : i === 2 ? SIZE - 22 : SIZE / 2 - 9,
          }}
        >
          {a}
        </span>
      ))}
      <div
        className="absolute rounded-full"
        style={{
          width: 62,
          height: 62,
          left: SIZE / 2 - 31 + knob.x,
          top: SIZE / 2 - 31 + knob.y,
          background: knob.active ? "linear-gradient(135deg,var(--accent),var(--accent2))" : "var(--bg-input)",
          border: "1px solid var(--border)",
          boxShadow: knob.active ? "0 4px 18px var(--accent-glow)" : "none",
          transition: knob.active ? "none" : "left 120ms, top 120ms",
        }}
      />
    </div>
  );
}

// ─── Jeu ─────────────────────────────────────────────────────────────────────
function BombermanGame({ ctx }: { ctx: RoomContext }) {
  const isHost = ctx.role === "host" || ctx.role === "solo";
  const myId = ctx.myId;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState | null>(null);
  const viewRef = useRef<View>({ shown: new Map(), stateAt: 0 });
  const gridCacheRef = useRef<Cell[] | null>(null);
  const myPosRef = useRef<{ row: number; col: number; face: Dir; round: number } | null>(null);
  const dirRef = useRef<Dir | null>(null);
  const lastSentRef = useRef({ at: 0, row: 0, col: 0 });
  // Hôte
  const positionsRef = useRef<Record<string, { row: number; col: number; face?: Dir }>>({});
  const bombReqRef = useRef<{ id: string; r?: number; c?: number }[]>([]);
  const lastGridSentRef = useRef({ gv: -1, tick: -999 });
  const forceGridRef = useRef(false);
  // Client
  const gridGvRef = useRef(-1);
  const lastGridAskRef = useRef(0);
  // Bombe demandée par ce téléphone, renvoyée tant qu'elle n'apparaît pas (message perdu).
  const pendingBombRef = useRef<{ seq: number; round: number; r: number; c: number; until: number; nextAt: number } | null>(null);
  const bombSeqRef = useRef(0);
  const lastBombSeqRef = useRef<Record<string, number>>({});
  const requestGrid = useCallback(() => {
    const t = performance.now();
    if (t - lastGridAskRef.current < 300) return;
    lastGridAskRef.current = t;
    const c = ctxRef.current;
    c.send({ type: "move", payload: { k: "bm-hello" } satisfies ClientMsg, from: c.myId });
  }, []);

  const [hud, setHud] = useState<Hud | null>(null);
  const hudKeyRef = useRef("");
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [, setClock] = useState(0);

  const pushHud = useCallback((s: GameState) => {
    const h = buildHud(s, ctxRef.current.myId);
    const key = JSON.stringify(h);
    if (key !== hudKeyRef.current) {
      hudKeyRef.current = key;
      setHud(h);
    }
  }, []);

  /** Nouvel état reçu ou calculé : on recale ma position si besoin. */
  const adoptState = useCallback(
    (s: GameState) => {
      const prev = stateRef.current;
      stateRef.current = s;
      viewRef.current.stateAt = performance.now();
      const me = s.players.find((p) => p.id === myId);
      const mine = myPosRef.current;
      if (me) {
        const far = mine ? Math.abs(mine.row - me.row) + Math.abs(mine.col - me.col) > 2.5 : true;
        if (!mine || mine.round !== s.round || s.status === "countdown" || (!isHost && far)) {
          myPosRef.current = { row: me.row, col: me.col, face: me.face, round: s.round };
        }
      } else {
        myPosRef.current = null;
      }
      if (!prev || prev.round !== s.round) viewRef.current.shown.clear();
      if (s.status === "ended" && prev?.status !== "ended") setEndedAt(Date.now());
      if (s.status !== "ended") setEndedAt(null);
      pushHud(s);
    },
    [isHost, myId, pushHud],
  );

  // ── Hôte : démarrage, simulation, diffusion ──
  const startRound = useCallback(() => {
    const roster = ctxRef.current.players.map((p) => ({ id: p.id, name: p.name }));
    const prev = stateRef.current;
    const next = createGame(roster, prev ? { round: prev.round, wins: prev.wins } : undefined);
    positionsRef.current = {};
    bombReqRef.current = [];
    forceGridRef.current = true;
    adoptState(next);
  }, [adoptState]);

  useEffect(() => {
    if (!isHost) return;
    startRound();
    let idleTicks = 0;
    const id = window.setInterval(() => {
      const cur = stateRef.current;
      if (!cur) return;
      const c = ctxRef.current;
      const present = new Set(c.players.map((p) => p.id));
      const mine = myPosRef.current;
      if (mine) positionsRef.current[c.myId] = { row: mine.row, col: mine.col, face: mine.face };
      const bombs = bombReqRef.current;
      bombReqRef.current = [];
      const next = step(cur, { positions: positionsRef.current, bombs, present });
      idleTicks += 1;
      if (next === cur) {
        // Manche finie : on rediffuse l'état de temps en temps (au cas où le dernier message s'est perdu).
        if (c.role !== "solo" && idleTicks % 10 === 0) c.broadcast({ type: "state", payload: toSnapshot(cur, idleTicks % 20 === 0) });
        return;
      }
      idleTicks = 0;
      adoptState(next);
      if (c.role === "solo") return;
      const aliveChanged = next.players.some((p, i) => p.alive !== cur.players[i]?.alive);
      const event =
        next.status !== cur.status ||
        next.gridVersion !== cur.gridVersion ||
        next.bombs.length !== cur.bombs.length ||
        aliveChanged;
      if (!event && next.tick % 2 !== 0) return;
      const sent = lastGridSentRef.current;
      const withGrid =
        forceGridRef.current || next.gridVersion !== sent.gv || next.tick - sent.tick >= GRID_RESEND_TICKS || next.tick < sent.tick;
      if (withGrid) {
        lastGridSentRef.current = { gv: next.gridVersion, tick: next.tick };
        forceGridRef.current = false;
      }
      c.broadcast({ type: "state", payload: toSnapshot(next, withGrid) });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [isHost]);

  // Manche suivante automatique
  useEffect(() => {
    if (!isHost || endedAt === null) return;
    const t = window.setTimeout(startRound, NEXT_ROUND_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [isHost, endedAt, startRound]);

  // Petite horloge pour l'affichage « manche suivante dans N s »
  useEffect(() => {
    if (endedAt === null) return;
    const t = window.setInterval(() => setClock((x) => x + 1), 250);
    return () => window.clearInterval(t);
  }, [endedAt]);

  // ── Réseau ──
  useEffect(() => {
    const off = ctx.onMessage((msg: NetMessage, from?: string) => {
      const c = ctxRef.current;
      const host = c.role === "host" || c.role === "solo";
      if (msg.type === "state" && !host) {
        const snap = msg.payload as Snapshot | undefined;
        if (!snap || snap.k !== "bm") return;
        if (snap.g) {
          gridCacheRef.current = snap.g.split("").map(Number) as Cell[];
          gridGvRef.current = snap.gv;
        } else if (gridGvRef.current !== snap.gv) {
          // Grille manquée (message perdu) : on la redemande, en attendant on garde la dernière connue.
          requestGrid();
        }
        const s = fromSnapshot(snap, gridCacheRef.current);
        if (s) adoptState(s);
      } else if (msg.type === "move" && host) {
        const p = msg.payload as ClientMsg | undefined;
        const who = from ?? msg.from;
        if (!p || !who) return;
        const cur = stateRef.current;
        if (p.k === "bm-hello") forceGridRef.current = true;
        if (!cur) return;
        if (p.k === "bm-pos" && p.round === cur.round) {
          positionsRef.current[who] = { row: p.r, col: p.c, face: p.d };
        } else if (p.k === "bm-bomb" && p.round === cur.round) {
          if ((lastBombSeqRef.current[who] ?? -1) >= p.seq) return; // doublon d'un renvoi
          lastBombSeqRef.current[who] = p.seq;
          bombReqRef.current.push({ id: who, r: p.r, c: p.c });
        }
      }
    });
    // Tant que la grille n'est pas arrivée, on la redemande régulièrement.
    let retry: number | undefined;
    if (!isHost) {
      requestGrid();
      retry = window.setInterval(() => {
        if (!gridCacheRef.current) requestGrid();
      }, 400);
    }
    return () => {
      off();
      if (retry) window.clearInterval(retry);
    };
  }, []);

  // ── Boucle d'affichage + déplacement local ──
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      const c = ctxRef.current;
      const mine = myPosRef.current;

      if (s && mine && mine.round === s.round) {
        const me = s.players.find((p) => p.id === c.myId);
        const dir = dirRef.current;
        if (me?.alive && s.status === "playing" && dir) {
          const passable = overlappedBombCells(s.bombs, mine);
          moveLocal(s.grid, s.bombs, mine, dir, me.speed, dt, passable);
          mine.face = dir;
        }
        // Renvoi de la bombe demandée tant qu'elle n'apparaît pas
        const pb = pendingBombRef.current;
        if (pb && c.role === "client") {
          const t = performance.now();
          const placed = s.bombs.some((b) => b.owner === c.myId && b.row === pb.r && b.col === pb.c);
          if (placed || t > pb.until || pb.round !== s.round || !me?.alive) pendingBombRef.current = null;
          else if (t >= pb.nextAt) {
            pb.nextAt = t + 160;
            c.send({ type: "move", payload: { k: "bm-bomb", round: pb.round, r: pb.r, c: pb.c, seq: pb.seq } satisfies ClientMsg, from: c.myId });
          }
        }
        // Envoi de ma position à l'hôte
        if (c.role === "client" && me?.alive && s.status !== "ended") {
          const ls = lastSentRef.current;
          const movedSince = Math.abs(ls.row - mine.row) + Math.abs(ls.col - mine.col) > 0.01;
          const t = performance.now();
          if ((movedSince && t - ls.at >= POS_SEND_MS) || t - ls.at >= POS_HEARTBEAT_MS) {
            lastSentRef.current = { at: t, row: mine.row, col: mine.col };
            c.send({
              type: "move",
              payload: { k: "bm-pos", round: s.round, r: Math.round(mine.row * 1000) / 1000, c: Math.round(mine.col * 1000) / 1000, d: mine.face } satisfies ClientMsg,
              from: c.myId,
            });
          }
        }
      }

      // Positions affichées : la mienne en direct, les autres lissées.
      if (s) {
        const shown = viewRef.current.shown;
        const k = 1 - Math.exp(-dt * 16);
        for (const p of s.players) {
          if (p.id === c.myId && mine && mine.round === s.round) {
            shown.set(p.id, { row: mine.row, col: mine.col });
            continue;
          }
          const cur = shown.get(p.id);
          if (!cur || Math.abs(cur.row - p.row) + Math.abs(cur.col - p.col) > 2.5) shown.set(p.id, { row: p.row, col: p.col });
          else shown.set(p.id, { row: cur.row + (p.row - cur.row) * k, col: cur.col + (p.col - cur.col) * k });
        }
        const myFace = mine?.face;
        const view = s.players.some((p) => p.id === c.myId) && myFace
          ? { ...s, players: s.players.map((p) => (p.id === c.myId ? { ...p, face: myFace } : p)) }
          : s;

        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          if (rect.width > 0) {
            const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
            const w = Math.round(rect.width * dpr);
            const h = Math.round(((rect.width * ROWS) / COLS) * dpr);
            if (canvas.width !== w || canvas.height !== h) {
              canvas.width = w;
              canvas.height = h;
            }
            const g = canvas.getContext("2d");
            if (g) {
              g.setTransform(dpr, 0, 0, dpr, 0, 0);
              drawGame(g, rect.width, view, viewRef.current, c.myId, now);
            }
          }
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Commandes ──
  const handleDir = useCallback((d: Dir | null) => {
    dirRef.current = d;
  }, []);

  const handleBomb = useCallback(() => {
    const s = stateRef.current;
    const mine = myPosRef.current;
    const c = ctxRef.current;
    if (!s || !mine || s.status !== "playing") return;
    const r = Math.floor(mine.row);
    const col = Math.floor(mine.col);
    if (c.role === "host" || c.role === "solo") {
      bombReqRef.current.push({ id: c.myId, r, c: col });
    } else {
      // On envoie aussi la position exacte juste avant, pour que l'hôte soit à jour.
      c.send({ type: "move", payload: { k: "bm-pos", round: s.round, r: mine.row, c: mine.col, d: mine.face } satisfies ClientMsg, from: c.myId });
      bombSeqRef.current += 1;
      const t = performance.now();
      const req = { seq: bombSeqRef.current, round: s.round, r, c: col, until: t + 900, nextAt: t + 160 };
      pendingBombRef.current = req;
      c.send({ type: "move", payload: { k: "bm-bomb", round: s.round, r, c: col, seq: req.seq } satisfies ClientMsg, from: c.myId });
    }
  }, []);

  // Clavier (tests sur ordinateur)
  useEffect(() => {
    const keyToDir: Record<string, Dir> = {
      ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
      w: "up", s: "down", a: "left", d: "right", z: "up", q: "left",
    };
    const pressed: string[] = [];
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault();
        if (!e.repeat) handleBomb();
        return;
      }
      const dir = keyToDir[e.key];
      if (!dir) return;
      e.preventDefault();
      if (!pressed.includes(e.key)) pressed.push(e.key);
      handleDir(dir);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const i = pressed.indexOf(e.key);
      if (i >= 0) pressed.splice(i, 1);
      if (!keyToDir[e.key]) return;
      const top = pressed[pressed.length - 1];
      handleDir(top ? keyToDir[top] : null);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [handleDir, handleBomb]);

  const winner = hud?.winnerId ? hud.players.find((p) => p.id === hud.winnerId) : null;
  const nextIn = endedAt !== null ? Math.max(0, Math.ceil((endedAt + NEXT_ROUND_DELAY_MS - Date.now()) / 1000)) : null;

  return (
    <div className="space-y-3 select-none">
      {/* Joueurs et manches gagnées */}
      <div className="flex flex-wrap items-center gap-1.5">
        {hud?.players.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold"
            style={{
              background: p.alive ? `${p.color}22` : "var(--bg-input)",
              border: `1px solid ${p.alive ? p.color : "var(--border)"}`,
              color: p.alive ? "var(--text-main)" : "var(--text-muted)",
              opacity: p.alive ? 1 : 0.55,
            }}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
            <span style={{ textDecoration: p.alive ? "none" : "line-through" }}>{p.name}</span>
            {p.wins > 0 && <span style={{ color: "#FFC23D" }}>★{p.wins}</span>}
          </div>
        ))}
        {hud && (
          <span className="ml-auto text-[11px]" style={{ color: "var(--text-muted)" }}>
            Manche {hud.round}
          </span>
        )}
      </div>

      <div className="relative">
        <canvas
          ref={canvasRef}
          className="block w-full rounded-2xl"
          style={{ aspectRatio: `${COLS} / ${ROWS}`, border: "1px solid var(--border)", background: C.floorB }}
        />
        {!hud && (
          <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: "var(--text-muted)" }}>
            Connexion à la partie…
          </div>
        )}
        {hud?.status === "ended" && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl text-center"
            style={{ background: "rgba(5,8,15,0.72)", backdropFilter: "blur(3px)" }}
          >
            <p className="font-display text-3xl" style={{ color: winner?.color ?? "var(--accent)" }}>
              {winner ? (winner.id === myId ? "TU GAGNES !" : `${winner.name.toUpperCase()} GAGNE`) : "MATCH NUL"}
            </p>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>
              Manche suivante dans {nextIn ?? 0} s
            </p>
          </div>
        )}
      </div>

      {/* Infos de mon joueur */}
      <div className="flex items-center justify-center gap-4 text-xs" style={{ color: "var(--text-muted)" }}>
        {hud?.me && (
          <>
            <span>💣 {Math.max(0, hud.bombsLeft)}/{hud.me.bombsMax}</span>
            <span>🔥 {hud.me.range}</span>
            <span>⚡ {hud.me.speed.toFixed(1)}</span>
          </>
        )}
        {hud?.spectator && <span>Partie pleine ({MAX_PLAYERS} max) : tu regardes cette manche.</span>}
        {hud?.me && !hud.me.alive && hud.status === "playing" && <span style={{ color: "#f87171" }}>Éliminé, attends la manche suivante</span>}
        {hud?.sudden ? (
          <span className="font-bold" style={{ color: "#f87171" }}>MORT SUBITE !</span>
        ) : hud?.suddenIn !== null && hud?.suddenIn !== undefined && hud.suddenIn <= 30 ? (
          <span style={{ color: "#fbbf24" }}>Mort subite dans {hud.suddenIn} s</span>
        ) : null}
      </div>

      {/* Commandes */}
      <div className="flex items-center justify-between px-1 pb-2" style={{ touchAction: "none" }}>
        <Joystick onDir={handleDir} />
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            handleBomb();
          }}
          aria-label="Poser une bombe"
          className="flex h-24 w-24 items-center justify-center rounded-full text-4xl transition-transform active:scale-90"
          style={{
            background: "linear-gradient(135deg,var(--accent),var(--accent2))",
            color: "white",
            boxShadow: "0 4px 20px var(--accent-glow)",
            touchAction: "none",
          }}
        >
          💣
        </button>
      </div>
    </div>
  );
}

export default function Bomberman({ ctx }: { ctx: RoomContext }) {
  return <BombermanGame ctx={ctx} />;
}
