import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID!;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY!;

interface SendPayload {
  title: string;
  message: string;
  playerIds?: string[];
  url?: string;
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("x-internal-key");
  if (auth !== process.env.INTERNAL_CRON_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: SendPayload = await req.json();
  const { title, message, playerIds, url } = body;

  const payload: Record<string, unknown> = {
    app_id: ONESIGNAL_APP_ID,
    headings: { fr: title, en: title },
    contents: { fr: message, en: message },
    url: url ?? "/",
  };

  if (playerIds && playerIds.length > 0) {
    payload.include_aliases = { external_id: playerIds };
    payload.target_channel = "push";
  } else {
    payload.included_segments = ["All"];
  }

  const res = await fetch("https://onesignal.com/api/v1/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Key ${ONESIGNAL_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) return NextResponse.json({ error: data }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}
