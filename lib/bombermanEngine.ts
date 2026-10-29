/**
 * bombermanEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Logique du Bomberman, sans React ni réseau : testable seule.
 *
 * Coordonnées : la position d'un joueur est le CENTRE de son personnage, en
 * unités de case. La case (r, c) couvre [r, r+1[ × [c, c+1[ et son centre est
 * (r + 0.5, c + 0.5). La case occupée par un joueur est floor(position).
 *
 * Réseau : chaque téléphone calcule lui-même le déplacement de son joueur (aucun
 * décalage ressenti) et envoie sa position. L'hôte reste l'arbitre de tout le
 * reste : bombes, flammes, bonus, morts, victoire.
 */

// ─── Réglages ────────────────────────────────────────────────────────────────
export const COLS = 13;
export const ROWS = 11;
export const TICK_MS = 50; // 20 Hz
export const MAX_PLAYERS = 6;

export const COUNTDOWN_TICKS = 60; // 3 s avant le départ
export const BOMB_FUSE_TICKS = 50; // 2,5 s
export const FLAME_TICKS = 10; // 0,5 s
/**
 * Il faut rester ce nombre de ticks d'affilée dans les flammes pour mourir (0,15 s).
 * Même règle pour tous : ça absorbe le petit retard réseau des positions (sinon on
 * meurt alors qu'on est à l'abri sur son propre écran).
 */
export const BURN_TICKS = 3;
export const SUDDEN_DEATH_AFTER_TICKS = 20 * 90; // mort subite après 1 min 30 de jeu
export const SUDDEN_DEATH_EVERY_TICKS = 6; // un bloc tombe toutes les 0,3 s

export const HALF = 0.4; // demi-largeur du personnage (en cases)
export const CORNER_ASSIST = 0.45; // tolérance de prise de virage
export const BASE_SPEED = 3.4; // cases / s
export const SPEED_BONUS = 0.6;
export const MAX_SPEED = 6.4;
export const START_RANGE = 2;
export const MAX_RANGE = 8;
export const MAX_BOMBS = 6;
export const CRATE_CHANCE = 0.62;
export const ITEM_CHANCE = 0.35;

export const PLAYER_COLORS = ["#FF4D5E", "#4D8DFF", "#3FD68C", "#FFC23D", "#B57BFF", "#FF8A3D"];

// Cases : 0 sol, 1 caisse, 2 mur, 3 bonus bombe, 4 bonus flamme, 5 bonus vitesse
export type Cell = 0 | 1 | 2 | 3 | 4 | 5;
export const EMPTY = 0, CRATE = 1, WALL = 2, ITEM_BOMB = 3, ITEM_FIRE = 4, ITEM_SPEED = 5;
export type Dir = "up" | "down" | "left" | "right";

export interface BPlayer {
  id: string;
  name: string;
  color: string;
  row: number; // centre
  col: number;
  face: Dir;
  alive: boolean;
  bombsMax: number;
  range: number;
  speed: number;
}

export interface Bomb {
  id: number;
  row: number; // case
  col: number;
  owner: string;
  range: number;
  timer: number;
}

/** Morceau de flamme : kind 0 centre, 1 horizontal, 2 vertical. */
export interface Flame {
  row: number;
  col: number;
  ttl: number;
  kind: 0 | 1 | 2;
}

export interface GameState {
  round: number;
  tick: number;
  status: "countdown" | "playing" | "ended";
  grid: Cell[]; // ROWS × COLS, à plat
  gridVersion: number;
  players: BPlayer[];
  bombs: Bomb[];
  flames: Flame[];
  nextBombId: number;
  /** Nombre de blocs déjà tombés pendant la mort subite. */
  sudden: number;
  winnerId: string | null;
  wins: Record<string, number>;
  /** Ticks consécutifs passés dans les flammes, par joueur. */
  burn: Record<string, number>;
}

// ─── Grille ──────────────────────────────────────────────────────────────────
export const idx = (r: number, c: number) => r * COLS + c;

