"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { BADGES, BADGE_MAP, NIVEAU_COLORS, NIVEAU_LABELS, BadgeCategorie } from "@/lib/badges";
import Card from "./Card";

interface Props {
  userId: string;
  userType: "joueur" | "staff";
}

const CATEGORIES_JOUEUR: { id: BadgeCategorie; label: string; icon: string }[] = [
  { id: "basket",       label: "Basket",             icon: "⛹️‍♀️" },
  { id: "renforcement", label: "Renforcement",        icon: "🏋️‍♂️" },
  { id: "connexion",    label: "Connexions",          icon: "📅" },
  { id: "suivi_complet",label: "Suivi complet",       icon: "📋" },
  { id: "mental",       label: "Prépa mentale",       icon: "🧠" },
];

const CATEGORIES_STAFF: { id: BadgeCategorie; label: string; icon: string }[] = [
  { id: "connexion", label: "Connexions", icon: "📅" },
];

export default function BadgesTab({ userId, userType }: Props) {
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("badges_joueur")
      .select("badge_id")
      .eq("joueur_id", userId)
      .eq("joueur_type", userType)
      .then(({ data }) => {
        setUnlocked(new Set((data ?? []).map(b => b.badge_id)));
        setLoading(false);
      });
  }, [userId, userType]);

  const categories = userType === "staff" ? CATEGORIES_STAFF : CATEGORIES_JOUEUR;
  const totalUnlocked = unlocked.size;
  const totalBadges = BADGES.filter(b => b.cible === userType || b.cible === "tous").length;

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} />
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Progression globale */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-xl court-line pb-2" style={{ color: "var(--text-main)" }}>
            MES BADGES
          </h2>
          <span className="font-display text-2xl" style={{ color: "var(--accent)" }}>
            {totalUnlocked}<span className="text-sm font-light" style={{ color: "var(--text-muted)" }}>/{totalBadges}</span>
          </span>
        </div>
        <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
          <div className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${(totalUnlocked / totalBadges) * 100}%`, background: "linear-gradient(90deg, var(--accent), var(--accent2))" }} />
        </div>
        <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
          {totalUnlocked === 0 ? "Continue à t'entraîner pour débloquer tes premiers badges !" :
           totalUnlocked === totalBadges ? "🎉 Tu as débloqué tous les badges !" :
           `${totalBadges - totalUnlocked} badge${totalBadges - totalUnlocked > 1 ? "s" : ""} restant${totalBadges - totalUnlocked > 1 ? "s" : ""}`}
        </p>
      </Card>

      {/* Badges par catégorie */}
      {categories.map(cat => {
        const badgesCat = BADGES.filter(b =>
          b.categorie === cat.id && (b.cible === userType || b.cible === "tous")
        );

        return (
          <div key={cat.id}>
            <p className="text-xs font-medium tracking-widest uppercase mb-3 flex items-center gap-2"
              style={{ color: "var(--text-sub)" }}>
              <span>{cat.icon}</span> {cat.label}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {badgesCat.map(badge => {
                const isUnlocked = unlocked.has(badge.id);
                const color = NIVEAU_COLORS[badge.niveau];
                return (
                  <div key={badge.id}
                    className="rounded-xl p-4 transition-all"
                    style={{
                      background: isUnlocked
                        ? `color-mix(in srgb, ${color} 8%, #0B1120)`
                        : "#0B1120",
                      border: `1px solid ${isUnlocked ? color + "44" : "rgba(43,80,160,0.1)"}`,
                      opacity: isUnlocked ? 1 : 0.45,
                    }}>
                    {/* Emoji / futur PNG */}
                    <div className="text-3xl mb-2" style={{ filter: isUnlocked ? "none" : "grayscale(1)" }}>
                      {isUnlocked ? badge.emoji : "🔒"}
                    </div>
                    <div className="text-[10px] font-bold tracking-wider uppercase mb-0.5" style={{ color: isUnlocked ? color : "var(--text-muted)" }}>
                      {NIVEAU_LABELS[badge.niveau]}
                    </div>
                    <p className="text-xs font-medium mb-1" style={{ color: isUnlocked ? "var(--text-main)" : "var(--text-muted)" }}>
                      {badge.nom}
                    </p>
                    <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                      {badge.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
