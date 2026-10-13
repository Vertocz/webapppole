"use client";

import { useEffect, useRef, useState } from "react";
import type { RoomContext } from "./RoomConnect";
import type { NetMessage, PlayerInfo } from "@/lib/p2pRoom";

// ─── Modèle ───────────────────────────────────────────────────────────────────
// Chaque joueur démarre un "livre" (chaîne) avec une phrase. À chaque tour, les
// livres tournent d'un joueur : le suivant dessine la phrase, puis le suivant
// décrit le dessin, etc. À la fin, tout le monde découvre les chaînes.
type EntryType = "text" | "drawing";

interface ChainEntry {
  type: EntryType;
  authorName: string;
  content: string; // texte, ou image (data URL) pour un dessin
}

type Chain = (ChainEntry | null)[];

interface GameState {
  phase: "writing" | "reveal";
  round: number;
  books: Chain[];
  submittedIds: string[];
}

function initialState(n: number): GameState {
  return {
    phase: "writing",
    round: 0,
    books: Array.from({ length: n }, () => []),
    submittedIds: [],
  };
}

/**
 * Version envoyée sur le réseau : pendant la partie, on n'expose que l'entrée
 * du tour précédent (la seule dont les joueurs ont besoin). La chaîne complète
 * n'est révélée qu'à la fin — évite aussi des messages trop lourds.
 */
function publicView(state: GameState): GameState {
  if (state.phase === "reveal") return state;
  return {
    ...state,
    books: state.books.map((chain) => chain.map((e, i) => (i === state.round - 1 ? e : null))),
  };
}

// ─── Zone de dessin ───────────────────────────────────────────────────────────
const CANVAS_W = 320;
const CANVAS_H = 240;

function DrawingCanvas({ onSubmit }: { onSubmit: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const clear = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, c.width, c.height);
  };

  useEffect(() => {
    clear();
  }, []);

  const pos = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * c.width) / rect.width,
      y: ((e.clientY - rect.top) * c.height) / rect.height,
    };
  };

  const onDown = (e: React.PointerEvent) => {
    drawing.current = true;
    last.current = pos(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };

  const onUp = () => {
    drawing.current = false;
    last.current = null;
  };

  return (
    <div className="space-y-3">
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="w-full rounded-xl"
        style={{ border: "1px solid var(--border)", touchAction: "none", background: "white" }}
      />
      <div className="flex gap-2">
        <button
          onClick={clear}
          className="flex-1 py-2.5 rounded-xl text-sm"
          style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
        >
          Effacer
        </button>
        <button
          onClick={() => canvasRef.current && onSubmit(canvasRef.current.toDataURL("image/png"))}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium"
          style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}
        >
          Valider le dessin
        </button>
      </div>
    </div>
  );
}

// ─── Écrans du jeu ────────────────────────────────────────────────────────────
function WriteEntry({ prior, onSubmit }: { prior: ChainEntry | null; onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="space-y-4">
      {prior ? (
        <>
          <p className="text-sm" style={{ color: "var(--text-sub)" }}>
            Que représente ce dessin, selon toi ?
          </p>
          <img src={prior.content} alt="dessin à deviner" className="w-full rounded-xl" style={{ background: "white" }} />
        </>
      ) : (
        <p className="text-sm" style={{ color: "var(--text-sub)" }}>
          Écris une phrase à faire dessiner (le joueur suivant devra la dessiner) :
        </p>
      )}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={80}
        placeholder={prior ? "Je vois…" : "Ex : un pingouin qui fait du ski"}
        className="w-full px-4 py-3 rounded-xl text-sm outline-none"
        style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)" }}
      />
      <button
        onClick={() => text.trim() && onSubmit(text.trim())}
        disabled={!text.trim()}
        className="w-full py-3 rounded-xl text-sm font-medium disabled:opacity-40"
        style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}
      >
        Valider
      </button>
    </div>
  );
}

function DrawEntry({ prior, onSubmit }: { prior: ChainEntry; onSubmit: (dataUrl: string) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: "var(--text-sub)" }}>
        Dessine cette phrase :
      </p>
      <p className="font-display text-xl text-center" style={{ color: "var(--accent)" }}>
        {prior.content}
      </p>
      <DrawingCanvas onSubmit={onSubmit} />
    </div>
  );
}

function WaitingView() {
  return (
    <div className="text-center py-12 space-y-3">
      <div
        className="w-8 h-8 mx-auto rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
      />
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        En attente des autres joueurs…
      </p>
    </div>
  );
}