export function cellAt(grid: Cell[], r: number, c: number): Cell {
  if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return WALL;
  return grid[idx(r, c)];
}

export const SPAWNS: [number, number][] = [
  [1, 1],
  [ROWS - 2, COLS - 2],
  [1, COLS - 2],
  [ROWS - 2, 1],
  [1, Math.floor(COLS / 2)],
  [ROWS - 2, Math.floor(COLS / 2)],
];

function isWallCell(r: number, c: number) {
  return r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1 || (r % 2 === 0 && c % 2 === 0);
}

export function buildGrid(spawnCount: number, rand: () => number = Math.random): Cell[] {
  const grid: Cell[] = new Array(ROWS * COLS).fill(EMPTY);
  const spawns = SPAWNS.slice(0, Math.max(spawnCount, 4));
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isWallCell(r, c)) grid[idx(r, c)] = WALL;
      else {
        // Zone dégagée autour des départs : de quoi poser une bombe et s'abriter derrière un angle.
        const nearSpawn = spawns.some(([sr, sc]) => Math.abs(sr - r) + Math.abs(sc - c) <= 2);
        if (!nearSpawn && rand() < CRATE_CHANCE) grid[idx(r, c)] = CRATE;
      }
    }
  }
  return grid;
}

/** Ordre de chute des blocs de la mort subite : spirale de l'extérieur vers le centre. */
export const SPIRAL: [number, number][] = (() => {
  const out: [number, number][] = [];
  let top = 1, bottom = ROWS - 2, left = 1, right = COLS - 2;
  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) out.push([top, c]);
    for (let r = top + 1; r <= bottom; r++) out.push([r, right]);
    if (top < bottom) for (let c = right - 1; c >= left; c--) out.push([bottom, c]);
    if (left < right) for (let r = bottom - 1; r > top; r--) out.push([r, left]);
    top++; bottom--; left++; right--;
  }
  return out.filter(([r, c]) => !isWallCell(r, c));
})();

// ─── Création d'une manche ───────────────────────────────────────────────────
export function createGame(
  roster: { id: string; name: string }[],
  prev?: Pick<GameState, "round" | "wins">,
  rand: () => number = Math.random,
): GameState {
  const list = roster.slice(0, MAX_PLAYERS);
  const wins: Record<string, number> = {};
  for (const p of list) wins[p.id] = prev?.wins[p.id] ?? 0;
  return {
    round: (prev?.round ?? 0) + 1,
    tick: 0,
    status: "countdown",
    grid: buildGrid(list.length, rand),
    gridVersion: 1,
    players: list.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: PLAYER_COLORS[i],
      row: SPAWNS[i][0] + 0.5,
      col: SPAWNS[i][1] + 0.5,
      face: "down",
      alive: true,
      bombsMax: 1,
      range: START_RANGE,
      speed: BASE_SPEED,
    })),
    bombs: [],
    flames: [],
    nextBombId: 1,
    sudden: 0,
    winnerId: null,
    wins,
    burn: {},
  };
}

// ─── Déplacement (utilisé sur chaque téléphone pour son propre joueur) ───────
interface Mover {
  row: number;
  col: number;
}

/** Cases de bombes que le joueur chevauche : il peut en sortir (pas y revenir). */
export function overlappedBombCells(bombs: { row: number; col: number }[], p: Mover): Set<number> {
  const s = new Set<number>();
  for (const b of bombs) {
    if (Math.abs(b.row + 0.5 - p.row) < 0.5 + HALF && Math.abs(b.col + 0.5 - p.col) < 0.5 + HALF) {
      s.add(idx(b.row, b.col));
    }
  }
  return s;
}

function solidFor(grid: Cell[], bombCells: Set<number>, passable: Set<number>) {
  return (r: number, c: number) => {
    const v = cellAt(grid, r, c);
    if (v === WALL || v === CRATE) return true;
    const k = idx(r, c);
    return bombCells.has(k) && !passable.has(k);
  };
}

