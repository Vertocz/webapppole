"use client";

import { useEffect, useState } from "react";
import { BADGE_MAP, NIVEAU_COLORS, NIVEAU_LABELS } from "@/lib/badges";

interface Props {
  badgeIds: string[];
  onDone: () => void;
}

export default function BadgePopup({ badgeIds, onDone }: Props) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  const badge = BADGE_MAP[badgeIds[index]];

  useEffect(() => {
    if (!badge) { onDone(); return; }
  }, [badge, onDone]);

  const next = () => {
    setVisible(false);
    setTimeout(() => {
      if (index + 1 < badgeIds.length) {
        setIndex(i => i + 1);
        setVisible(true);
      } else {
        onDone();
      }
    }, 300);
  };

  if (!badge || !visible) return null;

  const color = NIVEAU_COLORS[badge.niveau];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}>
      <div className="w-full max-w-xs animate-badge-pop"
        style={{
          background: "linear-gradient(145deg, #0B1120, #0E1E38)",
          border: `1px solid ${color}44`,
          borderRadius: "1.5rem",
          boxShadow: `0 0 60px ${color}22, 0 20px 60px rgba(0,0,0,0.6)`,
          overflow: "hidden",
        }}>
        {/* Barre couleur niveau */}
        <div className="h-1" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />

        <div className="px-6 py-8 text-center">
          {/* Badge débloqué label */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5"
            style={{ background: `${color}18`, border: `1px solid ${color}44` }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
            <span className="text-[10px] font-bold tracking-[0.2em] uppercase" style={{ color }}>
              Badge débloqué !
            </span>
          </div>

          {/* Emoji / futur PNG */}
          <div className="text-7xl mb-4 relative inline-block">
            {badge.emoji}
            {/* Halo animé */}
            <div className="absolute inset-0 rounded-full animate-ping opacity-20"
              style={{ background: color, animationDuration: "2s" }} />
          </div>

          {/* Niveau */}
          <div className="text-xs font-bold tracking-[0.25em] uppercase mb-2" style={{ color }}>
            {NIVEAU_LABELS[badge.niveau]}
          </div>

          {/* Nom */}
          <h2 className="font-display text-2xl mb-2" style={{ color: "#E8EEF8" }}>
            {badge.nom}
          </h2>

          {/* Description */}
          <p className="text-sm leading-relaxed mb-6" style={{ color: "#6B82B0" }}>
            {badge.description}
          </p>

          {/* Compteur si plusieurs badges */}
          {badgeIds.length > 1 && (
            <p className="text-xs mb-4" style={{ color: "#3D5080" }}>
              {index + 1} / {badgeIds.length}
            </p>
          )}

          <button onClick={next}
            className="w-full py-3.5 rounded-xl font-display text-sm tracking-widest transition-all active:scale-95"
            style={{
              background: `linear-gradient(135deg, ${color}88, ${color})`,
              color: "white",
              boxShadow: `0 4px 20px ${color}44`,
            }}>
            {index + 1 < badgeIds.length ? "BADGE SUIVANT →" : "SUPER ! 🎉"}
          </button>
        </div>
      </div>
    </div>
  );
}
