"use client";

// Modale de l'écran de tagging + sélecteur de joueur au clavier (1 à 4, 0 = adversaire).

import { useEffect } from "react";

export function Modale({
  titre,
  sousTitre,
  onAnnuler,
  children,
  large = false,
}: {
  titre: string;
  sousTitre?: string;
  onAnnuler: () => void;
  children: React.ReactNode;
  large?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      style={{ background: "rgba(3,5,10,0.72)", backdropFilter: "blur(3px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onAnnuler(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        className={`w-full ${large ? "max-w-2xl" : "max-w-md"} rounded-2xl p-5 animate-fade-in-up max-h-[92vh] overflow-y-auto`}
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-2xl leading-none" style={{ color: "var(--text-main)" }}>{titre}</h2>
            {sousTitre && <p className="text-xs mt-1" style={{ color: "var(--text-sub)" }}>{sousTitre}</p>}
          </div>
          <button
            onClick={onAnnuler}
            className="hover-text-main px-3 py-1.5 rounded-lg text-xs font-medium shrink-0"
            style={{ border: "1px solid var(--border)", color: "var(--text-sub)" }}
          >
            Annuler <span className="opacity-60">Échap</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface Choix {
  id: string;            // id du joueur ou "adversaire"
  label: string;
  initiales: string;
  info?: string;         // ex. « Rebond offensif »
  adversaire?: boolean;
}

/** Grandes cartes joueur. Raccourcis : 1-4 pour les joueurs, 0 pour l'adversaire, Échap pour annuler. */
export function ChoixJoueur({
  choix,
  onChoisir,
  onAnnuler,
  desactive = false,
}: {
  choix: Choix[];
  onChoisir: (id: string) => void;
  onAnnuler: () => void;
  desactive?: boolean;
}) {
  const joueurs = choix.filter((c) => !c.adversaire);
  const adv = choix.find((c) => c.adversaire);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onAnnuler(); return; }
      if (desactive) return;
      if (e.key === "0" && adv) { e.preventDefault(); onChoisir(adv.id); return; }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= joueurs.length) { e.preventDefault(); onChoisir(joueurs[n - 1].id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [joueurs, adv, onChoisir, onAnnuler, desactive]);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {joueurs.map((c, i) => (
          <CarteChoix key={c.id} c={c} touche={String(i + 1)} desactive={desactive} onClick={() => onChoisir(c.id)} />
        ))}
      </div>
      {adv && <CarteChoix c={adv} touche="0" desactive={desactive} onClick={() => onChoisir(adv.id)} />}
    </div>
  );
}

function CarteChoix({ c, touche, desactive, onClick }: { c: Choix; touche: string; desactive: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={desactive}
      className="hover-lift w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        background: c.adversaire ? "var(--bg-input)" : "color-mix(in srgb, var(--primary) 22%, var(--bg-card2))",
        border: `1px solid ${c.adversaire ? "var(--border)" : "color-mix(in srgb, var(--primary-light) 40%, transparent)"}`,
      }}
    >
      {/* Emplacement de la future carte / photo du joueur */}
      <span
        className="w-11 h-11 rounded-lg flex items-center justify-center font-display text-lg shrink-0"
        style={{
          background: c.adversaire ? "rgba(255,255,255,0.05)" : "linear-gradient(160deg, var(--primary-light), var(--primary))",
          color: c.adversaire ? "var(--text-sub)" : "white",
          border: c.adversaire ? "1px dashed var(--border)" : "1px solid color-mix(in srgb, var(--accent) 45%, transparent)",
        }}
      >
        {c.initiales}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold truncate" style={{ color: "var(--text-main)" }}>{c.label}</span>
        {c.info && <span className="block text-xs truncate" style={{ color: "var(--text-sub)" }}>{c.info}</span>}
      </span>
      <kbd
        className="text-xs px-1.5 py-0.5 rounded shrink-0"
        style={{ border: "1px solid var(--border)", color: "var(--text-sub)", fontFamily: "inherit" }}
      >
        {touche}
      </kbd>
    </button>
  );
}
