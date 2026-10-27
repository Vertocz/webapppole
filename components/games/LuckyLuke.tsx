"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomContext } from "./RoomConnect";
import type { NetMessage } from "@/lib/p2pRoom";
import { LancerFrancDuel } from "./LancerFranc";
import {
  createLucky,
  dropPlayer,
  duelsUntil,
  isShooter,
  pairOf,
  scored,
  startNextDuel,
  type LuckyMsg,
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
        }
      } else if (msg.type === "move" && c.role === "host") {
        const p = msg.payload as LuckyMsg | undefined;
        const cur = stateRef.current;
        if (p?.kind === "lucky-made" && cur) {
          const who = from ?? msg.from;
          const next = scored(cur, who, p.duel);
          if (next !== cur) publish(next);
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
  } else if (state.phase === "duel" && !shooting) {
    overlay = (
      <Panel>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "rgba(233,238,247,0.5)" }}>
          Duel en cours
        </p>
        <Title>
          {pair ? `${nameOf(pair[0])} contre ${nameOf(pair[1])}` : ""}
        </Title>
        <p className="mt-3 text-sm font-semibold" style={{ color: alive ? "#5FE3A1" : "#FF8A80" }}>
          {!alive
            ? "Tu es éliminé, tu regardes la fin."
            : waitDuels === 1
              ? "À toi au prochain duel !"
              : `À toi dans ${waitDuels} ${plural(waitDuels ?? 0, "duel", "duels")}`}
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
        overlay,
        footer,
      }}
    />
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
