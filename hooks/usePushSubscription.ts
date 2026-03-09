// hooks/usePushSubscription.ts
"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

type Role = "player" | "staff";
type Pole = "masculin" | "feminin" | "both";

// Retourne un ArrayBuffer (strict) — requis par applicationServerKey
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const buffer  = new ArrayBuffer(rawData.length);
  const view    = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) view[i] = rawData.charCodeAt(i);
  return buffer;
}

interface UsePushSubscriptionOptions {
  userId: string | null;
  role:   Role;
  pole:   Pole;
}

export function usePushSubscription({ userId, role, pole }: UsePushSubscriptionOptions) {
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    registerPush({ userId, role, pole });
  }, [userId, role, pole]);
}

async function registerPush({
  userId,
  role,
  pole,
}: {
  userId: string;
  role:   Role;
  pole:   Pole;
}) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.info("[Push] Non supporté sur ce navigateur.");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    console.info("[Push] Permission refusée ou ignorée.");
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  const existing     = await registration.pushManager.getSubscription();

  if (existing) {
    // Subscription déjà enregistrée : met à jour role/pole au cas où ils ont changé.
    // ⚠️  On ne touche PAS à notif_seen_at ici — c'est géré exclusivement par
    //     NotificationsInbox après que l'utilisateur a lu ses messages.
    await supabase
      .from("push_subscriptions")
      .update({ role, pole })
      .eq("endpoint", existing.endpoint)
      .eq("user_id", userId);

    console.info("[Push] Subscription existante rafraîchie (role/pole).");
    return;
  }

  // ── Nouvelle subscription ────────────────────────────────────────────────
  const vapidKey     = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly:   true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });

  const { endpoint, keys } = subscription.toJSON() as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };

  // notif_seen_at est intentionnellement absent ici :
  // la DB le positionne à DEFAULT now() (= date de subscription).
  // L'inbox montrera toutes les notifs envoyées après cette date.
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id:    userId,
      endpoint,
      p256dh:     keys.p256dh,
      auth:       keys.auth,
      role,
      pole,
      user_agent: navigator.userAgent,
      // notif_seen_at → DEFAULT now() côté DB
    },
    { onConflict: "endpoint" }
  );

  if (error) console.error("[Push] Erreur enregistrement :", error.message);
  else       console.info("[Push] Nouvelle subscription enregistrée.");
}
