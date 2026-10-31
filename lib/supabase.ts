import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://fxvotvtapcwzvjhfreqv.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4dm90dnRhcGN3enZqaGZyZXF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5ODU0MzMsImV4cCI6MjA3NzU2MTQzM30.-GHrLdGYicmtN2lx8MYkQlrnWKcxrcARp_tY6Cno3RQ";

// ─── fetch avec cache hors ligne ─────────────────────────────────────────────
// Les lectures (GET /rest/v1/…) sont mémorisées dans IndexedDB. Sans réseau,
// ou si le réseau met trop de temps à répondre, la dernière réponse connue est
// renvoyée : toute l'app reste consultable hors ligne sans modifier chaque écran.

/** Délai au-delà duquel on sert le cache (le réseau continue en arrière-plan). */
const SLOW_NETWORK_MS = 6000;

function requestInfo(input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  return { url, method, accept: headers.get("accept") ?? "" };
}

async function cachingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { url, method, accept } = requestInfo(input, init);
  const cacheable =
    typeof window !== "undefined" && method === "GET" && url.includes("/rest/v1/");
  if (!cacheable) return fetch(input, init);

  const { getCachedResponse, putCachedResponse } = await import("./offline");
  const key = `${accept}|${url}`;

  const fromCache = async (): Promise<Response | null> => {
    const hit = await getCachedResponse(key);
    if (!hit) return null;
    const headers = new Headers(hit.headers);
    headers.set("x-parabasket-cache", String(hit.ts));
    return new Response(hit.body, { status: hit.status, headers });
  };

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const cached = await fromCache();
    if (cached) return cached;
  }

  const network = fetch(input, init).then(async (res) => {
    if (res.ok) {
      const body = await res.clone().text();
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        if (k === "content-type" || k === "content-range") headers[k] = v;
      });
      putCachedResponse({ key, status: res.status, body, headers });
    }
    return res;
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<"slow">((resolve) => { timer = setTimeout(() => resolve("slow"), SLOW_NETWORK_MS); });

  try {
    const first = await Promise.race([network, slow]);
    if (first === "slow") {
      const cached = await fromCache();
      if (cached) {
        network.catch(() => {}); // la réponse fraîche mettra le cache à jour
        return cached;
      }
      return await network;
    }
    if (first.status >= 500) return (await fromCache()) ?? first;
    return first;
  } catch (err) {
    const cached = await fromCache();
    if (cached) return cached;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: cachingFetch },
});

export const SUPABASE_URL = supabaseUrl;
