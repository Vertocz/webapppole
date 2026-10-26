"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomContext } from "./RoomConnect";
import type { NetMessage } from "@/lib/p2pRoom";
import {
  AUTO_TEXT,
  DEFAULT_TIMING,
  MAX_TEXT,
  applyHostMsg,
  createGame,
  emptyView,
  fillMissing,
  isOverdue,
  resetGame,
  revealMissing,
  revealNext,
  revealReplay,
  revealRestOfBook,
  snapshotRound,
  submit as engineSubmit,
  taskFor,
  type ChainEntry,
  type ClientMsg,
  type EntryType,
  type Game,
  type HostMsg,
  type StepResult,
  type Timing,
  type View,
} from "@/lib/garticEngine";

// ─── Dessin ───────────────────────────────────────────────────────────────────
const CANVAS_W = 480;
const CANVAS_H = 360;
const COLORS = ["#111111", "#E5383B", "#1D70F0", "#2EAD5B", "#F6C026", "#8A5A3B"];
const SIZES = [
  { label: "Fin", px: 3 },
  { label: "Moyen", px: 8 },
  { label: "Gros", px: 16 },
];
const UNDO_LIMIT = 12;

/** WebP si le navigateur sait l'encoder (≈ 3× plus léger que le PNG), sinon JPEG. */
function exportCanvas(c: HTMLCanvasElement): string {
  const webp = c.toDataURL("image/webp", 0.7);
  if (webp.startsWith("data:image/webp")) return webp;
  return c.toDataURL("image/jpeg", 0.7);
}

let blankCache: string | null = null;
/** Image envoyée à la place du dessin d'un joueur absent. */
function blankDrawing(): string {
  if (blankCache) return blankCache;
  const c = document.createElement("canvas");
  c.width = CANVAS_W;
  c.height = CANVAS_H;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#9aa3b2";
    ctx.font = "600 28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("(pas de dessin)", c.width / 2, c.height / 2);
  }
  blankCache = exportCanvas(c);
  return blankCache;
}

