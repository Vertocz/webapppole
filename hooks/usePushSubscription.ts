// hooks/usePushSubscription.ts
"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

type Role = "player" | "staff";
type Pole = "masculin" | "feminin" | "both";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

interface UsePushSubscriptionOptions {
  userId: string | null;
  role: Role;
  pole: Pole;
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

async function registerPush({ userId, role, pole }: { userId: string; role: Role; pole: Pole }) {
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

  // Subscription existante → juste rafraîchir last_seen_at
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    await supabase
      .from("push_subscriptions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("endpoint", existing.endpoint);
    return;
  }

  // Nouvelle subscription
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });

  const { endpoint, keys } = subscription.toJSON() as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };

  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id: userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, role, pole, user_agent: navigator.userAgent },
    { onConflict: "endpoint" }
  );

  if (error) console.error("[Push] Erreur enregistrement :", error.message);
  else console.info("[Push] Subscription enregistrée.");
}
