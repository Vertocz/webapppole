/**
 * luckyEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Logique du « Lucky Luke » au lancer franc, sans React ni réseau.
 *
 * Règles :
 *  - Les joueurs sont dans un ordre fixe, en cercle.
 *  - À chaque duel, le joueur courant (A) et celui qui le suit (B) tirent en même temps
 *    et retentent jusqu'à ce que l'un des deux marque.
 *  - Si A marque : personne n'est éliminé, le duel suivant oppose B et le joueur d'après.
 *  - Si B marque : A est éliminé, le duel suivant oppose B et le joueur d'après.
 *  - Le dernier joueur restant gagne.
 */

export interface LuckyPlayer {
  id: string;
  name: string;
}

export interface LuckyLast {
  duel: number;
  scorer: string;
  /** Joueur éliminé à l'issue de ce duel (null si le premier a marqué). */
  eliminated: string | null;
}

export interface LuckyState {
  /** Joueurs encore en jeu, dans l'ordre du cercle. */
  order: string[];
  names: Record<string, string>;
  /** Éliminés, dans l'ordre d'élimination. */
  out: string[];
  /** Index (dans `order`) du joueur A du duel en cours. */
  cur: number;
  /** Numéro du duel : sert à ignorer les tirs en retard. */
  duel: number;
  phase: "duel" | "between" | "over";
  winner: string | null;
  last: LuckyLast | null;
}

export type LuckyMsg =
  | { kind: "lucky-state"; state: LuckyState }
  | { kind: "lucky-made"; duel: number }
  /** Un tir en direct : `who` est ajouté par l'hôte quand il le rediffuse aux spectateurs. */
  | { kind: "lucky-shot"; duel: number; shot: LuckyShot; who?: string };

export interface LuckyShot {
  id: number;
  outcome: "swish" | "made" | "rimout" | "board" | "short";
  side: 1 | -1;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createLucky(roster: LuckyPlayer[]): LuckyState {
  const names: Record<string, string> = {};
  for (const p of roster) names[p.id] = p.name;
  const order = shuffle(roster.map((p) => p.id));
  const state: LuckyState = {
    order,
    names,
    out: [],
    cur: 0,
    duel: 1,
    phase: order.length > 1 ? "duel" : "over",
    winner: order.length === 1 ? order[0] : null,
    last: null,
  };
  return state;
}

export function pairOf(s: LuckyState): [string, string] | null {
  if (s.order.length < 2) return null;
  return [s.order[s.cur % s.order.length], s.order[(s.cur + 1) % s.order.length]];
}

export function isShooter(s: LuckyState, id: string): boolean {
  if (s.phase !== "duel") return false;
  const p = pairOf(s);
  return !!p && (p[0] === id || p[1] === id);
}

/** Nombre de duels à attendre avant de tirer (0 = je tire dans le duel en cours). */
export function duelsUntil(s: LuckyState, id: string): number | null {
  const idx = s.order.indexOf(id);
  if (idx < 0) return null;
  const n = s.order.length;
  const offset = (idx - s.cur + n) % n; // 0 = A, 1 = B
  if (s.phase !== "duel") {
    // entre deux duels, le prochain duel est déjà celui de `cur`
    return offset <= 1 ? 0 : offset - 1;
  }
  return offset <= 1 ? 0 : offset - 1;
}

function finishIfAlone(s: LuckyState): LuckyState {
  if (s.order.length <= 1) {
    return { ...s, phase: "over", winner: s.order[0] ?? null };
  }
  return s;
}

/** Un joueur a marqué pendant le duel `duel`. Renvoie le même objet si le tir est ignoré. */
export function scored(s: LuckyState, playerId: string, duel: number): LuckyState {
  if (s.phase !== "duel" || duel !== s.duel) return s;
  const pair = pairOf(s);
  if (!pair || (pair[0] !== playerId && pair[1] !== playerId)) return s;

  const n = s.order.length;
  const firstWins = pair[0] === playerId;
  if (firstWins) {
    return {
      ...s,
      cur: (s.cur + 1) % n,
      phase: "between",
      last: { duel, scorer: playerId, eliminated: null },
    };
  }
  // Le second a marqué : le premier est éliminé, le second prend sa place dans l'ordre.
  const eliminated = pair[0];
  const order = s.order.filter((id) => id !== eliminated);
  const secondIdx = order.indexOf(playerId);
  return finishIfAlone({
    ...s,
    order,
    out: [...s.out, eliminated],
    cur: secondIdx,
    phase: "between",
    last: { duel, scorer: playerId, eliminated },
  });
}

/** Passe de l'écran de résultat au duel suivant. */
export function startNextDuel(s: LuckyState): LuckyState {
  if (s.phase !== "between") return s;
  return { ...s, phase: "duel", duel: s.duel + 1 };
}

/** Un joueur a quitté la partie : on le retire et on relance le duel si besoin. */
export function dropPlayer(s: LuckyState, id: string): LuckyState {
  const idx = s.order.indexOf(id);
  if (idx < 0 || s.phase === "over") return s;
  const order = s.order.filter((x) => x !== id);
  let cur = s.cur;
  if (idx < cur) cur -= 1;
  if (order.length > 0) cur = ((cur % order.length) + order.length) % order.length;
  const next: LuckyState = {
    ...s,
    order,
    out: [...s.out, id],
    cur,
    duel: s.duel + 1, // invalide les tirs en cours : le duel est recommencé
  };
  if (order.length <= 1) return finishIfAlone(next);
  return next;
}
