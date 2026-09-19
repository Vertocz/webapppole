"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import RoomConnect, { RoomContext } from "./RoomConnect";
import type { NetMessage } from "@/lib/p2pRoom";

/* ════════════════════════════════════════════════════════════════════════════
   1. RÈGLES
   Une position de joueur est un indice de case à virgule : la case occupée est
   Math.round(pos), et le joueur est dessiné en (pos + 0.5) * cell. Toute la
   géométrie en dépend — c'est ce point qui était incohérent dans l'ancienne
   version (Math.floor) et qui bloquait tous les déplacements.
   ═══════════════════════════════════════════════════════════════════════════ */

const COLS = 11;
const ROWS = 9;
const TICK_MS = 50; // 20 Hz
const BOMB_FUSE = 56; // ~2,8 s
const BLAST_TTL = 11; // ~0,55 s
const HALF = 0.34; // demi-taille du joueur, en cases
const BASE_SPEED = 4.2; // cases / seconde
const SPEED_BONUS = 0.8;
const MAX_SPEED = 7.4;
const MAX_RANGE = 6;
const MAX_BOMBS = 5;
const CRATE_CHANCE = 0.62;
const POWERUP_CHANCE = 0.32;
const SNAP = 0.02; // tolérance d'alignement dans un couloir

const SUDDEN_START = 1200; // 60 s avant que l'arène ne se referme
const SUDDEN_EVERY = 16; // une dalle toutes les 0,8 s

const PLAYER_COLORS = ["#E8192C", "#3B82F6", "#4ade80", "#F5B301"];
const BOT_NAMES = ["Bot Ada", "Bot Kim", "Bot Zoé"];

// 0 vide · 1 caisse · 2 mur · 3 bonus bombe · 4 bonus portée · 5 bonus vitesse
type Cell = 0 | 1 | 2 | 3 | 4 | 5;
type Grid = Cell[][];
type Dir = "up" | "down" | "left" | "right" | null;

const DIRV: Record<Exclude<Dir, null>, [number, number]> = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

interface PlayerState {
  id: string;
  name: string;
  row: number;
  col: number;
  dir: Dir;
  facing: Exclude<Dir, null>;
  alive: boolean;
  bot: boolean;
  bombsMax: number;
  bombsActive: number;
  range: number;
  speed: number;
  color: string;
  diedAt: number | null;
}

interface BombEntity {
  id: string;
  row: number;
  col: number;
  ownerId: string;
  range: number;
  timer: number;
  passable: string[]; // joueurs encore posés dessus, qui peuvent en sortir
}

interface BlastCell {
  row: number;
  col: number;
  ttl: number;
  kind: "core" | "arm";
}

interface GameState {
  grid: Grid;
  players: PlayerState[];
  bombs: BombEntity[];
  blasts: BlastCell[];
  status: "playing" | "ended";
  winnerId: string | null;
  tick: number;
  round: number;
  wins: Record<string, number>;
  ring: number; // nombre de dalles déjà tombées en mort subite
}

const SPAWNS: [number, number][] = [
  [1, 1],
  [ROWS - 2, COLS - 2],
  [1, COLS - 2],
  [ROWS - 2, 1],
];

const key = (r: number, c: number) => r * COLS + c;
const inside = (r: number, c: number) => r >= 0 && c >= 0 && r < ROWS && c < COLS;

function nearSpawn(r: number, c: number) {
  return SPAWNS.some(([sr, sc]) => Math.abs(sr - r) + Math.abs(sc - c) <= 2);
}

function buildGrid(): Grid {
  const grid: Grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0) as Cell[]);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1 || (r % 2 === 0 && c % 2 === 0)) {
        grid[r][c] = 2;
      } else if (!nearSpawn(r, c) && Math.random() < CRATE_CHANCE) {
        grid[r][c] = 1;
      }
    }
  }
  return grid;
}

/** Ordre en spirale des cases intérieures, pour la mort subite. */
function spiralOrder(): [number, number][] {
  const out: [number, number][] = [];
  let top = 1;
  let bottom = ROWS - 2;
  let left = 1;
  let right = COLS - 2;
  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) out.push([top, c]);
    for (let r = top + 1; r <= bottom; r++) out.push([r, right]);
    if (top < bottom) for (let c = right - 1; c >= left; c--) out.push([bottom, c]);
    if (left < right) for (let r = bottom - 1; r > top; r--) out.push([r, left]);
    top++;
    bottom--;
    left++;
    right--;
  }
  return out;
}
const SPIRAL = spiralOrder();

function makePlayer(
  id: string,
  name: string,
  i: number,
  bot: boolean
): PlayerState {
  return {
    id,
    name,
    row: SPAWNS[i % 4][0],
    col: SPAWNS[i % 4][1],
    dir: null,
    facing: i % 4 === 0 || i % 4 === 3 ? "right" : "left",
    alive: true,
    bot,
    bombsMax: 1,
    bombsActive: 0,
    range: 2,
    speed: BASE_SPEED,
    color: PLAYER_COLORS[i % 4],
    diedAt: null,
  };
}

