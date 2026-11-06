"use client";

import { useState } from "react";
import RoomConnect from "./RoomConnect";
import Bomberman from "./Bomberman";
import LuckyLuke from "./LuckyLuke";
import LancerFranc from "./LancerFranc";
import GarticPhone from "./GarticPhone";

type Mode = "menu" | "swish" | "bomberman" | "gartic" | "lucky";

const TUILES: { mode: Exclude<Mode, "menu">; icon: string; label: string; sub?: string }[] = [
  { mode: "swish", icon: "🏀", label: "Swish 3x3" },
  { mode: "lucky", icon: "🎯", label: "Lucky Luke", sub: "Duels de Swish 3x3" },
  { mode: "bomberman", icon: "💣", label: "Bomberman" },
  { mode: "gartic", icon: "🎨", label: "Gartic Phone", sub: "3 joueurs min." },
];

function Quitter({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-sm" style={{ color: "var(--text-muted)" }}>
      ← Quitter la partie
    </button>
  );
}

export default function GamesTab() {
  const [mode, setMode] = useState<Mode>("menu");
  const [connectionKey, setConnectionKey] = useState(0);

  // Une RoomConnect neuve à chaque nouvelle partie
  const leave = () => {
    setConnectionKey((k) => k + 1);
    setMode("menu");
  };

  if (mode === "swish") {
    return <LancerFranc onExit={() => setMode("menu")} />;
  }

  if (mode === "lucky") {
    return (
      <RoomConnect key={connectionKey} gameName="Lucky Luke" minPlayers={2} allowSolo={false}>
        {(ctx) => <LuckyLuke ctx={ctx} onExit={leave} />}
      </RoomConnect>
    );
  }

  if (mode === "bomberman") {
    return (
      <div className="space-y-4">
        <Quitter onClick={leave} />
        <RoomConnect key={connectionKey} gameName="Bomberman" minPlayers={1}>
          {(ctx) => <Bomberman ctx={ctx} />}
        </RoomConnect>
      </div>
    );
  }

  if (mode === "gartic") {
    return (
      <div className="space-y-4">
        <Quitter onClick={leave} />
        <RoomConnect key={connectionKey} gameName="Gartic Phone" minPlayers={3} allowSolo={false}>
          {(ctx) => <GarticPhone ctx={ctx} />}
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
        Pour jouer à plusieurs, l&apos;hôte crée une partie et donne un code à 5 caractères aux autres
        (connexion internet nécessaire).
      </p>
      <div className="grid grid-cols-2 gap-3">
        {TUILES.map((t) => (
          <button
            key={t.mode}
            onClick={() => setMode(t.mode)}
            className="rounded-2xl p-5 flex flex-col items-center gap-2 text-center transition-all active:scale-95"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
          >
            <span className="text-3xl">{t.icon}</span>
            <span className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
              {t.label}
            </span>
            {t.sub && (
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                {t.sub}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
