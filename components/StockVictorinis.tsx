"use client";

import { PERSONNES, RARETE_COLOR, RARETE_LABEL, getCarteUrl, type Rarete } from "@/lib/victorinis";

// Ordre d'affichage demandé : bleue, argent, or
const ORDRE: Rarete[] = ["bleu", "argent", "or"];

/**
 * Mon stock : pour chaque personne, ses 3 cartes (bleue, argent, or) en petit format avec
 * le nombre d'exemplaires. Les cartes en plusieurs exemplaires (échangeables) ressortent.
 */
export default function StockVictorinis({
  counts,
  onClose,
}: {
  counts: Record<string, number>;
  onClose: () => void;
}) {
  const n = (slug: string, r: Rarete) => counts[`${slug}|${r}`] ?? 0;
  const enDouble = Object.values(counts).filter((v) => v > 1).length;
  const enTrop = Object.values(counts).reduce((a, v) => a + Math.max(0, v - 1), 0);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center px-3"
      style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Mon stock de cartes"
    >
      <div
        className="w-full max-w-md rounded-2xl p-4 max-h-[92dvh] overflow-y-auto"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <div>
            <p className="font-display text-lg leading-none" style={{ color: "var(--text-main)" }}>
              MON STOCK
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              {enDouble === 0
                ? "Aucune carte en double pour l'instant"
                : `${enDouble} carte${enDouble > 1 ? "s" : ""} en double · ${enTrop} exemplaire${enTrop > 1 ? "s" : ""} échangeable${enTrop > 1 ? "s" : ""}`}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center"
            style={{ background: "var(--bg-input)", color: "var(--text-main)", border: "1px solid var(--border)" }}
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col">
          {PERSONNES.map((p, i) => (
            <div
              key={p.slug}
              className="flex items-center gap-2 py-1.5"
              style={{ borderTop: i === 0 ? undefined : "1px solid var(--border)" }}
            >
              <p className="w-[68px] shrink-0 text-sm leading-tight" style={{ color: "var(--text-main)" }}>
                {p.prenom}
                {p.role === "coach" && (
                  <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>
                    coach
                  </span>
                )}
              </p>
              <div className="flex flex-1 justify-end gap-2.5">
                {ORDRE.map((r) => (
                  <PetiteCarte key={r} slug={p.slug} rarete={r} n={n(p.slug, r)} label={`${p.prenom}, ${RARETE_LABEL[r]}`} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PetiteCarte({ slug, rarete, n, label }: { slug: string; rarete: Rarete; n: number; label: string }) {
  const color = RARETE_COLOR[rarete];
  const double = n > 1;
  return (
    <div
      className="relative shrink-0 overflow-hidden"
      aria-label={`${label} : ${n} exemplaire${n > 1 ? "s" : ""}`}
      style={{
        // Petit format : les 7 personnes tiennent sur un écran (on fait défiler seulement sur les très petits).
        width: "max(40px, min(17vw, 60px, calc((92dvh - 150px) / 10.5 - 8px)))",
        aspectRatio: "2 / 3",
        borderRadius: 7,
        border: n > 0 ? `1px solid ${color}` : "1px solid rgba(255,255,255,0.06)",
        background: n > 0 ? "var(--bg-input)" : "#23272F",
        boxShadow: double ? `0 0 10px ${color}66` : undefined,
      }}
    >
      {/* Carte non possédée : simple aplat, rien ne laisse deviner la carte */}
      {n > 0 && <img src={getCarteUrl(slug, rarete, 200)} alt="" decoding="async" className="h-full w-full object-cover" />}
      <span
        className="absolute right-0.5 top-0.5 rounded-md px-1 py-px text-[11px] font-black leading-tight"
        style={
          double
            ? { background: color, color: rarete === "bleu" ? "white" : "#111" }
            : { background: "rgba(0,0,0,0.65)", color: n > 0 ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.35)" }
        }
      >
        ×{n}
      </span>
    </div>
  );
}
