// ─── OneSignal — doit être importé EN PREMIER pour que les push fonctionnent ───
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDKWorker.js");

// ─── ParaBasket PWA — Cache & Offline ────────────────────────────────────────
const CACHE_VERSION = "v2";
const CACHE_NAME = `parabasket-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/logo.png",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/offline.html",
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        // addAll échoue silencieusement sur les assets manquants
        Promise.allSettled(
          STATIC_ASSETS.map((url) =>
            cache.add(url).catch(() => console.warn(`[SW] asset non mis en cache : ${url}`))
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("parabasket-") && k !== CACHE_NAME)
            .map((k) => {
              console.log(`[SW] Suppression ancien cache : ${k}`);
              return caches.delete(k);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorer les requêtes non-GET et les extensions Chrome
  if (request.method !== "GET") return;
  if (url.protocol === "chrome-extension:") return;

  // 1. TOUJOURS réseau : Supabase, API internes, OneSignal
  if (
    url.hostname.includes("supabase.co") ||
    url.hostname.includes("onesignal.com") ||
    url.pathname.startsWith("/api/")
  ) {
    event.respondWith(
      fetch(request).catch(() => new Response(JSON.stringify({ error: "offline" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }))
    );
    return;
  }

  // 2. Stale-while-revalidate pour les pages Next.js (_next/static inclus)
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image")
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 3. Network-first avec fallback cache pour les pages HTML
  if (request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkFirstWithOfflineFallback(request));
    return;
  }

  // 4. Cache-first pour tout le reste (assets statiques, images, fonts)
  event.respondWith(cacheFirst(request));
});

// ─── Stratégies de cache ──────────────────────────────────────────────────────

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });

  return cached || fetchPromise;
}

async function networkFirstWithOfflineFallback(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Page offline personnalisée
    const offline = await cache.match("/offline.html");
    return offline || new Response("<h1>Hors ligne</h1>", {
      status: 503,
      headers: { "Content-Type": "text/html" },
    });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && request.method === "GET") {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Ressource indisponible hors ligne", { status: 503 });
  }
}

// ─── Clic sur une notification push ──────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Si l'app est déjà ouverte → focus + navigation
        const existing = clients.find((c) => c.url.includes(self.location.origin));
        if (existing) {
          existing.focus();
          existing.navigate(targetUrl);
          return;
        }
        // Sinon → ouvrir une nouvelle fenêtre
        return self.clients.openWindow(targetUrl);
      })
  );
});
