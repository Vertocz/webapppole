"use client";

import { useEffect, useState } from "react";
import RoomConnect, { RoomContext } from "./RoomConnect";
import Connect4 from "./Connect4";
import Bomberman from "./Bomberman";
import LancerFranc from "./LancerFranc";
import GarticPhone from "./GarticPhone";
import type { NetMessage } from "@/lib/p2pRoom";

type NetGameId = "bomberman" | "puissance4";

const NET_GAMES: { id: NetGameId; label: string; icon: string }[] = [
  { id: "bomberman", label: "Bomberman", icon: "💣" },
  { id: "puissance4", label: "Puissance 4", icon: "🔴" },
];

// ─── Barre de contrôle une fois dans un jeu en réseau ──────────────────────────
function SwitchBar({
  canSwitch,
  label,
  onBack,
  onLeave,
}: {
  canSwitch: boolean;
  label: string;
  onBack: () => void;
  onLeave: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      {canSwitch ? (
        <button onClick={onBack} className="text-sm" style={{ color: "var(--text-muted)" }}>
          ← Changer de jeu
        </button>
      ) : (
        <span className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
          {label}
        </span>
      )}
      <button onClick={onLeave} className="text-xs" style={{ color: "var(--text-muted)" }}>
        Se déconnecter
      </button>
    </div>
  );
}

// ─── Zone connectée : switch de jeu SANS jamais démonter RoomConnect ──────────
function NetworkedGames({
  ctx,
  initialGame,
  onLeave,
}: {
  ctx: RoomContext;
  initialGame: NetGameId | null;
  onLeave: () => void;
}) {
  const [selected, setSelected] = useState<NetGameId | null>(initialGame);
  const isHost = ctx.role === "host" || ctx.role === "solo";

  // Diffuse le choix initial de l'hôte aux joueurs déjà connectés au moment du montage
  useEffect(() => {
    if (isHost && initialGame) {
      ctx.broadcast({ type: "state", payload: { selectedGame: initialGame } });
    }
  }, []);

  useEffect(() => {
    ctx.onMessage((msg: NetMessage) => {
      if (msg.type === "state" && !isHost) {
        const payload = msg.payload as { selectedGame?: NetGameId | null };
        if (payload && "selectedGame" in payload) setSelected(payload.selectedGame ?? null);
      }
    });
  }, [isHost]);

  const choose = (id: NetGameId | null) => {
    if (!isHost) return;
    setSelected(id);
    ctx.broadcast({ type: "state", payload: { selectedGame: id } });
  };

  if (selected === "bomberman") {
    return (
      <div className="space-y-3">
        <SwitchBar canSwitch={isHost} label="Bomberman" onBack={() => choose(null)} onLeave={onLeave} />
        <Bomberman ctx={ctx} />
      </div>
    );
  }

  if (selected === "puissance4") {
    return (
      <div className="space-y-3">
        <SwitchBar canSwitch={isHost} label="Puissance 4" onBack={() => choose(null)} onLeave={onLeave} />
        <Connect4 ctx={ctx} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-widest" style={{ color: "var(--text-sub)" }}>
          Connecté — {ctx.players.length} joueur{ctx.players.length > 1 ? "s" : ""}
        </p>
        <button onClick={onLeave} className="text-xs" style={{ color: "var(--text-muted)" }}>
          Se déconnecter
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {NET_GAMES.map((g) => (
          <button
            key={g.id}
            onClick={() => choose(g.id)}
            disabled={!isHost}
            className="rounded-2xl p-5 flex flex-col items-center gap-2 text-center transition-all active:scale-95 disabled:opacity-40"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
          >
            <span className="text-3xl">{g.icon}</span>
            <span className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
              {g.label}
            </span>
          </button>
        ))}
      </div>
      {!isHost && (
        <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
          En attente que l&apos;hôte choisisse un jeu…
        </p>
      )}
    </div>
  );
}

// ─── Point d'entrée ────────────────────────────────────────────────────────────
export default function GamesTab() {
  const [mode, setMode] = useState<"menu" | "lancerfranc" | "networked" | "gartic">("menu");
  const [initialGame, setInitialGame] = useState<NetGameId | null>(null);
  const [connectionKey, setConnectionKey] = useState(0);

  const openNetworked = (game: NetGameId) => {
    setInitialGame(game);
    setMode("networked");
  };

  const leaveNetworked = () => {
    setConnectionKey((k) => k + 1); // force une RoomConnect neuve au prochain essai
    setInitialGame(null);
    setMode("menu");
  };

  if (mode === "lancerfranc") {
    return (
      <LancerFranc onExit={() => setMode("menu")} />
    );
  }

  if (mode === "gartic") {
    return (
      <div className="space-y-4">
        <button
          onClick={() => {
            setConnectionKey((k) => k + 1);
            setMode("menu");
          }}
          className="text-sm"
          style={{ color: "var(--text-muted)" }}
        >
          ← Quitter la partie
        </button>
        <RoomConnect key={connectionKey} gameName="Gartic Phone" minPlayers={3} allowSolo={false}>
          {(ctx) => <GarticPhone ctx={ctx} />}
        </RoomConnect>
      </div>
    );
  }

  if (mode === "networked") {
    return (
      <div className="space-y-4">
        <RoomConnect key={connectionKey} gameName="Jeux en réseau" minPlayers={1}>
          {(ctx) => <NetworkedGames ctx={ctx} initialGame={initialGame} onLeave={leaveNetworked} />}
        </RoomConnect>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h2 className="font-display text-2xl" style={{ color: "var(--text-main)" }}>
        JEUX
      </h2>
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
        Jouez ensemble sans connexion internet — idéal en avion. Connectez-vous
        une fois pour Bomberman ou Puissance 4 : vous pourrez ensuite changer de
        jeu librement sans avoir à rescanner de QR code.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => openNetworked("bomberman")}
          className="rounded-2xl p-5 flex flex-col items-center gap-2 text-center transition-all active:scale-95"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
        >
          <span className="text-3xl">💣</span>
          <span className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
            Bomberman
          </span>
        </button>
        <button
          onClick={() => openNetworked("puissance4")}
          className="rounded-2xl p-5 flex flex-col items-center gap-2 text-center transition-all active:scale-95"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
        >
          <span className="text-3xl">🔴</span>
          <span className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
            Puissance 4
          </span>
        </button>
        <button
          onClick={() => setMode("lancerfranc")}
          className="rounded-2xl p-5 flex flex-col items-center gap-2 text-center transition-all active:scale-95"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
        >
          <span className="text-3xl">🏀</span>
          <span className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
            Lancer franc
          </span>
        </button>
        <button
          onClick={() => setMode("gartic")}
          className="rounded-2xl p-5 flex flex-col items-center gap-2 text-center transition-all active:scale-95"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
        >
          <span className="text-3xl">🎨</span>
          <span className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
            Gartic Phone
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            3 joueurs min.
          </span>
        </button>
      </div>
    </div>
  );
}
