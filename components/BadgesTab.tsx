"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { CATEGORIE_LABELS, CATEGORIE_COLORS, BadgeCategorie } from "@/lib/badges";
import Card from "./Card";

// ─── Types ────────────────────────────────────────────────────────────────────
interface BadgeRow {
  id: string;
  nom: string;
  description: string;
  type: "automatique" | "manuel";
  masculin: boolean;
  feminin: boolean;
  joueurs: boolean;
  staff: boolean;
  image_url_masc: string | null;
  image_url_fem:  string | null;
}

interface Props {
  userId:    string;
  userType:  "joueur" | "staff";
  categorie?: string; // "Masculin" | "Féminin"
  readOnly?:  boolean;
  // Props staff : quand fournies, affiche le panneau d'attribution manuelle
  staffId?:   string;
  staffPole?: "masculin" | "feminin" | "both";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getCat(id: string): BadgeCategorie {
  if (id.startsWith("basket") || id.startsWith("serie") || id.startsWith("machine") || id.startsWith("disette") || id.startsWith("mois") || id.startsWith("sans")
    || id.startsWith("lancers") || id === "cent_mille")
    return "basket";
  if (id.startsWith("renfo"))   return "renforcement";
  if (id.startsWith("presence")) return "connexion";
  if (id.startsWith("recuperation") || id.startsWith("zen") || id.startsWith("pile") || id.startsWith("bonne"))
    return "forme";
  if (id.startsWith("mental") || id.startsWith("scan") || id.startsWith("explorateur") || id.startsWith("emotions"))
    return "mental";
  return "complet";
}

function getImg(badge: BadgeRow, categorie?: string): string | null {
  if (categorie === "Masculin") return badge.image_url_masc ?? badge.image_url_fem ?? null;
  return badge.image_url_fem ?? badge.image_url_masc ?? null;
}

// ─── Sous-composant image (jamais de src vide) ────────────────────────────────
function BadgeImg({ src, nom, width, height, className }: {
  src: string | null; nom: string; width: number; height: number; className?: string;
}) {
  if (!src) return (
    <div className={className}
      style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center", fontSize: width * 0.55 }}>
      🏅
    </div>
  );
  return <Image src={src} alt={nom} width={width} height={height} className={className} />;
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function BadgesTab({ userId, userType, categorie, readOnly, staffId, staffPole }: Props) {
  const [allBadges,     setAllBadges]     = useState<BadgeRow[]>([]);
  const [unlocked,      setUnlocked]      = useState<Set<string>>(new Set());
  const [loading,       setLoading]       = useState(true);
  const [selectedBadge, setSelectedBadge] = useState<BadgeRow | null>(null);

  const load = useCallback(async () => {
    let query = supabase.from("badges").select("*");
    if (userType === "staff") {
      query = query.eq("staff", true);
    } else {
      query = query.eq("joueurs", true);
      if (categorie === "Masculin")     query = query.eq("masculin", true);
      else if (categorie === "Féminin") query = query.eq("feminin",  true);
      // Si undefined : pas de filtre genre → tous les badges joueurs affichés
    }

    const [{ data: badgesData }, { data: unlockedData }] = await Promise.all([
      query,
      supabase.from("badges_joueur").select("badge_id")
        .eq("joueur_id",   userId)
        .eq("joueur_type", userType),
    ]);

    setAllBadges(badgesData ?? []);
    setUnlocked(new Set((unlockedData ?? []).map(b => b.badge_id)));
    setLoading(false);
  }, [userId, userType, categorie]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} />
    </div>
  );

  const unlockedBadges = allBadges.filter(b => unlocked.has(b.id));
  const totalBadges    = allBadges.length;
  const totalUnlocked  = unlockedBadges.length;
  const categories     = [...new Set(allBadges.map(b => getCat(b.id)))] as BadgeCategorie[];

  // ── Vue joueur (page player) ──────────────────────────────────────────────
  if (!readOnly) {
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
                {unlockedBadges.map(badge => {
                  const color = CATEGORIE_COLORS[getCat(badge.id)];
                  return (
                    <button key={badge.id} onClick={() => setSelectedBadge(badge)}
                      className="rounded-xl p-3 text-center transition-all active:scale-95 hover:scale-105"
                      style={{ background: `${color}12`, border: `1px solid ${color}33` }}>
                      <BadgeImg src={getImg(badge, categorie)} nom={badge.nom}
                        width={80} height={80} className="object-contain mx-auto mb-1" />
                      <p className="text-[11px] font-bold leading-tight" style={{ color: "var(--text-main)" }}>
                        {badge.nom}
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-4xl mb-3 opacity-20">🏅</p>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Tes médailles s&apos;afficheront ici
                </p>
              </div>
            )}
          </Card>
        </div>
        {selectedBadge && (
          <BadgeDetailModal badge={selectedBadge} categorie={categorie} onClose={() => setSelectedBadge(null)} />
        )}
      </>
    );
  }

  // ── Vue staff (page staff, readOnly + attribution) ────────────────────────
  return (
    <div className="space-y-5">
      {selectedBadge && (
        <BadgeDetailModal badge={selectedBadge} categorie={categorie} onClose={() => setSelectedBadge(null)} />
      )}

      {/* Progression */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-xl" style={{ color: "var(--text-main)" }}>BADGES</h2>
          <span className="font-display text-2xl" style={{ color: "var(--accent)" }}>
            {totalUnlocked}
            <span className="text-sm font-light" style={{ color: "var(--text-muted)" }}>/{totalBadges}</span>
          </span>
        </div>
        <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
          <div className="h-full rounded-full transition-all duration-1000"
            style={{
              width: `${totalBadges > 0 ? (totalUnlocked / totalBadges) * 100 : 0}%`,
              background: "linear-gradient(90deg, var(--accent), var(--accent2))",
            }} />
        </div>
      </Card>

      {/* Attribution manuelle (si staffId fourni) */}
      {staffId && (
        <ManualAssignPanel
          joueurId={userId}
          joueurCategorie={categorie}
          staffId={staffId}
          staffPole={staffPole ?? "both"}
          unlocked={unlocked}
          onAssigned={(newId) => setUnlocked(prev => new Set([...prev, newId]))}
        />
      )}

      {/* Collection par catégorie */}
      {categories.map(cat => {
        const badgesCat       = allBadges.filter(b => getCat(b.id) === cat);
        const { label, icon } = CATEGORIE_LABELS[cat];
        const color           = CATEGORIE_COLORS[cat];
        return (
          <div key={cat}>
            <p className="text-xs font-medium tracking-widest uppercase mb-3 flex items-center gap-2"
              style={{ color: "var(--text-sub)" }}>
              <span>{icon}</span>{label}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {badgesCat.map(badge => {
                const isUnlocked = unlocked.has(badge.id);
                const Tag        = isUnlocked ? "button" : "div";
                return (
                  <Tag key={badge.id}
                    onClick={isUnlocked ? () => setSelectedBadge(badge) : undefined}
                    className={`rounded-xl p-4 transition-all text-left${isUnlocked ? " active:scale-95 hover:scale-105" : ""}`}
                    style={{
                      background: isUnlocked ? `${color}10` : "#0B1120",
                      border:     `1px solid ${isUnlocked ? color + "44" : "rgba(43,80,160,0.1)"}`,
                      opacity:    isUnlocked ? 1 : 0.45,
                    }}>
                    <div className="mb-2" style={{ filter: isUnlocked ? "none" : "grayscale(1)" }}>
                      <BadgeImg src={getImg(badge, categorie)} nom={badge.nom}
                        width={56} height={56} className="object-contain" />
                    </div>
                    <p className="text-xs font-bold mb-1"
                      style={{ color: isUnlocked ? "var(--text-main)" : "var(--text-muted)" }}>
                      {badge.nom}
                    </p>
                    <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                      {badge.description}
                    </p>
                    {badge.type === "manuel" && (
                      <span className="inline-block mt-1.5 text-[9px] px-1.5 py-0.5 rounded-full font-bold tracking-widest uppercase"
                        style={{ background: `${color}22`, color }}>
                        Manuel
                      </span>
                    )}
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

// ─── Panneau d'attribution manuelle ───────────────────────────────────────────
function ManualAssignPanel({
  joueurId, joueurCategorie, staffId, staffPole, unlocked, onAssigned,
}: {
  joueurId:         string;
  joueurCategorie?: string;
  staffId:          string;
  staffPole:        "masculin" | "feminin" | "both";
  unlocked:         Set<string>;
  onAssigned:       (badgeId: string) => void;
}) {
  const [badges,    setBadges]    = useState<BadgeRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [feedback,  setFeedback]  = useState<{ id: string; ok: boolean } | null>(null);

  useEffect(() => {
    async function load() {
      // Badges manuels filtrés par pole du staff ET compatibles avec le genre du joueur
      let q = supabase.from("badges").select("*").eq("type", "manuel").eq("joueurs", true);
      if (joueurCategorie === "Masculin") q = q.eq("masculin", true);
      else                                q = q.eq("feminin",  true);
      // Filtre pole staff
      if (staffPole === "masculin") q = q.eq("masculin", true);
      if (staffPole === "feminin")  q = q.eq("feminin",  true);
      const { data } = await q.order("nom");
      setBadges(data ?? []);
      setLoading(false);
    }
    load();
  }, [joueurCategorie, staffPole]);

  const assign = useCallback(async (badge: BadgeRow) => {
    if (assigning) return;
    setAssigning(badge.id);
    const { error } = await supabase.from("badges_joueur").insert({
      joueur_id:   joueurId,
      joueur_type: "joueur",
      badge_id:    badge.id,
      sent_by:     staffId,
      unlocked_at: new Date().toISOString(),
    });
    setAssigning(null);
    if (!error) {
      onAssigned(badge.id);
      setFeedback({ id: badge.id, ok: true });
      setTimeout(() => setFeedback(null), 2500);
    } else {
      setFeedback({ id: badge.id, ok: false });
      setTimeout(() => setFeedback(null), 2500);
    }
  }, [joueurId, staffId, assigning, onAssigned]);

  if (loading) return null;
  if (badges.length === 0) return null;

  // Séparer : déjà attribués / disponibles
  const disponibles = badges.filter(b => !unlocked.has(b.id));
  const deja        = badges.filter(b => unlocked.has(b.id));

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ border: "1px solid rgba(232,100,28,0.25)", background: "rgba(232,100,28,0.04)" }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2"
        style={{ borderBottom: "1px solid rgba(232,100,28,0.15)" }}>
        <span className="text-base">🏅</span>
        <p className="text-xs font-bold tracking-widest uppercase" style={{ color: "#E8641C" }}>
          Attribuer un badge
        </p>
      </div>

      <div className="p-4 space-y-3">
        {disponibles.length === 0 && (
          <p className="text-xs text-center py-2" style={{ color: "var(--text-muted)" }}>
            Ce joueur possède déjà tous les badges manuels disponibles.
          </p>
        )}

        {/* Badges disponibles */}
        {disponibles.map(badge => {
          const isBusy = assigning === badge.id;
          const fb     = feedback?.id === badge.id;
          return (
            <button key={badge.id}
              onClick={() => assign(badge)}
              disabled={!!assigning}
              className="w-full flex items-center gap-3 rounded-xl px-4 py-3 transition-all text-left active:scale-[0.99] hover:scale-[1.005]"
              style={{
                background: fb
                  ? feedback!.ok ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)"
                  : "rgba(255,255,255,0.04)",
                border: `1px solid ${fb
                  ? feedback!.ok ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)"
                  : "rgba(232,100,28,0.2)"}`,
                opacity: assigning && !isBusy ? 0.5 : 1,
              }}>
              <BadgeImg src={getImg(badge, joueurCategorie)} nom={badge.nom}
                width={44} height={44} className="object-contain flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold" style={{ color: "var(--text-main)" }}>{badge.nom}</p>
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{badge.description}</p>
              </div>
              <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: "rgba(232,100,28,0.15)" }}>
                {isBusy
                  ? <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
                      style={{ borderColor: "#E8641C", borderTopColor: "transparent" }} />
                  : fb
                    ? <span className="text-sm">{feedback!.ok ? "✓" : "✗"}</span>
                    : <span className="text-xs" style={{ color: "#E8641C" }}>+</span>
                }
              </div>
            </button>
          );
        })}

        {/* Badges déjà attribués */}
        {deja.length > 0 && (
          <div className="mt-2 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
              Déjà attribués
            </p>
            <div className="flex flex-wrap gap-2">
              {deja.map(badge => (
                <div key={badge.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                  style={{ background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)" }}>
                  <BadgeImg src={getImg(badge, joueurCategorie)} nom={badge.nom}
                    width={20} height={20} className="object-contain" />
                  <span className="text-[11px] font-medium" style={{ color: "#4ade80" }}>{badge.nom}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Modal détail ─────────────────────────────────────────────────────────────
function BadgeDetailModal({ badge, categorie, onClose }: {
  badge: BadgeRow; categorie?: string; onClose: () => void;
}) {
  const cat             = getCat(badge.id);
  const color           = CATEGORIE_COLORS[cat];
  const { label, icon } = CATEGORIE_LABELS[cat];
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)" }}
      onClick={onClose}>
      <div className="w-full max-w-xs animate-badge-pop" onClick={e => e.stopPropagation()}
        style={{
          background:   "linear-gradient(145deg, #0B1120, #0E1E38)",
          border:       `1px solid ${color}44`,
          borderRadius: "1.5rem",
          boxShadow:    `0 0 60px ${color}22, 0 20px 60px rgba(0,0,0,0.6)`,
          overflow:     "hidden",
        }}>
        <div className="h-1" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />
        <div className="px-6 py-8 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5"
            style={{ background: `${color}18`, border: `1px solid ${color}44` }}>
            <span>{icon}</span>
            <span className="text-[10px] font-bold tracking-[0.2em] uppercase" style={{ color }}>{label}</span>
          </div>
          <div className="relative inline-block mb-4">
            <BadgeImg src={getImg(badge, categorie)} nom={badge.nom}
              width={180} height={180} className="object-contain" />
            <div className="absolute inset-0 rounded-full animate-ping opacity-10 pointer-events-none"
              style={{ background: color, animationDuration: "2.5s" }} />
          </div>
          <h2 className="font-display text-2xl mb-2" style={{ color: "#E8EEF8" }}>{badge.nom}</h2>
          <p className="text-sm leading-relaxed mb-6" style={{ color: "#6B82B0" }}>{badge.description}</p>
          <button onClick={onClose}
            className="w-full py-3.5 rounded-xl font-display text-sm tracking-widest transition-all active:scale-95"
            style={{
              background: `linear-gradient(135deg, ${color}88, ${color})`,
              color:      "white",
              boxShadow:  `0 4px 20px ${color}44`,
            }}>
            FERMER
          </button>
        </div>
      </div>
    </div>
  );
}