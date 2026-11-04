"use client";

// Évolution match après match : adresse et possessions, pour l'équipe ou un joueur.

import { useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import type { Joueuse } from "@/types";
import Card from "@/components/Card";
import { type Action, type Match, calculerStats, pct } from "@/lib/analyse";
import { dateMatch } from "./RapportMatch";

const labelStyle: React.CSSProperties = {
  fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-sub)",
};

const SERIES_ADRESSE = [
  { key: "tirs", label: "Tirs en jeu", color: "#C49A28" },
  { key: "tirs1", label: "1 pt", color: "#2A5299" },
  { key: "tirs2", label: "2 pts", color: "#E8192C" },
  { key: "lf", label: "LF", color: "#22c55e" },
];
const SERIES_BALLONS = [
  { key: "rebonds", label: "Rebonds", color: "#C49A28" },
  { key: "gagnes", label: "Ballons gagnés", color: "#22c55e" },
  { key: "perdus", label: "Ballons perdus", color: "#ef4444" },
];

export default function Evolution({ matchs, actions, joueurs }: { matchs: Match[]; actions: Action[]; joueurs: Joueuse[] }) {
  const [cible, setCible] = useState<string>("equipe");

  const joueursAyantJoue = useMemo(() => {
    const ids = new Set(matchs.flatMap((m) => m.effectif));
    return joueurs.filter((j) => ids.has(j.id));
  }, [matchs, joueurs]);

  const donnees = useMemo(() => {
    return [...matchs]
      .sort((a, b) => a.date_match.localeCompare(b.date_match))
      .filter((m) => cible === "equipe" || m.effectif.includes(cible))
      .map((m) => {
        const s = calculerStats(actions.filter((a) => a.match_id === m.id), m.effectif);
        const b = cible === "equipe" ? s.equipe : s.joueurs[cible];
        return {
          nom: `${dateMatch(m, "court")}${m.adversaire ? ` · ${m.adversaire}` : ""}`,
          tirs: pct(b.tirs), tirs1: pct(b.tirs1), tirs2: pct(b.tirs2), lf: pct(b.lf),
          rebonds: b.rebOff + b.rebDef, gagnes: b.gagnes, perdus: b.perdus,
        };
      });
  }, [matchs, actions, cible]);

  const tooltip = {
    contentStyle: { background: "var(--bg-card2)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 },
    labelStyle: { color: "var(--text-main)" },
  };

  return (
    <div className="space-y-5 animate-fade-in-up">
      <Card>
        <p style={labelStyle} className="mb-3">Voir l&apos;évolution de</p>
        <div className="flex flex-wrap gap-1.5">
          {[{ id: "equipe", label: "Toute l'équipe" }, ...joueursAyantJoue.map((j) => ({ id: j.id, label: `${j.prenom} ${j.nom}` }))].map((c) => (
            <button
              key={c.id}
              onClick={() => setCible(c.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={cible === c.id
                ? { background: "var(--primary)", color: "white" }
                : { background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </Card>

      {donnees.length < 2 ? (
        <Card>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Il faut au moins 2 matchs tagués pour voir une évolution.
          </p>
        </Card>
      ) : (
        <>
          <Graphique titre="Adresse (% de réussite)" donnees={donnees} series={SERIES_ADRESSE} domaine={[0, 100]} unite=" %" tooltip={tooltip} />
          <Graphique titre="Rebonds et ballons (par match)" donnees={donnees} series={SERIES_BALLONS} tooltip={tooltip} />
        </>
      )}
    </div>
  );
}

function Graphique({
  titre, donnees, series, domaine, unite = "", tooltip,
}: {
  titre: string;
  donnees: Record<string, string | number | null>[];
  series: { key: string; label: string; color: string }[];
  domaine?: [number, number];
  unite?: string;
  tooltip: { contentStyle: React.CSSProperties; labelStyle: React.CSSProperties };
}) {
  return (
    <Card>
      <p style={labelStyle} className="mb-3">{titre}</p>
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={donnees} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="nom" tick={{ fill: "var(--text-sub)", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis domain={domaine ?? [0, "auto"]} allowDecimals={false} tick={{ fill: "var(--text-sub)", fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip {...tooltip} formatter={(v) => (v === null || v === undefined ? "–" : `${v}${unite}`)} />
            <Legend wrapperStyle={{ fontSize: 11, color: "var(--text-sub)" }} />
            {series.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
