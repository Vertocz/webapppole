import { NextRequest, NextResponse } from "next/server";

const SNCF_KEY = process.env.SNCF_API_KEY ?? "";
const BASE     = "https://api.sncf.com/v1/coverage/sncf";

// Résolution gare → stop_area id
async function resolveStopArea(gare: string): Promise<string | null> {
  const url = `${BASE}/places?q=${encodeURIComponent(gare)}&type[]=stop_area&count=1`;
  const res  = await fetch(url, {
    headers: { Authorization: "Basic " + Buffer.from(SNCF_KEY + ":").toString("base64") },
    next: { revalidate: 3600 },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.places?.[0]?.id ?? null;
}

export async function GET(req: NextRequest) {
  const gare        = req.nextUrl.searchParams.get("gare");
  const numero      = req.nextUrl.searchParams.get("numero");
  const date        = req.nextUrl.searchParams.get("date");        // YYYY-MM-DD
  const heure       = req.nextUrl.searchParams.get("heure");       // HH:MM:SS

  if (!gare || !numero || !date || !heure)
    return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });

  const stopId = await resolveStopArea(gare);
  if (!stopId)
    return NextResponse.json({ error: `Gare "${gare}" introuvable` }, { status: 404 });

  // Chercher les départs 30min avant → 30min après l'heure du train
  const [h, m] = heure.split(":");
  const datetime = `${date.replace(/-/g, "")}T${h}${m}00`;

  // On prend 30 résultats autour de l'heure
  const url = `${BASE}/stop_areas/${encodeURIComponent(stopId)}/departures?from_datetime=${datetime}&count=50&data_freshness=realtime`;

  const res = await fetch(url, {
    headers: { Authorization: "Basic " + Buffer.from(SNCF_KEY + ":").toString("base64") },
    next: { revalidate: 0 }, // toujours temps réel
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: text }, { status: 502 });
  }

  const data = await res.json();
  const departures = data.departures ?? [];

  // Trouver le train correspondant au numéro
  const match = departures.find((d: {
    display_informations?: { headsign?: string; trip_short_name?: string };
    stop_date_time?: { departure_date_time?: string; platform?: string };
  }) => {
    const headsign = d.display_informations?.headsign ?? "";
    const tripName = d.display_informations?.trip_short_name ?? "";
    return headsign === numero || tripName === numero ||
           headsign.includes(numero) || tripName.includes(numero);
  });

  if (!match)
    return NextResponse.json({ quai: null, found: false });

  const quai = match.stop_date_time?.platform ?? null;
  return NextResponse.json({
    found: true,
    quai,
    heure_depart_realtime: match.stop_date_time?.departure_date_time ?? null,
    perturbation: match.stop_date_time?.data_freshness === "realtime"
      ? (match.stop_date_time?.departure_status ?? null)
      : null,
  });
}
