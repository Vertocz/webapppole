"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Billet } from "@/types";
import Card from "./Card";

const STORAGE_BASE = "https://fxvotvtapcwzvjhfreqv.supabase.co/storage/v1/object/public/Billets/";

export default function Billets({ userId }: { userId: string }) {
  const [billets, setBillets] = useState<Billet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("billets").select("*").eq("joueuse_id", userId)
      .order("created_at", { ascending: false })
      .then(({ data }) => { setBillets(data ?? []); setLoading(false); });
  }, [userId]);

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} />
    </div>
  );

  if (billets.length === 0) return (
    <Card>
      <div className="text-center py-8">
        <span className="text-5xl block mb-4">🎫</span>
        <p style={{ color: "var(--text-muted)" }}>Aucun billet disponible pour le moment.</p>
      </div>
    </Card>
  );

  return (
    <div className="space-y-3">
      <h2 className="font-display text-2xl court-line pb-3" style={{ color: "var(--text-main)" }}>
        VOS BILLETS DE TRAIN
      </h2>
      {billets.map((b, i) => (
        <div key={b.id} className="animate-fade-in-up" style={{ animationDelay: `${i * 0.06}s`, opacity: 0, animationFillMode: "forwards" }}>
          <Card>
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0"
                style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)" }}>
                🎫
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "var(--text-main)" }}>{b.nom_fichier}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {new Date(b.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              </div>
              <a
                href={STORAGE_BASE + b.url_stockage}
                target="_blank" rel="noreferrer"
                className="shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-85"
                style={{ background: "linear-gradient(135deg, var(--accent), var(--accent2))", color: "white" }}
              >
                Ouvrir
              </a>
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}
