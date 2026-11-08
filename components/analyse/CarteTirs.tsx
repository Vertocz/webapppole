"use client";

// Carte des tirs (points rentrés / ratés) et réussite par zone, affichée à part
// pour ne pas surcharger le terrain.

import { useId } from "react";
import { type Action, type Ligne, ARC_JONCTION_Y, TERRAIN, ZONES, fmtLigne, pct } from "@/lib/analyse";
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

// ─── Schéma de réussite par zone ─────────────────────────────────────────────


/** Couleur d'une zone selon sa réussite : plus c'est foncé, plus c'est réussi. */
function couleurZone(l: Ligne): { fond: string; texte: string } {
  const p = pct(l);
  if (p === null) return { fond: "#ffffff", texte: "#9ca3af" };
  // Du bleu très clair (0 %) au bleu du pôle (100 %)
  const a = [232, 238, 249], b = [30, 58, 110];
  const t = Math.max(0, Math.min(1, p / 100));
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return { fond: `rgb(${c.join(",")})`, texte: t > 0.45 ? "#ffffff" : "#111827" };
}

/** Demi-terrain découpé en zones, chacune colorée selon sa réussite avec réussis/tentés et %. */
export function SchemaZones({ tirs }: { tirs: Action[] }) {
  const uid = useId().replace(/:/g, "");
  const zones = statsZones(tirs);
  const Z = Object.fromEntries(zones.map((z) => [z.id, z]));
  const T = TERRAIN;
  const L = T.raquetteDemiLargeur;
  // Intérieur de la ligne à 2 points
  const arc = `M${tx(-T.arcX)} 0 L${tx(-T.arcX)} ${ARC_JONCTION_Y} A${T.rayonArc} ${T.rayonArc} 0 0 0 ${tx(T.arcX)} ${ARC_JONCTION_Y} L${tx(T.arcX)} 0 Z`;
  const colonnes: [string, number, number][] = [["gauche", -7.5, -L], ["axe", -L, L], ["droite", L, 7.5]];
  const libelle = (id: string) => {
    const z = ZONES.find((x) => x.id === id)!;
    const s = Z[id];
    const c = couleurZone(s.l);
    const petit = id === "sous_panier";
    return (
      <g key={`t-${id}`}>
        <text x={tx(z.cx)} y={z.cy - (petit ? 0.02 : 0.08)} textAnchor="middle" fontSize={petit ? 0.42 : 0.6} fontWeight={700} fill={c.texte}>{fmtZoneLigne(s.l)}</text>
        {s.l.tentes > 0 && <text x={tx(z.cx)} y={z.cy + (petit ? 0.4 : 0.6)} textAnchor="middle" fontSize={petit ? 0.34 : 0.42} fill={c.texte}>{fmtZonePct(s.l)}</text>}
      </g>
    );
  };
  return (
    <Terrain ligne="#64748b" fond="#ffffff" accent="#C49A28">
      <defs>
        <clipPath id={`${uid}-int`}><path d={arc} /></clipPath>
        <clipPath id={`${uid}-ext`}><path d={`M0 0 H15 V11 H0 Z ${arc}`} clipRule="evenodd" /></clipPath>
        <clipPath id={`${uid}-terrain`}><rect x={0} y={0} width={15} height={11} /></clipPath>
      </defs>
      {colonnes.map(([cote, x0, x1]) => (
        <g key={cote}>
          <rect x={tx(x0)} y={0} width={x1 - x0} height={11} fill={couleurZone(Z[`ext_${cote}`].l).fond} clipPath={`url(#${uid}-ext)`} />
          <rect x={tx(x0)} y={0} width={x1 - x0} height={11} fill={couleurZone(Z[`int_${cote}`].l).fond} clipPath={`url(#${uid}-int)`} />
        </g>
      ))}
      <circle cx={tx(0)} cy={T.panierY} r={T.rayonNonCharge} fill={couleurZone(Z.sous_panier.l).fond} clipPath={`url(#${uid}-terrain)`} />
      {/* Séparations des zones */}
      <g stroke="#64748b" strokeWidth={0.05} fill="none">
        <line x1={tx(-L)} y1={0} x2={tx(-L)} y2={11} />
        <line x1={tx(L)} y1={0} x2={tx(L)} y2={11} />
        <path d={arc} />
        <circle cx={tx(0)} cy={T.panierY} r={T.rayonNonCharge} clipPath={`url(#${uid}-terrain)`} />
        <rect x={0} y={0} width={15} height={11} />
      </g>
      {ZONES.map((z) => libelle(z.id))}
    </Terrain>
  );
}
