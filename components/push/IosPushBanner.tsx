"use client";

import { useState, useEffect } from "react";

// ─── Détection ────────────────────────────────────────────────────────────────
function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isInStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  return (
    ("standalone" in window.navigator && (window.navigator as { standalone?: boolean }).standalone === true) ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

// ─── Composant ────────────────────────────────────────────────────────────────
export default function IosPushBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // N'afficher que sur iOS, hors mode standalone, et si pas déjà ignoré
    const dismissed = localStorage.getItem("ios-push-banner-dismissed");
    if (isIos() && !isInStandaloneMode() && !dismissed) {
      // Petit délai pour ne pas agresser l'user dès l'ouverture
      const t = setTimeout(() => setVisible(true), 2000);
      return () => clearTimeout(t);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem("ios-push-banner-dismissed", "1");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <>
      {/* Overlay semi-transparent */}
      <div
        className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
        onClick={dismiss}
      />

      {/* Banner ancré en bas */}
      <div className="fixed bottom-0 left-0 right-0 z-50 p-4 animate-slide-up">
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5 shadow-2xl max-w-sm mx-auto">

          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <img
                src="/icon-192.png"
                alt="ParaBasket"
                className="w-12 h-12 rounded-2xl object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src =
                    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='40' fill='%23f97316'/%3E%3Ctext x='96' y='130' font-size='100' text-anchor='middle'%3E🏀%3C/text%3E%3C/svg%3E";
                }}
              />
              <div>
                <p className="font-bold text-sm">Activer les notifications</p>
                <p className="text-xs text-gray-400">ParaBasket</p>
              </div>
            </div>
            <button
              onClick={dismiss}
              className="text-gray-500 hover:text-gray-300 transition-colors p-1"
              aria-label="Fermer"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          {/* Texte explicatif */}
          <p className="text-sm text-gray-300 mb-5 leading-relaxed">
            Pour recevoir les notifications (convocations, annulations, infos du club),
            installe l'app sur ton écran d'accueil.
          </p>

          {/* Étapes visuelles */}
          <div className="space-y-3 mb-5">
            <Step number={1} text="Appuie sur le bouton Partager en bas de Safari" icon={<ShareIcon />} />
            <Step number={2} text={`Sélectionne "Sur l'écran d'accueil"`} icon={<AddIcon />} />
            <Step number={3} text="Ouvre l'app installée et accepte les notifications" icon={<BellIcon />} />
          </div>

          {/* Bouton fermer */}
          <button
            onClick={dismiss}
            className="w-full py-3 rounded-xl text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
          >
            Compris, plus tard
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slide-up {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        .animate-slide-up {
          animation: slide-up 0.35s cubic-bezier(0.32, 0.72, 0, 1) forwards;
        }
      `}</style>
    </>
  );
}

// ─── Sous-composants ──────────────────────────────────────────────────────────
function Step({ number, text, icon }: { number: number; text: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-6 h-6 rounded-full bg-orange-500 flex-shrink-0 flex items-center justify-center text-xs font-bold">
        {number}
      </div>
      <p className="text-xs text-gray-400 flex-1 leading-snug">{text}</p>
      <div className="text-gray-500 flex-shrink-0">{icon}</div>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
      <polyline points="16 6 12 2 8 6"/>
      <line x1="12" y1="2" x2="12" y2="15"/>
    </svg>
  );
}

function AddIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3"/>
      <line x1="12" y1="8" x2="12" y2="16"/>
      <line x1="8" y1="12" x2="16" y2="12"/>
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  );
}