function DrawingCanvas({ onSubmit, expired }: { onSubmit: (dataUrl: string) => void; expired: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPt = useRef<{ x: number; y: number } | null>(null);
  const lastMid = useRef<{ x: number; y: number } | null>(null);
  const undoStack = useRef<ImageData[]>([]);
  const sent = useRef(false);
  const [color, setColor] = useState(COLORS[0]);
  const [sizeIdx, setSizeIdx] = useState(1);
  const [eraser, setEraser] = useState(false);
  const [strokes, setStrokes] = useState(0);
  const [canUndo, setCanUndo] = useState(false);

  const getCtx = () => canvasRef.current?.getContext("2d", { willReadFrequently: true }) ?? null;

  const fillWhite = () => {
    const ctx = getCtx();
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  };

  useEffect(() => {
    fillWhite();
  }, []);

  const snapshot = () => {
    const ctx = getCtx();
    if (!ctx) return;
    undoStack.current.push(ctx.getImageData(0, 0, CANVAS_W, CANVAS_H));
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
    setCanUndo(true);
  };

  const undo = () => {
    const ctx = getCtx();
    const prev = undoStack.current.pop();
    if (!ctx || !prev) return;
    ctx.putImageData(prev, 0, 0);
    setStrokes((s) => Math.max(0, s - 1));
    setCanUndo(undoStack.current.length > 0);
  };

  const clear = () => {
    snapshot();
    fillWhite();
    setStrokes(0);
  };

  const send = useCallback(() => {
    if (sent.current || !canvasRef.current) return;
    sent.current = true;
    onSubmit(exportCanvas(canvasRef.current));
  }, [onSubmit]);

  // Temps écoulé : on envoie ce qui est dessiné, même incomplet.
  useEffect(() => {
    if (expired) send();
  }, [expired, send]);

  const pos = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * c.width) / rect.width,
      y: ((e.clientY - rect.top) * c.height) / rect.height,
    };
  };

  const strokeStyle = (ctx: CanvasRenderingContext2D) => {
    const w = SIZES[sizeIdx].px * (eraser ? 1.8 : 1);
    ctx.strokeStyle = eraser ? "#ffffff" : color;
    ctx.fillStyle = eraser ? "#ffffff" : color;
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    return w;
  };

  const onDown = (e: React.PointerEvent) => {
    if (expired || sent.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    snapshot();
    drawing.current = true;
    const p = pos(e);
    lastPt.current = p;
    lastMid.current = p;
    // Un simple tap laisse un point.
    const w = strokeStyle(ctx);
    ctx.beginPath();
    ctx.arc(p.x, p.y, w / 2, 0, Math.PI * 2);
    ctx.fill();
    setStrokes((s) => s + 1);
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* pointeur déjà relâché : on dessine quand même */
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current || !lastPt.current || !lastMid.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    const p = pos(e);
    const mid = { x: (lastPt.current.x + p.x) / 2, y: (lastPt.current.y + p.y) / 2 };
    strokeStyle(ctx);
    // Courbe lissée : on passe par les milieux des segments plutôt que par les points bruts.
    ctx.beginPath();
    ctx.moveTo(lastMid.current.x, lastMid.current.y);
    ctx.quadraticCurveTo(lastPt.current.x, lastPt.current.y, mid.x, mid.y);
    ctx.stroke();
    lastPt.current = p;
    lastMid.current = mid;
  };

  const onUp = () => {
    const ctx = getCtx();
    if (drawing.current && ctx && lastPt.current && lastMid.current) {
      strokeStyle(ctx);
      ctx.beginPath();
      ctx.moveTo(lastMid.current.x, lastMid.current.y);
      ctx.lineTo(lastPt.current.x, lastPt.current.y);
      ctx.stroke();
    }
    drawing.current = false;
    lastPt.current = null;
    lastMid.current = null;
  };

  const chip = (active: boolean) => ({
    border: `2px solid ${active ? "var(--accent)" : "var(--border)"}`,
    background: active ? "var(--bg-input)" : "transparent",
    color: "var(--text-main)",
  });

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
        style={{
          border: "1px solid var(--border)",
          touchAction: "none",
          background: "white",
          aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
        }}
      />

      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Couleur ${c}`}
              onClick={() => {
                setColor(c);
                setEraser(false);
              }}
              className="h-8 w-8 rounded-full"
              style={{
                background: c,
                border: `3px solid ${!eraser && color === c ? "var(--accent)" : "transparent"}`,
                outline: "1px solid var(--border)",
              }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setEraser((v) => !v)}
          className="h-9 rounded-lg px-3 text-xs font-medium"
          style={chip(eraser)}
        >
          Gomme
        </button>
      </div>

      <div className="flex items-center gap-2">
        {SIZES.map((s, i) => (
          <button
            key={s.label}
            type="button"
            onClick={() => setSizeIdx(i)}
            className="h-9 flex-1 rounded-lg text-xs"
            style={chip(sizeIdx === i)}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          className="h-9 rounded-lg px-3 text-xs disabled:opacity-30"
          style={{ border: "1px solid var(--border)", color: "var(--text-main)" }}
        >
          ↶ Annuler
        </button>
        <button
          type="button"
          onClick={clear}
          className="h-9 rounded-lg px-3 text-xs"
          style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
        >
          Effacer
        </button>
      </div>

      <button
        type="button"
        onClick={send}
        disabled={strokes === 0}
        className="w-full rounded-xl py-3 text-sm font-medium disabled:opacity-40"
        style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}
      >
        {strokes === 0 ? "Dessine quelque chose…" : "Valider le dessin"}
      </button>
    </div>
  );
}

// ─── Écrans ───────────────────────────────────────────────────────────────────
const IDEAS = [
  "un pingouin qui fait du ski",
  "un dentiste dans un ascenseur en panne",
  "une licorne qui rate son permis",
  "un cactus qui fait un câlin",
  "un pirate qui a perdu son smartphone",
  "une girafe dans un train bondé",
  "un robot qui fait ses courses",
  "un escargot champion du 100 mètres",
  "un fantôme qui cherche ses clés",
  "un chat qui anime une émission de cuisine",
  "un dragon allergique à la fumée",
  "une baleine au cinéma",
  "un astronaute qui oublie son casque",
  "un hérisson en maillot de bain",
  "un chevalier qui a peur des poules",
  "un pingouin en vacances au Sahara",
  "une pizza qui court après son livreur",
  "un yéti à la plage",
  "un crocodile chez le coiffeur",
  "un lapin magicien qui rate son tour",
  "un hamster dans un 4x4",
  "un clown qui fait la grève",
  "un koala qui joue de la guitare",
  "un sandwich géant qui poursuit un touriste",
  "une grand-mère en moto",
  "un ours qui apprend à nager",
  "un poulpe qui fait du repassage",
  "un facteur poursuivi par un nuage",
  "un mouton qui passe un entretien d'embauche",
  "un monstre sous le lit qui a peur du noir",
];

function Countdown({ remainingMs, totalMs }: { remainingMs: number | null; totalMs: number }) {
  if (remainingMs === null || totalMs <= 0) return null;
  const secs = Math.ceil(remainingMs / 1000);
  const urgent = secs <= 10;
  return (
    <div className="space-y-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--bg-input)" }}>
        <div
          className={`h-full rounded-full ${urgent ? "animate-pulse" : ""}`}
          style={{
            width: `${Math.min(100, (remainingMs / totalMs) * 100)}%`,
            background: urgent ? "#f59e0b" : "var(--accent)",
            transition: "width 0.3s linear",
          }}
        />
      </div>
      <p
        className={`text-right tabular-nums ${urgent ? "text-sm font-bold" : "text-[11px]"}`}
        style={{ color: urgent ? "#f59e0b" : "var(--text-muted)" }}
      >
        {secs}s
      </p>
    </div>
  );
}

function WriteEntry({
  prior,
  expired,
  onSubmit,
}: {
  prior: ChainEntry | null;
  expired: boolean;
  onSubmit: (text: string, auto: boolean) => void;
}) {
  const [text, setText] = useState("");
  const sent = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;

  const send = (auto: boolean) => {
    if (sent.current) return;
    const t = textRef.current.trim();
    if (!t && !auto) return;
    sent.current = true;
    onSubmit(t || AUTO_TEXT, auto && !t);
  };

  // Temps écoulé : on envoie ce qui est tapé (ou « pas de réponse »).
  useEffect(() => {
    if (expired) send(true);
  }, [expired]);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        send(false);
      }}
    >
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
        maxLength={MAX_TEXT}
        autoFocus
        enterKeyHint="send"
        placeholder={prior ? "Je vois…" : "Ex : un pingouin qui fait du ski"}
        className="w-full rounded-xl px-4 py-3 text-sm outline-none"
        style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)" }}
      />
      {!prior && (
        <button
          type="button"
          onClick={() => setText(IDEAS[Math.floor(Math.random() * IDEAS.length)])}
          className="w-full rounded-xl py-2 text-xs"
          style={{ border: "1px dashed var(--border)", color: "var(--text-muted)" }}
        >
          🎲 Surprends-moi
        </button>
      )}
      <button
        type="submit"
        disabled={!text.trim()}
        className="w-full rounded-xl py-3 text-sm font-medium disabled:opacity-40"
        style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}
      >
        Valider
      </button>
    </form>
  );
}

function DrawEntry({
  prior,
  expired,
  onSubmit,
}: {
  prior: ChainEntry | null;
  expired: boolean;
  onSubmit: (dataUrl: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: "var(--text-sub)" }}>
        Dessine cette phrase :
      </p>
      <p className="font-display text-center text-xl" style={{ color: "var(--accent)" }}>
        {prior && !prior.auto ? prior.content : "Carte blanche : dessine ce que tu veux !"}
      </p>
      <DrawingCanvas onSubmit={onSubmit} expired={expired} />
    </div>
  );
}

function WaitingView({
  pending,
  total,
  done,
  onSkip,
}: {
  pending: string[];
  total: number;
  done: number;
  onSkip?: () => void;
}) {
  return (
    <div className="space-y-4 py-10 text-center">
      <div
        className="mx-auto h-8 w-8 animate-spin rounded-full border-2"
        style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
      />
      <p className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
        {done}/{total} ont fini
      </p>
      {pending.length > 0 && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          On attend : {pending.join(", ")}
        </p>
      )}
      {onSkip && pending.length > 0 && (
        <button
          type="button"
          onClick={onSkip}
          className="rounded-xl px-4 py-2 text-xs"
          style={{ border: "1px solid var(--border)", color: "var(--text-main)" }}
        >
          Passer les absents
        </button>
      )}
    </div>
  );
}

function RevealView({
  view,
  isHost,
  onNext,
  onBook,
  onNewGame,
}: {
  view: View;
  isHost: boolean;
  onNext: () => void;
  onBook: () => void;
  onNewGame: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const reveal = view.reveal;
  const entries = (reveal?.entries ?? []).filter((e): e is ChainEntry => !!e);
  const ended = view.phase === "end";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [entries.length, reveal?.book]);

  return (
    <div className="space-y-4">
      <p className="font-display text-center text-xl" style={{ color: "var(--accent)" }}>
        {ended ? "C'EST TERMINÉ !" : "LA RÉVÉLATION !"}
      </p>

      {!reveal && (
        <div className="space-y-4 py-8 text-center">
          <p className="text-sm" style={{ color: "var(--text-main)" }}>
            Tout le monde a fini !
          </p>
          {!isHost && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              L&apos;hôte va lancer la révélation…
            </p>
          )}
        </div>
      )}

      {reveal && (
        <p className="text-center text-sm font-medium" style={{ color: "var(--text-main)" }}>
          Histoire de {reveal.owner} ({reveal.book + 1}/{view.n})
        </p>
      )}

      <div className="space-y-3">
        {entries.map((entry, i) => (
          <div
            key={`${reveal?.book}-${i}`}
            className="rounded-xl p-3"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
          >
            <p className="mb-1.5 text-[10px] uppercase tracking-widest" style={{ color: "var(--text-sub)" }}>
              {entry.authorName} — {entry.type === "text" ? (i === 0 ? "a écrit" : "a deviné") : "a dessiné"}
            </p>
            {entry.type === "text" ? (
              <p
                className="font-display text-lg"
                style={{ color: entry.auto ? "var(--text-muted)" : "var(--text-main)", fontStyle: entry.auto ? "italic" : "normal" }}
              >
                {entry.content}
              </p>
            ) : (
              <img src={entry.content} alt="" className="w-full rounded-lg" style={{ background: "white" }} />
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {isHost && !ended && (
        <div className="sticky bottom-3 flex gap-2">
          <button
            type="button"
            onClick={onNext}
            className="flex-1 rounded-xl py-3 text-sm font-medium"
            style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}
          >
            {reveal ? "Suivant ▸" : "Lancer la révélation"}
          </button>
          {reveal && (
            <button
              type="button"
              onClick={onBook}
              className="rounded-xl px-4 py-3 text-sm"
              style={{ border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-main)" }}
            >
              Tout afficher
            </button>
          )}
        </div>
      )}
      {!isHost && !ended && reveal && (
        <p className="text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
          L&apos;hôte dévoile la suite…
        </p>
      )}

      {ended && (
        <div className="space-y-2 text-center">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Tous les livres ont été dévoilés.
          </p>
          {isHost && (
            <button
              type="button"
              onClick={onNewGame}
              className="w-full rounded-xl py-3 text-sm font-medium"
              style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}
            >
              Nouvelle partie
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Jeu ──────────────────────────────────────────────────────────────────────
export default function GarticPhone({ ctx, timing = DEFAULT_TIMING }: { ctx: RoomContext; timing?: Timing }) {
  const isHost = ctx.role === "host";
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // La vue du joueur vit dans une ref synchronisée avec le state : les gestionnaires réseau lisent
  // toujours la dernière valeur, sans fermeture périmée ni effet de bord dans un updater React.
  const viewRef = useRef<View>(emptyView());
  const [view, setViewState] = useState<View>(viewRef.current);
  const update = useCallback((fn: (v: View) => View) => {
    viewRef.current = fn(viewRef.current);
    setViewState(viewRef.current);
  }, []);

  const gameRef = useRef<Game | null>(null); // état complet : hôte seulement
  const lastSubmit = useRef<{ round: number; entry: ChainEntry } | null>(null);
  const alive = useRef(true);
  const registered = useRef(false);
  const [, setTick] = useState(0);

  // ── Hôte : diffusion ──
  const emit = useCallback(
    (msg: HostMsg) => {
      try {
        ctxRef.current.broadcast({ type: "state", payload: msg });
      } catch (err) {
        console.warn("Gartic: diffusion impossible", err);
      }
      update((v) => applyHostMsg(v, msg, ctxRef.current.myId, performance.now()));
    },
    [update]
  );

  const emitRound = useCallback(() => {
    const g = gameRef.current;
    if (g) emit(snapshotRound(g, Date.now()));
  }, [emit]);

  const emitTasks = useCallback(
    (only?: string) => {
      const g = gameRef.current;
      if (!g) return;
      for (const p of g.roster) {
        if (only && p.id !== only) continue;
        const t = taskFor(g, p.id);
        if (t) emit({ kind: "task", to: p.id, round: t.round, type: t.type, prior: t.prior });
      }
    },
    [emit]
  );

  const afterStep = useCallback(
    (res: StepResult) => {
      if (res === "ignored") return;
      emitRound();
      if (res === "advanced") emitTasks();
    },
    [emitRound, emitTasks]
  );

  const hostSubmit = useCallback(
    (playerId: string, round: number, entry: ChainEntry) => {
      const g = gameRef.current;
      if (!g) return;
      afterStep(engineSubmit(g, playerId, round, entry, Date.now()));
    },
    [afterStep]
  );

  const hostFillMissing = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    afterStep(fillMissing(g, Date.now(), blankDrawing()));
  }, [afterStep]);

  const hostReplyTo = useCallback(
    (playerId: string) => {
      const g = gameRef.current;
      if (!g) return;
      emitRound();
      if (g.phase === "writing") emitTasks(playerId);
      else for (const item of revealReplay(g)) emit({ kind: "reveal", item });
    },
    [emit, emitRound, emitTasks]
  );

  const hostRevealNext = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    const r = revealNext(g);
    if (r === "end") emitRound();
    else if (r) emit({ kind: "reveal", item: r });
  }, [emit, emitRound]);

  const hostRevealBook = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    const { items, ended } = revealRestOfBook(g);
    for (const item of items) emit({ kind: "reveal", item });
    if (ended) emitRound();
  }, [emit, emitRound]);

  const hostNewGame = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    gameRef.current = resetGame(g, Date.now());
    lastSubmit.current = null;
    emitRound();
    emitTasks();
  }, [emitRound, emitTasks]);

  // Messages des joueurs, côté hôte.
  const handleClientMsg = (from: string | undefined, payload: unknown) => {
    if (!from || !payload || typeof payload !== "object") return;
    const m = payload as ClientMsg;
    if (m.kind === "sync") hostReplyTo(from);
    else if (m.kind === "submit") hostSubmit(from, m.round, m.entry);
  };
  const handleClientMsgRef = useRef(handleClientMsg);
  handleClientMsgRef.current = handleClientMsg;

  // Abonnement réseau : une seule fois (le contexte ne permet pas de se désabonner).
  useEffect(() => {
    alive.current = true;
    if (!registered.current) {
      registered.current = true;
      ctx.onMessage((msg: NetMessage, from?: string) => {
        if (!alive.current) return;
        const c = ctxRef.current;
        if (msg.type === "state" && c.role !== "host") {
          const payload = msg.payload as HostMsg | null;
          if (payload && typeof payload === "object" && "kind" in payload) {
            update((v) => applyHostMsg(v, payload, c.myId, performance.now()));
          }
        } else if (msg.type === "move" && c.role === "host") {
          const sender = from && from !== "inconnu" ? from : msg.from;
          handleClientMsgRef.current(sender, msg.payload);
        }
      });
    }
    return () => {
      alive.current = false;
    };
  }, []);

  // Hôte : lance la partie, surveille le minuteur et renvoie l'état régulièrement.
  useEffect(() => {
    if (!isHost) return;
    if (!gameRef.current) {
      gameRef.current = createGame(ctxRef.current.players, Date.now(), timing);
      emitRound();
      emitTasks();
    }
    let beat = 0;
    const id = setInterval(() => {
      const g = gameRef.current;
      if (!g) return;
      if (isOverdue(g, Date.now())) {
        hostFillMissing();
      } else if (++beat % 4 === 0) {
        emitRound();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [isHost]);

  // Joueurs : demandent l'état au démarrage, au retour au premier plan, et tant qu'il leur manque
  // leur tâche (message perdu, écran verrouillé…).
  const requestSync = useCallback(() => {
    const c = ctxRef.current;
    if (c.role === "host") return;
    c.send({ type: "move", payload: { kind: "sync" } satisfies ClientMsg, from: c.myId });
  }, []);

  useEffect(() => {
    if (isHost) return;
    requestSync();
    const onVisible = () => {
      if (document.visibilityState === "visible") requestSync();
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(() => {
      const v = viewRef.current;
      if (!v.started || (v.phase === "writing" && !v.task) || revealMissing(v)) requestSync();
    }, 3000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(id);
    };
  }, [isHost, requestSync]);

  // Si l'hôte ne m'a pas compté alors que j'ai rendu mon travail (message perdu), je le renvoie.
  useEffect(() => {
    if (isHost) return;
    const last = lastSubmit.current;
    if (
      last &&
      view.phase === "writing" &&
      view.round === last.round &&
      view.iSubmitted &&
      !view.submitted.includes(ctxRef.current.myId)
    ) {
      const c = ctxRef.current;
      c.send({ type: "move", payload: { kind: "submit", round: last.round, entry: last.entry } satisfies ClientMsg, from: c.myId });
    }
  }, [view.submitted]);

  // Horloge d'affichage du compte à rebours.
  useEffect(() => {
    if (view.phase !== "writing" || view.deadlineAt === null) return;
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [view.phase, view.deadlineAt]);

  // ── Rendu ──
  const myId = ctx.myId;
  const remaining = view.deadlineAt === null ? null : Math.max(0, view.deadlineAt - performance.now());
  const expired = remaining !== null && remaining <= 0;

  const submitEntry = (type: EntryType, content: string, auto: boolean) => {
    const v = viewRef.current;
    if (v.iSubmitted || !v.task) return;
    const entry: ChainEntry = { type, authorName: "", content, auto: auto || undefined };
    const round = v.task.round;
    lastSubmit.current = { round, entry };
    update((x) => ({ ...x, iSubmitted: true }));
    if (isHost) hostSubmit(myId, round, entry);
    else ctx.send({ type: "move", payload: { kind: "submit", round, entry } satisfies ClientMsg, from: myId });
  };

  if (!view.started) {
    return (
      <div className="space-y-3 py-12 text-center">
        <div
          className="mx-auto h-8 w-8 animate-spin rounded-full border-2"
          style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
        />
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {isHost ? "Préparation de la partie…" : "En attente du lancement par l'hôte…"}
        </p>
      </div>
    );
  }

  if (view.phase !== "writing") {
    return (
      <RevealView
        view={view}
        isHost={isHost}
        onNext={hostRevealNext}
        onBook={hostRevealBook}
        onNewGame={hostNewGame}
      />
    );
  }

  const done = new Set(view.submitted);
  if (view.iSubmitted) done.add(myId);
  const pending = view.roster.filter((p) => !done.has(p.id)).map((p) => p.name);
  const task = view.task;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-center text-xs uppercase tracking-widest" style={{ color: "var(--text-sub)" }}>
          Tour {view.round + 1} / {view.n}
        </p>
        <Countdown remainingMs={remaining} totalMs={view.totalMs} />
      </div>

      {view.iSubmitted ? (
        <WaitingView
          pending={pending}
          total={view.n}
          done={done.size}
          onSkip={isHost ? hostFillMissing : undefined}
        />
      ) : !task ? (
        <div className="space-y-3 py-10 text-center">
          <div
            className="mx-auto h-8 w-8 animate-spin rounded-full border-2"
            style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
          />
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Récupération de ta tâche…
          </p>
        </div>
      ) : task.type === "text" ? (
        <WriteEntry
          key={`w${task.round}`}
          prior={task.prior}
          expired={expired}
          onSubmit={(text, auto) => submitEntry("text", text, auto)}
        />
      ) : (
        <DrawEntry
          key={`d${task.round}`}
          prior={task.prior}
          expired={expired}
          onSubmit={(url) => submitEntry("drawing", url, false)}
        />
      )}
    </div>
  );
}
