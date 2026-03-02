"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid,
} from "recharts";
import type { SuiviForme } from "@/types";

type Periode = "7j" | "30j" | "60j";

const PERIODES: { val: Periode; label: string }[] = [
  { val: "7j",  label: "7 jours" },
  { val: "30j", label: "30 jours" },
  { val: "60j", label: "2 mois" },
];

const SERIES = [
  { key: "fatigue", label: "Fatigue", icon: "😴", color: "#818CF8" },
  { key: "sommeil", label: "Sommeil", icon: "🛌", color: "#60A5FA" },
  { key: "douleur", label: "Douleurs", icon: "🤕", color: "#F87171" },
  { key: "stress",  label: "Stress",  icon: "😰", color: "#FBBF24" },
  { key: "humeur",  label: "Humeur",  icon: "😊", color: "#86efac" },
];

interface Props { data: SuiviForme[] }

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl px-4 py-3 text-xs space-y-1.5 shadow-xl"
      style={{ background: "#0B1120", border: "1px solid rgba(43,80,160,0.3)", minWidth: "140px" }}>
      <p className="font-medium tracking-widest uppercase mb-2" style={{ color: "var(--text-sub)", fontSize: "0.65rem" }}>
        {label}
      </p>
      {payload.map((p) => {
        const serie = SERIES.find((s) => s.label === p.name);
        return (
          <div key={p.name} className="flex items-center justify-between gap-4">
            <span style={{ color: p.color }}>{serie?.icon} {p.name}</span>
            <span className="font-display text-sm" style={{ color: "var(--text-main)" }}>{p.value}<span style={{ color: "var(--text-muted)", fontSize: "0.65rem" }}>/5</span></span>
          </div>
        );
      })}
    </div>
  );
}

export default function GraphiqueForme({ data }: Props) {
  const [periode, setPeriode] = useState<Periode>("30j");
  const [seriesActives, setSeriesActives] = useState<Set<string>>(new Set(["fatigue", "humeur", "stress"]));
  const [ouvert, setOuvert] = useState(false);

  const joursMap: Record<Periode, number> = { "7j": 7, "30j": 30, "60j": 60 };

  const donnees = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - joursMap[periode]);

    return [...data]
      .filter((d) => new Date(d.date) >= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        date: d.date,
        label: new Date(d.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }),
        fatigue: d.fatigue,
        sommeil: d.sommeil,
        douleur: d.douleur,
        stress:  d.stress,
        humeur:  d.humeur,
      }));
  }, [data, periode]);

  const toggleSerie = (key: string) => {
    setSeriesActives((prev) => {
      const next = new Set(prev);
      if (next.has(key) && next.size > 1) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (data.length < 2) return null;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#0B1120", border: "1px solid rgba(43,80,160,0.15)" }}>
      {/* Header cliquable */}
      <button onClick={() => setOuvert((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 transition-colors"
        style={{ color: "var(--text-main)" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
        <div className="flex items-center gap-3">
          <span className="font-display text-lg tracking-widest">GRAPHIQUE</span>
          <div className="flex gap-1.5 items-center">
            {SERIES.map((s) => (
              <span key={s.key} className="w-2.5 h-2.5 rounded-full inline-block transition-opacity"
                style={{ background: s.color, opacity: seriesActives.has(s.key) ? 1 : 0.2 }} />
            ))}
          </div>
        </div>
        <span className="text-lg transition-transform duration-300"
          style={{ display: "inline-block", transform: ouvert ? "rotate(180deg)" : "rotate(0deg)", color: "var(--text-muted)" }}>
          ↓
        </span>
      </button>

      {/* Contenu */}
      {ouvert && (
        <div className="px-5 pb-5 space-y-4">
          {/* Sélecteur période */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }}>
              {PERIODES.map((p) => (
                <button key={p.val} onClick={() => setPeriode(p.val)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: periode === p.val ? "var(--primary)" : "transparent",
                    color: periode === p.val ? "white" : "var(--text-muted)",
                    boxShadow: periode === p.val ? "0 2px 8px rgba(27,58,140,0.4)" : "none",
                  }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sélecteur métriques */}
          <div className="flex flex-wrap gap-2">
            {SERIES.map((s) => {
              const active = seriesActives.has(s.key);
              return (
                <button key={s.key} onClick={() => toggleSerie(s.key)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: active ? `color-mix(in srgb, ${s.color} 12%, transparent)` : "rgba(255,255,255,0.04)",
                    border: `1px solid ${active ? s.color : "transparent"}`,
                    color: active ? s.color : "var(--text-muted)",
                    opacity: active ? 1 : 0.45,
                  }}>
                  <span>{s.icon}</span>
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Graphique */}
          {donnees.length < 2 ? (
            <p className="text-center py-6 text-sm" style={{ color: "var(--text-muted)" }}>
              Pas assez de données sur cette période.
            </p>
          ) : (
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={donnees} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="label" tick={{ fill: "var(--text-muted)", fontSize: 10 }}
                    tickLine={false} axisLine={false}
                    interval={donnees.length <= 7 ? 0 : Math.ceil(donnees.length / 6)} />
                  <YAxis domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]}
                    tick={{ fill: "var(--text-muted)", fontSize: 10 }}
                    tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }} />
                  {SERIES.filter((s) => seriesActives.has(s.key)).map((s) => (
                    <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                      stroke={s.color} strokeWidth={2}
                      dot={false} activeDot={{ r: 4, fill: s.color, stroke: "#0B1120", strokeWidth: 2 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
