/**
 * garticEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Logique du Gartic Phone, sans React ni réseau : testable seule.
 *
 * Principe : chaque joueur démarre un « livre ». À chaque tour les livres tournent d'un joueur :
 * le suivant dessine la phrase, puis le suivant décrit le dessin, etc. À la fin, l'hôte dévoile
 * les livres entrée par entrée.
 *
 * Architecture réseau :
 *  - L'hôte détient l'état complet (`Game`). Les clients n'ont qu'une `View` minimale : leur tâche
 *    du tour, qui a fini, le temps restant, et ce qui a déjà été dévoilé.
 *  - Aucun message ne contient plus d'une image : une tâche = 1 image au plus, une révélation =
 *    1 entrée. (Avant, la révélation envoyait tous les livres d'un coup et dépassait la taille
 *    maximale d'un message WebRTC dès 4 joueurs.)
 *  - L'hôte renvoie régulièrement l'état du tour et répond aux demandes de resynchronisation :
 *    un téléphone qui se verrouille ou rate un message se remet à jour tout seul.
 */

import type { PlayerInfo } from "./p2pRoom";

export type EntryType = "text" | "drawing";

export interface ChainEntry {
  type: EntryType;
  authorName: string;
  content: string; // texte, ou image (data URL) pour un dessin
  auto?: boolean; // rempli automatiquement : le joueur n'a pas répondu à temps
}

export interface Timing {
  text: number; // secondes pour écrire / deviner
  drawing: number; // secondes pour dessiner
  graceMs: number; // délai de grâce de l'hôte avant de remplir les absents
}

export const DEFAULT_TIMING: Timing = { text: 60, drawing: 90, graceMs: 6000 };
export const MAX_TEXT = 80;
export const MAX_IMAGE_CHARS = 400_000; // garde-fou : un dessin plus lourd est refusé
export const AUTO_TEXT = "(pas de réponse)";

export type Phase = "writing" | "reveal" | "end";

export interface Game {
  roster: PlayerInfo[];
  phase: Phase;
  round: number;
  books: (ChainEntry | undefined)[][]; // books[livre][tour]
  submitted: string[]; // ids ayant rendu leur travail ce tour
  deadline: number; // heure (horloge de l'hôte) de fin du tour
  reveal: { book: number; step: number }; // step = dernière entrée dévoilée (-1 : aucune)
  timing: Timing;
}

export function roundType(round: number): EntryType {
  return round % 2 === 0 ? "text" : "drawing";
}

function secondsFor(game: Game, round: number): number {
  return roundType(round) === "text" ? game.timing.text : game.timing.drawing;
}

export function createGame(roster: PlayerInfo[], now: number, timing: Timing = DEFAULT_TIMING): Game {
  const n = roster.length;
  const game: Game = {
    roster: roster.map((p) => ({ ...p })),
    phase: "writing",
    round: 0,
    books: Array.from({ length: n }, () => []),
    submitted: [],
    deadline: 0,
    reveal: { book: 0, step: -1 },
    timing,
  };
  game.deadline = now + secondsFor(game, 0) * 1000;
  return game;
}

/** Livre sur lequel travaille le joueur `playerIndex` au tour `round`. */
function bookIndexOf(game: Game, playerIndex: number, round: number): number {
  const n = game.roster.length;
  return (((playerIndex - round) % n) + n) % n;
}

export interface TaskInfo {
  round: number;
  type: EntryType;
  prior: ChainEntry | null; // l'entrée précédente du livre (null au premier tour)
}

export function taskFor(game: Game, playerId: string): TaskInfo | null {
  if (game.phase !== "writing") return null;
  const idx = game.roster.findIndex((p) => p.id === playerId);
  if (idx < 0) return null;
  const book = bookIndexOf(game, idx, game.round);
  return {
    round: game.round,
    type: roundType(game.round),
    prior: game.round === 0 ? null : (game.books[book][game.round - 1] ?? null),
  };
}

export type StepResult = "ignored" | "recorded" | "advanced" | "reveal";

function record(game: Game, playerIndex: number, entry: ChainEntry) {
  const id = game.roster[playerIndex].id;
  game.books[bookIndexOf(game, playerIndex, game.round)][game.round] = entry;
  game.submitted.push(id);
}

function advanceIfDone(game: Game, now: number): StepResult {
  if (game.submitted.length < game.roster.length) return "recorded";
  game.round += 1;
  game.submitted = [];
  if (game.round >= game.roster.length) {
    game.phase = "reveal";
    game.reveal = { book: 0, step: -1 };
    return "reveal";
  }
  game.deadline = now + secondsFor(game, game.round) * 1000;
  return "advanced";
}

