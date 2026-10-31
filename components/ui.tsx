"use client";

// Petits éléments d'interface partagés (auparavant recopiés dans chaque onglet).

export const fieldInputStyle = {
  background: "var(--bg-input)",
  border: "1px solid var(--border)",
  color: "var(--text-main)",
} as React.CSSProperties;

export const fieldLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  fontWeight: 500,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--text-sub)",
  marginBottom: "0.5rem",
};

/** Bouton carré à icône (modifier, supprimer…). Survol géré en CSS (globals.css). */
export function IconBtn({ onClick, icon, danger = false, title }: {
  onClick: () => void; icon: string; danger?: boolean; title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`icon-btn ${danger ? "icon-btn-danger" : ""} w-8 h-8 rounded-lg flex items-center justify-center transition-colors shrink-0`}
    >
      {icon}
    </button>
  );
}

export function SuccessBanner({ text }: { text: string }) {
  return (
    <div className="rounded-lg px-4 py-3 text-sm animate-slide-in"
      style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", color: "#86efac" }}>
      {text}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-8">
      <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} />
    </div>
  );
}

// ─── Plage de dates des historiques (suivi sportif, forme) ───────────────────
// "jours: null" = pas de filtre de date (tout l'historique)
export const RANGES: { val: string; label: string; jours: number | null }[] = [
  { val: "30",  label: "30 jours", jours: 30 },
  { val: "90",  label: "3 mois",   jours: 90 },
  { val: "365", label: "1 an",     jours: 365 },
  { val: "all", label: "Tout",     jours: null },
];

export function RangeSwitch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl overflow-x-auto scrollbar-hide" style={{ background: "rgba(255,255,255,0.04)" }}>
      {RANGES.map((r) => (
        <button key={r.val} onClick={() => onChange(r.val)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 whitespace-nowrap"
          style={{
            background: value === r.val ? "var(--primary)" : "transparent",
            color: value === r.val ? "white" : "var(--text-muted)",
            boxShadow: value === r.val ? "0 2px 8px rgba(27,58,140,0.4)" : "none",
          }}>
          {r.label}
        </button>
      ))}
    </div>
  );
}
