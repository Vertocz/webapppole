"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import RoomConnect, { RoomContext } from "./RoomConnect";
import type { NetMessage } from "@/lib/p2pRoom";

// ─── Constantes de jeu ────────────────────────────────────────────────────────
const COLS = 11;
const ROWS = 9;
const TICK_MS = 50; // 20 Hz
const BOMB_FUSE_TICKS = 60; // 3s
const EXPLOSION_TTL_TICKS = 10; // ~0.5s
const PLAYER_MARGIN = 0.32; // demi-taille du joueur, en cellules
const BASE_SPEED = 3.6; // cellules / seconde
const SPEED_BONUS = 0.9;
const MAX_SPEED = 6.3;
const MAX_RANGE = 6;
const MAX_BOMBS = 5;
const DESTRUCTIBLE_CHANCE = 0.6;
const POWERUP_CHANCE = 0.3;

const PLAYER_COLORS = ["#E8192C", "#1B3A8C", "#4ade80", "#C49A28"];

// Cellules : 0 vide, 1 destructible, 2 indestructible, 3/4/5 bonus (bombe/portée/vitesse)
type Cell = 0 | 1 | 2 | 3 | 4 | 5;
type Grid = Cell[][];
type Dir = "up" | "down" | "left" | "right" | null;

interface PlayerState {
  id: string;
  name: string;
  row: number;
  col: number;
  alive: boolean;
  bombsMax: number;
  bombsActive: number;
  range: number;
  speed: number;
  color: string;
}

interface BombEntity {
  id: string;
  row: number;
  col: number;
  ownerId: string;
  range: number;
  timer: number;
}

interface ExplosionCell {
  row: number;
  col: number;
  ttl: number;
}

interface GameState {
  grid: Grid;
  players: PlayerState[];
  bombs: BombEntity[];
  explosions: ExplosionCell[];
  status: "playing" | "ended";
  winnerId: string | null;
}

const SPAWNS: [number, number][] = [
  [1, 1],
  [ROWS - 2, COLS - 2],
  [1, COLS - 2],
  [ROWS - 2, 1],
];

function isNearSpawn(r: number, c: number): boolean {
  return SPAWNS.some(([sr, sc]) => Math.abs(sr - r) <= 1 && Math.abs(sc - c) <= 1);
}

function buildGrid(): Grid {
  const grid: Grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0) as Cell[]);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const border = r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1;
      const pillar = r % 2 === 0 && c % 2 === 0;
      if (border || pillar) {
        grid[r][c] = 2;
      } else if (!isNearSpawn(r, c) && Math.random() < DESTRUCTIBLE_CHANCE) {
        grid[r][c] = 1;
      }
    }
  }
  return grid;
}

function createInitialState(players: { id: string; name: string }[]): GameState {
  return {
    grid: buildGrid(),
    players: players.slice(0, 4).map((p, i) => ({
      id: p.id,
      name: p.name,
      row: SPAWNS[i][0],
      col: SPAWNS[i][1],
      alive: true,
      bombsMax: 1,
      bombsActive: 0,
      range: 2,
      speed: BASE_SPEED,
      color: PLAYER_COLORS[i],
    })),
    bombs: [],
    explosions: [],
    status: "playing",
    winnerId: null,
  };
}

function isBlocked(grid: Grid, row: number, col: number): boolean {
  const r = Math.floor(row);
  const c = Math.floor(col);
  if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return true;
  const v = grid[r][c];
  return v === 1 || v === 2;
}

function movePlayer(grid: Grid, p: PlayerState, dir: Dir, dt: number) {
  if (!dir) return;
  const delta = p.speed * dt;
  let dRow = 0;
  let dCol = 0;
  if (dir === "up") dRow = -delta;
  else if (dir === "down") dRow = delta;
  else if (dir === "left") dCol = -delta;
  else if (dir === "right") dCol = delta;

  if (dRow !== 0) {
    const newRow = p.row + dRow;
    const edgeRow = dRow > 0 ? newRow + PLAYER_MARGIN : newRow - PLAYER_MARGIN;
    if (!isBlocked(grid, edgeRow, p.col - PLAYER_MARGIN) && !isBlocked(grid, edgeRow, p.col + PLAYER_MARGIN)) {
      p.row = newRow;
    }
  } else if (dCol !== 0) {
    const newCol = p.col + dCol;
    const edgeCol = dCol > 0 ? newCol + PLAYER_MARGIN : newCol - PLAYER_MARGIN;
    if (!isBlocked(grid, p.row - PLAYER_MARGIN, edgeCol) && !isBlocked(grid, p.row + PLAYER_MARGIN, edgeCol)) {
      p.col = newCol;
    }
  }
}

