// components/NotificationsInbox.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Pole = "masculin" | "feminin" | "both";
type Role = "player" | "staff";

interface Props {
  userId: string;
  role:   Role;
  pole:   Pole;
}

interface Notif {
  id:      string;
  title:   string;
  body:    string;
  sent_at: string;
}

function formatDate(iso: string) {
  const d     = new Date(iso);
  const now   = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH  = Math.floor(diffMs / 3600000);
  const diffD  = Math.floor(diffMs / 86400000);

  if (diffH < 1)  return "Il y a moins d'1h";
  if (diffH < 24) return `Il y a ${diffH}h`;
  if (diffD < 7)  return `Il y a ${diffD} jour${diffD > 1 ? "s" : ""}`;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

// ─── Fallback localStorage (utilisateurs sans push activé) ───────────────────
const LS_KEY = (userId: string) => `notif_last_seen_${userId}`;

function getLsLastSeen(userId: string): string | null {
  try { return localStorage.getItem(LS_KEY(userId)); } catch { return null; }
}
function setLsLastSeen(userId: string, ts: string) {
  try { localStorage.setItem(LS_KEY(userId), ts); } catch { /* rien */ }
}

export default function NotificationsInbox({ userId, role, pole }: Props) {
  const [notifs,       setNotifs]       = useState<Notif[]>([]);
  const [visible,      setVisible]      = useState(false);
  const [index,        setIndex]        = useState(0);
  // endpoint de la subscription courante (null = pas de push ou non dispo)
  const [subEndpoint,  setSubEndpoint]  = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const now = new Date().toISOString();
      let cutoff: string | null = null;
      let endpoint: string | null = null;

      // ── 1. Essaie de lire la subscription push du navigateur ──────────────
      if ("serviceWorker" in navigator && "PushManager" in window) {
        try {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();

          if (sub) {
            endpoint = sub.endpoint;
            setSubEndpoint(endpoint);

            // Lit notif_seen_at depuis Supabase pour CETTE subscription
            const { data } = await supabase
              .from("push_subscriptions")
              .select("notif_seen_at")
              .eq("endpoint", endpoint)
              .eq("user_id", userId)
              .maybeSingle();

            // notif_seen_at = date de subscription (initiale) ou dernière lecture
            cutoff = data?.notif_seen_at ?? null;
          }
        } catch {
          // Service worker non prêt, on tombe en fallback
        }
      }

      // ── 2. Fallback localStorage si pas de push subscription ──────────────
      if (!endpoint) {
        const ls = getLsLastSeen(userId);
        if (!ls) {
          // Première connexion sans push : on mémorise et on ne spamme pas
          setLsLastSeen(userId, now);
          return;
        }
        cutoff = ls;
      }

      if (!cutoff) return; // Aucun point de départ disponible

      // ── 3. Charge les notifs depuis le cutoff ─────────────────────────────
      const { data, error } = await supabase
        .from("push_notifications")
        .select("id, title, body, sent_at, target_pole, target_role, target_users")
        .gt("sent_at", cutoff)
        .order("sent_at", { ascending: true });

      if (error || !data?.length) return;

      // ── 4. Filtre côté client : garder ce qui concerne cet utilisateur ────
      const relevant = data.filter((n) => {
        if (n.target_users?.length) return n.target_users.includes(userId);
        if (n.target_role && n.target_role !== role) return false;
        if (n.target_pole) {
          if (pole === "both") return true;
          return n.target_pole === pole;
        }
        return true;
      });

      if (!relevant.length) return;

      setNotifs(relevant);
      setIndex(0);
      setVisible(true);
    };

    load();
  }, [userId, role, pole]);

  // ── Marque tout comme lu ──────────────────────────────────────────────────
  const markSeen = async () => {
    const now = new Date().toISOString();

    if (subEndpoint) {
      // Met à jour notif_seen_at dans Supabase pour cette subscription
      await supabase
        .from("push_subscriptions")
        .update({ notif_seen_at: now })
        .eq("endpoint", subEndpoint)
        .eq("user_id", userId);
    } else {
      // Fallback localStorage
      setLsLastSeen(userId, now);
    }
  };

  const handleClose = async () => {
    await markSeen();
    setVisible(false);
  };

  const handleNext = () => {
    if (index + 1 < notifs.length) {
      setIndex((i) => i + 1);
    } else {
      handleClose();
    }
  };

  if (!visible || !notifs.length) return null;

  const notif = notifs[index];

  return (
    <>
      <div
        className="fixed inset-0 z-[250]"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
        onClick={handleClose}
      />

      <div className="fixed inset-0 z-[251] flex items-end sm:items-center justify-center p-4">
        <div
          className="w-full sm:max-w-sm rounded-2xl overflow-hidden"
          style={{
            background:  "linear-gradient(145deg, #0B1120, #0E1E38)",
            border:      "1px solid rgba(43,80,160,0.35)",
            boxShadow:   "0 -8px 60px rgba(0,0,0,0.6)",
            animation:   "inboxSlideUp .35s cubic-bezier(.32,.72,0,1) forwards",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Barre déco */}
          <div
            className="h-1"
            style={{ background: "linear-gradient(90deg,transparent,#1B3A8C,#C49A28,transparent)" }}
          />

          <div className="p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-base"
                  style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))" }}
                >
                  📬
                </div>
                <div>
                  <p
                    className="font-display text-sm tracking-wider"
                    style={{ color: "var(--text-main)" }}
                  >
                    MESSAGES REÇUS
                  </p>
                  {notifs.length > 1 && (
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {index + 1} / {notifs.length}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={handleClose}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-opacity hover:opacity-70"
                style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
              >
                ✕
              </button>
            </div>

            {/* Contenu notif */}
            <div
              className="rounded-xl p-4 mb-4"
              style={{
                background: "rgba(255,255,255,0.04)",
                border:     "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center text-base"
                  style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))" }}
                >
                  🏀
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p
                      className="text-sm font-semibold leading-tight"
                      style={{ color: "var(--text-main)" }}
                    >
                      {notif.title}
                    </p>
                    <span
                      className="text-[10px] shrink-0 mt-0.5"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {formatDate(notif.sent_at)}
                    </span>
                  </div>
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: "var(--text-sub)" }}
                  >
                    {notif.body}
                  </p>
                </div>
              </div>
            </div>

            {/* Indicateurs si plusieurs notifs */}
            {notifs.length > 1 && (
              <div className="flex justify-center gap-1.5 mb-4">
                {notifs.map((_, i) => (
                  <div
                    key={i}
                    className="rounded-full transition-all"
                    style={{
                      width:      i === index ? "16px" : "6px",
                      height:     "6px",
                      background: i === index ? "var(--accent)" : "var(--border)",
                    }}
                  />
                ))}
              </div>
            )}

            {/* Bouton */}
            <button
              onClick={handleNext}
              className="w-full py-3 rounded-xl font-display text-sm tracking-widest transition-all active:scale-95"
              style={{
                background: "linear-gradient(135deg,var(--accent),var(--accent2))",
                color:      "white",
                boxShadow:  "0 4px 20px var(--accent-glow)",
              }}
            >
              {index + 1 < notifs.length ? "SUIVANT →" : "OK, COMPRIS"}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes inboxSlideUp {
          from { transform: translateY(40px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </>
  );
}
