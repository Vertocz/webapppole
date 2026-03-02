"use client";

import { useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import type { Activite } from "@/types";

type Periode = "7j" | "30j" | "60j";

const PERIODES: { val: Periode; label: string }[] = [
  { val: "7j",  label: "7j" },
  { val: "30j", label: "30j" },
  { val: "60j", label: "2 mois" },
];

const SERIES = [
  { key: "difficulte", label: "Difficulté", color: "#F87171" },
  { key: "plaisir",    label: "Plaisir",    color: "#86efac" },
];

interface Props { activites: Activite[] }

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl px-4 py-3 text-xs space-y-1.5 shadow-xl"
      style={{ background: "#0B1120", border: "1px solid rgba(43,80,160,0.3)", minWidth: "130px" }}>
      <p className="font-medium tracking-widest uppercase mb-2" style={{ color: "var(--text-sub)", fontSize: "0.65rem" }}>{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-display text-sm" style={{ color: "var(--text-main)" }}>
            {p.value}<span style={{ color: "var(--text-muted)", fontSize: "0.65rem" }}>/10</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Switch période ───────────────────────────────────────────────────────────
function PeriodeSwitch({ value, onChange }: { value: Periode; onChange: (v: Periode) => void }) {
  const idx = PERIODES.findIndex((p) => p.val === value);
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }}>
      {PERIODES.map((p, i) => (
        <button key={p.val} onClick={() => onChange(p.val)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
          style={{
            background: idx === i ? "var(--primary)" : "transparent",
            color: idx === i ? "white" : "var(--text-muted)",
            boxShadow: idx === i ? "0 2px 8px rgba(27,58,140,0.4)" : "none",
          }}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

export default function GraphiqueSportif({ activites }: Props) {
  const [periode, setPeriode] = useState<Periode>("30j");
  const [seriesActives, setSeriesActives] = useState<Set<string>>(new Set(["difficulte", "plaisir"]));
  const [ouvert, setOuvert] = useState(false);

  const joursMap: Record<Periode, number> = { "7j": 7, "30j": 30, "60j": 60 };

  const donnees = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - joursMap[periode]);
    const filtered = activites.filter((a) => new Date(a.date) >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
    const byDate: Record<string, { difficulte: number[]; plaisir: number[] }> = {};
    for (const a of filtered) {
      if (!byDate[a.date]) byDate[a.date] = { difficulte: [], plaisir: [] };
      byDate[a.date].difficulte.push(a.difficulte);
      byDate[a.date].plaisir.push(a.plaisir);
    }
    return Object.entries(byDate).map(([date, vals]) => ({
      label: new Date(date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }),
      difficulte: Math.round((vals.difficulte.reduce((s, v) => s + v, 0) / vals.difficulte.length) * 10) / 10,
      plaisir:    Math.round((vals.plaisir.reduce((s, v) => s + v, 0)    / vals.plaisir.length)    * 10) / 10,
    }));
  }, [activites, periode]);

  const toggleSerie = (key: string) => {
    setSeriesActives((prev) => {
      const next = new Set(prev);
      if (next.has(key) && next.size > 1) next.delete(key); else next.add(key);
      return next;
    });
  };

  if (activites.length < 2) return null;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#0B1120", border: "1px solid rgba(43,80,160,0.15)" }}>
      {/* Header */}
      <button onClick={() => setOuvert((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4"
        style={{ color: "var(--text-main)" }}>
        <div className="flex items-center gap-3">
          <span className="font-display text-lg tracking-widest">GRAPHIQUE</span>
          <div className="flex gap-2">
            {SERIES.map((s) => (
              <span key={s.key} className="w-4 h-0.5 rounded-full inline-block transition-opacity"
                style={{ background: s.color, opacity: seriesActives.has(s.key) ? 1 : 0.25 }} />
            ))}
          </div>
        </div>
        <span style={{ color: "var(--text-muted)", transition: "transform 0.3s", display: "inline-block", transform: ouvert ? "rotate(180deg)" : "rotate(0)" }}>↓</span>
      </button>

      {ouvert && (
        <div className="px-5 pb-5 space-y-4">
          {/* Contrôles */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <PeriodeSwitch value={periode} onChange={setPeriode} />
            <div className="flex gap-2">
              {SERIES.map((s) => {
                const active = seriesActives.has(s.key);
                return (
                  <button key={s.key} onClick={() => toggleSerie(s.key)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{
                      background: active ? `color-mix(in srgb, ${s.color} 12%, transparent)` : "rgba(255,255,255,0.04)",
                      border: `1px solid ${active ? s.color : "transparent"}`,
                      color: active ? s.color : "var(--text-muted)",
                      opacity: active ? 1 : 0.5,
                    }}>
                    <span className="w-3 h-0.5 rounded-full inline-block" style={{ background: s.color }} />
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {donnees.length < 2 ? (
            <p className="text-center py-6 text-sm" style={{ color: "var(--text-muted)" }}>Pas assez de données sur cette période.</p>
          ) : (
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={donnees} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="label" tick={{ fill: "var(--text-muted)", fontSize: 10 }} tickLine={false} axisLine={false}
                    interval={donnees.length <= 7 ? 0 : Math.ceil(donnees.length / 6)} />
                  <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={{ fill: "var(--text-muted)", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }} />
                  {SERIES.filter((s) => seriesActives.has(s.key)).map((s) => (
                    <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                      stroke={s.color} strokeWidth={2} dot={false}
                      activeDot={{ r: 4, fill: s.color, stroke: "#0B1120", strokeWidth: 2 }} />
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
