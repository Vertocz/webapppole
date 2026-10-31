"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomContext } from "./RoomConnect";
import type { NetMessage } from "@/lib/p2pRoom";
import { LancerFrancDuel, ShotScene, isMade, type Outcome, type ShotResult } from "./LancerFranc";
import {
  createLucky,
  dropPlayer,
  duelsUntil,
  isShooter,
  pairOf,
  scored,
  startNextDuel,
  type LuckyMsg,
  type LuckyShot,
  type LuckyState,
} from "@/lib/luckyEngine";

const RESULT_PAUSE_MS = 2600; // temps d'affichage du résultat entre deux duels
const HEARTBEAT_MS = 2000;

function plural(n: number, one: string, many: string) {
  return n > 1 ? many : one;
}

export default function LuckyLuke({ ctx, onExit }: { ctx: RoomContext; onExit: () => void }) {
  const isHost = ctx.role === "host";
  const [state, setState] = useState<LuckyState | null>(null);
  const stateRef = useRef<LuckyState | null>(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // Derniers tirs vus, par joueur, pour le duel en cours (affichés aux spectateurs).
  const [shots, setShots] = useState<Record<string, { duel: number; shot: LuckyShot; n: number }>>({});
  const receiveShot = useCallback((who: string, duel: number, shot: LuckyShot) => {
    setShots((prev) => {
      const old = prev[who];
      if (old && old.duel === duel && old.shot.id === shot.id) return prev; // doublon (relais + envoi direct)
      const n = old && old.duel === duel ? old.n + 1 : 1;
      return { ...prev, [who]: { duel, shot, n } };
    });
  }, []);

  const publish = useCallback((next: LuckyState | null) => {
    stateRef.current = next;
    setState(next);
    if (next && ctxRef.current.role === "host") {
      ctxRef.current.broadcast({ type: "state", payload: { kind: "lucky-state", state: next } satisfies LuckyMsg });
    }
  }, []);

  // Messages réseau
  useEffect(() => {
    ctx.onMessage((msg: NetMessage, from?: string) => {
      const c = ctxRef.current;
      if (msg.type === "state") {
        const p = msg.payload as LuckyMsg | undefined;
        if (c.role !== "host" && p?.kind === "lucky-state") {
          stateRef.current = p.state;
          setState(p.state);
        } else if (p?.kind === "lucky-shot" && p.who && p.who !== c.myId) {
          receiveShot(p.who, p.duel, p.shot);
        }
      } else if (msg.type === "move" && c.role === "host") {
        const p = msg.payload as LuckyMsg | undefined;
        const cur = stateRef.current;
        if (p?.kind === "lucky-made" && cur) {
          const who = from ?? msg.from;
          const next = scored(cur, who, p.duel);
          if (next !== cur) publish(next);
        } else if (p?.kind === "lucky-shot" && cur) {
          // Tir d'un joueur : on vérifie qu'il est bien en duel, puis on le montre à tout le monde.
          const who = from ?? msg.from;
          if (who && p.duel === cur.duel && isShooter(cur, who)) {
            receiveShot(who, p.duel, p.shot);
            c.broadcast({ type: "state", payload: { kind: "lucky-shot", duel: p.duel, shot: p.shot, who } satisfies LuckyMsg });
          }
        }
      }
    });
  }, []);

  // Hôte : enchaîne les duels, retire les joueurs partis, rediffuse l'état régulièrement.
  useEffect(() => {
    if (!isHost) return;
    const id = window.setInterval(() => {
      let cur = stateRef.current;
      if (!cur) return;
      const present = new Set(ctxRef.current.players.map((p) => p.id));
      let changed = false;
      for (const pid of cur.order) {
        if (!present.has(pid)) {
          cur = dropPlayer(cur, pid);
          changed = true;
        }
      }
      if (changed) publish(cur);
      else ctxRef.current.broadcast({ type: "state", payload: { kind: "lucky-state", state: cur } satisfies LuckyMsg });
    }, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [isHost, publish]);

  useEffect(() => {
    if (!isHost || !state || state.phase !== "between") return;
    const t = window.setTimeout(() => {
      const cur = stateRef.current;
      if (cur && cur.phase === "between") publish(startNextDuel(cur));
    }, RESULT_PAUSE_MS);
    return () => window.clearTimeout(t);
  }, [isHost, state, publish]);

  // Un client qui rejoint en cours de route redemande l'état en ne faisant rien : l'hôte le rediffuse toutes les 2 s.

  const onShot = useCallback((made: boolean, duelKey: number) => {
    if (!made) return;
    const c = ctxRef.current;
    if (c.role === "host") {
      const cur = stateRef.current;
      if (!cur) return;
      const next = scored(cur, c.myId, duelKey);
      if (next !== cur) publish(next);
    } else {
      c.send({ type: "move", payload: { kind: "lucky-made", duel: duelKey } satisfies LuckyMsg, from: c.myId });
    }
  }, [publish]);

  const onShotFired = useCallback((shot: ShotResult, duelKey: number) => {
    const c = ctxRef.current;
    const lite: LuckyShot = { id: shot.id, outcome: shot.outcome, side: shot.side };
    if (c.role === "host") {
      receiveShot(c.myId, duelKey, lite);
      c.broadcast({ type: "state", payload: { kind: "lucky-shot", duel: duelKey, shot: lite, who: c.myId } satisfies LuckyMsg });
    } else {
      c.send({ type: "move", payload: { kind: "lucky-shot", duel: duelKey, shot: lite } satisfies LuckyMsg, from: c.myId });
    }
  }, [receiveShot]);

  const names = state?.names ?? {};
  const nameOf = (id: string | null | undefined) => (id ? names[id] ?? "?" : "?");
  const me = ctx.myId;
  const alive = !!state && state.order.includes(me);
  const shooting = !!state && isShooter(state, me);
  const pair = state ? pairOf(state) : null;
  const waitDuels = state && alive ? duelsUntil(state, me) : null;

  // ── Contenu affiché par-dessus le terrain ──
  let overlay: React.ReactNode = null;
  if (!state) {
    overlay = (
      <Panel>
        <Title>Lucky Luke</Title>
        <p style={{ color: "#AAB9CC" }} className="mt-2 text-sm leading-6">
          Deux joueurs tirent en même temps et retentent jusqu&apos;à ce que l&apos;un marque. Si le second marque
          avant le premier, le premier est éliminé. Le dernier en jeu gagne.
        </p>
        <p className="mt-3 text-xs font-semibold" style={{ color: "#5FE3A1" }}>
          {ctx.players.length} joueur{ctx.players.length > 1 ? "s" : ""} connecté{ctx.players.length > 1 ? "s" : ""} :{" "}
          {ctx.players.map((p) => p.name).join(", ")}
        </p>
        {isHost ? (
          <button
            type="button"
            disabled={ctx.players.length < 2}
            onClick={() => publish(createLucky(ctx.players.map((p) => ({ id: p.id, name: p.name }))))}
            className="mt-5 w-full rounded-xl px-5 py-3.5 text-sm font-extrabold tracking-wide disabled:opacity-40"
            style={{ background: "linear-gradient(135deg,#FFA45D,#F16D2A)", color: "#171018" }}
          >
            {ctx.players.length < 2 ? "Il faut au moins 2 joueurs" : "Lancer la partie"}
          </button>
        ) : (
          <p className="mt-5 text-xs" style={{ color: "#AAB9CC" }}>
            En attente que l&apos;hôte lance la partie…
          </p>
        )}
      </Panel>
    );
  } else if (state.phase === "over") {
    overlay = (
      <Panel>
        <div className="text-4xl" aria-hidden="true">🏆</div>
        <Title>{state.winner === me ? "Tu as gagné !" : `${nameOf(state.winner)} gagne`}</Title>
        <p className="mt-2 text-sm" style={{ color: "#AAB9CC" }}>
          Éliminés : {state.out.map(nameOf).join(" → ") || "—"}
        </p>
        {isHost && (
          <button
            type="button"
            onClick={() => publish(createLucky(ctx.players.map((p) => ({ id: p.id, name: p.name }))))}
            className="mt-5 w-full rounded-xl px-5 py-3.5 text-sm font-extrabold"
            style={{ background: "linear-gradient(135deg,#FFA45D,#F16D2A)", color: "#171018" }}
          >
            Rejouer
          </button>
        )}
      </Panel>
    );
  } else if (!shooting && pair && (state.phase === "duel" || (state.phase === "between" && state.last))) {
    let banner: React.ReactNode;
    if (state.phase === "between" && state.last) {
      const l = state.last;
      banner = (
        <>
          <span style={{ fontWeight: 800, color: "#F7F9FC" }}>{nameOf(l.scorer)} marque !</span>{" "}
          <span style={{ color: l.eliminated ? "#FF8A80" : "#AAB9CC" }}>
            {l.eliminated ? (l.eliminated === me ? "Tu es éliminé." : `${nameOf(l.eliminated)} est éliminé.`) : "Personne n'est éliminé."}
          </span>
        </>
      );
    } else {
      banner = (
        <span style={{ color: alive ? "#5FE3A1" : "#FF8A80", fontWeight: 700 }}>
          {!alive
            ? "Tu es éliminé, tu regardes la fin."
            : waitDuels === 1
              ? "À toi au prochain duel !"
              : `À toi dans ${waitDuels} ${plural(waitDuels ?? 0, "duel", "duels")}`}
        </span>
      );
    }
    overlay = (
      <Spectate
        banner={banner}
        panes={pair.map((id) => ({ id, name: nameOf(id), entry: shots[id]?.duel === state.duel ? shots[id] : undefined }))}
      />
    );
  } else if (state.phase === "between" && state.last) {
    const l = state.last;
    overlay = (
      <Panel>
        <Title>{nameOf(l.scorer)} marque !</Title>
        <p className="mt-2 text-sm" style={{ color: l.eliminated ? "#FF8A80" : "#AAB9CC" }}>
          {l.eliminated
            ? l.eliminated === me
              ? "Tu es éliminé."
              : `${nameOf(l.eliminated)} est éliminé.`
            : "Personne n'est éliminé."}
        </p>
      </Panel>
    );
  }

  const footer = (
    <footer
      className="relative"
      aria-label="Joueurs"
      style={{
        padding: "12px 16px calc(12px + env(safe-area-inset-bottom))",
        background: "#0A0F18",
        borderTop: "1px solid rgba(233,238,247,0.08)",
      }}
    >
      {shooting && state && pair && (
        <p className="mb-2 text-center text-[11px] font-bold uppercase tracking-[0.15em]" style={{ color: "#FF6A2A" }}>
          Duel : toi contre {nameOf(pair[0] === me ? pair[1] : pair[0])}
          {pair[0] === me ? " (tu tires en premier)" : ""}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-1.5">
        {state ? (
          <>
            {state.order.map((id) => {
              const active = !!pair && state.phase === "duel" && (pair[0] === id || pair[1] === id);
              return (
                <span
                  key={id}
                  className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                  style={{
                    background: active ? "rgba(255,106,42,0.2)" : "rgba(233,238,247,0.07)",
                    color: active ? "#FF9A5F" : "#E9EEF7",
                    border: id === me ? "1px solid rgba(95,227,161,0.6)" : "1px solid transparent",
                  }}
                >
                  {nameOf(id)}
                </span>
              );
            })}
            {state.out.map((id) => (
              <span
                key={id}
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold line-through"
                style={{ color: "rgba(233,238,247,0.35)" }}
              >
                {nameOf(id)}
              </span>
            ))}
          </>
        ) : (
          <span className="text-[11px]" style={{ color: "rgba(233,238,247,0.5)" }}>Lucky Luke</span>
        )}
      </div>
    </footer>
  );

  return (
    <LancerFrancDuel
      onExit={onExit}
      duel={{
        enabled: !!state && state.phase === "duel" && shooting,
        duelKey: state?.duel ?? 0,
        onShot,
        onShotFired,
        overlay,
        footer,
      }}
    />
  );
}

/** Écran partagé : on voit en direct les deux joueurs qui sont en duel. */
function Spectate({
  banner,
  panes,
}: {
  banner: React.ReactNode;
  panes: { id: string; name: string; entry?: { duel: number; shot: LuckyShot; n: number } }[];
}) {
  return (
    <div className="absolute inset-0 flex flex-col" style={{ background: "#0F1520" }}>
      <div
        className="px-4 pb-2 text-center text-[13px]"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 10px)", background: "#0A0F18", borderBottom: "1px solid rgba(233,238,247,0.08)" }}
        aria-live="polite"
      >
        {banner}
      </div>
      {panes.map((p, i) => (
        <SpectatePane key={p.id} name={p.name} entry={p.entry} divider={i > 0} />
      ))}
    </div>
  );
}

function SpectatePane({
  name,
  entry,
  divider,
}: {
  name: string;
  entry?: { duel: number; shot: LuckyShot; n: number };
  divider: boolean;
}) {
  const [result, setResult] = useState<{ id: number; outcome: Outcome } | null>(null);
  const shot: ShotResult | null = entry ? { id: entry.shot.id, outcome: entry.shot.outcome, side: entry.shot.side } : null;
  const shown = result && shot && result.id === shot.id ? result.outcome : null;
  const made = shown ? isMade(shown) : false;
  return (
    <div
      className="relative min-h-0 flex-1"
      style={{ borderTop: divider ? "2px solid rgba(233,238,247,0.14)" : undefined }}
    >
      <ShotScene
        shot={shot}
        onResult={(outcome) => shot && setResult({ id: shot.id, outcome })}
        onDone={() => {}}
      />
      <div className="pointer-events-none absolute left-3 top-2 flex items-center gap-2">
        <span className="rounded-full px-2.5 py-1 text-[12px] font-extrabold" style={{ background: "rgba(10,15,24,0.8)", color: "#F7F9FC" }}>
          {name}
        </span>
        <span className="text-[11px] font-semibold" style={{ color: "rgba(233,238,247,0.6)" }}>
          {entry ? `essai ${entry.n}` : "vise…"}
        </span>
      </div>
      {shown && (
        <div
          className="pointer-events-none absolute right-3 top-2 rounded-full px-2.5 py-1 text-[12px] font-black tracking-wide"
          style={{ background: made ? "rgba(95,227,161,0.18)" : "rgba(255,138,128,0.15)", color: made ? "#5FE3A1" : "#FF8A80" }}
        >
          {made ? "PANIER !" : "RATÉ"}
        </div>
      )}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center px-6"
      style={{ background: "rgba(4,9,17,0.72)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="w-full max-w-sm rounded-3xl px-6 py-7 text-center"
        style={{ background: "#18212F", border: "1px solid rgba(233,238,247,0.12)" }}
      >
        {children}
      </div>
    </div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="text-xl font-black tracking-tight" style={{ color: "#F7F9FC" }}>
      {children}
    </h1>
  );
}
