// components/NotificationsInbox.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Pole = "masculin" | "feminin" | "both";
type Role = "player" | "staff";

interface Props {
  userId: string;
  role: Role;
  pole: Pole;
}

interface Notif {
  id: string;
  title: string;
  body: string;
  sent_at: string;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);

  if (diffH < 1)  return "Il y a moins d'1h";
  if (diffH < 24) return `Il y a ${diffH}h`;
  if (diffD < 7)  return `Il y a ${diffD} jour${diffD > 1 ? "s" : ""}`;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

const STORAGE_KEY = (userId: string) => `notif_last_seen_${userId}`;

export default function NotificationsInbox({ userId, role, pole }: Props) {
  const [notifs,  setNotifs]  = useState<Notif[]>([]);
  const [visible, setVisible] = useState(false);
  const [index,   setIndex]   = useState(0);

  useEffect(() => {
    const load = async () => {
      const now = new Date().toISOString();
      const lastSeen = localStorage.getItem(STORAGE_KEY(userId));

      // Première connexion sur ce device : on marque maintenant et on n'affiche rien
      // (évite de spammer avec toutes les anciennes notifs)
      if (!lastSeen) {
        localStorage.setItem(STORAGE_KEY(userId), now);
        return;
      }

      const { data, error } = await supabase
        .from("push_notifications")
        .select("id, title, body, sent_at, target_pole, target_role, target_users")
        .gt("sent_at", lastSeen)
        .order("sent_at", { ascending: true });

      if (error || !data?.length) {
        localStorage.setItem(STORAGE_KEY(userId), now);
        return;
      }

      // Filtrer côté client : garder les notifs qui concernent cet user
      const relevant = data.filter(n => {
        // Ciblage individuel : prioritaire
        if (n.target_users?.length) {
          return n.target_users.includes(userId);
        }
        // Ciblage par rôle (valeurs : "player" | "staff" | null)
        if (n.target_role && n.target_role !== role) return false;
        // Ciblage par pôle (valeurs : "masculin" | "feminin" | null)
        if (n.target_pole) {
          if (pole === "both") return true;
          return n.target_pole === pole;
        }
        return true;
      });

      if (!relevant.length) {
        localStorage.setItem(STORAGE_KEY(userId), now);
        return;
      }

      setNotifs(relevant);
      setIndex(0);
      setVisible(true);
    };

    load();
  }, [userId, role, pole]);

  const handleClose = () => {
    localStorage.setItem(STORAGE_KEY(userId), new Date().toISOString());
    setVisible(false);
  };

  const handleNext = () => {
    if (index + 1 < notifs.length) {
      setIndex(i => i + 1);
    } else {
      handleClose();
    }
  };

  if (!visible || !notifs.length) return null;

  const notif = notifs[index];

  return (
    <>
      <div className="fixed inset-0 z-[250]"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
        onClick={handleClose}
      />

      <div className="fixed inset-0 z-[251] flex items-end sm:items-center justify-center p-4">
        <div
          className="w-full sm:max-w-sm rounded-2xl overflow-hidden"
          style={{
            background: "linear-gradient(145deg, #0B1120, #0E1E38)",
            border: "1px solid rgba(43,80,160,0.35)",
            boxShadow: "0 -8px 60px rgba(0,0,0,0.6)",
            animation: "inboxSlideUp .35s cubic-bezier(.32,.72,0,1) forwards",
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Barre déco */}
          <div className="h-1" style={{ background: "linear-gradient(90deg,transparent,#1B3A8C,#C49A28,transparent)" }} />

          <div className="p-6">

            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base"
                  style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))" }}>
                  📬
                </div>
                <div>
                  <p className="font-display text-sm tracking-wider" style={{ color: "var(--text-main)" }}>
                    MESSAGES REÇUS
                  </p>
                  {notifs.length > 1 && (
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {index + 1} / {notifs.length}
                    </p>
                  )}
                </div>
              </div>
              <button onClick={handleClose}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-opacity hover:opacity-70"
                style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                ✕
              </button>
            </div>

            {/* Contenu notif */}
            <div className="rounded-xl p-4 mb-4"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center text-base"
                  style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))" }}>
                  🏀
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-sm font-semibold leading-tight" style={{ color: "var(--text-main)" }}>
                      {notif.title}
                    </p>
                    <span className="text-[10px] shrink-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {formatDate(notif.sent_at)}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--text-sub)" }}>
                    {notif.body}
                  </p>
                </div>
              </div>
            </div>

            {/* Indicateurs si plusieurs notifs */}
            {notifs.length > 1 && (
              <div className="flex justify-center gap-1.5 mb-4">
                {notifs.map((_, i) => (
                  <div key={i} className="rounded-full transition-all"
                    style={{
                      width: i === index ? "16px" : "6px",
                      height: "6px",
                      background: i === index ? "var(--accent)" : "var(--border)",
                    }} />
                ))}
              </div>
            )}

            {/* Bouton */}
            <button onClick={handleNext}
              className="w-full py-3 rounded-xl font-display text-sm tracking-widest transition-all active:scale-95"
              style={{
                background: "linear-gradient(135deg,var(--accent),var(--accent2))",
                color: "white",
                boxShadow: "0 4px 20px var(--accent-glow)",
              }}>
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