function boxFree(solid: (r: number, c: number) => boolean, row: number, col: number): boolean {
  const eps = 1e-6;
  const r0 = Math.floor(row - HALF), r1 = Math.floor(row + HALF - eps);
  const c0 = Math.floor(col - HALF), c1 = Math.floor(col + HALF - eps);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (solid(r, c)) return false;
  return true;
}

/**
 * Avance le joueur de `speed × dt` dans la direction voulue. Glisse automatiquement
 * vers le centre du couloir pour prendre les virages sans devoir viser au pixel.
 * Modifie `p` et renvoie true si le joueur a bougé.
 */
export function moveLocal(
  grid: Cell[],
  bombs: { row: number; col: number }[],
  p: Mover,
  dir: Dir,
  speed: number,
  dt: number,
  passable: Set<number>,
): boolean {
  const bombCells = new Set(bombs.map((b) => idx(b.row, b.col)));
  const solid = solidFor(grid, bombCells, passable);
  let remaining = speed * Math.min(dt, 0.1);
  const vertical = dir === "up" || dir === "down";
  const sign = dir === "up" || dir === "left" ? -1 : 1;
  let moved = false;

  for (let guard = 0; guard < 4 && remaining > 1e-6; guard++) {
    const main = vertical ? p.row : p.col;
    const cross = vertical ? p.col : p.row;
    const lane = Math.floor(cross) + 0.5;
    const off = cross - lane;

    // 1) Avancer tout droit si possible.
    const step = Math.min(remaining, 0.25);
    const nextMain = main + sign * step;
    const free = vertical ? boxFree(solid, nextMain, p.col) : boxFree(solid, p.row, nextMain);
    if (free) {
      if (vertical) p.row = nextMain;
      else p.col = nextMain;
      // Recentrage doux dans le couloir pendant qu'on avance.
      if (Math.abs(off) > 1e-4) {
        const nudge = Math.min(Math.abs(off), step * 0.6);
        const newCross = cross - Math.sign(off) * nudge;
        const okCross = vertical ? boxFree(solid, p.row, newCross) : boxFree(solid, newCross, p.col);
        if (okCross) {
          if (vertical) p.col = newCross;
          else p.row = newCross;
        }
      }
      remaining -= step;
      moved = true;
      continue;
    }

    // 2) Bloqué : coller au mur (sans le traverser).
    const edgeLimit = sign > 0 ? Math.ceil(main + HALF) - HALF : Math.floor(main - HALF) + HALF;
    const gap = Math.abs(edgeLimit - main);
    if (gap > 1e-4 && gap < step) {
      const tryMain = edgeLimit - sign * 1e-5;
      const ok = vertical ? boxFree(solid, tryMain, p.col) : boxFree(solid, p.row, tryMain);
      if (ok) {
        if (vertical) p.row = tryMain;
        else p.col = tryMain;
        remaining -= gap;
        moved = true;
        continue;
      }
    }

    // 3) Prise de virage : si la case devant (dans le couloir le plus proche) est libre,
    //    on glisse vers le centre de ce couloir.
    const ahead = Math.floor(main) + sign;
    const laneIdx = Math.floor(cross);
    const aheadOpen = vertical ? !solid(ahead, laneIdx) : !solid(laneIdx, ahead);
    if (aheadOpen && Math.abs(off) > 1e-4) {
      const slide = Math.min(Math.abs(off), remaining);
      const newCross = cross - Math.sign(off) * slide;
      const ok = vertical ? boxFree(solid, p.row, newCross) : boxFree(solid, newCross, p.col);
      if (!ok) break;
      if (vertical) p.col = newCross;
      else p.row = newCross;
      remaining -= slide;
      moved = true;
      continue;
    }
    // Couloir voisin si on déborde déjà nettement dessus.
    if (Math.abs(off) > 0.5 - CORNER_ASSIST) {
      const otherLane = laneIdx + Math.sign(off);
      const otherOpen = vertical ? !solid(ahead, otherLane) : !solid(otherLane, ahead);
      const sideOpen = vertical ? !solid(Math.floor(main), otherLane) : !solid(otherLane, Math.floor(main));
      if (otherOpen && sideOpen) {
        const target = otherLane + 0.5;
        const slide = Math.min(Math.abs(target - cross), remaining);
        const newCross = cross + Math.sign(target - cross) * slide;
        const ok = vertical ? boxFree(solid, p.row, newCross) : boxFree(solid, newCross, p.col);
        if (!ok) break;
        if (vertical) p.col = newCross;
        else p.row = newCross;
        remaining -= slide;
        moved = true;
        continue;
      }
    }
    break;
  }
  return moved;
}

