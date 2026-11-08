"use client";

// Carte des tirs (points rentrés / ratés) et réussite par zone, affichée à part
// pour ne pas surcharger le terrain.

import { type Action, type Ligne, ZONES, fmtLigne, pct } from "@/lib/analyse";
import Terrain, { tx } from "./Terrain";

export interface CouleursCarte {
  reussi: string;
  rate: string;
  ligne?: string;
  fond?: string;
  accent?: string;
}

export const COULEURS_ECRAN: CouleursCarte = {
  reussi: "#22c55e",
  rate: "#ef4444",
};

export const COULEURS_PDF: CouleursCarte = {
  reussi: "#16a34a",
  rate: "#dc2626",
  ligne: "#94a3b8",
  fond: "#f1f5f9",
  accent: "#C49A28",
};

/** Tirs en jeu tranchés (hors lancers francs et tirs en attente). */
const tirsEnJeu = (tirs: Action[]) => tirs.filter((a) => a.type === "tir" && a.resultat !== "attente" && a.resultat !== null);

export default function CarteTirs({ tirs, couleurs = COULEURS_ECRAN }: { tirs: Action[]; couleurs?: CouleursCarte }) {
  const enJeu = tirsEnJeu(tirs).filter((a) => a.x !== null && a.y !== null);
  return (
    <Terrain ligne={couleurs.ligne} fond={couleurs.fond} accent={couleurs.accent}>
      {enJeu.map((a) =>
        a.resultat === "reussi" ? (
          <circle key={a.id} cx={tx(a.x!)} cy={a.y!} r={0.26} fill={couleurs.reussi} fillOpacity={0.9} />
        ) : (
          <g key={a.id} stroke={couleurs.rate} strokeWidth={0.1} strokeLinecap="round">
            <line x1={tx(a.x!) - 0.2} y1={a.y! - 0.2} x2={tx(a.x!) + 0.2} y2={a.y! + 0.2} />
            <line x1={tx(a.x!) - 0.2} y1={a.y! + 0.2} x2={tx(a.x!) + 0.2} y2={a.y! - 0.2} />
          </g>
        ),
      )}
    </Terrain>
  );
}

/** Réussite par zone, dans l'ordre du terrain. Les zones sans tir sont gardées (–). */
export function statsZones(tirs: Action[]): { id: string; label: string; court: string; points: 1 | 2; l: Ligne }[] {
  const enJeu = tirsEnJeu(tirs);
  return ZONES.map((z) => {
    const l = { reussis: 0, tentes: 0 };
    for (const a of enJeu) if (a.zone === z.id) { l.tentes++; if (a.resultat === "reussi") l.reussis++; }
    return { id: z.id, label: z.label, court: z.court, points: z.points, l };
  });
}

export const fmtZonePct = (l: Ligne) => { const p = pct(l); return p === null ? "–" : `${p} %`; };
export const fmtZoneLigne = (l: Ligne) => (l.tentes ? fmtLigne(l) : "–");
