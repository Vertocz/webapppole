// app/api/push/send/route.ts
import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// ── Vérification des variables d'environnement au démarrage
const VAPID_SUBJECT    = process.env.VAPID_SUBJECT;
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log("[Push Init] VAPID_SUBJECT:", VAPID_SUBJECT ? "✓" : "✗ MANQUANT");
console.log("[Push Init] VAPID_PUBLIC_KEY:", VAPID_PUBLIC_KEY ? "✓" : "✗ MANQUANT");
console.log("[Push Init] VAPID_PRIVATE_KEY:", VAPID_PRIVATE_KEY ? "✓" : "✗ MANQUANT");
console.log("[Push Init] SUPABASE_URL:", SUPABASE_URL ? "✓" : "✗ MANQUANT");
console.log("[Push Init] SERVICE_ROLE_KEY:", SERVICE_ROLE_KEY ? "✓" : "✗ MANQUANT");

if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error("[Push Init] Variables VAPID manquantes — web-push non initialisé");
} else {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const supabaseAdmin = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  : null;

type Pole = "masculin" | "feminin" | "both";
type TargetRole = "player" | "staff";

interface SendPushPayload {
  staff_id:      string;
  title:         string;
  body:          string;
  url?:          string;
  icon?:         string;
  target_pole?:  Pole;
  target_role?:  TargetRole;
  target_users?: string[];
}

export async function POST(req: NextRequest) {
  console.log("[Push] POST reçu");

  // Vérifications initiales
  if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error("[Push] Variables VAPID manquantes");
    return NextResponse.json({ error: "Configuration VAPID manquante" }, { status: 500 });
  }
  if (!supabaseAdmin) {
    console.error("[Push] Supabase admin non initialisé");
    return NextResponse.json({ error: "Configuration Supabase manquante" }, { status: 500 });
  }

  let payload: SendPushPayload;
  try {
    payload = await req.json();
    console.log("[Push] Payload reçu:", JSON.stringify({ ...payload, staff_id: "***" }));
  } catch (e) {
    console.error("[Push] Erreur parsing JSON:", e);
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const { staff_id, title, body, url = "/", icon = "/icon-192.png" } = payload;

  if (!staff_id || !title?.trim() || !body?.trim()) {
    return NextResponse.json({ error: "staff_id, title et body sont requis" }, { status: 400 });
  }

  // 1. Vérifier le staff
  console.log("[Push] Recherche staff:", staff_id);
  const { data: staffMember, error: staffError } = await supabaseAdmin
    .from("staff")
    .select("id, masculin, feminin")
    .eq("id", staff_id)
    .single();

  if (staffError || !staffMember) {
    console.error("[Push] Staff non trouvé:", staffError?.message);
    return NextResponse.json({ error: "Staff non trouvé" }, { status: 403 });
  }
  console.log("[Push] Staff trouvé:", staffMember);

  const senderPole: Pole =
    staffMember.masculin && staffMember.feminin ? "both"
    : staffMember.masculin ? "masculin"
    : "feminin";

  let effectivePole: Pole = senderPole;
  if (payload.target_pole) {
    if (senderPole === "both" || payload.target_pole === senderPole) {
      effectivePole = payload.target_pole;
    }
  }
  console.log("[Push] Pôle effectif:", effectivePole);

  // 2. Requête subscriptions
  let query = supabaseAdmin.from("push_subscriptions").select("endpoint, p256dh, auth");
  if (effectivePole !== "both") query = query.in("pole", [effectivePole, "both"]);
  if (payload.target_users?.length) query = query.in("user_id", payload.target_users);
  else if (payload.target_role)     query = query.eq("role", payload.target_role);

  const { data: subscriptions, error: fetchError } = await query;
  if (fetchError) {
    console.error("[Push] Erreur fetch subscriptions:", fetchError.message);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }

  console.log("[Push] Subscriptions trouvées:", subscriptions?.length ?? 0);

  if (!subscriptions?.length) {
    return NextResponse.json({ message: "Aucun destinataire", sent: 0, total: 0 });
  }

  // 3. Envoi
  const notifPayload = JSON.stringify({ title, body, url, icon });
  const expiredEndpoints: string[] = [];

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          notifPayload
        );
        console.log("[Push] Envoyé à:", sub.endpoint.slice(0, 50) + "...");
      } catch (err: unknown) {
        console.error("[Push] Erreur envoi:", (err as { statusCode?: number; message?: string }).statusCode, (err as { message?: string }).message);
        if ((err as { statusCode?: number }).statusCode === 410) {
          expiredEndpoints.push(sub.endpoint);
        }
        throw err;
      }
    })
  );

  if (expiredEndpoints.length) {
    await supabaseAdmin.from("push_subscriptions").delete().in("endpoint", expiredEndpoints);
    console.log("[Push] Subscriptions expirées supprimées:", expiredEndpoints.length);
  }

  const successCount = results.filter((r) => r.status === "fulfilled").length;
  console.log("[Push] Résultat:", successCount, "/", subscriptions.length);

  await supabaseAdmin.from("push_notifications").insert({
    sent_by:          staff_id,
    title, body, url, icon,
    target_pole:      effectivePole !== "both" ? effectivePole : null,
    target_role:      payload.target_role ?? null,
    target_users:     payload.target_users ?? null,
    recipients_count: successCount,
  });

  return NextResponse.json({ success: true, sent: successCount, total: subscriptions.length });
}