function applyPowerup(p: PlayerState, kind: Cell) {
  if (kind === 3) p.bombsMax = Math.min(MAX_BOMBS, p.bombsMax + 1);
  if (kind === 4) p.range = Math.min(MAX_RANGE, p.range + 1);
  if (kind === 5) p.speed = Math.min(MAX_SPEED, p.speed + SPEED_BONUS);
}

function stepSimulation(
  prev: GameState,
  dirs: Record<string, Dir>,
  pendingBombs: string[]
): GameState {
  if (prev.status === "ended") return prev;

  const grid = prev.grid.map((row) => [...row]) as Grid;
  const players = prev.players.map((p) => ({ ...p }));
  let bombs = prev.bombs.map((b) => ({ ...b }));
  const explosions: ExplosionCell[] = prev.explosions
    .map((e) => ({ ...e, ttl: e.ttl - 1 }))
    .filter((e) => e.ttl > 0);

  const dt = TICK_MS / 1000;

  // 1. Déplacements
  for (const p of players) {
    if (!p.alive) continue;
    movePlayer(grid, p, dirs[p.id] ?? null, dt);
    // Ramassage de bonus
    const r = Math.round(p.row);
    const c = Math.round(p.col);
    const cell = grid[r]?.[c];
    if (cell === 3 || cell === 4 || cell === 5) {
      applyPowerup(p, cell);
      grid[r][c] = 0;
    }
  }

  // 2. Poses de bombes
  for (const playerId of pendingBombs) {
    const p = players.find((pl) => pl.id === playerId);
    if (!p || !p.alive) continue;
    if (p.bombsActive >= p.bombsMax) continue;
    const r = Math.round(p.row);
    const c = Math.round(p.col);
    if (bombs.some((b) => b.row === r && b.col === c)) continue;
    bombs.push({ id: `${playerId}-${Date.now()}-${Math.random()}`, row: r, col: c, ownerId: playerId, range: p.range, timer: BOMB_FUSE_TICKS });
    p.bombsActive++;
  }

  // 3. Détonations (avec réaction en chaîne)
  const explodeQueue = bombs.filter((b) => --b.timer <= 0).map((b) => b.id);
  const exploded = new Set<string>();

  const explodeOne = (bombId: string) => {
    if (exploded.has(bombId)) return;
    const bomb = bombs.find((b) => b.id === bombId);
    if (!bomb) return;
    exploded.add(bombId);

    explosions.push({ row: bomb.row, col: bomb.col, ttl: EXPLOSION_TTL_TICKS });
    const dirs4: [number, number][] = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    for (const [dr, dc] of dirs4) {
      for (let k = 1; k <= bomb.range; k++) {
        const r = bomb.row + dr * k;
        const c = bomb.col + dc * k;
        if (r < 0 || c < 0 || r >= ROWS || c >= COLS) break;
        const v = grid[r][c];
        if (v === 2) break;
        // Bombe présente sur la trajectoire : chaîne, puis on arrête la propagation
        const chained = bombs.find((b) => b.row === r && b.col === c && b.id !== bomb.id);
        if (chained) {
          explosions.push({ row: r, col: c, ttl: EXPLOSION_TTL_TICKS });
          explodeOne(chained.id);
          break;
        }
        explosions.push({ row: r, col: c, ttl: EXPLOSION_TTL_TICKS });
        if (v === 1) {
          grid[r][c] = Math.random() < POWERUP_CHANCE ? ((3 + Math.floor(Math.random() * 3)) as Cell) : 0;
          break; // le mur destructible stoppe la propagation
        }
      }
    }

    const owner = players.find((pl) => pl.id === bomb.ownerId);
    if (owner) owner.bombsActive = Math.max(0, owner.bombsActive - 1);
  };

  explodeQueue.forEach(explodeOne);
  bombs = bombs.filter((b) => !exploded.has(b.id));

  // 4. Joueurs pris dans une explosion
  const explosionKeys = new Set(explosions.map((e) => `${e.row},${e.col}`));
  for (const p of players) {
    if (!p.alive) continue;
    const key = `${Math.round(p.row)},${Math.round(p.col)}`;
    if (explosionKeys.has(key)) p.alive = false;
  }

  // 5. Condition de victoire
  let status: GameState["status"] = prev.status;
  let winnerId = prev.winnerId;
  if (players.length > 1) {
    const alive = players.filter((p) => p.alive);
    if (alive.length <= 1) {
      status = "ended";
      winnerId = alive.length === 1 ? alive[0].id : null;
    }
  }

  return { grid, players, bombs, explosions, status, winnerId };
}

