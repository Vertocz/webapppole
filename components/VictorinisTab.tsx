"use client";

import { useEffect, useState } from "react";
import Card from "@/components/Card";
import CarteModal from "@/components/CarteModal";
import {
  PERSONNES,
  RARETES,
  RARETE_COLOR,
  RARETE_LABEL,
  TOTAL_CARTES,
  getCarteUrl,
  getCollection,
  type Rarete,
  type UserTypeCarte,
} from "@/lib/victorinis";

interface Props {
  userId: string;
  userType: UserTypeCarte;
  /** Change quand une nouvelle carte est gagnée → recharge la collection */
  refreshKey?: number;
}

export default function VictorinisTab({ userId, userType, refreshKey = 0 }: Props) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [apercu, setApercu] = useState<{ personne: string; rarete: Rarete } | null>(null);

  useEffect(() => {
    let annule = false;
    getCollection(userId, userType).then((c) => {
      if (annule) return;
      setCounts(c);
      setLoading(false);
    });
    return () => {
      annule = true;
    };
  }, [userId, userType, refreshKey]);

  const possedees = Object.keys(counts).length;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display text-lg" style={{ color: "var(--text-main)" }}>
              MES VICTORINIS
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {loading ? "Chargement…" : `${possedees} / ${TOTAL_CARTES} cartes différentes · ${total} au total`}
            </p>
          </div>
          <span className="text-3xl">🃏</span>
        </div>
        <div className="h-1.5 rounded-full mt-3 overflow-hidden" style={{ background: "var(--bg-input)" }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${(possedees / TOTAL_CARTES) * 100}%`,
              background: "linear-gradient(90deg, #3B7BFF, #C9D1DE, #F2B90F)",
            }}
          />
        </div>
      </Card>

      {PERSONNES.map((p) => (
        <div key={p.slug}>
          <p className="text-xs uppercase tracking-widest mb-2 px-1" style={{ color: "var(--text-sub)" }}>
            {p.prenom} {p.nom} · {p.role === "coach" ? "Coach" : `#${p.fichier}`}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {RARETES.map((r) => {
              const n = counts[`${p.slug}|${r}`] ?? 0;
              const color = RARETE_COLOR[r];
              const owned = n > 0;
              return (
                <button
                  key={r}
                  disabled={!owned}
                  onClick={() => owned && setApercu({ personne: p.slug, rarete: r })}
                  className="relative rounded-xl overflow-hidden transition-transform active:scale-95 disabled:active:scale-100"
                  style={{
                    aspectRatio: "2 / 3",
                    border: `1px solid ${owned ? color : "var(--border)"}`,
                    background: "var(--bg-input)",
                    boxShadow: owned && r === "or" ? "0 0 14px rgba(242,185,15,0.45)" : undefined,
                  }}
                  aria-label={`${p.prenom} ${p.nom}, carte ${RARETE_LABEL[r]}${owned ? "" : " (non obtenue)"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getCarteUrl(p.slug, r, 300)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                    style={owned ? undefined : { filter: "grayscale(1) brightness(0.28)" }}
                  />
                  {!owned && (
                    <span
                      className="absolute inset-0 flex items-center justify-center text-2xl font-bold"
                      style={{ color: "rgba(255,255,255,0.35)" }}
                    >
                      ?
                    </span>
                  )}
                  {n > 1 && (
                    <span
                      className="absolute top-1 right-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold"
                      style={{ background: color, color: r === "bleu" ? "white" : "#111" }}
                    >
                      ×{n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {apercu && (
        <CarteModal
          personne={apercu.personne}
          rarete={apercu.rarete}
          gagnee={false}
          onClose={() => setApercu(null)}
        />
      )}
    </div>
  );
}
