"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Props {
  notifId: string;
  onClose: () => void;
}

interface Notif {
  title: string;
  body: string;
  sent_at: string;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });
}

export default function NotifModal({ notifId, onClose }: Props) {
  const [notif,   setNotif]   = useState<Notif | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("push_notifications")
      .select("title, body, sent_at")
      .eq("id", notifId)
      .single()
      .then(({ data }) => {
        setNotif(data ?? null);
        setLoading(false);
      });
  }, [notifId]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-0"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Barre accent */}
        <div className="h-1" style={{ background: "linear-gradient(90deg, var(--primary), var(--accent))" }} />

        <div className="px-5 py-5">
          {/* En-tête */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">🔔</span>
              <span className="text-[10px] font-bold tracking-widest uppercase"
                style={{ color: "var(--accent)" }}>
                Notification
              </span>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-opacity hover:opacity-60"
              style={{ background: "var(--bg-input)", color: "var(--text-muted)" }}>
              ✕
            </button>
          </div>

          {/* Contenu */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
            </div>
          ) : !notif ? (
            <p className="text-sm text-center py-6" style={{ color: "var(--text-muted)" }}>
              Notification introuvable.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-base font-semibold leading-snug" style={{ color: "var(--text-main)" }}>
                {notif.title}
              </p>
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-sub)" }}>
                {notif.body}
              </p>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {fmtDate(notif.sent_at)}
              </p>
            </div>
          )}

          {/* Bouton fermer */}
          <button
            onClick={onClose}
            className="w-full mt-5 py-3 rounded-xl text-sm font-medium tracking-wide transition-all active:scale-95"
            style={{
              background: "linear-gradient(135deg, var(--accent), var(--accent2, var(--accent)))",
              color: "white",
            }}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
