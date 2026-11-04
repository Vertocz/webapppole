"use client";

import { makeChance, tip, type Evaluation } from "@/lib/lancerFranc/shot";
import { C } from "@/lib/lancerFranc/scene";

/** Une jauge : la zone verte au centre, le repère montre où était le geste. */
function Gauge({ label, err, left, right }: { label: string; err: number; left: string; right: string }) {
  const pos = Math.max(-1.5, Math.min(1.5, err)); // −1.5..1.5
  const pct = ((pos + 1.5) / 3) * 100;
  const good = Math.abs(err) <= 0.35;
  const ok = Math.abs(err) <= 1;
  const color = good ? C.green : ok ? C.amber : C.red;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "72px 1fr", alignItems: "center", gap: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(233,238,247,0.7)" }}>
        {label}
      </div>
      <div>
        <div style={{ position: "relative", height: 12, borderRadius: 6, background: "rgba(233,238,247,0.1)" }}>
          {/* Zone « bonne » (±1 tolérance) puis zone « parfaite » (±0.35). */}
          <div style={{ position: "absolute", left: "16.7%", width: "66.6%", top: 0, bottom: 0, borderRadius: 6, background: "rgba(255,212,155,0.16)" }} />
          <div style={{ position: "absolute", left: "38.3%", width: "23.4%", top: 0, bottom: 0, borderRadius: 6, background: "rgba(95,227,161,0.35)" }} />
          <div
            style={{
              position: "absolute", top: -4, width: 20, height: 20, marginLeft: -10, left: `${pct}%`,
              borderRadius: 10, background: color, border: `3px solid ${C.bg}`, transition: "left 300ms ease-out",
            }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginTop: 4, color: "rgba(233,238,247,0.45)" }}>
          <span>{left}</span>
          <span>{right}</span>
        </div>
      </div>
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const color = value >= 0.7 ? C.green : value >= 0.4 ? C.amber : C.red;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "72px 1fr", alignItems: "center", gap: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(233,238,247,0.7)" }}>
        {label}
      </div>
      <div style={{ height: 12, borderRadius: 6, background: "rgba(233,238,247,0.1)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.round(value * 100)}%`, background: color, borderRadius: 6, transition: "width 300ms ease-out" }} />
      </div>
    </div>
  );
}

/** Le retour après chaque tir : un conseil en gros, puis le détail du geste. */
export function ShotFeedback({ e }: { e: Evaluation }) {
  return (
    <div
      style={{
        position: "absolute", left: 12, right: 12, bottom: 44, padding: "14px 16px 12px",
        borderRadius: 18, background: "rgba(10,15,24,0.88)", border: "1px solid rgba(233,238,247,0.1)",
        display: "grid", gap: 10, pointerEvents: "none",
      }}
    >
      <div style={{ textAlign: "center", fontSize: 18, fontWeight: 900, color: e.quality > 0.8 ? C.green : "#F4F7FC" }}>
        {tip(e)}
      </div>
      <Gauge label="Force" err={e.speedErr} left="court" right="long" />
      <Gauge label="Direction" err={e.aimErr} left="gauche" right="droite" />
      <Gauge label="Courbe" err={e.arcErr} left="plate" right="haute" />
      <Meter label="Poignet" value={e.flickQ} />
    </div>
  );
}

/** Mode labo : les valeurs brutes, pour régler le jeu (voir src/game/settings.ts). */
export function LabReadout({ e }: { e: Evaluation }) {
  const m = e.measure;
  const rows: Array<[string, string]> = [
    ["vitesse", `${m.speed.toFixed(2)} m/s`],
    ["courbe", `${m.arc.toFixed(0)}°`],
    ["direction", `${m.aim >= 0 ? "+" : ""}${m.aim.toFixed(1)}°`],
    ["poignet", m.flick === null ? "—" : `${m.flick.toFixed(0)}°/s`],
    ["décalage", m.flickOffsetMs === null ? "—" : `${m.flickOffsetMs.toFixed(0)} ms`],
    ["pureté", `${Math.round(m.flickPurity * 100)} %`],
    ["poussée", `${m.peakUp.toFixed(1)} m/s² · ${m.pushMs.toFixed(0)} ms`],
    ["note", `${Math.round(e.quality * 100)} % → ${Math.round(makeChance(e.quality) * 100)} % de chance`],
  ];
  return (
    <div
      style={{
        position: "absolute", right: 8, top: "calc(env(safe-area-inset-top) + 8px)", padding: "8px 10px",
        borderRadius: 10, background: "rgba(0,0,0,0.65)", fontSize: 12,
        lineHeight: 1.5, color: "#CFE3FF", pointerEvents: "none",
      }}
    >
      {rows.map(([k, v]) => (
        <div key={k}>
          <span style={{ opacity: 0.6 }}>{k} </span>
          {v}
        </div>
      ))}
    </div>
  );
}
