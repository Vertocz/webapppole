"use client";

import { useState } from "react";
import Connect4 from "./Connect4";
import Bomberman from "./Bomberman";
import LancerFranc from "./LancerFranc";

interface GameDef {
  id: string;
  label: string;
  icon: string;
  available: boolean;
}

const GAMES: GameDef[] = [
  { id: "bomberman", label: "Bomberman", icon: "💣", available: true },
  { id: "puissance4", label: "Puissance 4", icon: "🔴", available: true },
  { id: "lancerfranc", label: "Lancer franc", icon: "🏀", available: true },
];

export default function GamesTab() {
  const [active, setActive] = useState<string | null>(null);

  if (active) {
    const game = GAMES.find((g) => g.id === active);
    return (
      <div className="space-y-4">
        <button
          onClick={() => setActive(null)}
          className="text-sm flex items-center gap-1.5"
          style={{ color: "var(--text-muted)" }}
        >
          ← Retour aux jeux
        </button>
        {active === "puissance4" && <Connect4 />}
        {active === "bomberman" && <Bomberman />}
        {active === "lancerfranc" && <LancerFranc />}
        {!game?.available && (
          <p className="text-sm text-center py-8" style={{ color: "var(--text-muted)" }}>
            {game?.label} arrive bientôt.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h2 className="font-display text-2xl" style={{ color: "var(--text-main)" }}>
        JEUX
      </h2>
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
        Jouez ensemble sans connexion internet — idéal en avion. Un joueur
        crée la partie (bouton &laquo;&nbsp;Créer une partie&nbsp;&raquo;), active son
        partage de connexion, et les autres la rejoignent en scannant un QR
        code.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {GAMES.map((g) => (
          <button
            key={g.id}
            disabled={!g.available}
            onClick={() => g.available && setActive(g.id)}
            className="rounded-2xl p-5 flex flex-col items-center gap-2 text-center transition-all active:scale-95 disabled:opacity-40"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
          >
            <span className="text-3xl">{g.icon}</span>
            <span className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
              {g.label}
            </span>
            {!g.available && (
              <span
                className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full"
                style={{ background: "var(--bg-input)", color: "var(--text-muted)" }}
              >
                Bientôt
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
