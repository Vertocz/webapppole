// Notification push "tu as reçu une proposition d'échange Victorinis"
// Sécurité : on ne reçoit qu'un id de proposition ; le titre, le texte et le destinataire
// sont relus en base, et chaque proposition ne peut notifier qu'une seule fois.
import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VAPID_SUBJECT = process.env.VAPID_SUBJECT;
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (VAPID_SUBJECT && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const supabaseAdmin =
  SUPABASE_URL && SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;

export async function POST(req: NextRequest) {
  if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !supabaseAdmin) {
    return NextResponse.json({ error: "Configuration manquante" }, { status: 500 });
  }

  let echangeId: string | undefined;
  try {
    echangeId = (await req.json())?.echange_id;
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }
  if (!echangeId || typeof echangeId !== "string") {
    return NextResponse.json({ error: "echange_id requis" }, { status: 400 });
  }

  // On "réclame" la notification de façon atomique : une seule fois par proposition
  const { data: echange } = await supabaseAdmin
    .from("victorinis_echanges")
    .update({ notifie: true })
    .eq("id", echangeId)
    .eq("notifie", false)
    .eq("statut", "en_attente")
    .select("de_id, de_type, a_id")
    .maybeSingle();

  if (!echange) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const table = echange.de_type === "staff" ? "staff" : "joueuses";
  const { data: proposeur } = await supabaseAdmin
    .from(table)
    .select("prenom")
    .eq("id", echange.de_id)
    .maybeSingle();

  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", echange.a_id);

  if (!subs?.length) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const payload = JSON.stringify({
    title: "🃏 Proposition d'échange",
    body: `${proposeur?.prenom ?? "Quelqu'un"} te propose un échange de cartes Victorinis !`,
    url: "/",
    icon: "/icon-192.png",
  });

  const expired: string[] = [];
  const results = await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        );
      } catch (err) {
        if ((err as { statusCode?: number }).statusCode === 410) expired.push(s.endpoint);
        throw err;
      }
    })
  );

  if (expired.length) {
    await supabaseAdmin.from("push_subscriptions").delete().in("endpoint", expired);
  }

  return NextResponse.json({
    ok: true,
    sent: results.filter((r) => r.status === "fulfilled").length,
  });
}
