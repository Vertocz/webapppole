"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Card from "./Card";

const STORAGE_BASE =
  "https://fxvotvtapcwzvjhfreqv.supabase.co/storage/v1/object/public/cartes/";

interface CarteRow {
  id: number;
  nom_fichier: string;
  url_stockage: string;
}

export default function CarteAvantage({ userId }: { userId: string }) {
  const [carte, setCarte] = useState<CarteRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("cartes")
      .select("id, nom_fichier, url_stockage")
      .eq("joueuse_id", userId)
      .limit(1)
      .then(({ data }) => {
        setCarte((data ?? [])[0] ?? null);
        setLoading(false);
      });
  }, [userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div
          className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  if (!carte) {
    return (
      <Card>
        <div className="text-center py-8">
          <span className="text-5xl block mb-4">💳</span>
          <p style={{ color: "var(--text-muted)" }}>
            Aucune carte avantage enregistrée pour le moment.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <h2 className="font-display text-2xl" style={{ color: "var(--text-main)" }}>
        MA CARTE AVANTAGE
      </h2>

      <Card>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <span className="text-5xl">💳</span>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Ta carte avantage SNCF est prête — tu peux la présenter directement
            depuis ton téléphone, sans avoir besoin de la chercher ailleurs.
          </p>
          <a
            href={STORAGE_BASE + carte.url_stockage}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-medium tracking-wider transition-all hover:opacity-85 active:scale-[0.98]"
            style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}
          >
            <span>📄</span>
            <span>OUVRIR MA CARTE</span>
          </a>
        </div>
      </Card>
    </div>
  );
}