/** Valide et nettoie une entrée reçue d'un joueur : le type attendu et le nom viennent de l'hôte. */
function sanitize(game: Game, playerIndex: number, entry: ChainEntry): ChainEntry | null {
  if (!entry || typeof entry.content !== "string") return null;
  const type = roundType(game.round);
  const authorName = game.roster[playerIndex].name;
  if (type === "text") {
    const text = entry.content.trim().slice(0, MAX_TEXT);
    return text ? { type, authorName, content: text, auto: entry.auto } : null;
  }
  if (!entry.content.startsWith("data:image/") || entry.content.length > MAX_IMAGE_CHARS) return null;
  return { type, authorName, content: entry.content, auto: entry.auto };
}

/** Un joueur rend son travail. Ignoré s'il n'est pas du bon tour, déjà rendu, ou invalide. */
export function submit(game: Game, playerId: string, round: number, entry: ChainEntry, now: number): StepResult {
  if (game.phase !== "writing" || round !== game.round) return "ignored";
  if (game.submitted.includes(playerId)) return "ignored";
  const idx = game.roster.findIndex((p) => p.id === playerId);
  if (idx < 0) return "ignored";
  const clean = sanitize(game, idx, entry);
  if (!clean) return "ignored";
  record(game, idx, clean);
  return advanceIfDone(game, now);
}

export function isOverdue(game: Game, now: number): boolean {
  return game.phase === "writing" && now > game.deadline + game.timing.graceMs;
}

export function missingPlayers(game: Game): PlayerInfo[] {
  return game.phase === "writing" ? game.roster.filter((p) => !game.submitted.includes(p.id)) : [];
}

/** Remplit à la place des absents (minuteur écoulé, ou bouton « passer » de l'hôte). */
export function fillMissing(game: Game, now: number, blankDrawing: string): StepResult {
  if (game.phase !== "writing") return "ignored";
  const type = roundType(game.round);
  for (const p of missingPlayers(game)) {
    const idx = game.roster.findIndex((q) => q.id === p.id);
    record(game, idx, {
      type,
      authorName: p.name,
      content: type === "text" ? AUTO_TEXT : blankDrawing,
      auto: true,
    });
  }
  return advanceIfDone(game, now);
}

// ─── Révélation ───────────────────────────────────────────────────────────────

export interface RevealItem {
  book: number;
  step: number;
  steps: number;
  owner: string; // celui qui a lancé le livre
  entry: ChainEntry;
}

function itemAt(game: Game, book: number, step: number): RevealItem {
  const n = game.roster.length;
  const entry =
    game.books[book][step] ?? { type: roundType(step), authorName: "?", content: AUTO_TEXT, auto: true };
  return { book, step, steps: n, owner: game.roster[book].name, entry };
}

/** Dévoile l'entrée suivante. `null` si la partie n'est pas en phase de révélation. */
export function revealNext(game: Game): RevealItem | "end" | null {
  if (game.phase !== "reveal") return null;
  const n = game.roster.length;
  let { book, step } = game.reveal;
  step += 1;
  if (step >= n) {
    book += 1;
    step = 0;
  }
  if (book >= n) {
    game.phase = "end";
    return "end";
  }
  game.reveal = { book, step };
  return itemAt(game, book, step);
}

/**
 * « Tout afficher » : dévoile les entrées restantes du livre en cours. Si ce livre est terminé (ou
 * pas commencé), commence le suivant et l'affiche en entier.
 */
export function revealRestOfBook(game: Game): { items: RevealItem[]; ended: boolean } {
  const items: RevealItem[] = [];
  const first = revealNext(game);
  if (first === null) return { items, ended: false };
  if (first === "end") return { items, ended: true };
  items.push(first);
  while (game.reveal.step < game.roster.length - 1) {
    const next = revealNext(game);
    if (next === null || next === "end") break; // ne peut pas arriver : on reste dans le même livre
    items.push(next);
  }
  return { items, ended: false };
}

/** Ce qu'il faut renvoyer à un client qui a raté des messages : le livre en cours jusqu'ici. */
export function revealReplay(game: Game): RevealItem[] {
  const n = game.roster.length;
  if (game.phase === "writing") return [];
  const book = game.phase === "end" ? n - 1 : game.reveal.book;
  const upTo = game.phase === "end" ? n - 1 : game.reveal.step;
  const items: RevealItem[] = [];
  for (let s = 0; s <= upTo; s++) items.push(itemAt(game, book, s));
  return items;
}

export function resetGame(game: Game, now: number): Game {
  return createGame(game.roster, now, game.timing);
}

// ─── Messages hôte → joueurs ─────────────────────────────────────────────────