// ─── Hôte : une étape de simulation ──────────────────────────────────────────
export interface TickInput {
  /** Positions déclarées par chaque joueur (centre). */
  positions: Record<string, { row: number; col: number; face?: Dir }>;
  /** Joueurs qui veulent poser une bombe ce tick (avec la case vue par leur téléphone). */
  bombs: { id: string; r?: number; c?: number }[];
  /** Joueurs encore connectés (les autres sont éliminés). */
  present?: Set<string>;
}

const DIRS4: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function randomItem(rand: () => number): Cell {
  const x = rand();
  return x < 0.4 ? ITEM_BOMB : x < 0.75 ? ITEM_FIRE : ITEM_SPEED;
}

export function step(prev: GameState, input: TickInput, rand: () => number = Math.random): GameState {
  if (prev.status === "ended") return prev;
  const s: GameState = {
    ...prev,
    tick: prev.tick + 1,
    grid: prev.grid,
    players: prev.players.map((p) => ({ ...p })),
    bombs: prev.bombs.map((b) => ({ ...b })),
    flames: prev.flames.map((f) => ({ ...f, ttl: f.ttl - 1 })).filter((f) => f.ttl > 0),
    wins: { ...prev.wins },
    burn: {},
  };
  let grid = prev.grid;
  const editGrid = () => {
    if (grid === prev.grid) grid = prev.grid.slice();
    return grid;
  };

  // Joueurs partis : éliminés.
  if (input.present) for (const p of s.players) if (p.alive && !input.present.has(p.id)) p.alive = false;

  if (s.status === "countdown") {
    if (s.tick >= COUNTDOWN_TICKS) s.status = "playing";
    return s;
  }

  // 1. Positions déclarées (avec un garde-fou : jamais dans un mur ou une caisse).
  for (const p of s.players) {
    if (!p.alive) continue;
    const pos = input.positions[p.id];
    if (!pos || !Number.isFinite(pos.row) || !Number.isFinite(pos.col)) continue;
    const v = cellAt(grid, Math.floor(pos.row), Math.floor(pos.col));
    if (v === WALL || v === CRATE) continue;
    if (Math.abs(pos.row - p.row) + Math.abs(pos.col - p.col) > 4) continue; // téléportation : ignorée
    p.row = pos.row;
    p.col = pos.col;
    if (pos.face) p.face = pos.face;
  }

  // 2. Bonus ramassés.
  for (const p of s.players) {
    if (!p.alive) continue;
    const r = Math.floor(p.row), c = Math.floor(p.col);
    const v = cellAt(grid, r, c);
    if (v === ITEM_BOMB) p.bombsMax = Math.min(MAX_BOMBS, p.bombsMax + 1);
    else if (v === ITEM_FIRE) p.range = Math.min(MAX_RANGE, p.range + 1);
    else if (v === ITEM_SPEED) p.speed = Math.min(MAX_SPEED, p.speed + SPEED_BONUS);
    else continue;
    editGrid()[idx(r, c)] = EMPTY;
  }

  // 3. Bombes posées.
  for (const req of input.bombs) {
    const id = req.id;
    const p = s.players.find((x) => x.id === id);
    if (!p || !p.alive) continue;
    const active = s.bombs.filter((b) => b.owner === id).length;
    if (active >= p.bombsMax) continue;
    let r = Math.floor(p.row), c = Math.floor(p.col);
    // La case vue par le téléphone du joueur prime si elle est voisine (le réseau a un temps de retard).
    if (req.r !== undefined && req.c !== undefined && Math.abs(req.r - r) + Math.abs(req.c - c) <= 1) {
      const v = cellAt(grid, req.r, req.c);
      if (v !== WALL && v !== CRATE) {
        r = req.r;
        c = req.c;
      }
    }
    if (s.bombs.some((b) => b.row === r && b.col === c)) continue;
    s.bombs.push({ id: s.nextBombId++, row: r, col: c, owner: id, range: p.range, timer: BOMB_FUSE_TICKS });
  }

  // 4. Détonations, avec réactions en chaîne.
  for (const b of s.bombs) b.timer -= 1;
  const queue = s.bombs.filter((b) => b.timer <= 0);
  const exploded = new Set<number>();
  const addFlame = (row: number, col: number, kind: 0 | 1 | 2) => {
    const existing = s.flames.find((f) => f.row === row && f.col === col);
    if (existing) {
      existing.ttl = FLAME_TICKS;
      if (existing.kind !== kind) existing.kind = 0;
    } else s.flames.push({ row, col, ttl: FLAME_TICKS, kind });
  };
  while (queue.length) {
    const bomb = queue.shift()!;
    if (exploded.has(bomb.id)) continue;
    exploded.add(bomb.id);
    addFlame(bomb.row, bomb.col, 0);
    for (const [dr, dc] of DIRS4) {
      const kind: 1 | 2 = dr === 0 ? 1 : 2;
      for (let k = 1; k <= bomb.range; k++) {
        const r = bomb.row + dr * k, c = bomb.col + dc * k;
        const v = cellAt(grid, r, c);
        if (v === WALL) break;
        const other = s.bombs.find((o) => o.row === r && o.col === c && !exploded.has(o.id));
        if (other) {
          other.timer = 0;
          queue.push(other);
          break; // la bombe touchée explosera elle-même dans cette direction
        }
        addFlame(r, c, kind);
        if (v === CRATE) {
          editGrid()[idx(r, c)] = rand() < ITEM_CHANCE ? randomItem(rand) : EMPTY;
          break;
        }
        if (v === ITEM_BOMB || v === ITEM_FIRE || v === ITEM_SPEED) {
          editGrid()[idx(r, c)] = EMPTY; // les flammes détruisent les bonus
          break;
        }
      }
    }
  }
  if (exploded.size) s.bombs = s.bombs.filter((b) => !exploded.has(b.id));

  // 5. Mort subite : des blocs tombent en spirale.
  const playTicks = s.tick - COUNTDOWN_TICKS;
  if (playTicks >= SUDDEN_DEATH_AFTER_TICKS && (playTicks - SUDDEN_DEATH_AFTER_TICKS) % SUDDEN_DEATH_EVERY_TICKS === 0 && s.sudden < SPIRAL.length) {
    const [r, c] = SPIRAL[s.sudden];
    s.sudden += 1;
    editGrid()[idx(r, c)] = WALL;
    s.bombs = s.bombs.filter((b) => !(b.row === r && b.col === c));
    s.flames = s.flames.filter((f) => !(f.row === r && f.col === c));
    for (const p of s.players) if (p.alive && Math.floor(p.row) === r && Math.floor(p.col) === c) p.alive = false;
  }

  // 6. Joueurs dans les flammes (assez longtemps).
  if (s.flames.length) {
    const hot = new Set(s.flames.map((f) => idx(f.row, f.col)));
    for (const p of s.players) {
      if (!p.alive || !hot.has(idx(Math.floor(p.row), Math.floor(p.col)))) continue;
      const n = (prev.burn[p.id] ?? 0) + 1;
      if (n >= BURN_TICKS) p.alive = false;
      else s.burn[p.id] = n;
    }
  }

  if (grid !== prev.grid) {
    s.grid = grid;
    s.gridVersion = prev.gridVersion + 1;
  }

  // 7. Fin de manche.
  if (s.players.length > 1) {
    const alive = s.players.filter((p) => p.alive);
    if (alive.length <= 1) {
      s.status = "ended";
      s.winnerId = alive[0]?.id ?? null;
      if (s.winnerId) s.wins[s.winnerId] = (s.wins[s.winnerId] ?? 0) + 1;
    }
  } else if (s.players.length === 1 && !s.players[0].alive) {
    s.status = "ended";
  }
  return s;
}

