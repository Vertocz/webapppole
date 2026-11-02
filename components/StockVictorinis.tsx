"use client";

import { PERSONNES, RARETE_COLOR, RARETE_LABEL, getCarteUrl, type Rarete } from "@/lib/victorinis";

const ORDRE: Rarete[] = ["or", "argent", "bleu"];

/** Stock : les cartes possédées en plus d'un exemplaire (celles qu'on peut échanger). */
export default function StockVictorinis({
  counts,
  onClose,
}: {
  counts: Record<string, number>;
  onClose: () => void;
}) {
  const stock = ORDRE.flatMap((r) =>
    PERSONNES.map((p) => ({ p, r, n: counts[`${p.slug}|${r}`] ?? 0 })).filter((x) => x.n > 1),
  );
  const enTrop = stock.reduce((a, x) => a + x.n - 1, 0);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center px-3"
      style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Mon stock de cartes en double"
    >
      <div
        className="w-full max-w-md rounded-2xl p-4 space-y-4 max-h-[90dvh] overflow-y-auto"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-display text-lg leading-none" style={{ color: "var(--text-main)" }}>
              MON STOCK
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              {stock.length === 0
                ? "Cartes possédées en plusieurs exemplaires"
                : `${stock.length} carte${stock.length > 1 ? "s" : ""} en double · ${enTrop} exemplaire${enTrop > 1 ? "s" : ""} en trop`}
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

        {stock.length === 0 ? (
          <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            Aucune carte en double pour l&apos;instant.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {stock.map(({ p, r, n }) => (
              <div key={`${p.slug}|${r}`} className="flex flex-col items-center gap-1.5">
                <div
                  className="relative w-full overflow-hidden"
                  style={{
                    aspectRatio: "2 / 3",
                    borderRadius: 10,
                    border: `1px solid ${RARETE_COLOR[r]}`,
                    background: "var(--bg-input)",
                    boxShadow: r === "or" ? "0 0 12px rgba(242,185,15,0.4)" : undefined,
                  }}
                >
                  <img src={getCarteUrl(p.slug, r, 200)} alt="" decoding="async" className="h-full w-full object-cover" />
                  <span
                    className="absolute right-1 top-1 rounded-md px-1.5 py-0.5 text-xs font-black"
                    style={{ background: "rgba(0,0,0,0.75)", color: RARETE_COLOR[r] }}
                  >
                    ×{n}
                  </span>
                </div>
                <p className="text-center text-xs leading-tight" style={{ color: "var(--text-main)" }}>
                  {p.prenom}
                  <span className="block text-[10px]" style={{ color: RARETE_COLOR[r] }}>
                    {RARETE_LABEL[r]}
                  </span>
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
