"use client";

import { useEffect, useState } from "react";
import CarteModal from "@/components/CarteModal";
import { EchangeModal, EchangesNotifs } from "@/components/EchangesVictorinis";
import { getParticipants, type Participant } from "@/lib/victorinisEchanges";
import {
  PERSONNES,
  RARETE_COLOR,
  RARETE_LABEL,
  TOTAL_CARTES,
  getCarteUrl,
  getCollection,
  type Personne,
  type Rarete,
  type UserTypeCarte,
} from "@/lib/victorinis";

interface Props {
  userId: string;
  userType: UserTypeCarte;
  /** Change quand une nouvelle carte est gagnée → recharge la collection */
  refreshKey?: number;
}

// De la plus haute à la plus basse
const ORDRE_RARETE: Rarete[] = ["or", "argent", "bleu"];

const JOUEURS = PERSONNES.filter((p) => p.role === "joueur");
const COACHES = PERSONNES.filter((p) => p.role === "coach");

/**
 * Hauteur d'une carte : on partage la hauteur de l'écran (moins l'en-tête de
 * l'appli et celle de l'onglet) entre 3 rangées, sans jamais dépasser ce que
 * permet la largeur (3 cartes côte à côte, ratio 2:3).
 */
const CARD_H =
  "max(90px, min(calc((100dvh - 330px) / 3), calc((min(100vw, 42rem) - 48px) / 2)))";

export default function VictorinisTab({ userId, userType, refreshKey = 0 }: Props) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const participe = participants.some((p) => p.id === userId && p.type === userType);
  const [echangeOuvert, setEchangeOuvert] = useState(false);
  const [rechargement, setRechargement] = useState(0);
  const [apercu, setApercu] = useState<{ personne: string; rarete: Rarete; raretes: Rarete[] } | null>(null);

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
  }, [userId, userType, refreshKey, rechargement]);

  // Seuls les 5 joueurs et les 2 coachs peuvent échanger
  useEffect(() => {
    getParticipants().then(setParticipants);
  }, []);

  const distinctes = Object.keys(counts).length;

  /** Meilleure carte possédée par une personne (or > argent > bleu) */
  const meilleure = (p: Personne): { rarete: Rarete; n: number } | null => {
    for (const r of ORDRE_RARETE) {
      const n = counts[`${p.slug}|${r}`] ?? 0;
      if (n > 0) return { rarete: r, n };
    }
    return null;
  };

  const renderCarte = (p: Personne) => {
    const best = meilleure(p);

    // Pas de carte : simple aplat gris foncé, rien ne laisse deviner la carte
    if (!best) {
      return (
        <div
          key={p.slug}
          aria-label={`${p.prenom} ${p.nom} : pas encore de carte`}
          style={{
            height: CARD_H,
            aspectRatio: "2 / 3",
            borderRadius: 12,
            background: "#23272F",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        />
      );
    }

    const color = RARETE_COLOR[best.rarete];
    return (
      <button
        key={p.slug}
        onClick={() =>
          setApercu({
            personne: p.slug,
            rarete: best.rarete,
            raretes: ORDRE_RARETE.filter((r) => (counts[`${p.slug}|${r}`] ?? 0) > 0),
          })
        }
        className="relative overflow-hidden transition-transform active:scale-95"
        style={{
          height: CARD_H,
          aspectRatio: "2 / 3",
          borderRadius: 12,
          border: `1px solid ${color}`,
          background: "var(--bg-input)",
          boxShadow: best.rarete === "or" ? "0 0 14px rgba(242,185,15,0.45)" : undefined,
        }}
        aria-label={`${p.prenom} ${p.nom}, carte ${RARETE_LABEL[best.rarete]}`}
      >
        <img
          src={getCarteUrl(p.slug, best.rarete, 300)}
          alt=""
          decoding="async"
          className="w-full h-full object-cover"
        />
      </button>
    );
  };

  const Rangee = ({ gens }: { gens: Personne[] }) => (
    <div className="flex justify-center gap-2">{gens.map(renderCarte)}</div>
  );

  const Titre = ({ children }: { children: React.ReactNode }) => (
    <p
      className="text-[10px] uppercase tracking-[0.25em] text-center"
      style={{ color: "var(--text-sub)" }}
    >
      {children}
    </p>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-baseline gap-2 min-w-0">
          <p className="font-display text-lg leading-none whitespace-nowrap" style={{ color: "var(--text-main)" }}>
            MES CARTES VICTORINIS
          </p>
          <p className="text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
            {loading ? "…" : `${distinctes}/${TOTAL_CARTES}`}
          </p>
        </div>
        {participe && (
          <button
            onClick={() => setEchangeOuvert(true)}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium active:scale-95 transition-transform"
            style={{ background: "var(--bg-input)", color: "var(--text-main)", border: "1px solid var(--border)" }}
          >
            🔄 Échanger
          </button>
        )}
      </div>

      <Titre>Joueurs</Titre>
      <div className="flex flex-col gap-2">
        <Rangee gens={JOUEURS.slice(0, 3)} />
        <Rangee gens={JOUEURS.slice(3)} />
      </div>

      <Titre>Coachs</Titre>
      <Rangee gens={COACHES} />

      {participe && (
        <EchangesNotifs
          moi={{ id: userId, type: userType }}
          refreshKey={refreshKey + rechargement}
          onChange={() => setRechargement((n) => n + 1)}
        />
      )}

      {echangeOuvert && (
        <EchangeModal
          moi={{ id: userId, type: userType }}
          participants={participants}
          onClose={() => setEchangeOuvert(false)}
          onChange={() => setRechargement((n) => n + 1)}
        />
      )}

      {apercu && (
        <CarteModal
          personne={apercu.personne}
          rarete={apercu.rarete}
          raretes={apercu.raretes}
          gagnee={false}
          onClose={() => setApercu(null)}
        />
      )}
    </div>
  );
}
