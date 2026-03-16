import { NextRequest, NextResponse } from "next/server";

const SNCF_KEY = process.env.SNCF_API_KEY ?? "";
const BASE     = "https://api.sncf.com/v1/coverage/sncf";

export async function GET(req: NextRequest) {
  const from       = req.nextUrl.searchParams.get("from");
  const to         = req.nextUrl.searchParams.get("to");
  const datetime   = req.nextUrl.searchParams.get("datetime"); // YYYYMMDDTHHmmss
  const represents = req.nextUrl.searchParams.get("represents") ?? "arrival"; // arrival | departure

  if (!from || !to || !datetime)
    return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });

  const url = `${BASE}/journeys?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&datetime=${datetime}&datetime_represents=${represents}&count=5&min_nb_journeys=3`;

  const res = await fetch(url, {
    headers: {
      Authorization: "Basic " + Buffer.from(SNCF_KEY + ":").toString("base64"),
    },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: text, status: res.status }, { status: 502 });
  }

  const data = await res.json();
  return NextResponse.json(data);
}