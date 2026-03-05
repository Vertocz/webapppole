"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { getBadgesPourProfil, CATEGORIE_LABELS, CATEGORIE_COLORS, BadgeCategorie } from "@/lib/badges";
import Card from "./Card";

interface Props {
  userId: string;
  userType: "joueur" | "staff";
  categorie?: string;
  readOnly?: boolean; // true = vue staff sur un joueur
}

export default function BadgesTab({ userId, userType, categorie, readOnly }: Props) {
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("badges_joueur")
      .select("badge_id")
      .eq("joueur_id", userId)
      .eq("joueur_type", userType)
      .then(({ data }) => {
        setUnlocked(new Set((data ?? []).map(b => b.badge_id)));
        setLoading(false);
      });
  }, [userId, userType]);

  const badges = getBadgesPourProfil(userType, categorie);
  const totalUnlocked = badges.filter(b => unlocked.has(b.id)).length;
  const totalBadges = badges.length;
  const categories = [...new Set(badges.map(b => b.categorie))] as BadgeCategorie[];

  if (loading) return (
    <div className="flex justify-center py-12">
      <div
        className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }}
      />
    </div>
  );

  // ── Vue joueur : collection de médailles débloquées uniquement ──────────────
  if (!readOnly) {
    const unlockedBadges = badges.filter(b => unlocked.has(b.id));
    return (
      <div className="space-y-5">
        <Card>
          <h2 className="font-display text-xl mb-1" style={{ color: "var(--text-main)" }}>
            MES MÉDAILLES
          </h2>
          <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
            {unlockedBadges.length === 0
              ? "Continue à t'entraîner pour débloquer ta première médaille !"
              : `${unlockedBadges.length} médaille${unlockedBadges.length > 1 ? "s" : ""} débloquée${unlockedBadges.length > 1 ? "s" : ""}`}
          </p>

          {unlockedBadges.length > 0 ? (
            <div className="grid grid-cols-3 gap-3">
              {unlockedBadges.map(badge => (
                <div
                  key={badge.id}
                  className="rounded-xl p-3 text-center"
                  style={{
                    background: `${CATEGORIE_COLORS[badge.categorie]}12`,
                    border: `1px solid ${CATEGORIE_COLORS[badge.categorie]}33`,
                  }}
                >
                  <Image
                    src={`/badges/${badge.id}.png`}
                    alt={badge.nom}
                    width={80}
                    height={80}
                    className="object-contain mx-auto mb-1"
                  />
                  <p className="text-[11px] font-bold leading-tight" style={{ color: "var(--text-main)" }}>
                    {badge.nom}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-3 opacity-20">
                <Image src="/badges/presence_joueur.png" alt="" width={64} height={64} className="object-contain" />
              </div>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Tes médailles s&apos;afficheront ici
              </p>
            </div>
          )}
        </Card>
      </div>
    );
  }

  // ── Vue staff : tous les badges avec catégories ───────────────────────────
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-xl" style={{ color: "var(--text-main)" }}>BADGES</h2>
          <span className="font-display text-2xl" style={{ color: "var(--accent)" }}>
            {totalUnlocked}
            <span className="text-sm font-light" style={{ color: "var(--text-muted)" }}>/{totalBadges}</span>
          </span>
        </div>
        <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{
              width: `${totalBadges > 0 ? (totalUnlocked / totalBadges) * 100 : 0}%`,
              background: "linear-gradient(90deg, var(--accent), var(--accent2))",
            }}
          />
        </div>
      </Card>

      {categories.map(cat => {
        const badgesCat = badges.filter(b => b.categorie === cat);
        const { label, icon } = CATEGORIE_LABELS[cat];
        const color = CATEGORIE_COLORS[cat];
        return (
          <div key={cat}>
            <p
              className="text-xs font-medium tracking-widest uppercase mb-3 flex items-center gap-2"
              style={{ color: "var(--text-sub)" }}
            >
              <span>{icon}</span>{label}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {badgesCat.map(badge => {
                const isUnlocked = unlocked.has(badge.id);
                return (
                  <div
                    key={badge.id}
                    className="rounded-xl p-4 transition-all"
                    style={{
                      background: isUnlocked ? `${color}10` : "#0B1120",
                      border: `1px solid ${isUnlocked ? color + "44" : "rgba(43,80,160,0.1)"}`,
                      opacity: isUnlocked ? 1 : 0.45,
                    }}
                  >
                    <div className="mb-2" style={{ filter: isUnlocked ? "none" : "grayscale(1)" }}>
                      <Image
                        src={`/badges/${badge.image}`}
                        alt={badge.nom}
                        width={56}
                        height={56}
                        className="object-contain"
                      />
                    </div>
                    <p
                      className="text-xs font-bold mb-1"
                      style={{ color: isUnlocked ? "var(--text-main)" : "var(--text-muted)" }}
                    >
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
