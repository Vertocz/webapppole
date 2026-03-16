import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const VAPID_PUBLIC_KEY  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT!;
const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

export async function POST(req: NextRequest) {
  const { user_id, quai, gare_depart, numero_train, heure_depart } = await req.json();
  if (!user_id || !quai) return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });

  // Récupérer la/les subscription(s) du joueur
  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", user_id)
    .eq("opted_out", false);

  if (!subs?.length) return NextResponse.json({ sent: 0 });

  const payload = JSON.stringify({
    title: `🚉 Voie ${quai}`,
    body:  `Départ ${heure_depart?.slice(0, 5)} → voie ${quai}`,
    url:   "/player",
    icon:  "/icon-192.png",
  });

  const expiredEndpoints: string[] = [];
  await Promise.allSettled(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    } catch (err: unknown) {
      if ((err as { statusCode?: number }).statusCode === 410) expiredEndpoints.push(sub.endpoint);
    }
  }));

  if (expiredEndpoints.length) {
    await supabaseAdmin.from("push_subscriptions").delete().in("endpoint", expiredEndpoints);
  }

  return NextResponse.json({ sent: subs.length - expiredEndpoints.length });
}
