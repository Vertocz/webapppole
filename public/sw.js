// Service Worker — ParaBasket PWA
const CACHE_NAME = "parabasket-v1";

// Ressources à mettre en cache lors de l'installation
const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/logo.png",
  "/icon-192.png",
  "/icon-512.png",
];

// Installation : mise en cache des assets statiques
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activation : nettoyage des anciens caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch : network-first pour les requêtes API/Supabase, cache-first pour les assets
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Toujours réseau pour Supabase et les API
  if (
    url.hostname.includes("supabase.co") ||
    url.pathname.startsWith("/api/")
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache-first pour les assets statiques
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Mettre en cache les nouvelles ressources statiques
        if (response.ok && event.request.method === "GET") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached ?? new Response("Hors ligne", { status: 503 }));
    })
  );
});
