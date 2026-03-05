"use client";

import { useEffect, useState } from "react";

type OS = "ios" | "android" | "desktop" | null;

const DISMISS_KEY = "pwa-banner-dismissed-until";
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

function detectOS(): OS {
  if (typeof window === "undefined") return null;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((navigator as any).standalone === true) return true;
  return false;
}

function isSnoozed(): boolean {
  try {
    const until = localStorage.getItem(DISMISS_KEY);
    if (!until) return false;
    // "never" = dismiss permanent
    if (until === "never") return true;
    return Date.now() < parseInt(until, 10);
  } catch {
    return false;
  }
}

export default function PwaBanner() {
  const [visible, setVisible] = useState(false);
  const [os, setOs] = useState<OS>(null);

  useEffect(() => {
    if (isInstalled()) return;
    if (isSnoozed()) return;

    const detectedOS = detectOS();
    if (detectedOS === "desktop") return;

    setOs(detectedOS);
    setVisible(true);
  }, []);

  const snooze = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + COOLDOWN_MS));
    } catch { /* storage indisponible */ }
    setVisible(false);
  };

  const dismissForever = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "never");
    } catch { /* storage indisponible */ }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-4 animate-slide-in-up">
      <div
        className="rounded-2xl p-4 shadow-2xl"
        style={{
          background: "linear-gradient(145deg, #0E1628, #111E35)",
          border: "1px solid rgba(43,80,160,0.35)",
          boxShadow: "0 -4px 40px rgba(0,0,0,0.5)",
        }}
      >
        {/* Barre déco */}
        <div className="h-0.5 rounded-full mb-4" style={{ background: "linear-gradient(90deg, #1B3A8C, #E8192C)" }} />

        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📲</span>
            <div>
              <p className="font-display text-sm tracking-wider" style={{ color: "var(--text-main)" }}>
                INSTALLER L&apos;APPLICATION
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                Pour recevoir les notifications
              </p>
            </div>
          </div>
          {/* ✕ = snooze 7 jours */}
          <button
            onClick={snooze}
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs"
            style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            ✕
          </button>
        </div>

        {/* Instructions selon OS */}
        {os === "android" && (
          <div
            className="rounded-xl p-3 space-y-1.5"
            style={{ background: "rgba(27,58,140,0.1)", border: "1px solid rgba(27,58,140,0.2)" }}
          >
            <Step num={1} text="Appuie sur le menu" icon="⋮" />
            <Step num={2} text='Sélectionne "Ajouter à l&apos;écran d&apos;accueil"' icon="➕" />
          </div>
        )}

        {os === "ios" && (
          <div
            className="rounded-xl p-3 space-y-1.5"
            style={{ background: "rgba(27,58,140,0.1)", border: "1px solid rgba(27,58,140,0.2)" }}
          >
            <Step num={1} text="Appuie sur le bouton Partager" icon="□↑" />
            <Step num={2} text='Sélectionne "Sur l&apos;écran d&apos;accueil"' icon="➕" />
          </div>
        )}

        <div className="flex gap-2 mt-3">
          {/* Rappeler dans 7 jours */}
          <button
            onClick={snooze}
            className="flex-1 py-2.5 rounded-xl text-xs font-medium tracking-widest"
            style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            Plus tard
          </button>
          {/* Ne plus jamais afficher */}
          <button
            onClick={dismissForever}
            className="px-4 py-2.5 rounded-xl text-xs"
            style={{ color: "var(--text-muted)", opacity: 0.5 }}
          >
            Ne plus afficher
          </button>
        </div>
      </div>
    </div>
  );
}

function Step({ num, text, icon }: { num: number; text: string; icon: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
        style={{ background: "var(--primary)", color: "white" }}
      >
        {num}
      </span>
      <span className="text-xs" style={{ color: "var(--text-sub)" }}>
        {text}{" "}
        <span className="font-bold" style={{ color: "var(--text-main)" }}>
          {icon}
        </span>
      </span>
    </div>
  );
}
