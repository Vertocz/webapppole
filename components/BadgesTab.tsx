"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import {
  getBadgesPourProfil, CATEGORIE_LABELS, CATEGORIE_COLORS,
  BadgeCategorie, getBadgeImagePath, BadgeDef,
} from "@/lib/badges";
import Card from "./Card";

interface Props {
  userId: string;
  userType: "joueur" | "staff";
  categorie?: string;
  readOnly?: boolean;
}

export default function BadgesTab({ userId, userType, categorie, readOnly }: Props) {
  const [unlocked,      setUnlocked]      = useState<Set<string>>(new Set());
  const [loading,       setLoading]       = useState(true);
  const [selectedBadge, setSelectedBadge] = useState<BadgeDef | null>(null);

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

  const badges        = getBadgesPourProfil(userType, categorie);
  const totalUnlocked = badges.filter(b => unlocked.has(b.id)).length;
  const totalBadges   = badges.length;
  const categories    = [...new Set(badges.map(b => b.categorie))] as BadgeCategorie[];

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} />
    </div>
  );

  // ── Vue joueur : collection cliquable ────────────────────────────────────
  if (!readOnly) {
    const unlockedBadges = badges.filter(b => unlocked.has(b.id));
    return (
      <>
        <div className="space-y-5">
          <Card>
            <h2 className="font-display text-xl mb-1" style={{ color: "var(--text-main)" }}>
              MES MÉDAILLES
            </h2>
            <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
              {unlockedBadges.length === 0
                ? "Continue à t'entraîner pour débloquer ta première médaille !"
                : `${unlockedBadges.length} médaille${unlockedBadges.length > 1 ? "s" : ""} débloquée${unlockedBadges.length > 1 ? "s" : ""} — appuie pour agrandir`}
            </p>

            {unlockedBadges.length > 0 ? (
              <div className="grid grid-cols-3 gap-3">
                {unlockedBadges.map(badge => (
                  <button
                    key={badge.id}
                    onClick={() => setSelectedBadge(badge)}
                    className="rounded-xl p-3 text-center transition-all active:scale-95 hover:scale-105"
                    style={{
                      background: `${CATEGORIE_COLORS[badge.categorie]}12`,
                      border: `1px solid ${CATEGORIE_COLORS[badge.categorie]}33`,
                    }}
                  >
                    <Image
                      src={getBadgeImagePath(badge, categorie)}
                      alt={badge.nom}
                      width={80}
                      height={80}
                      className="object-contain mx-auto mb-1"
                    />
                    <p className="text-[11px] font-bold leading-tight" style={{ color: "var(--text-main)" }}>
                      {badge.nom}
                    </p>
                  </button>
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

        {/* Modal badge agrandi */}
        {selectedBadge && (
          <BadgeDetailModal
            badge={selectedBadge}
            categorie={categorie}
            onClose={() => setSelectedBadge(null)}
          />
        )}
      </>
    );
  }

  // ── Vue staff : tous les badges avec catégories ───────────────────────────
  return (
    <div className="space-y-5">
      {selectedBadge && (
        <BadgeDetailModal
          badge={selectedBadge}
          categorie={categorie}
          onClose={() => setSelectedBadge(null)}
        />
      )}
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
            <p className="text-xs font-medium tracking-widest uppercase mb-3 flex items-center gap-2"
              style={{ color: "var(--text-sub)" }}>
              <span>{icon}</span>{label}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {badgesCat.map(badge => {
                const isUnlocked = unlocked.has(badge.id);
                const Tag = isUnlocked ? "button" : "div";
                return (
                  <Tag
                    key={badge.id}
                    onClick={isUnlocked ? () => setSelectedBadge(badge) : undefined}
                    className={`rounded-xl p-4 transition-all text-left${isUnlocked ? " active:scale-95 hover:scale-105" : ""}`}
                    style={{
                      background: isUnlocked ? `${color}10` : "#0B1120",
                      border: `1px solid ${isUnlocked ? color + "44" : "rgba(43,80,160,0.1)"}`,
                      opacity: isUnlocked ? 1 : 0.45,
                    }}
                  >
                    <div className="mb-2" style={{ filter: isUnlocked ? "none" : "grayscale(1)" }}>
                      <Image
                        src={getBadgeImagePath(badge, categorie)}
                        alt={badge.nom}
                        width={56}
                        height={56}
                        className="object-contain"
                      />
                    </div>
                    <p className="text-xs font-bold mb-1"
                      style={{ color: isUnlocked ? "var(--text-main)" : "var(--text-muted)" }}>
                      {badge.nom}
                    </p>
                    <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                      {badge.description}
                    </p>
                  </Tag>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Modal détail badge ────────────────────────────────────────────────────────

function BadgeDetailModal({ badge, categorie, onClose }: {
  badge: BadgeDef;
  categorie?: string;
  onClose: () => void;
}) {
  const color = CATEGORIE_COLORS[badge.categorie];
  const { label, icon } = CATEGORIE_LABELS[badge.categorie];

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs animate-badge-pop"
        onClick={e => e.stopPropagation()}
        style={{
          background: "linear-gradient(145deg, #0B1120, #0E1E38)",
          border: `1px solid ${color}44`,
          borderRadius: "1.5rem",
          boxShadow: `0 0 60px ${color}22, 0 20px 60px rgba(0,0,0,0.6)`,
          overflow: "hidden",
        }}
      >
        {/* Barre couleur */}
        <div className="h-1" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />

        <div className="px-6 py-8 text-center">
          {/* Catégorie */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5"
            style={{ background: `${color}18`, border: `1px solid ${color}44` }}>
            <span>{icon}</span>
            <span className="text-[10px] font-bold tracking-[0.2em] uppercase" style={{ color }}>
              {label}
            </span>
          </div>

          {/* Image */}
          <div className="relative inline-block mb-4">
            <Image
              src={getBadgeImagePath(badge, categorie)}
              alt={badge.nom}
              width={180}
              height={180}
              className="object-contain"
            />
            <div
              className="absolute inset-0 rounded-full animate-ping opacity-10 pointer-events-none"
              style={{ background: color, animationDuration: "2.5s" }}
            />
          </div>

          {/* Nom */}
          <h2 className="font-display text-2xl mb-2" style={{ color: "#E8EEF8" }}>
            {badge.nom}
          </h2>

          {/* Description */}
          <p className="text-sm leading-relaxed mb-6" style={{ color: "#6B82B0" }}>
            {badge.description}
          </p>

          <button
            onClick={onClose}
            className="w-full py-3.5 rounded-xl font-display text-sm tracking-widest transition-all active:scale-95"
            style={{
              background: `linear-gradient(135deg, ${color}88, ${color})`,
              color: "white",
              boxShadow: `0 4px 20px ${color}44`,
            }}
          >
            FERMER
          </button>
        </div>
      </div>
    </div>
  );
}