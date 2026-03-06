"use client";

import { useEffect, useState } from "react";

interface OneSignalTags {
  pole: "masculin" | "feminin" | null; // null = staff sans pôle assigné
  role: "player" | "staff";
}

export function useOneSignal(userId: string | null, tags?: OneSignalTags) {
  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
    if (!appId) return;

    if ((window as any)["__onesignal_loaded"]) {
      const OS = (window as any).OneSignal;
      if (OS && tags) {
        OS.login(userId).then(() => {
          OS.User.removeTag("type");
          OS.User.removeTag("prenom");
          OS.User.addTag("role", tags.role);
          if (tags.pole) OS.User.addTag("pole", tags.pole);
        });
      }
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    script.defer = true;
    document.head.appendChild(script);

    script.onload = () => {
      (window as any)["__onesignal_loaded"] = true;
      const OneSignalDeferred: any[] = (window as any).OneSignalDeferred =
        (window as any).OneSignalDeferred || [];

      OneSignalDeferred.push(async (OS: any) => {
        await OS.init({
          appId,
          notifyButton: { enable: false },
          allowLocalhostAsSecureOrigin: true,
          serviceWorkerParam: { scope: "/" },
          serviceWorkerPath: "/OneSignalSDKWorker.js",
        });
        // External User ID → retrouver l'utilisateur par son ID Supabase dans OneSignal
        await OS.login(userId);
        // addTag (singulier) — plus fiable que addTags en v16
        // Ces Data Tags sont filtrables dans les segments OneSignal
        if (tags) {
          // Supprime les anciens tags (migration type/prenom → role/pole)
          await OS.User.removeTag("type");
          await OS.User.removeTag("prenom");
          // Pose les nouveaux
          await OS.User.addTag("role", tags.role);
          if (tags.pole) await OS.User.addTag("pole", tags.pole);
        }
      });
    };

    return () => { if (document.head.contains(script)) document.head.removeChild(script); };
  // On ne redéclenche pas si tags change (ne change jamais en session)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}

function isPWA(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  if ((navigator as any).standalone === true) return true;
  return false;
}

export default function NotificationsPermission() {
  const [visible, setVisible]       = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [result, setResult]         = useState<"granted" | "denied" | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted" && Notification.permission !== "denied") {
      const alreadyAsked = localStorage.getItem("notif-asked");
      if (isPWA() || !alreadyAsked) {
        const timer = setTimeout(() => setVisible(true), 2500);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  const handleAccept = async () => {
    setRequesting(true);
    try {
      const OS = (window as any).OneSignal;
      if (OS?.Notifications) {
        await OS.Notifications.requestPermission();
        setResult(OS.Notifications.permission ? "granted" : "denied");
      } else {
        const r = await Notification.requestPermission();
        setResult(r === "granted" ? "granted" : "denied");
      }
    } catch {
      setResult("denied");
    } finally {
      setRequesting(false);
      localStorage.setItem("notif-asked", "1");
      setTimeout(() => setVisible(false), 2500);
    }
  };

  const handleDismiss = () => {
    if (!isPWA()) localStorage.setItem("notif-asked", "1");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed top-4 left-4 right-4 z-50 animate-slide-in" style={{ maxWidth: "420px", margin: "0 auto" }}>
      <div className="rounded-2xl p-4 shadow-2xl"
        style={{ background: "linear-gradient(145deg, #0E1628, #111E35)", border: "1px solid rgba(43,80,160,0.35)", boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }}>
        <div className="h-0.5 rounded-full mb-4" style={{ background: "linear-gradient(90deg, #1B3A8C, #E8192C)" }} />
        {result === "granted" ? (
          <div className="text-center py-2">
            <p className="text-2xl mb-1">✅</p>
            <p className="text-sm font-medium" style={{ color: "#86efac" }}>Notifications activées !</p>
          </div>
        ) : result === "denied" ? (
          <div className="text-center py-2">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Active-les depuis les paramètres de ton navigateur si tu changes d&apos;avis.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3 mb-4">
              <span className="text-2xl">🔔</span>
              <div>
                <p className="font-display text-sm tracking-wider mb-1" style={{ color: "var(--text-main)" }}>ACTIVER LES NOTIFICATIONS</p>
                <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  Reçois les rappels de suivi et sois alerté quand tes billets sont disponibles.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleAccept} disabled={requesting}
                className="flex-1 py-2.5 rounded-xl text-xs font-display tracking-widest transition-all"
                style={{ background: "linear-gradient(135deg, #1B3A8C, #2952CC)", color: "white", boxShadow: "0 4px 16px rgba(27,58,140,0.4)", opacity: requesting ? 0.6 : 1 }}>
                {requesting ? "..." : "ACTIVER"}
              </button>
              <button onClick={handleDismiss} className="px-4 py-2.5 rounded-xl text-xs font-medium"
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