function createInitialState(
  humans: { id: string; name: string }[],
  bots: number,
  wins: Record<string, number> = {},
  round = 1
): GameState {
  const list = humans.slice(0, 4).map((p, i) => makePlayer(p.id, p.name, i, false));
  for (let b = 0; b < bots && list.length < 4; b++) {
    list.push(makePlayer(`bot-${b + 1}`, BOT_NAMES[b] ?? `Bot ${b + 1}`, list.length, true));
  }
  return {
    grid: buildGrid(),
    players: list,
    bombs: [],
    blasts: [],
    status: "playing",
    winnerId: null,
    tick: 0,
    round,
    wins,
    ring: 0,
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   2. COLLISIONS & DÉPLACEMENT
   ═══════════════════════════════════════════════════════════════════════════ */

function cellSolid(grid: Grid, r: number, c: number) {
  if (!inside(r, c)) return true;
  const v = grid[r][c];
  return v === 1 || v === 2;
}

function bombAt(bombs: BombEntity[], r: number, c: number) {
  return bombs.find((b) => b.row === r && b.col === c);
}

function solid(grid: Grid, bombs: BombEntity[], r: number, c: number, who: string) {
  if (cellSolid(grid, r, c)) return true;
  const b = bombAt(bombs, r, c);
  return !!b && !b.passable.includes(who);
}

/** Le joueur occupe un carré de côté 2·HALF : on teste ses quatre coins. */
function freeAt(grid: Grid, bombs: BombEntity[], row: number, col: number, who: string) {
  const r0 = Math.round(row - HALF);
  const r1 = Math.round(row + HALF);
  const c0 = Math.round(col - HALF);
  const c1 = Math.round(col + HALF);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (solid(grid, bombs, r, c, who)) return false;
  return true;
}

/**
 * Déplacement avec aide au couloir : si on pousse vers une case libre mais qu'on
 * est légèrement décalé, on se recale au lieu de rester coincé sur l'angle.
 * C'est ce qui sépare un Bomberman jouable d'un Bomberman frustrant.
 */
function moveEntity(grid: Grid, bombs: BombEntity[], p: PlayerState, dt: number) {
  if (!p.dir) return;
  const [dr, dc] = DIRV[p.dir];
  const dist = p.speed * dt;

  if (freeAt(grid, bombs, p.row + dr * dist, p.col + dc * dist, p.id)) {
    p.row += dr * dist;
    p.col += dc * dist;
    if (dr !== 0 && Math.abs(p.col - Math.round(p.col)) < SNAP) p.col = Math.round(p.col);
    if (dc !== 0 && Math.abs(p.row - Math.round(p.row)) < SNAP) p.row = Math.round(p.row);
    return;
  }

  // Bloqué : on avance quand même au ras de l'obstacle (dichotomie), sinon le
  // joueur s'arrête jusqu'à un tiers de case trop tôt et ne s'aligne pas.
  let lo = 0;
  let hi = dist;
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    if (freeAt(grid, bombs, p.row + dr * mid, p.col + dc * mid, p.id)) lo = mid;
    else hi = mid;
  }
  if (lo > 1e-4) {
    p.row += dr * lo;
    p.col += dc * lo;
    return;
  }

  // Toujours bloqué : on tente de se réaligner sur l'axe perpendiculaire.
  const perpVal = dr !== 0 ? p.col : p.row;
  const target = Math.round(perpVal);
  const diff = target - perpVal;
  if (Math.abs(diff) < 1e-4) return;

  const aheadR = dr !== 0 ? Math.round(p.row) + dr : target;
  const aheadC = dc !== 0 ? Math.round(p.col) + dc : target;
  if (solid(grid, bombs, aheadR, aheadC, p.id)) return; // la case visée est un vrai mur

  const step = Math.sign(diff) * Math.min(dist, Math.abs(diff));
  if (dr !== 0) {
    if (freeAt(grid, bombs, p.row, p.col + step, p.id)) p.col = Math.abs(diff) <= dist ? target : p.col + step;
  } else {
    if (freeAt(grid, bombs, p.row + step, p.col, p.id)) p.row = Math.abs(diff) <= dist ? target : p.row + step;
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   3. EXPLOSIONS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Cases touchées par une bombe, caisses comprises (la caisse arrête le souffle). */
function blastCells(grid: Grid, bomb: BombEntity): [number, number][] {
  const out: [number, number][] = [[bomb.row, bomb.col]];
  for (const [dr, dc] of Object.values(DIRV)) {
    for (let k = 1; k <= bomb.range; k++) {
      const r = bomb.row + dr * k;
      const c = bomb.col + dc * k;
      if (!inside(r, c) || grid[r][c] === 2) break;
      out.push([r, c]);
      if (grid[r][c] === 1) break;
    }
  }
  return out;
}

/** Carte du danger : case → nombre de ticks avant qu'elle ne brûle. */
function dangerMap(grid: Grid, bombs: BombEntity[], blasts: BlastCell[]) {
  const m = new Map<number, number>();
  const put = (r: number, c: number, t: number) => {
    const k = key(r, c);
    const cur = m.get(k);
    if (cur === undefined || t < cur) m.set(k, t);
  };
  for (const b of bombs) for (const [r, c] of blastCells(grid, b)) put(r, c, b.timer);
  for (const e of blasts) put(e.row, e.col, 0);
  return m;
}

/* ════════════════════════════════════════════════════════════════════════════
   4. SIMULATION (autorité : l'hôte)
   ═══════════════════════════════════════════════════════════════════════════ */

function stepSimulation(prev: GameState, inputDirs: Record<string, Dir>, inputDrops: string[]): GameState {
  if (prev.status === "ended") return prev;

  const dirs = { ...inputDirs };
  const drops = [...inputDrops];
  const grid = prev.grid.map((r) => [...r]) as Grid;
  const players = prev.players.map((p) => ({ ...p }));
  let bombs = prev.bombs.map((b) => ({ ...b, passable: [...b.passable] }));
  const blasts: BlastCell[] = prev.blasts.map((e) => ({ ...e, ttl: e.ttl - 1 })).filter((e) => e.ttl > 0);
  const tick = prev.tick + 1;
  const dt = TICK_MS / 1000;

  // 1. Décisions des bots
  for (const p of players) {
    if (!p.alive || !p.bot) continue;
    const d = botThink({ ...prev, grid, bombs }, p);
    dirs[p.id] = d.dir;
    if (d.bomb) drops.push(p.id);
  }

  // 2. Déplacements
  for (const p of players) {
    if (!p.alive) continue;
    p.dir = dirs[p.id] ?? null;
    if (p.dir) p.facing = p.dir;
    moveEntity(grid, bombs, p, dt);

    const r = Math.round(p.row);
    const c = Math.round(p.col);
    const cell = grid[r]?.[c];
    if (cell === 3) p.bombsMax = Math.min(MAX_BOMBS, p.bombsMax + 1);
    else if (cell === 4) p.range = Math.min(MAX_RANGE, p.range + 1);
    else if (cell === 5) p.speed = Math.min(MAX_SPEED, p.speed + SPEED_BONUS);
    if (cell === 3 || cell === 4 || cell === 5) grid[r][c] = 0;
  }

  // 3. Une bombe redevient solide dès que son poseur en est sorti
  for (const b of bombs) {
    b.passable = b.passable.filter((id) => {
      const p = players.find((pl) => pl.id === id);
      if (!p || !p.alive) return false;
      return (
        Math.round(p.row - HALF) <= b.row &&
        Math.round(p.row + HALF) >= b.row &&
        Math.round(p.col - HALF) <= b.col &&
        Math.round(p.col + HALF) >= b.col
      );
    });
  }

  // 4. Poses
  for (const id of drops) {
    const p = players.find((pl) => pl.id === id);
    if (!p || !p.alive || p.bombsActive >= p.bombsMax) continue;
    const r = Math.round(p.row);
    const c = Math.round(p.col);
    if (bombAt(bombs, r, c)) continue;
    bombs.push({
      id: `${id}-${tick}-${bombs.length}`,
      row: r,
      col: c,
      ownerId: id,
      range: p.range,
      timer: BOMB_FUSE,
      passable: players
        .filter(
          (q) =>
            q.alive &&
            Math.round(q.row - HALF) <= r &&
            Math.round(q.row + HALF) >= r &&
            Math.round(q.col - HALF) <= c &&
            Math.round(q.col + HALF) >= c
        )
        .map((q) => q.id),
    });
    p.bombsActive++;
  }

  // 5. Détonations, avec réaction en chaîne
  const fuseOut = bombs.filter((b) => --b.timer <= 0).map((b) => b.id);
  const done = new Set<string>();
  const explode = (bombId: string) => {
    if (done.has(bombId)) return;
    const bomb = bombs.find((b) => b.id === bombId);
    if (!bomb) return;
    done.add(bombId);

    blasts.push({ row: bomb.row, col: bomb.col, ttl: BLAST_TTL, kind: "core" });
    for (const [dr, dc] of Object.values(DIRV)) {
      for (let k = 1; k <= bomb.range; k++) {
        const r = bomb.row + dr * k;
        const c = bomb.col + dc * k;
        if (!inside(r, c) || grid[r][c] === 2) break;
        blasts.push({ row: r, col: c, ttl: BLAST_TTL, kind: "arm" });
        const chained = bombs.find((b) => b.row === r && b.col === c && b.id !== bomb.id);
        if (chained) {
          explode(chained.id);
          break;
        }
        if (grid[r][c] === 1) {
          grid[r][c] =
            Math.random() < POWERUP_CHANCE ? ((3 + Math.floor(Math.random() * 3)) as Cell) : 0;
          break;
        }
      }
    }
    const owner = players.find((pl) => pl.id === bomb.ownerId);
    if (owner) owner.bombsActive = Math.max(0, owner.bombsActive - 1);
  };
  fuseOut.forEach(explode);
  bombs = bombs.filter((b) => !done.has(b.id));

  // 6. Mort subite : l'arène se referme en spirale
  let ring = prev.ring;
  if (tick > SUDDEN_START && (tick - SUDDEN_START) % SUDDEN_EVERY === 0 && ring < SPIRAL.length) {
    const [r, c] = SPIRAL[ring];
    ring++;
    grid[r][c] = 2;
    bombs = bombs.filter((b) => {
      if (b.row !== r || b.col !== c) return true;
      const o = players.find((pl) => pl.id === b.ownerId);
      if (o) o.bombsActive = Math.max(0, o.bombsActive - 1);
      return false;
    });
    for (const p of players) {
      if (p.alive && Math.round(p.row) === r && Math.round(p.col) === c) {
        p.alive = false;
        p.diedAt = tick;
      }
    }
  }

  // 7. Joueurs pris dans le souffle
  const burning = new Set(blasts.map((e) => key(e.row, e.col)));
  for (const p of players) {
    if (!p.alive) continue;
    if (burning.has(key(Math.round(p.row), Math.round(p.col)))) {
      p.alive = false;
      p.diedAt = tick;
      p.dir = null;
    }
  }

  // 8. Fin de manche
  let status: GameState["status"] = prev.status;
  let winnerId = prev.winnerId;
  const wins = { ...prev.wins };
  const alive = players.filter((p) => p.alive);
  if (players.length > 1 ? alive.length <= 1 : alive.length === 0) {
    status = "ended";
    winnerId = alive.length === 1 ? alive[0].id : null;
    if (winnerId) wins[winnerId] = (wins[winnerId] ?? 0) + 1;
  }

  return { grid, players, bombs, blasts, status, winnerId, tick, round: prev.round, wins, ring };
}

/* ════════════════════════════════════════════════════════════════════════════
   5. BOTS
   Un bot qui se suicide ne sert à rien : toute décision de poser une bombe est
   conditionnée à l'existence d'une fuite, vérifiée par parcours en largeur.
   ═══════════════════════════════════════════════════════════════════════════ */

interface Flood {
  dist: Int16Array;
  from: Int16Array;
}

/**
 * Parcours en largeur conscient du temps : on refuse d'entrer dans une case qui
 * aura explosé avant qu'on n'en soit ressorti. Sans ça, un bot fuit sa propre
 * bombe en traversant tranquillement la zone de souffle d'une autre.
 */
function flood(
  grid: Grid,
  bombs: BombEntity[],
  sr: number,
  sc: number,
  who: string,
  timing?: { danger: Map<number, number>; tpc: number; margin: number }
): Flood {
  const dist = new Int16Array(ROWS * COLS).fill(-1);
  const from = new Int16Array(ROWS * COLS).fill(-1);
  const q: number[] = [key(sr, sc)];
  dist[key(sr, sc)] = 0;
  for (let h = 0; h < q.length; h++) {
    const k = q[h];
    const r = Math.floor(k / COLS);
    const c = k % COLS;
    for (const [dr, dc] of Object.values(DIRV)) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inside(nr, nc)) continue;
      const nk = key(nr, nc);
      if (dist[nk] !== -1) continue;
      if (solid(grid, bombs, nr, nc, who)) continue;
      if (timing) {
        const risk = timing.danger.get(nk);
        if (risk !== undefined && risk < (dist[k] + 1) * timing.tpc + timing.margin) continue;
      }
      dist[nk] = dist[k] + 1;
      from[nk] = k;
      q.push(nk);
    }
  }
  return { dist, from };
}

/** Première direction à prendre pour rejoindre `goal`. */
function firstStep(f: Flood, sr: number, sc: number, goal: number): Dir {
  let cur = goal;
  const start = key(sr, sc);
  if (cur === start) return null;
  while (f.from[cur] !== start && f.from[cur] !== -1) cur = f.from[cur];
  if (f.from[cur] === -1) return null;
  const dr = Math.floor(cur / COLS) - sr;
  const dc = (cur % COLS) - sc;
  if (dr === -1) return "up";
  if (dr === 1) return "down";
  if (dc === -1) return "left";
  if (dc === 1) return "right";
  return null;
}

function botThink(state: GameState, bot: PlayerState): { dir: Dir; bomb: boolean } {
  const { grid, bombs, players, blasts } = state;
  const sr = Math.round(bot.row);
  const sc = Math.round(bot.col);
  const danger = dangerMap(grid, bombs, blasts);
  const tpc = Math.ceil(1000 / (bot.speed * TICK_MS));
  const f = flood(grid, bombs, sr, sc, bot.id, { danger, tpc, margin: 4 });

  // a. En danger : on fuit. « Sûre » veut dire hors de TOUTE zone de souffle —
  // une case simplement pas encore en feu reste un piège (typiquement la case
  // où l'on vient de poser sa propre bombe).
  if (danger.has(key(sr, sc))) {
    // Deux bots qui fuient au même endroit meurent de la même bombe : on
    // pénalise les refuges déjà occupés pour qu'ils se dispersent.
    const taken = new Set(
      players
        .filter((p) => p.alive && p.id !== bot.id)
        .map((p) => key(Math.round(p.row), Math.round(p.col)))
    );
    let safe = -1;
    let safeD = 1e9;
    for (let k = 0; k < ROWS * COLS; k++) {
      const d = f.dist[k];
      if (d < 0 || d > 12) continue;
      if (danger.has(k)) continue;
      const cost = d + (taken.has(k) ? 4 : 0);
      if (cost < safeD) {
        safeD = cost;
        safe = k;
      }
    }
    if (safe >= 0) return { dir: firstStep(f, sr, sc, safe), bomb: false };

    // Aucune issue propre : on gagne le plus de temps possible.
    const loose = flood(grid, bombs, sr, sc, bot.id);
    let fallback = -1;
    let bestMargin = danger.get(key(sr, sc)) ?? 0;
    for (let k = 0; k < ROWS * COLS; k++) {
      const d = loose.dist[k];
      if (d <= 0 || d > 8) continue;
      const risk = danger.get(k);
      const margin = (risk ?? 999) - d * tpc;
      if (margin > bestMargin) {
        bestMargin = margin;
        fallback = k;
      }
    }
    return { dir: fallback >= 0 ? firstStep(loose, sr, sc, fallback) : null, bomb: false };
  }

  // b. Poser une bombe ? Seulement si une fuite existe.
  const escapeExists = () => {
    const virtual: BombEntity = {
      id: "virtuelle",
      row: sr,
      col: sc,
      ownerId: bot.id,
      range: bot.range,
      timer: BOMB_FUSE,
      passable: [bot.id],
    };
    const all = [...bombs, virtual];
    const d2 = dangerMap(grid, all, blasts);
    const f2 = flood(grid, all, sr, sc, bot.id, { danger: d2, tpc, margin: 4 });
    for (let k = 0; k < ROWS * COLS; k++) {
      const d = f2.dist[k];
      if (d <= 0 || d > 8) continue;
      if (d2.get(k) === undefined) return true; // refuge atteignable et hors souffle
    }
    return false;
  };

  if (bot.bombsActive < bot.bombsMax && !bombAt(bombs, sr, sc)) {
    let worth = false;
    for (const [dr, dc] of Object.values(DIRV)) {
      for (let k = 1; k <= bot.range; k++) {
        const r = sr + dr * k;
        const c = sc + dc * k;
        if (!inside(r, c) || grid[r][c] === 2) break;
        if (grid[r][c] === 1) {
          worth = true;
          break;
        }
        if (players.some((p) => p.alive && p.id !== bot.id && Math.round(p.row) === r && Math.round(p.col) === c)) {
          worth = true;
          break;
        }
      }
    }
    if (worth && Math.random() < 0.55 && escapeExists()) return { dir: null, bomb: true };
  }

  // c. Sinon : cap sur la cible utile la plus proche (bonus, caisse, adversaire),
  // par un chemin qui contourne les zones minées.
  const safeFlood = flood(grid, bombs, sr, sc, bot.id, { danger, tpc, margin: 200 });
  let best = -1;
  let bestScore = -1e9;
  for (let k = 0; k < ROWS * COLS; k++) {
    const d = safeFlood.dist[k];
    if (d < 0) continue;
    if (danger.has(k)) continue; // on ne se fixe pas un objectif dans une zone minée
    const r = Math.floor(k / COLS);
    const c = k % COLS;
    let value = 0;
    const v = grid[r][c];
    if (v === 3 || v === 4 || v === 5) value = 30;
    for (const [dr, dc] of Object.values(DIRV)) {
      if (inside(r + dr, c + dc) && grid[r + dr][c + dc] === 1) value = Math.max(value, 14);
    }
    for (const p of players) {
      if (!p.alive || p.id === bot.id) continue;
      const pd = Math.abs(Math.round(p.row) - r) + Math.abs(Math.round(p.col) - c);
      value = Math.max(value, 20 - pd * 2);
    }
    const score = value - d * 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  }
  if (best >= 0) {
    const dir = firstStep(safeFlood, sr, sc, best);
    if (dir) return { dir, bomb: false };
  }
  return { dir: null, bomb: false };
}

/* ════════════════════════════════════════════════════════════════════════════
   6. RENDU
   Boucle requestAnimationFrame avec interpolation entre deux ticks : la
   simulation tourne à 20 Hz, l'affichage reste fluide.
   ═══════════════════════════════════════════════════════════════════════════ */

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

interface Palette {
  floorA: string;
  floorB: string;
  wall: string;
  wallTop: string;
  crate: string;
  crateLine: string;
  accent: string;
}

function drawBoard(
  g: CanvasRenderingContext2D,
  s: GameState,
  prev: GameState | null,
  alpha: number,
  cell: number,
  now: number,
  pal: Palette,
  meId: string
) {
  const W = COLS * cell;
  const H = ROWS * cell;
  g.clearRect(0, 0, W, H);

  // Sol
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      g.fillStyle = (r + c) % 2 === 0 ? pal.floorA : pal.floorB;
      g.fillRect(c * cell, r * cell, cell, cell);
    }
  }

  // Zone de souffle imminente : on prévient le joueur avant que ça pète
  const dm = dangerMap(s.grid, s.bombs, []);
  dm.forEach((t, k) => {
    if (t > 26) return;
    const r = Math.floor(k / COLS);
    const c = k % COLS;
    const puls = 0.5 + 0.5 * Math.sin(now / (60 + t * 6));
    g.fillStyle = `rgba(232,25,44,${0.06 + (1 - t / 26) * 0.14 * puls})`;
    g.fillRect(c * cell, r * cell, cell, cell);
  });

  // Blocs
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = s.grid[r][c];
      const x = c * cell;
      const y = r * cell;
      if (v === 2) {
        g.fillStyle = pal.wall;
        roundRect(g, x + 1, y + 1, cell - 2, cell - 2, cell * 0.14);
        g.fill();
        g.fillStyle = pal.wallTop;
        roundRect(g, x + 1, y + 1, cell - 2, (cell - 2) * 0.34, cell * 0.14);
        g.fill();
      } else if (v === 1) {
        g.fillStyle = pal.crate;
        roundRect(g, x + 2, y + 2, cell - 4, cell - 4, cell * 0.12);
        g.fill();
        g.strokeStyle = pal.crateLine;
        g.lineWidth = Math.max(1, cell * 0.045);
        g.beginPath();
        g.moveTo(x + cell * 0.2, y + cell * 0.38);
        g.lineTo(x + cell * 0.8, y + cell * 0.38);
        g.moveTo(x + cell * 0.2, y + cell * 0.62);
        g.lineTo(x + cell * 0.8, y + cell * 0.62);
        g.stroke();
      } else if (v >= 3) {
        const col = v === 3 ? "#4ade80" : v === 4 ? pal.accent : "#60a5fa";
        const bob = Math.sin(now / 320 + r + c) * cell * 0.04;
        g.fillStyle = col;
        g.globalAlpha = 0.22;
        g.beginPath();
        g.arc(x + cell / 2, y + cell / 2 + bob, cell * 0.36, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
        roundRect(g, x + cell * 0.26, y + cell * 0.26 + bob, cell * 0.48, cell * 0.48, cell * 0.12);
        g.fill();
        g.fillStyle = "#08111F";
        g.font = `bold ${Math.floor(cell * 0.3)}px system-ui, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(v === 3 ? "+" : v === 4 ? "✳" : "»", x + cell / 2, y + cell / 2 + bob + cell * 0.02);
      }
    }
  }

  // Bombes
  for (const b of s.bombs) {
    const x = (b.col + 0.5) * cell;
    const y = (b.row + 0.5) * cell;
    const urgency = 1 - b.timer / BOMB_FUSE;
    const beat = 1 + 0.16 * Math.abs(Math.sin(now / (260 - urgency * 170)));
    const rad = cell * 0.31 * beat;
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.beginPath();
    g.ellipse(x, y + cell * 0.3, rad * 0.9, rad * 0.35, 0, 0, Math.PI * 2);
    g.fill();
    const grad = g.createRadialGradient(x - rad * 0.35, y - rad * 0.4, rad * 0.1, x, y, rad);
    grad.addColorStop(0, "#4B5567");
    grad.addColorStop(0.5, "#161C29");
    grad.addColorStop(1, "#05080F");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = `rgba(232,25,44,${0.3 + urgency * 0.7})`;
    g.lineWidth = Math.max(1.5, cell * 0.05);
    g.stroke();
    g.fillStyle = Math.sin(now / 70) > 0 ? "#FFD166" : "#FF7A1A";
    g.beginPath();
    g.arc(x + rad * 0.5, y - rad * 0.85, cell * 0.07, 0, Math.PI * 2);
    g.fill();
  }

  // Souffle
  for (const e of s.blasts) {
    const life = e.ttl / BLAST_TTL;
    const grow = Math.min(1, (1 - life) * 4);
    const size = cell * (0.5 + 0.5 * grow) * (e.kind === "core" ? 1 : 0.94);
    const x = (e.col + 0.5) * cell;
    const y = (e.row + 0.5) * cell;
    const grad = g.createRadialGradient(x, y, 0, x, y, size * 0.75);
    grad.addColorStop(0, `rgba(255,255,236,${0.95 * life})`);
    grad.addColorStop(0.45, `rgba(255,176,32,${0.9 * life})`);
    grad.addColorStop(1, `rgba(232,25,44,${0.18 * life})`);
    g.fillStyle = grad;
    roundRect(g, x - size / 2, y - size / 2, size, size, cell * 0.28);
    g.fill();
  }

  // Joueurs
  const order = [...s.players].sort((a, b) => a.row - b.row);
  for (const p of order) {
    const before = prev?.players.find((q) => q.id === p.id);
    const row = before && p.alive && before.alive ? before.row + (p.row - before.row) * alpha : p.row;
    const col = before && p.alive && before.alive ? before.col + (p.col - before.col) * alpha : p.col;
    const x = (col + 0.5) * cell;
    const y = (row + 0.5) * cell;
    const rad = cell * 0.33;

    if (!p.alive) {
      const age = p.diedAt !== null ? s.tick - p.diedAt : 99;
      if (age > 14) continue;
      g.globalAlpha = Math.max(0, 1 - age / 14);
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(x, y - age * cell * 0.03, rad * (1 + age * 0.06), 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      continue;
    }

    g.fillStyle = "rgba(0,0,0,0.35)";
    g.beginPath();
    g.ellipse(x, y + rad * 0.85, rad * 0.85, rad * 0.32, 0, 0, Math.PI * 2);
    g.fill();

    const body = g.createLinearGradient(x, y - rad, x, y + rad);
    body.addColorStop(0, p.color);
    body.addColorStop(1, "rgba(0,0,0,0.45)");
    g.fillStyle = body;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = p.id === meId ? "#FFFFFF" : "rgba(0,0,0,0.45)";
    g.lineWidth = Math.max(1.5, cell * (p.id === meId ? 0.07 : 0.04));
    g.stroke();

    const [fr, fc] = DIRV[p.facing];
    const ex = x + fc * rad * 0.3;
    const ey = y + fr * rad * 0.22 - rad * 0.08;
    g.fillStyle = "#FFFFFF";
    for (const off of fc !== 0 ? [-0.16, 0.16] : [-0.22, 0.22]) {
      g.beginPath();
      g.arc(ex + (fc !== 0 ? 0 : off * rad * 1.4), ey + (fc !== 0 ? off * rad * 1.4 : 0), rad * 0.17, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "#0B1220";
    for (const off of fc !== 0 ? [-0.16, 0.16] : [-0.22, 0.22]) {
      g.beginPath();
      g.arc(
        ex + (fc !== 0 ? fc * rad * 0.06 : off * rad * 1.4),
        ey + (fc !== 0 ? off * rad * 1.4 : fr * rad * 0.06),
        rad * 0.08,
        0,
        Math.PI * 2
      );
      g.fill();
    }
  }
}

function GameCanvas({ state, meId }: { state: GameState; meId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cur = useRef<{ s: GameState; t: number } | null>(null);
  const prev = useRef<GameState | null>(null);

  useEffect(() => {
    if (cur.current && cur.current.s !== state) prev.current = cur.current.s;
    cur.current = { s: state, t: performance.now() };
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let cell = 0;
    let pal: Palette = {
      floorA: "#0C1322",
      floorB: "#0A101C",
      wall: "#1B3A8C",
      wallTop: "rgba(255,255,255,0.14)",
      crate: "#C8A96E",
      crateLine: "rgba(0,0,0,0.28)",
      accent: "#E8192C",
    };

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      cell = w / COLS;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(cell * ROWS * dpr);
      const g = canvas.getContext("2d");
      if (g) g.setTransform(dpr, 0, 0, dpr, 0, 0);
      pal = {
        floorA: cssVar("--bg-card", "#0C1322"),
        floorB: cssVar("--bg-base", "#0A101C"),
        wall: cssVar("--primary", "#1B3A8C"),
        wallTop: "rgba(255,255,255,0.14)",
        crate: "#C8A96E",
        crateLine: "rgba(0,0,0,0.28)",
        accent: cssVar("--accent", "#E8192C"),
      };
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const g = canvas.getContext("2d");
      const c = cur.current;
      if (!g || !c || cell === 0) return;
      const alpha = Math.min(1, (now - c.t) / TICK_MS);
      drawBoard(g, c.s, prev.current, alpha, cell, now, pal, meId);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [meId]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-2xl block"
      style={{ aspectRatio: `${COLS} / ${ROWS}`, border: "1px solid var(--border)", background: "var(--bg-base)" }}
    />
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   7. CONTRÔLES
   Un stick analogique : un seul doigt posé, plus de glissement hors du bouton.
   ═══════════════════════════════════════════════════════════════════════════ */

function Joystick({ onDir }: { onDir: (d: Dir) => void }) {
  const padRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const dirRef = useRef<Dir>(null);
  const [active, setActive] = useState(false);

  const R = 46;
  const DEAD = 12;

  const setKnob = (dx: number, dy: number) => {
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  const emit = (d: Dir) => {
    if (dirRef.current === d) return;
    dirRef.current = d;
    onDir(d);
  };

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const r = padRef.current?.getBoundingClientRect();
    if (!r) return;
    originRef.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setActive(true);
    move(e);
  };

  const move = (e: React.PointerEvent) => {
    const o = originRef.current;
    if (!o) return;
    let dx = e.clientX - o.x;
    let dy = e.clientY - o.y;
    const len = Math.hypot(dx, dy);
    if (len > R) {
      dx = (dx / len) * R;
      dy = (dy / len) * R;
    }
    setKnob(dx, dy);
    if (len < DEAD) return emit(null);
    emit(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
  };

  const up = () => {
    originRef.current = null;
    setActive(false);
    setKnob(0, 0);
    emit(null);
  };

  return (
    <div
      ref={padRef}
      onPointerDown={down}
      onPointerMove={(e) => originRef.current && move(e)}
      onPointerUp={up}
      onPointerCancel={up}
      className="relative rounded-full select-none shrink-0"
      style={{
        width: 132,
        height: 132,
        touchAction: "none",
        background: "var(--bg-input)",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          ref={knobRef}
          className="rounded-full"
          style={{
            width: 56,
            height: 56,
            background: "linear-gradient(135deg,var(--accent),var(--accent2))",
            transition: active ? "none" : "transform .18s ease-out",
            boxShadow: "0 3px 14px rgba(0,0,0,.45)",
          }}
        />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   8. JEU
   ═══════════════════════════════════════════════════════════════════════════ */

function BombermanGame({ ctx }: { ctx: RoomContext }) {
  const isHost = ctx.role === "host" || ctx.role === "solo";
  const [bots, setBots] = useState(() => (ctx.role === "solo" ? 2 : 0));
  const [state, setState] = useState<GameState>(() => createInitialState(ctx.players, ctx.role === "solo" ? 2 : 0));

  const dirsRef = useRef<Record<string, Dir>>({});
  const dropsRef = useRef<string[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const botsRef = useRef(bots);
  botsRef.current = bots;

  const publish = useCallback(
    (next: GameState) => {
      setState(next);
      if (isHost) ctx.broadcast({ type: "state", payload: next });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isHost]
  );

  // Réseau
  useEffect(() => {
    ctx.onMessage((msg: NetMessage, from?: string) => {
      if (msg.type === "state" && !isHost) setState(msg.payload as GameState);
      if (msg.type === "move" && isHost && from) {
        const p = msg.payload as { dir?: Dir; bomb?: boolean };
        if (p.dir !== undefined) dirsRef.current[from] = p.dir;
        if (p.bomb) dropsRef.current.push(from);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost]);

  // Arrivée / départ d'un joueur
  const roster = ctx.players.map((p) => p.id).join("|");
  useEffect(() => {
    if (!isHost) return;
    const cur = stateRef.current;
    const known = new Set(cur.players.filter((p) => !p.bot).map((p) => p.id));
    const joined = ctx.players.some((p) => !known.has(p.id));
    if (joined) {
      publish(createInitialState(ctx.players, botsRef.current, cur.wins, cur.round));
      return;
    }
    const present = new Set(ctx.players.map((p) => p.id));
    if (cur.players.some((p) => !p.bot && !present.has(p.id) && p.alive)) {
      publish({
        ...cur,
        players: cur.players.map((p) =>
          !p.bot && !present.has(p.id) ? { ...p, alive: false, diedAt: cur.tick } : p
        ),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, isHost]);

  // Boucle de simulation (hôte)
  useEffect(() => {
    if (!isHost) return;
    const timer = setInterval(() => {
      const drops = dropsRef.current;
      dropsRef.current = [];
      const next = stepSimulation(stateRef.current, dirsRef.current, drops);
      if (next === stateRef.current) return;
      stateRef.current = next;
      setState(next);
      ctx.broadcast({ type: "state", payload: next });
    }, TICK_MS);
    return () => clearInterval(timer);
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
    if (isHost) dropsRef.current.push(ctx.myId);
    else ctx.send({ type: "move", payload: { bomb: true }, from: ctx.myId });
  }, [ctx, isHost]);

  // Clavier
  useEffect(() => {
    const map: Record<string, Exclude<Dir, null>> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      z: "up",
      w: "up",
      s: "down",
      q: "left",
      a: "left",
      d: "right",
    };
    const held: Exclude<Dir, null>[] = [];
    const onDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault();
        handleBomb();
        return;
      }
      const d = map[e.key];
      if (!d) return;
      e.preventDefault();
      if (!held.includes(d)) held.push(d);
      handleDir(held[held.length - 1]);
    };
    const onUp = (e: KeyboardEvent) => {
      const d = map[e.key];
      if (!d) return;
      const i = held.indexOf(d);
      if (i >= 0) held.splice(i, 1);
      handleDir(held.length ? held[held.length - 1] : null);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [handleDir, handleBomb]);

  const restart = (nbBots = bots) => {
    if (!isHost) return;
    dirsRef.current = {};
    dropsRef.current = [];
    const next = createInitialState(ctx.players, nbBots, stateRef.current.wins, stateRef.current.round + 1);
    stateRef.current = next;
    publish(next);
  };

  const me = state.players.find((p) => p.id === ctx.myId);
  const suddenIn = Math.max(0, Math.ceil(((SUDDEN_START - state.tick) * TICK_MS) / 1000));
  const closing = state.tick > SUDDEN_START;

  return (
    <div className="space-y-3">
      <style>{`
        @keyframes bb-pop{0%{opacity:0;transform:scale(.94)}100%{opacity:1;transform:none}}
        .bb-pop{animation:bb-pop .28s cubic-bezier(.2,.8,.3,1) both}
        @media (prefers-reduced-motion:reduce){.bb-pop{animation:none}}
      `}</style>

      <div className="flex flex-wrap items-center gap-2 px-1">
        {state.players.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
            style={{
              background: p.alive ? `${p.color}22` : "var(--bg-input)",
              border: `1px solid ${p.alive ? p.color : "var(--border)"}`,
              color: p.alive ? p.color : "var(--text-muted)",
              opacity: p.alive ? 1 : 0.55,
            }}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span style={{ textDecoration: p.alive ? "none" : "line-through" }}>{p.name}</span>
            {(state.wins[p.id] ?? 0) > 0 && <span style={{ color: "var(--text-muted)" }}>· {state.wins[p.id]}</span>}
          </div>
        ))}
        <span className="ml-auto text-xs" style={{ color: closing ? "var(--accent)" : "var(--text-muted)" }}>
          {closing ? "L'arène se referme" : suddenIn < 30 ? `Mort subite dans ${suddenIn} s` : `Manche ${state.round}`}
        </span>
      </div>

      <GameCanvas state={state} meId={ctx.myId} />

      {me && (
        <div className="flex justify-center gap-5 text-xs" style={{ color: "var(--text-muted)" }}>
          <span>💣 {me.bombsMax - me.bombsActive}/{me.bombsMax}</span>
          <span>🔥 {me.range}</span>
          <span>⚡ {me.speed.toFixed(1)}</span>
        </div>
      )}

      {state.status === "ended" ? (
        <div className="text-center space-y-3 bb-pop">
          <p className="font-display text-2xl" style={{ color: "var(--accent)" }}>
            {state.winnerId
              ? `${state.players.find((p) => p.id === state.winnerId)?.name ?? "?"} GAGNE !`
              : "MATCH NUL"}
          </p>
          {isHost ? (
            <button
              onClick={() => restart()}
              className="px-6 py-3 rounded-xl font-display tracking-widest text-sm active:scale-95 transition-transform"
              style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}
            >
              MANCHE SUIVANTE
            </button>
          ) : (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              En attente que l&apos;hôte relance une partie…
            </p>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between px-2" style={{ touchAction: "none" }}>
          <Joystick onDir={handleDir} />
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              handleBomb();
            }}
            disabled={!me?.alive}
            className="w-24 h-24 rounded-full flex items-center justify-center text-4xl select-none active:scale-90 transition-transform disabled:opacity-40"
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
      )}

      {isHost && (
        <div className="flex items-center gap-2 justify-center">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Bots
          </span>
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: "var(--bg-input)" }}>
            {[0, 1, 2, 3].map((n) => (
              <button
                key={n}
                disabled={ctx.players.length + n > 4}
                onClick={() => {
                  setBots(n);
                  botsRef.current = n;
                  restart(n);
                }}
                className="w-8 h-8 rounded-lg text-xs font-medium disabled:opacity-30"
                style={n === bots ? { background: "var(--accent)", color: "#fff" } : { color: "var(--text-muted)" }}
              >
                {n}
              </button>
            ))}
          </div>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            (relance la manche)
          </span>
        </div>
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
