"use client";

import { useState } from "react";
import EmotionsTab from "./mentale/EmotionsTab";
import RespirationTab from "./mentale/RespirationTab";

const SOUS_ONGLETS = [
  { id: "emotions", label: "Émotions", icon: "💭" },
  { id: "respiration", label: "Respiration", icon: "🫁" },
];

export default function PreparationMentale({ userId, readOnly = false, onSave }: { userId: string; readOnly?: boolean; onSave?: () => void }) {
  const [sousOnglet, setSousOnglet] = useState("emotions");

  return (
    <div className="space-y-5">
      <div className="flex rounded-xl p-1 gap-1" style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
        {SOUS_ONGLETS.map((tab) => {
          const isActive = sousOnglet === tab.id;
          return (
            <button key={tab.id} onClick={() => setSousOnglet(tab.id)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all duration-200"
              style={isActive
                ? { background: "linear-gradient(135deg, var(--accent), var(--accent2))", color: "white", boxShadow: "0 2px 12px var(--accent-glow)" }
                : { color: "var(--text-muted)" }}>
              <span>{tab.icon}</span><span>{tab.label}</span>
            </button>
          );
        })}
      </div>
      {sousOnglet === "emotions" && <EmotionsTab userId={userId} readOnly={readOnly} />}
      {sousOnglet === "respiration" && <RespirationTab userId={userId} readOnly={readOnly} onSave={onSave} />}
    </div>
  );
}