function RevealView({ books, players }: { books: Chain[]; players: PlayerInfo[] }) {
  const [idx, setIdx] = useState(0);
  const chain = (books[idx] ?? []).filter((e): e is ChainEntry => !!e);
  return (
    <div className="space-y-4">
      <p className="font-display text-xl text-center" style={{ color: "var(--accent)" }}>
        LA RÉVÉLATION !
      </p>
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          className="w-10 h-10 rounded-xl disabled:opacity-30"
          style={{ border: "1px solid var(--border)", color: "var(--text-main)" }}
        >
          ←
        </button>
        <p className="text-sm font-medium text-center" style={{ color: "var(--text-main)" }}>
          Histoire de {players[idx]?.name ?? "?"} ({idx + 1}/{books.length})
        </p>
        <button
          onClick={() => setIdx((i) => Math.min(books.length - 1, i + 1))}
          disabled={idx >= books.length - 1}
          className="w-10 h-10 rounded-xl disabled:opacity-30"
          style={{ border: "1px solid var(--border)", color: "var(--text-main)" }}
        >
          →
        </button>
      </div>
      <div className="space-y-3">
        {chain.map((entry, i) => (
          <div
            key={i}
            className="rounded-xl p-3"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
          >
            <p className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-sub)" }}>
              {entry.authorName} — {entry.type === "text" ? (i === 0 ? "a écrit" : "a deviné") : "a dessiné"}
            </p>
            {entry.type === "text" ? (
              <p className="font-display text-lg" style={{ color: "var(--text-main)" }}>
                {entry.content}
              </p>
            ) : (
              <img src={entry.content} alt="" className="w-full rounded-lg" style={{ background: "white" }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Jeu ──────────────────────────────────────────────────────────────────────
export default function GarticPhone({ ctx }: { ctx: RoomContext }) {
  const isHost = ctx.role === "host";
  const n = ctx.players.length;
  const [state, setState] = useState<GameState>(() => initialState(n));
  const [submitted, setSubmitted] = useState(false);

  const recordSubmission = (playerId: string, entry: ChainEntry) => {
    setState((prev) => {
      if (prev.phase !== "writing" || prev.submittedIds.includes(playerId)) return prev;
      const playerIndex = ctx.players.findIndex((p) => p.id === playerId);
      if (playerIndex === -1) return prev;

      const bookIndex = (playerIndex - prev.round + n) % n;
      const books = prev.books.map((b) => [...b]);
      books[bookIndex][prev.round] = entry;

      let submittedIds = [...prev.submittedIds, playerId];
      let round = prev.round;
      let phase: GameState["phase"] = prev.phase;
      if (submittedIds.length >= n) {
        round += 1;
        submittedIds = [];
        if (round >= n) phase = "reveal";
      }
      const next: GameState = { phase, round, books, submittedIds };
      ctx.broadcast({ type: "state", payload: publicView(next) });
      return next;
    });
  };

  useEffect(() => {
    ctx.onMessage((msg: NetMessage, from?: string) => {
      if (msg.type === "state" && !isHost) {
        const payload = msg.payload as Partial<GameState> | null;
        if (payload && "phase" in payload && "books" in payload) setState(payload as GameState);
      }
      if (msg.type === "move" && isHost && from) {
        const entry = (msg.payload as { entry?: ChainEntry }).entry;
        if (entry) recordSubmission(from, entry);
      }
    });
  }, [isHost]);

  // Nouveau tour = nouvelle tâche à faire
  useEffect(() => {
    setSubmitted(false);
  }, [state.round]);

  if (state.phase === "reveal") return <RevealView books={state.books} players={ctx.players} />;

  const myIndex = ctx.players.findIndex((p) => p.id === ctx.myId);
  const bookIndex = (myIndex - state.round + n) % n;
  const prior = state.round === 0 ? null : state.books[bookIndex]?.[state.round - 1] ?? null;
  const taskType: EntryType = state.round === 0 ? "text" : prior?.type === "text" ? "drawing" : "text";
  const myName = ctx.players[myIndex]?.name ?? "?";

  const submit = (content: string) => {
    const entry: ChainEntry = { type: taskType, authorName: myName, content };
    setSubmitted(true);
    if (isHost) recordSubmission(ctx.myId, entry);
    else ctx.send({ type: "move", payload: { entry }, from: ctx.myId });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs uppercase tracking-widest text-center" style={{ color: "var(--text-sub)" }}>
        Tour {state.round + 1} / {n}
      </p>
      {submitted ? (
        <WaitingView />
      ) : taskType === "text" ? (
        <WriteEntry prior={prior} onSubmit={submit} />
      ) : prior ? (
        <DrawEntry prior={prior} onSubmit={submit} />
      ) : (
        <WaitingView />
      )}
    </div>
  );
}
