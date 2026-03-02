"use client";

import { useEffect, useState } from "react";

// Initialise OneSignal et enregistre le joueur
export function useOneSignal(userId: string | null) {
  useEffect(() => {
    if (!userId) return;
    if (typeof window === "undefined") return;

    const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
    if (!appId) return;

    // Charger le SDK OneSignal
    const script = document.createElement("script");
    script.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    script.defer = true;
    document.head.appendChild(script);

    script.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const OneSignal = (window as any).OneSignalDeferred = (window as any).OneSignalDeferred || [];
      OneSignal.push(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const OS = (window as any).OneSignal;
        await OS.init({
          appId,
          safari_web_id: process.env.NEXT_PUBLIC_ONESIGNAL_SAFARI_ID ?? "",
          notifyButton: { enable: false }, // on gère nous-mêmes l'UI
          allowLocalhostAsSecureOrigin: true,
        });
        // Associer l'ID joueur pour ciblage individuel
        await OS.login(userId);
      });
    };

    return () => {
      if (document.head.contains(script)) document.head.removeChild(script);
    };
  }, [userId]);
}

// Bouton demande de permission (affiché après connexion)
export default function NotificationsPermission() {
  const [status, setStatus] = useState<"idle" | "granted" | "denied" | "loading">("idle");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;

    const already = localStorage.getItem("notif-permission-asked");
    if (already) return;

    // Petit délai pour ne pas surcharger l'écran à la connexion
    const timer = setTimeout(() => {
      if (Notification.permission === "default") setVisible(true);
      else if (Notification.permission === "granted") {
        localStorage.setItem("notif-permission-asked", "1");
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  const requestPermission = async () => {
    setStatus("loading");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const OS = (window as any).OneSignal;
    if (OS) {
      try {
        await OS.Notifications.requestPermission();
        const granted = OS.Notifications.permission;
        setStatus(granted ? "granted" : "denied");
      } catch {
        setStatus("denied");
      }
    } else {
      // Fallback natif si OneSignal pas encore chargé
      const result = await Notification.requestPermission();
      setStatus(result === "granted" ? "granted" : "denied");
    }
    localStorage.setItem("notif-permission-asked", "1");
    setTimeout(() => setVisible(false), 2000);
  };

  const dismiss = () => {
    localStorage.setItem("notif-permission-asked", "1");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed top-4 left-4 right-4 z-50 animate-slide-in"
      style={{ maxWidth: "420px", margin: "0 auto" }}>
      <div className="rounded-2xl p-4 shadow-2xl"
        style={{
          background: "linear-gradient(145deg, #0E1628, #111E35)",
          border: "1px solid rgba(43,80,160,0.35)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
        }}>
        <div className="h-0.5 rounded-full mb-4" style={{ background: "linear-gradient(90deg, #1B3A8C, #E8192C)" }} />

        {status === "granted" ? (
          <div className="text-center py-2">
            <p className="text-2xl mb-1">✅</p>
            <p className="text-sm font-medium" style={{ color: "#86efac" }}>Notifications activées !</p>
          </div>
        ) : status === "denied" ? (
          <div className="text-center py-2">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Tu pourras les activer plus tard dans les paramètres de ton navigateur.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3 mb-4">
              <span className="text-2xl">🔔</span>
              <div>
                <p className="font-display text-sm tracking-wider mb-1" style={{ color: "var(--text-main)" }}>
                  ACTIVER LES NOTIFICATIONS
                </p>
                <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  Reçois des rappels pour tes suivis et sois alerté quand tes billets de train sont disponibles.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={requestPermission} disabled={status === "loading"}
                className="flex-1 py-2.5 rounded-xl text-xs font-display tracking-widest transition-all"
                style={{ background: "linear-gradient(135deg, #1B3A8C, #2952CC)", color: "white", boxShadow: "0 4px 16px rgba(27,58,140,0.4)" }}>
                {status === "loading" ? "..." : "ACTIVER"}
              </button>
              <button onClick={dismiss}
                className="px-4 py-2.5 rounded-xl text-xs font-medium"
                style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                Plus tard
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
