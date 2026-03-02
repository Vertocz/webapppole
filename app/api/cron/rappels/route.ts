import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Force dynamic — empêche Next.js d'exécuter ce module au build
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest) {
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${process.env.CRON_SECRET}`;
}

async function sendNotif(
  baseUrl: string,
  cronKey: string,
  playerIds: string[],
  title: string,
  message: string,
  url: string
) {
  if (playerIds.length === 0) return;
  await fetch(`${baseUrl}/api/notifications/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-key": cronKey },
    body: JSON.stringify({ title, message, playerIds, url }),
  });
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Init à l'intérieur du handler — les env vars sont dispo à runtime, pas au build
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://polefrance.vercel.app";
  const cronKey = process.env.INTERNAL_CRON_KEY!;

  const now = new Date();
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const seuil7j  = fmt(new Date(now.getTime() - 7  * 86400000));
  const seuil15j = fmt(new Date(now.getTime() - 15 * 86400000));
  const seuil30j = fmt(new Date(now.getTime() - 30 * 86400000));

  const { data: joueurs } = await supabaseAdmin.from("joueuses").select("id, prenom");
  if (!joueurs) return NextResponse.json({ ok: true, skipped: "no players" });

  const rappelsSportif:  string[] = [];
  const rappelsForme:    string[] = [];
  const rappelsEmotions: string[] = [];

  for (const j of joueurs) {
    const { data: sportif } = await supabaseAdmin
      .from("activites").select("id").eq("joueuse_id", j.id).gte("date", seuil7j).limit(1);
    if (!sportif || sportif.length === 0) rappelsSportif.push(j.id);

    const { data: forme } = await supabaseAdmin
      .from("suivi_forme").select("id").eq("joueuse_id", j.id).gte("date", seuil15j).limit(1);
    if (!forme || forme.length === 0) rappelsForme.push(j.id);

    const { data: emotions } = await supabaseAdmin
      .from("suivi_emotions").select("id").eq("joueur_id", j.id).gte("date", seuil30j).limit(1);
    if (!emotions || emotions.length === 0) rappelsEmotions.push(j.id);
  }

  await sendNotif(baseUrl, cronKey, rappelsSportif,
    "⛹️ Suivi sportif",
    "Tu n'as pas enregistré de séance depuis plus d'une semaine. C'est le moment !",
    "/player"
  );
  await sendNotif(baseUrl, cronKey, rappelsForme,
    "🧘 Forme quotidienne",
    "Ça fait 2 semaines que tu n'as pas rempli ton suivi du jour. 2 minutes suffisent !",
    "/player"
  );
  await sendNotif(baseUrl, cronKey, rappelsEmotions,
    "💭 Suivi émotions",
    "Ce mois-ci tu n'as pas encore fait ton scan émotionnel. Prends 5 minutes pour toi.",
    "/player"
  );

  return NextResponse.json({
    ok: true,
    rappelsSportif: rappelsSportif.length,
    rappelsForme: rappelsForme.length,
    rappelsEmotions: rappelsEmotions.length,
  });
}
