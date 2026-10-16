"use client";

import { useEffect, useMemo, useState } from "react";
import Card from "@/components/Card";
import CarteModal from "@/components/CarteModal";
import {
  PERSONNES,
  RARETE_COLOR,
  RARETE_LABEL,
  TOTAL_CARTES,
  getCarteUrl,
  getCollection,
  getPersonne,
  type Rarete,
  type UserTypeCarte,
} from "@/lib/victorinis";

interface Props {
  userId: string;
  userType: UserTypeCarte;
  /** Change quand une nouvelle carte est gagnée → recharge la collection */
  refreshKey?: number;
}

// Or d'abord, puis argent, puis bleu
const ORDRE_RARETE: Rarete[] = ["or", "argent", "bleu"];

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

  // Uniquement les cartes possédées, triées par rareté puis par ordre des personnes
  const cartes = useMemo(() => {
    const liste: { personne: string; rarete: Rarete; n: number }[] = [];
    for (const r of ORDRE_RARETE) {
      for (const p of PERSONNES) {
        const n = counts[`${p.slug}|${r}`] ?? 0;
        if (n > 0) liste.push({ personne: p.slug, rarete: r, n });
      }
    }
    return liste;
  }, [counts]);

  const total = cartes.reduce((a, c) => a + c.n, 0);

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display text-lg" style={{ color: "var(--text-main)" }}>
              MES VICTORINIS
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {loading
                ? "Chargement…"
                : `${cartes.length} / ${TOTAL_CARTES} cartes différentes · ${total} au total`}
            </p>
          </div>
          <span className="text-3xl">🃏</span>
        </div>
        <div className="h-1.5 rounded-full mt-3 overflow-hidden" style={{ background: "var(--bg-input)" }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${(cartes.length / TOTAL_CARTES) * 100}%`,
              background: "linear-gradient(90deg, #3B7BFF, #C9D1DE, #F2B90F)",
            }}
          />
        </div>
      </Card>

      {!loading && cartes.length === 0 && (
        <Card>
          <p className="text-sm text-center" style={{ color: "var(--text-muted)" }}>
            Tu n&apos;as pas encore de carte. La première arrive très vite ! 🏀
          </p>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-2">
        {cartes.map(({ personne, rarete, n }) => {
          const color = RARETE_COLOR[rarete];
          const p = getPersonne(personne);
          return (
            <button
              key={`${personne}|${rarete}`}
              onClick={() => setApercu({ personne, rarete })}
              className="relative rounded-xl overflow-hidden transition-transform active:scale-95"
              style={{
                aspectRatio: "2 / 3",
                border: `1px solid ${color}`,
                background: "var(--bg-input)",
                boxShadow: rarete === "or" ? "0 0 14px rgba(242,185,15,0.45)" : undefined,
              }}
              aria-label={`${p?.prenom ?? ""} ${p?.nom ?? ""}, carte ${RARETE_LABEL[rarete]}${n > 1 ? `, ${n} exemplaires` : ""}`}
            >
              <img
                src={getCarteUrl(personne, rarete, 300)}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
              {n > 1 && (
                <span
                  className="absolute top-1 right-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold"
                  style={{ background: color, color: rarete === "bleu" ? "white" : "#111" }}
                >
                  ×{n}
                </span>
              )}
            </button>
          );
        })}
      </div>

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