/** Secondes avant la mort subite (null si déjà commencée ou hors jeu). */
export function secondsBeforeSudden(s: GameState): number | null {
  if (s.status !== "playing") return null;
  const left = SUDDEN_DEATH_AFTER_TICKS - (s.tick - COUNTDOWN_TICKS);
  return left > 0 ? Math.ceil((left * TICK_MS) / 1000) : null;
}

// ─── Format réseau compact ───────────────────────────────────────────────────
/** Instantané envoyé par l'hôte. La grille n'est jointe que si elle a changé (ou périodiquement). */
export interface Snapshot {
  k: "bm";
  round: number;
  tick: number;
  status: GameState["status"];
  gv: number;
  g?: string;
  p: [string, string, string, number, number, number, number, number, number, number][]; // id, nom, couleur, row×100, col×100, face, vivant, bombes, portée, vitesse×10
  b: [number, number, number, number, string][]; // id, row, col, timer, propriétaire
  f: [number, number, number, number][]; // row, col, ttl, kind
  sd: number;
  w: string | null;
  wins: Record<string, number>;
}

const FACES: Dir[] = ["up", "down", "left", "right"];

export function toSnapshot(s: GameState, withGrid: boolean): Snapshot {
  return {
    k: "bm",
    round: s.round,
    tick: s.tick,
    status: s.status,
    gv: s.gridVersion,
    g: withGrid ? s.grid.join("") : undefined,
    p: s.players.map((p) => [
      p.id, p.name, p.color,
      Math.round(p.row * 100), Math.round(p.col * 100),
      FACES.indexOf(p.face), p.alive ? 1 : 0, p.bombsMax, p.range, Math.round(p.speed * 10),
    ]),
    b: s.bombs.map((b) => [b.id, b.row, b.col, b.timer, b.owner]),
    f: s.flames.map((f) => [f.row, f.col, f.ttl, f.kind]),
    sd: s.sudden,
    w: s.winnerId,
    wins: s.wins,
  };
}

