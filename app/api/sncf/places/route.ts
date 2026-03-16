import { NextRequest, NextResponse } from "next/server";

const SNCF_KEY = process.env.SNCF_API_KEY ?? "";
const BASE     = "https://api.sncf.com/v1/coverage/sncf";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q) return NextResponse.json({ places: [] });

  const url = `${BASE}/places?q=${encodeURIComponent(q)}&type[]=stop_area&count=8`;
  const res = await fetch(url, {
    headers: {
      Authorization: "Basic " + Buffer.from(SNCF_KEY + ":").toString("base64"),
    },
    next: { revalidate: 3600 },
  });

  if (!res.ok) return NextResponse.json({ error: "SNCF API error", status: res.status }, { status: 502 });
  const data = await res.json();
  return NextResponse.json(data);
}