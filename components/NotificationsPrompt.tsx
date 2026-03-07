// components/NotificationsPrompt.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Role = "player" | "staff";
type Pole = "masculin" | "feminin" | "both";

interface Props {
  userId: string;
  role: Role;
  pole: Pole;
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) view[i] = rawData.charCodeAt(i);
  return buffer;
}

function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

type Step = "prompt" | "loading" | "success" | "denied" | "ios";

export default function NotificationsPrompt({ userId, role, pole }: Props) {
  const [visible, setVisible] = useState(false);
  const [step,    setStep]    = useState<Step>("prompt");

  useEffect(() => {
    // Seulement sur mobile
    if (!isMobile()) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;

    // Si permission déjà accordée → vérifier si en base, sinon inscrire silencieusement
    if (Notification.permission === "granted") {
      checkAndEnsureInDb();
      return;
    }

    // iOS hors standalone : on affiche quand même (pour expliquer l'installation)
    // Autre cas refusé : on insiste quand même (contexte sportif, pas une app marchande)
    // → on affiche toujours le modal si pas en base

    checkIfInDb();

    async function checkIfInDb() {
      // Vérifier si l'utilisateur a déjà une subscription en base
      const { data } = await supabase
        .from("push_subscriptions")
        .select("id")
        .eq("user_id", userId)
        .limit(1);

      // Déjà inscrit → rien à faire
      if (data && data.length > 0) return;

      // Pas encore inscrit → afficher le modal après un court délai
      setTimeout(() => setVisible(true), 1500);
    }

    async function checkAndEnsureInDb() {
      const { data } = await supabase
        .from("push_subscriptions")
        .select("id")
        .eq("user_id", userId)
        .limit(1);

      if (data && data.length > 0) {
        // Déjà en base → rafraîchir last_seen_at silencieusement
        if ("serviceWorker" in navigator) {
          const reg = await navigator.serviceWorker.ready;
          const existing = await reg.pushManager.getSubscription();
          if (existing) {
            await supabase
              .from("push_subscriptions")
              .update({ last_seen_at: new Date().toISOString() })
              .eq("endpoint", existing.endpoint);
          }
        }
        return;
      }

      // Permission accordée mais pas en base (ex: nouvelle installation) → réinscrire
      setTimeout(() => setVisible(true), 1500);
    }
  }, [userId]);

  const handleAccept = async () => {
    // iOS hors standalone → expliquer l'installation
    if (isIos() && !isStandalone()) {
      setStep("ios");
      return;
    }

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStep("denied");
      return;
    }

    setStep("loading");

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStep("denied");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();

      if (existing) {
        await saveSubscription(existing, userId, role, pole);
        setStep("success");
        setTimeout(() => setVisible(false), 2000);
        return;
      }

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) { setStep("denied"); return; }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      await saveSubscription(subscription, userId, role, pole);
      setStep("success");
      setTimeout(() => setVisible(false), 2000);

    } catch (err) {
      console.error("[Push]", err);
      setStep("denied");
    }
  };

  // "Plus tard" : ferme mais réapparaîtra à la prochaine connexion (pas de sessionStorage)
  const handleDismiss = () => setVisible(false);

  if (!visible) return null;

  return (
    <>
      <div className="fixed inset-0 z-[300]"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }} />

      <div className="fixed inset-0 z-[301] flex items-end sm:items-center justify-center p-4">
        <div
          className="w-full sm:max-w-sm rounded-2xl overflow-hidden"
          style={{
            background: "linear-gradient(145deg, #0B1120, #0E1E38)",
            border: "1px solid rgba(43,80,160,0.35)",
            boxShadow: "0 -8px 60px rgba(0,0,0,0.6)",
            animation: "notifSlideUp .35s cubic-bezier(.32,.72,0,1) forwards",
          }}
        >
          <div className="h-1" style={{ background: "linear-gradient(90deg, transparent, #1B3A8C, #C49A28, transparent)" }} />

          <div className="p-6">

            {/* ── Prompt ── */}
            {step === "prompt" && (
              <>
                <div className="flex items-start gap-4 mb-5">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0"
                    style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))" }}>
                    🔔
                  </div>
                  <div>
                    <p className="font-display text-base tracking-wider mb-1" style={{ color: "var(--text-main)" }}>
                      ACTIVER LES NOTIFICATIONS
                    </p>
                    <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                      Reçois les alertes directement sur ton téléphone — billets de train disponibles, convocations, annulations, rappels.
                    </p>
                  </div>
                </div>

                {/* Aperçu */}
                <div className="rounded-xl p-3 mb-5 flex items-start gap-3"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))" }}>🏀</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold" style={{ color: "var(--text-main)" }}>Pôle France</p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Tes billets de train pour Toulouse sont disponibles 🎫</p>
                  </div>
                  <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>maintenant</span>
                </div>

                <div className="flex gap-2">
                  <button onClick={handleAccept}
                    className="flex-1 py-3 rounded-xl text-sm font-display tracking-widest transition-all active:scale-95"
                    style={{
                      background: "linear-gradient(135deg,var(--accent),var(--accent2))",
                      color: "white", boxShadow: "0 4px 20px var(--accent-glow)",
                    }}>
                    ACTIVER
                  </button>
                  <button onClick={handleDismiss}
                    className="px-4 py-3 rounded-xl text-sm font-medium transition-all"
                    style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                    Plus tard
                  </button>
                </div>
              </>
            )}

            {/* ── Chargement ── */}
            {step === "loading" && (
              <div className="flex flex-col items-center py-6 gap-3">
                <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
                  style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>Activation en cours…</p>
              </div>
            )}

            {/* ── Succès ── */}
            {step === "success" && (
              <div className="flex flex-col items-center py-6 gap-3">
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-3xl"
                  style={{ background: "rgba(74,222,128,0.15)" }}>✅</div>
                <p className="text-sm font-medium" style={{ color: "#4ade80" }}>Notifications activées !</p>
                <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
                  Tu recevras désormais toutes les alertes du staff.
                </p>
              </div>
            )}

            {/* ── Refusé ── */}
            {step === "denied" && (
              <div className="space-y-4">
                <div className="flex flex-col items-center py-4 gap-3">
                  <span className="text-4xl">🔕</span>
                  <p className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
                    Permission refusée
                  </p>
                  <p className="text-xs text-center leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    Pour les activer : appuie sur ton nom en haut à droite → Notifications → Activer.
                  </p>
                </div>
                <button onClick={handleDismiss}
                  className="w-full py-3 rounded-xl text-sm font-medium"
                  style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                  Fermer
                </button>
              </div>
            )}

            {/* ── iOS hors standalone ── */}
            {step === "ios" && (
              <div className="space-y-4">
                <p className="font-display text-sm tracking-wider" style={{ color: "var(--text-main)" }}>
                  INSTALLE L&apos;APP D&apos;ABORD
                </p>
                <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  Sur iPhone, les notifications nécessitent que l&apos;app soit installée sur l&apos;écran d&apos;accueil.
                </p>
                <div className="space-y-3">
                  {[
                    { n: 1, text: "Appuie sur le bouton Partager en bas de Safari", icon: "⬆️" },
                    { n: 2, text: `Sélectionne "Sur l'écran d'accueil"`,            icon: "➕" },
                    { n: 3, text: "Ouvre l'app installée et reconnecte-toi",        icon: "📲" },
                  ].map(({ n, text, icon }) => (
                    <div key={n} className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-xs font-bold"
                        style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}>
                        {n}
                      </div>
                      <p className="text-xs flex-1" style={{ color: "var(--text-muted)" }}>{text}</p>
                      <span>{icon}</span>
                    </div>
                  ))}
                </div>
                <button onClick={handleDismiss}
                  className="w-full py-3 rounded-xl text-sm font-medium mt-2"
                  style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                  Compris
                </button>
              </div>
            )}

          </div>
        </div>
      </div>

      <style>{`
        @keyframes notifSlideUp {
          from { transform: translateY(40px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function saveSubscription(
  subscription: PushSubscription,
  userId: string,
  role: Role,
  pole: Pole
) {
  const { endpoint, keys } = subscription.toJSON() as {
    endpoint: string; keys: { p256dh: string; auth: string };
  };
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId, endpoint,
      p256dh: keys.p256dh, auth: keys.auth,
      role, pole, user_agent: navigator.userAgent,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  );
  if (error) console.error("[Push] Erreur sauvegarde subscription:", error.message);
}