/** Reconstitue un état à partir d'un instantané. `grid` = dernière grille connue (si absente du message). */
export function fromSnapshot(snap: Snapshot, grid: Cell[] | null): GameState | null {
  const g = snap.g ? (snap.g.split("").map(Number) as Cell[]) : grid;
  if (!g || g.length !== ROWS * COLS) return null;
  return {
    round: snap.round,
    tick: snap.tick,
    status: snap.status,
    grid: g,
    gridVersion: snap.gv,
    players: snap.p.map(([id, name, color, r, c, face, alive, bombsMax, range, speed]) => ({
      id, name, color,
      row: r / 100, col: c / 100,
      face: FACES[face] ?? "down",
      alive: alive === 1,
      bombsMax, range, speed: speed / 10,
    })),
    bombs: snap.b.map(([id, row, col, timer, owner]) => ({ id, row, col, timer, owner, range: 0 })),
    flames: snap.f.map(([row, col, ttl, kind]) => ({ row, col, ttl, kind: kind as 0 | 1 | 2 })),
    nextBombId: 0,
    sudden: snap.sd,
    winnerId: snap.w,
    wins: snap.wins,
    burn: {},
  };
}

/** Messages envoyés par un joueur à l'hôte. */
export type ClientMsg =
  | { k: "bm-pos"; round: number; r: number; c: number; d: Dir }
  | { k: "bm-bomb"; round: number; r: number; c: number; seq: number }
  | { k: "bm-hello" };