export type HostMsg =
  | {
      kind: "round";
      phase: Phase;
      round: number;
      n: number;
      roster: PlayerInfo[];
      submitted: string[];
      remainingMs: number | null;
      totalMs: number | null;
      // Avancement de la révélation : permet à un joueur de voir qu'il a raté des entrées.
      revealCursor: { book: number; step: number } | null;
    }
  | { kind: "task"; to: string; round: number; type: EntryType; prior: ChainEntry | null }
  | { kind: "reveal"; item: RevealItem };

/** Messages joueur → hôte. */
export type ClientMsg = { kind: "submit"; round: number; entry: ChainEntry } | { kind: "sync" };

export function snapshotRound(game: Game, now: number): HostMsg {
  const writing = game.phase === "writing";
  return {
    kind: "round",
    phase: game.phase,
    round: game.round,
    n: game.roster.length,
    roster: game.roster,
    submitted: [...game.submitted],
    remainingMs: writing ? Math.max(0, game.deadline - now) : null,
    totalMs: writing ? secondsFor(game, game.round) * 1000 : null,
    revealCursor: revealCursorOf(game),
  };
}

function revealCursorOf(game: Game): { book: number; step: number } | null {
  const n = game.roster.length;
  if (game.phase === "end") return { book: n - 1, step: n - 1 };
  if (game.phase === "reveal" && game.reveal.step >= 0) return { ...game.reveal };
  return null;
}

// ─── Vue côté joueur ─────────────────────────────────────────────────────────

export interface RevealView {
  book: number;
  owner: string;
  steps: number;
  entries: (ChainEntry | undefined)[];
}

export interface View {
  started: boolean;
  roster: PlayerInfo[];
  phase: Phase;
  round: number;
  n: number;
  submitted: string[];
  deadlineAt: number | null; // horloge locale (performance.now)
  totalMs: number;
  task: TaskInfo | null;
  iSubmitted: boolean;
  reveal: RevealView | null;
  revealCursor: { book: number; step: number } | null; // ce que l'hôte a dévoilé jusqu'ici
}

export function emptyView(): View {
  return {
    started: false,
    roster: [],
    phase: "writing",
    round: 0,
    n: 0,
    submitted: [],
    deadlineAt: null,
    totalMs: 0,
    task: null,
    iSubmitted: false,
    reveal: null,
    revealCursor: null,
  };
}

/** Vrai s'il manque au joueur des entrées déjà dévoilées par l'hôte : il doit demander un rattrapage. */
export function revealMissing(view: View): boolean {
  const c = view.revealCursor;
  if (!c || view.phase === "writing") return false;
  if (!view.reveal || view.reveal.book !== c.book) return true;
  for (let i = 0; i <= c.step; i++) if (!view.reveal.entries[i]) return true;
  return false;
}

/** Applique un message de l'hôte à la vue du joueur. Pure : renvoie une nouvelle vue. */
export function applyHostMsg(view: View, msg: HostMsg, myId: string, now: number): View {
  if (msg.kind === "round") {
    const newRound = msg.round !== view.round || msg.phase !== view.phase;
    const restart = msg.phase === "writing" && view.phase !== "writing"; // nouvelle partie
    const submitted = msg.submitted;
    return {
      ...view,
      started: true,
      roster: msg.roster,
      phase: msg.phase,
      round: msg.round,
      n: msg.n,
      submitted,
      deadlineAt: msg.remainingMs === null ? null : now + msg.remainingMs,
      totalMs: msg.totalMs ?? view.totalMs,
      task: newRound ? null : view.task,
      iSubmitted: newRound ? submitted.includes(myId) : view.iSubmitted || submitted.includes(myId),
      reveal: restart ? null : view.reveal,
      revealCursor: restart ? null : msg.revealCursor,
    };
  }
  if (msg.kind === "task") {
    if (msg.to !== myId || msg.round < view.round) return view;
    const sameRound = msg.round === view.round;
    return {
      ...view,
      started: true,
      round: msg.round,
      phase: "writing",
      task: { round: msg.round, type: msg.type, prior: msg.prior },
      iSubmitted: sameRound ? view.iSubmitted : false,
    };
  }
  // Révélation : on range l'entrée à sa place (idempotent si le message arrive deux fois).
  const { item } = msg;
  const same = view.reveal && view.reveal.book === item.book;
  const entries = same ? [...view.reveal!.entries] : [];
  entries[item.step] = item.entry;
  return {
    ...view,
    started: true,
    phase: view.phase === "end" ? "end" : "reveal",
    task: null,
    reveal: { book: item.book, owner: item.owner, steps: item.steps, entries },
  };
}
