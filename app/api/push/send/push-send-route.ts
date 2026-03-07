// app/api/push/send/route.ts
import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Pole = "masculin" | "feminin" | "both";
type TargetRole = "player" | "staff";

interface SendPushPayload {
  staff_id:      string;
  title:         string;
  body:          string;
  url?:          string;
  icon?:         string;
  target_pole?:  Pole;        // undefined = pôle du staff (ou tous si "both")
  target_role?:  TargetRole;  // undefined = joueurs + staff
  target_users?: string[];    // UUID[] — si renseigné, ignore target_role
}

export async function POST(req: NextRequest) {
  const payload: SendPushPayload = await req.json();
  const { staff_id, title, body, url = "/", icon = "/icon-192.png" } = payload;

  if (!staff_id || !title?.trim() || !body?.trim()) {
    return NextResponse.json({ error: "staff_id, title et body sont requis" }, { status: 400 });
  }

  // 1. Vérifier que le staff existe et récupérer son pôle
  const { data: staffMember, error: staffError } = await supabaseAdmin
    .from("staff")
    .select("id, masculin, feminin")
    .eq("id", staff_id)
    .single();

  if (staffError || !staffMember) {
    return NextResponse.json({ error: "Staff non trouvé" }, { status: 403 });
  }

  const senderPole: Pole =
    staffMember.masculin && staffMember.feminin ? "both"
    : staffMember.masculin ? "masculin"
    : "feminin";

  // Le pôle effectif = ce que le staff a sélectionné, dans la limite de son scope
  // Si target_pole est fourni, on vérifie que le staff y a accès
  let effectivePole: Pole = senderPole;
  if (payload.target_pole) {
    // Un staff "both" peut cibler n'importe quel pôle
    // Un staff mono-pôle ne peut cibler que le sien
    if (senderPole === "both" || payload.target_pole === senderPole) {
      effectivePole = payload.target_pole;
    }
    // Sinon on ignore silencieusement et on utilise le pôle du staff
  }

  // 2. Construire la requête de ciblage
  let query = supabaseAdmin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth");

  // Filtre par pôle
  if (effectivePole !== "both") {
    query = query.in("pole", [effectivePole, "both"]);
  }

  // Ciblage par utilisateurs spécifiques
  if (payload.target_users?.length) {
    query = query.in("user_id", payload.target_users);
  }
  // Sinon par rôle
  else if (payload.target_role) {
    query = query.eq("role", payload.target_role);
  }

  const { data: subscriptions, error: fetchError } = await query;

  if (fetchError) {
    console.error("[Push] Erreur récupération subscriptions :", fetchError.message);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }

  if (!subscriptions?.length) {
    return NextResponse.json({ message: "Aucun destinataire", sent: 0, total: 0 });
  }

  // 3. Envoi en parallèle
  const notifPayload = JSON.stringify({ title, body, url, icon });
  const expiredEndpoints: string[] = [];

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          notifPayload
        );
      } catch (err: unknown) {
        if ((err as { statusCode?: number }).statusCode === 410) {
          expiredEndpoints.push(sub.endpoint);
        }
        throw err;
      }
    })
  );

  // 4. Nettoyer les endpoints expirés
  if (expiredEndpoints.length) {
    await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .in("endpoint", expiredEndpoints);
  }

  const successCount = results.filter((r) => r.status === "fulfilled").length;

  // 5. Historique
  await supabaseAdmin.from("push_notifications").insert({
    sent_by:          staff_id,
    title,
    body,
    url,
    icon,
    target_pole:      effectivePole !== "both" ? effectivePole : null,
    target_role:      payload.target_role ?? null,
    target_users:     payload.target_users ?? null,
    recipients_count: successCount,
  });

  return NextResponse.json({ success: true, sent: successCount, total: subscriptions.length });
}