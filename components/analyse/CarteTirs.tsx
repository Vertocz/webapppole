"use client";

// Carte des tirs : points réussis / ratés et réussite par zone.

import { type Action, ZONES, fmtLigne, pct } from "@/lib/analyse";
import Terrain, { tx } from "./Terrain";

export interface CouleursCarte {
  reussi: string;
  rate: string;
  texte: string;
  ligne?: string;
  fond?: string;
  accent?: string;
  pastille: string;
}

export const COULEURS_ECRAN: CouleursCarte = {
  reussi: "#22c55e",
  rate: "#ef4444",
  texte: "var(--text-main)",
  pastille: "rgba(7,9,14,0.72)",
};

export const COULEURS_PDF: CouleursCarte = {
  reussi: "#16a34a",
  rate: "#dc2626",
  texte: "#111827",
  ligne: "#94a3b8",
  fond: "#f1f5f9",
  accent: "#C49A28",
  pastille: "rgba(255,255,255,0.88)",
};

export default function CarteTirs({ tirs, couleurs = COULEURS_ECRAN }: { tirs: Action[]; couleurs?: CouleursCarte }) {
  const enJeu = tirs.filter((a) => a.type === "tir" && a.resultat !== "attente");
  // Réussite par zone sur les tirs passés en paramètre
  const zones = ZONES.map((z) => {
    const l = { reussis: 0, tentes: 0 };
    for (const a of enJeu) if (a.zone === z.id) { l.tentes++; if (a.resultat === "reussi") l.reussis++; }
    return { ...z, l };
  });

  return (
    <Terrain ligne={couleurs.ligne} fond={couleurs.fond} accent={couleurs.accent}>
      {enJeu.filter((a) => a.x !== null && a.y !== null).map((a) =>
        a.resultat === "reussi" ? (
          <circle key={a.id} cx={tx(a.x!)} cy={a.y!} r={0.26} fill={couleurs.reussi} fillOpacity={0.9} />
        ) : (
          <g key={a.id} stroke={couleurs.rate} strokeWidth={0.1} strokeLinecap="round">
            <line x1={tx(a.x!) - 0.2} y1={a.y! - 0.2} x2={tx(a.x!) + 0.2} y2={a.y! + 0.2} />
            <line x1={tx(a.x!) - 0.2} y1={a.y! + 0.2} x2={tx(a.x!) + 0.2} y2={a.y! - 0.2} />
          </g>
        ),
      )}
      {zones.filter((z) => z.l.tentes > 0).map((z) => (
        <g key={z.id}>
          <rect x={tx(z.cx) - 1.05} y={z.cy - 0.42} width={2.1} height={0.84} rx={0.2} fill={couleurs.pastille} />
          <text x={tx(z.cx)} y={z.cy - 0.04} textAnchor="middle" fontSize={0.36} fontWeight={700} fill={couleurs.texte}>
            {pct(z.l)} %
          </text>
          <text x={tx(z.cx)} y={z.cy + 0.3} textAnchor="middle" fontSize={0.26} fill={couleurs.texte} fillOpacity={0.75}>
            {fmtLigne(z.l)}
          </text>
        </g>
      ))}
    </Terrain>
  );
}
