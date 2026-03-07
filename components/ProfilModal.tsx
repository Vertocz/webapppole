"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Props {
  userId: string;
  userType: "joueuse" | "staff";
  prenom: string;
  nom: string;
  telephone: string;
  role: "player" | "staff";          // ← nouveau
  pole: "masculin" | "feminin" | "both"; // ← nouveau
  onClose: () => void;
  onPhoneUpdated: (newPhone: string) => void;
}

type Step = "menu" | "phone" | "notifs";
type NotifStatus = "granted" | "denied" | "default";

function normalizePhone(val: string) {
  return val.replace(/\s/g, "").replace(/^\+33/, "0");
}

function isValidPhone(val: string) {
  const n = normalizePhone(val);
  return n.length === 10 && ["06", "07"].some((p) => n.startsWith(p));
}

function getNotifStatus(): NotifStatus {
  if (typeof window === "undefined" || !("Notification" in window)) return "default";
  return Notification.permission as NotifStatus;
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

export default function ProfilModal({
  userId, userType, prenom, nom, telephone,
  role, pole,
  onClose, onPhoneUpdated,
}: Props) {
  const [step, setStep] = useState<Step>("menu");

  // ── Téléphone
  const [phone1,      setPhone1]      = useState("");
  const [phone2,      setPhone2]      = useState("");
  const [phoneError,  setPhoneError]  = useState("");
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneSaved,  setPhoneSaved]  = useState(false);

  // ── Notifications
  const [notifStatus,  setNotifStatus]  = useState<NotifStatus>(getNotifStatus);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifMsg,     setNotifMsg]     = useState("");

  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Sauvegarde téléphone
  const savePhone = async () => {
    setPhoneError("");
    const n1 = normalizePhone(phone1);
    const n2 = normalizePhone(phone2);
    if (!isValidPhone(n1)) { setPhoneError("Numéro invalide (06 ou 07, 10 chiffres)."); return; }
    if (n1 !== n2)         { setPhoneError("Les deux numéros ne correspondent pas."); return; }
    if (n1 === normalizePhone(telephone)) { setPhoneError("C'est déjà ton numéro actuel."); return; }

    setPhoneSaving(true);
    const table = userType === "joueuse" ? "joueuses" : "staff";
    const { error } = await supabase.from(table).update({ numero_tel: n1 }).eq("id", userId);
    setPhoneSaving(false);

    if (error) {
      setPhoneError("Erreur lors de la sauvegarde. Réessaie.");
    } else {
      setPhoneSaved(true);
      onPhoneUpdated(n1);
      setTimeout(() => { setPhoneSaved(false); setPhone1(""); setPhone2(""); setStep("menu"); }, 1500);
    }
  };

  // ── Activer les notifications (Web Push natif)
  const requestNotifs = async () => {
    setNotifLoading(true);
    setNotifMsg("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setNotifMsg("Non supporté sur ce navigateur.");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setNotifStatus("denied");
        setNotifMsg("Permission refusée.");
        return;
      }

      const registration = await navigator.serviceWorker.ready;

      // Vérifier s'il existe déjà une subscription
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        // Déjà abonné — s'assurer que c'est en base
        await supabase.from("push_subscriptions").upsert(
          { user_id: userId, endpoint: existing.endpoint,
            p256dh: (existing.toJSON().keys as { p256dh: string }).p256dh,
            auth:   (existing.toJSON().keys as { auth: string }).auth,
            role, pole, user_agent: navigator.userAgent,
            last_seen_at: new Date().toISOString() },
          { onConflict: "endpoint" }
        );
        setNotifStatus("granted");
        setNotifMsg("Notifications activées !");
        return;
      }

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) { setNotifMsg("Clé VAPID manquante."); return; }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const { endpoint, keys } = subscription.toJSON() as {
        endpoint: string; keys: { p256dh: string; auth: string };
      };

      const { error } = await supabase.from("push_subscriptions").upsert(
        { user_id: userId, endpoint, p256dh: keys.p256dh, auth: keys.auth,
          role, pole, user_agent: navigator.userAgent },
        { onConflict: "endpoint" }
      );

      if (error) { setNotifMsg("Erreur enregistrement. Réessaie."); }
      else       { setNotifStatus("granted"); setNotifMsg("Notifications activées !"); }

    } catch (err) {
      console.error("[Push]", err);
      setNotifMsg("Une erreur est survenue.");
    } finally {
      setNotifLoading(false);
    }
  };

  // ── Désactiver les notifications
  const optOutNotifs = async () => {
    setNotifLoading(true);
    setNotifMsg("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Supprimer de Supabase
        await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
        // Révoquer la subscription côté navigateur
        await subscription.unsubscribe();
      }

      setNotifStatus("denied");
      setNotifMsg("Désabonnement effectué.");
    } catch (err) {
      console.error("[Push]", err);
      setNotifMsg("Erreur lors du désabonnement.");
    } finally {
      setNotifLoading(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div
        className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl overflow-hidden animate-slide-in-up sm:animate-badge-pop"
        style={{
          background: "linear-gradient(145deg, #0B1120, #0E1E38)",
          border: "1px solid rgba(43,80,160,0.3)",
          boxShadow: "0 -8px 60px rgba(0,0,0,0.6)",
        }}
      >
        {/* Barre déco */}
        <div className="h-1" style={{ background: "linear-gradient(90deg, transparent, #1B3A8C, #C49A28, transparent)" }} />

        {/* Poignée mobile */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
        </div>

        <div className="px-6 py-5">
          {/* En-tête */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              {step !== "menu" && (
                <button
                  onClick={() => { setPhoneError(""); setNotifMsg(""); setStep("menu"); }}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-opacity hover:opacity-70"
                  style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
                >←</button>
              )}
              <div>
                <p className="font-display text-base tracking-wider" style={{ color: "var(--text-main)" }}>
                  {prenom} {nom}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {step === "menu" ? "Mon profil" : step === "phone" ? "Modifier le téléphone" : "Notifications"}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-xs transition-opacity hover:opacity-70"
              style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
            >✕</button>
          </div>

          {/* ── MENU ── */}
          {step === "menu" && (
            <div className="space-y-2">
              <MenuItem
                icon="📱" label="Modifier mon numéro" sub={`Actuel : ${telephone}`}
                onClick={() => setStep("phone")}
              />
              <MenuItem
                icon="🔔" label="Notifications"
                sub={notifStatus === "granted" ? "Activées" : notifStatus === "denied" ? "Désactivées" : "Non configurées"}
                statusDot={notifStatus}
                onClick={() => setStep("notifs")}
              />
            </div>
          )}

          {/* ── TÉLÉPHONE ── */}
          {step === "phone" && (
            <div className="space-y-3">
              <PhoneInput label="Nouveau numéro" value={phone1} onChange={setPhone1} placeholder="06 12 34 56 78" />
              <PhoneInput label="Confirmer le numéro" value={phone2} onChange={setPhone2} placeholder="06 12 34 56 78" />
              {phoneError && <p className="text-xs px-1" style={{ color: "#F87171" }}>{phoneError}</p>}
              <button
                onClick={savePhone} disabled={phoneSaving || phoneSaved}
                className="w-full py-3 rounded-xl text-sm font-display tracking-widest mt-1 transition-all active:scale-95"
                style={{
                  background: phoneSaved ? "linear-gradient(135deg, #22c55e, #16a34a)" : "linear-gradient(135deg, #1B3A8C, #2952CC)",
                  color: "white", opacity: phoneSaving ? 0.6 : 1,
                  boxShadow: "0 4px 20px rgba(27,58,140,0.35)",
                }}
              >
                {phoneSaved ? "✓ ENREGISTRÉ" : phoneSaving ? "..." : "ENREGISTRER"}
              </button>
            </div>
          )}

          {/* ── NOTIFICATIONS ── */}
          {step === "notifs" && (
            <div className="space-y-3">
              <div className="rounded-xl p-4 flex items-center gap-3"
                style={{ background: "rgba(27,58,140,0.08)", border: "1px solid rgba(27,58,140,0.2)" }}>
                <span className="text-2xl">
                  {notifStatus === "granted" ? "🔔" : notifStatus === "denied" ? "🔕" : "❓"}
                </span>
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
                    {notifStatus === "granted" ? "Notifications activées"
                      : notifStatus === "denied" ? "Notifications désactivées"
                      : "Non encore configurées"}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {notifStatus === "granted" ? "Tu reçois les alertes du staff."
                      : notifStatus === "denied" ? "Tu ne reçois aucune notification."
                      : "Configure-les pour rester informé."}
                  </p>
                </div>
              </div>

              {/* Message de feedback */}
              {notifMsg && (
                <p className="text-xs text-center px-2" style={{ color: notifMsg.includes("!") ? "#4ade80" : "#F87171" }}>
                  {notifMsg}
                </p>
              )}

              {notifStatus !== "granted" && (
                <button
                  onClick={requestNotifs} disabled={notifLoading}
                  className="w-full py-3 rounded-xl text-sm font-display tracking-widest transition-all active:scale-95"
                  style={{
                    background: "linear-gradient(135deg, #1B3A8C, #2952CC)",
                    color: "white", opacity: notifLoading ? 0.6 : 1,
                    boxShadow: "0 4px 20px rgba(27,58,140,0.35)",
                  }}
                >
                  {notifLoading ? "..." : "ACTIVER LES NOTIFICATIONS"}
                </button>
              )}

              {notifStatus === "granted" && (
                <button
                  onClick={optOutNotifs} disabled={notifLoading}
                  className="w-full py-3 rounded-xl text-sm font-medium transition-all active:scale-95"
                  style={{ border: "1px solid rgba(248,113,113,0.3)", color: "#F87171", opacity: notifLoading ? 0.6 : 1 }}
                >
                  {notifLoading ? "..." : "Se désabonner"}
                </button>
              )}

              {notifStatus === "denied" && !notifMsg && (
                <p className="text-xs text-center px-2" style={{ color: "var(--text-muted)" }}>
                  Si tu les avais bloquées, va dans les réglages de ton appareil pour les réactiver.
                </p>
              )}
            </div>
          )}

          <div className="h-4 sm:h-0" />
        </div>
      </div>
    </div>
  );
}

// ── Sous-composants ────────────────────────────────────────────────────────────

function MenuItem({ icon, label, sub, statusDot, onClick }: {
  icon: string; label: string; sub: string; statusDot?: NotifStatus; onClick: () => void;
}) {
  const dotColor = statusDot === "granted" ? "#4ade80" : statusDot === "denied" ? "#f87171" : "#94a3b8";
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-left transition-all active:scale-[0.98]"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(27,58,140,0.1)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
    >
      <span className="text-xl w-8 text-center">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: "var(--text-main)" }}>{label}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {statusDot && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} />}
          <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{sub}</p>
        </div>
      </div>
      <span style={{ color: "var(--text-muted)", opacity: 0.5 }}>›</span>
    </button>
  );
}

function PhoneInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div>
      <label className="block text-xs mb-1.5 tracking-wider" style={{ color: "var(--text-muted)" }}>{label}</label>
      <input
        type="tel" inputMode="numeric" value={value}
        onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(43,80,160,0.3)", color: "var(--text-main)" }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(43,80,160,0.7)")}
        onBlur={(e)  => (e.currentTarget.style.borderColor = "rgba(43,80,160,0.3)")}
      />
    </div>
  );
}