// ─── Rendu Canvas ─────────────────────────────────────────────────────────────
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function GameCanvas({ state }: { state: GameState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = canvas.clientWidth;
    const cell = size / COLS;
    canvas.width = size;
    canvas.height = (size / COLS) * ROWS;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bgBase = cssVar("--bg-base", "#05080F");
    const wallColor = cssVar("--primary", "#1B3A8C");
    const blockColor = "#C8A96E"; // court.tan (palette Tailwind, pas exposée en variable CSS)
    const accent = cssVar("--accent", "#E8192C");

    ctx.fillStyle = bgBase;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = c * cell;
        const y = r * cell;
        const v = state.grid[r][c];
        if (v === 2) {
          ctx.fillStyle = wallColor;
          ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
        } else if (v === 1) {
          ctx.fillStyle = blockColor;
          ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
        } else if (v === 3 || v === 4 || v === 5) {
          ctx.fillStyle = v === 3 ? "#4ade80" : v === 4 ? accent : "#60a5fa";
          ctx.beginPath();
          ctx.arc(x + cell / 2, y + cell / 2, cell * 0.22, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Explosions
    for (const e of state.explosions) {
      ctx.fillStyle = "rgba(255,140,0,0.85)";
      ctx.fillRect(e.col * cell + 2, e.row * cell + 2, cell - 4, cell - 4);
    }

    // Bombes
    for (const b of state.bombs) {
      const pulse = 0.75 + 0.25 * Math.sin(b.timer * 0.5);
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc((b.col + 0.5) * cell, (b.row + 0.5) * cell, cell * 0.3 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    // Joueurs
    for (const p of state.players) {
      if (!p.alive) continue;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc((p.col + 0.5) * cell, (p.row + 0.5) * cell, cell * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.font = `${Math.floor(cell * 0.35)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.name.charAt(0).toUpperCase(), (p.col + 0.5) * cell, (p.row + 0.5) * cell);
    }
  }, [state]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-2xl block"
      style={{ aspectRatio: `${COLS} / ${ROWS}`, border: "1px solid var(--border)" }}
    />
  );
}

// ─── Contrôles tactiles ───────────────────────────────────────────────────────
function DirButton({
  dir,
  icon,
  onDown,
  onUp,
}: {
  dir: Dir;
  icon: string;
  onDown: (d: Dir) => void;
  onUp: () => void;
}) {
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        onDown(dir);
      }}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onPointerCancel={onUp}
      className="w-14 h-14 rounded-xl flex items-center justify-center text-xl select-none active:scale-90 transition-transform"
      style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)", touchAction: "none" }}
    >
      {icon}
    </button>
  );
}

function TouchControls({ onDir, onBomb }: { onDir: (d: Dir) => void; onBomb: () => void }) {
  return (
    <div className="flex items-end justify-between px-2" style={{ touchAction: "none" }}>
      <div className="grid grid-cols-3 gap-1.5" style={{ width: 176 }}>
        <div />
        <DirButton dir="up" icon="↑" onDown={onDir} onUp={() => onDir(null)} />
        <div />
        <DirButton dir="left" icon="←" onDown={onDir} onUp={() => onDir(null)} />
        <div />
        <DirButton dir="right" icon="→" onDown={onDir} onUp={() => onDir(null)} />
        <div />
        <DirButton dir="down" icon="↓" onDown={onDir} onUp={() => onDir(null)} />
        <div />
      </div>
      <button
        onPointerDown={(e) => {
          e.preventDefault();
          onBomb();
        }}
        className="w-20 h-20 rounded-full flex items-center justify-center text-3xl select-none active:scale-90 transition-transform"
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
  );
}

// ─── Composant de jeu ─────────────────────────────────────────────────────────
function BombermanGame({ ctx }: { ctx: RoomContext }) {
  const isHost = ctx.role === "host" || ctx.role === "solo";
  const [state, setState] = useState<GameState>(() => createInitialState(ctx.players));

  const dirsRef = useRef<Record<string, Dir>>({});
  const pendingBombsRef = useRef<string[]>([]);
  const stateRef = useRef<GameState>(state);
  stateRef.current = state;

  // Réception réseau
  useEffect(() => {
    ctx.onMessage((msg: NetMessage, from?: string) => {
      if (msg.type === "state" && !isHost) {
        setState(msg.payload as GameState);
      }
      if (msg.type === "move" && isHost && from) {
        const payload = msg.payload as { dir?: Dir; bomb?: boolean };
        if (payload.dir !== undefined) dirsRef.current[from] = payload.dir;
        if (payload.bomb) pendingBombsRef.current.push(from);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost]);

  // Boucle de simulation (hôte uniquement)
  useEffect(() => {
    if (!isHost) return;
    const interval = setInterval(() => {
      const bombsThisTick = pendingBombsRef.current;
      pendingBombsRef.current = [];
      setState((prev) => {
        const next = stepSimulation(prev, dirsRef.current, bombsThisTick);
        ctx.broadcast({ type: "state", payload: next });
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost]);

  const handleDir = useCallback(
    (dir: Dir) => {
      if (isHost) dirsRef.current[ctx.myId] = dir;
      else ctx.send({ type: "move", payload: { dir }, from: ctx.myId });
    },
    [ctx, isHost]
  );

  const handleBomb = useCallback(() => {
    if (isHost) pendingBombsRef.current.push(ctx.myId);
    else ctx.send({ type: "move", payload: { bomb: true }, from: ctx.myId });
  }, [ctx, isHost]);

  const restart = () => {
    if (!isHost) return;
    const next = createInitialState(ctx.players);
    setState(next);
    ctx.broadcast({ type: "state", payload: next });
  };

  const me = state.players.find((p) => p.id === ctx.myId);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 px-1">
        {state.players.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
            style={{
              background: p.alive ? `${p.color}22` : "var(--bg-input)",
              border: `1px solid ${p.alive ? p.color : "var(--border)"}`,
              color: p.alive ? p.color : "var(--text-muted)",
              opacity: p.alive ? 1 : 0.5,
              textDecoration: p.alive ? "none" : "line-through",
            }}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </div>
        ))}
      </div>

      <GameCanvas state={state} />

      {me && (
        <div className="flex justify-center gap-4 text-xs" style={{ color: "var(--text-muted)" }}>
          <span>💣 {me.bombsMax - me.bombsActive}/{me.bombsMax}</span>
          <span>🔥 {me.range}</span>
          <span>⚡ {me.speed.toFixed(1)}</span>
        </div>
      )}

      {state.status === "ended" ? (
        <div className="text-center space-y-3 animate-fade-in-up">
          <p className="font-display text-2xl" style={{ color: "var(--accent)" }}>
            {state.winnerId
              ? `${state.players.find((p) => p.id === state.winnerId)?.name ?? "?"} GAGNE !`
              : "MATCH NUL"}
          </p>
          {isHost ? (
            <button
              onClick={restart}
              className="px-6 py-3 rounded-xl font-display tracking-widest text-sm"
              style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}
            >
              REJOUER
            </button>
          ) : (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              En attente que l&apos;hôte relance une partie…
            </p>
          )}
        </div>
      ) : (
        <TouchControls onDir={handleDir} onBomb={handleBomb} />
      )}
    </div>
  );
}

export default function Bomberman() {
  return (
    <RoomConnect gameName="Bomberman" minPlayers={1}>
      {(ctx) => <BombermanGame ctx={ctx} />}
    </RoomConnect>
  );
}
