// public/sw.js
// ─── ParaBasket PWA — Cache, Offline & Push natif ────────────────────────────

const CACHE_VERSION = "v4";
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

  if (request.method !== "GET") return;
  if (url.protocol === "chrome-extension:") return;

  // 1. Toujours réseau : Supabase + API internes
  if (
    url.hostname.includes("supabase.co") ||
    url.pathname.startsWith("/api/")
  ) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: "offline" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    return;
  }

  // 2. Stale-while-revalidate pour les assets Next.js
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image")
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 3. Network-first avec fallback offline pour les pages HTML
  if (request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkFirstWithOfflineFallback(request));
    return;
  }

  // 4. Cache-first pour tout le reste
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
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response("Ressource indisponible hors ligne", { status: 503 });
  }
}

// ─── Réception d'une notification push ───────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "ParaBasket", body: event.data.text(), url: "/", icon: "/icon-192.png" };
  }

  const { title, body, url = "/", icon = "/icon-192.png", id } = data;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: "/icon-192.png",
      data: { url, id },   // on stocke l'id dans data
      vibrate: [200, 100, 200],
    })
  );
});

// ─── Clic sur une notification ────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const { url = "/", id } = event.notification.data ?? {};

  // Si on a un id, on l'ajoute en query param pour que l'app ouvre la modale
  const targetUrl = id ? `${url}?notif_id=${id}` : url;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((c) => c.url.includes(self.location.origin));
        if (existing) {
          existing.focus();
          existing.navigate(targetUrl);
          return;
        }
        return self.clients.openWindow(targetUrl);
      })
  );
});
