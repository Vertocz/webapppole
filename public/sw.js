// public/sw.js
// ─── ParaBasket PWA — Cache, Hors ligne & Push natif ─────────────────────────
//
// La version est passée à l'enregistrement (/sw.js?v=<commit>) : chaque
// déploiement installe un nouveau service worker et vide l'ancien cache,
// sans avoir à changer un numéro à la main.
//
// Caches :
//   parabasket-v-<version>  pages, JS/CSS Next.js, assets précachés (vidé à chaque version)
//   parabasket-images       images (gardées d'une version à l'autre, taille limitée)
//   parabasket-fonts        polices Google
//   parabasket-billets      PDF des billets, gérés par l'app (lib/offline.ts)
//   parabasket-media        audios de respiration, gérés par l'app

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE_NAME = `parabasket-v-${VERSION}`;
const IMAGES_CACHE = "parabasket-images";
const FONTS_CACHE = "parabasket-fonts";
const BILLETS_CACHE = "parabasket-billets";

const MAX_IMAGES = 200;
const NAVIGATION_TIMEOUT_MS = 4000;

const PRECACHE = [
  "/",
  "/player",
  "/staff",
  "/offline.html",
  "/manifest.json",
  "/logo.png",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

// Images de la prépa mentale : petites, utilisées hors ligne
const PRECACHE_IMAGES = [
  "/emotions/calme.png", "/emotions/concentre.png", "/emotions/creatif.png",
  "/emotions/degoute.png", "/emotions/epuise.png", "/emotions/fort.png",
  "/emotions/frustre.png", "/emotions/inquiet.png", "/emotions/joyeux.png",
  "/emotions/motive.png",
  "/options/arbitre.png", "/options/bulle.png", "/options/discours.png",
  "/options/equipe.png", "/options/erreur.png", "/options/panier.png",
  "/options/respiration.jpg", "/options/trop_plein.png", "/options/visualisation.png",
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  const addAll = (cacheName, urls) =>
    caches.open(cacheName).then((cache) =>
      Promise.allSettled(
        urls.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() =>
            console.warn(`[SW] non mis en cache : ${url}`)
          )
        )
      )
    );

  event.waitUntil(
    Promise.all([addAll(CACHE_NAME, PRECACHE), addAll(IMAGES_CACHE, PRECACHE_IMAGES)]).then(() =>
      self.skipWaiting()
    )
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
            // anciennes versions (y compris l'ancien format "parabasket-v4")
            .filter((k) => /^parabasket-v(\d+$|-)/.test(k) && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Billets PDF : la copie locale d'abord (indispensable sans réseau)
  if (url.hostname.endsWith("supabase.co") && url.pathname.includes("/storage/v1/object/public/Billets/")) {
    event.respondWith(
      caches.open(BILLETS_CACHE).then((cache) =>
        cache.match(request.url).then((hit) => hit || fetch(request))
      )
    );
    return;
  }

  // Polices Google
  if (url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(request, FONTS_CACHE));
    return;
  }
  if (url.hostname === "fonts.googleapis.com") {
    event.respondWith(staleWhileRevalidate(request, FONTS_CACHE));
    return;
  }

  // Le reste des requêtes externes (API Supabase, temps réel…) : pas d'interception.
  // Le cache hors ligne des données est géré dans l'app (lib/supabase.ts).
  if (url.origin !== self.location.origin) return;

  // API internes : toujours le réseau
  if (url.pathname.startsWith("/api/")) return;

  // Fichiers Next.js versionnés (hash dans le nom) : immuables
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  // Navigation (ouverture d'une page)
  if (request.mode === "navigate") {
    event.respondWith(navigationHandler(request));
    return;
  }

  // Données de navigation Next.js (RSC)
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) {
    event.respondWith(networkFirst(request, CACHE_NAME));
    return;
  }

  // Images et autres fichiers statiques
  if (request.destination === "image" || /\.(png|jpe?g|webp|svg|gif|ico)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, IMAGES_CACHE, MAX_IMAGES));
    return;
  }

  event.respondWith(networkFirst(request, CACHE_NAME));
});

// ─── Stratégies de cache ──────────────────────────────────────────────────────

async function trim(cache, max) {
  if (!max) return;
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function put(cacheName, request, response, max) {
  if (!response || !response.ok || response.type === "opaque") return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
  await trim(cache, max);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    put(cacheName, request, response.clone());
    return response;
  } catch {
    return new Response("Ressource indisponible hors ligne", { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      put(cacheName, request, response.clone(), max);
      return response;
    })
    .catch(() => null);
  return cached || (await network) || new Response("", { status: 503 });
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    put(cacheName, request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || Response.error();
  }
}

/** Réseau d'abord, mais pas plus de quelques secondes : sinon la page en cache. */
async function navigationHandler(request) {
  const cache = await caches.open(CACHE_NAME);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });

  const fromCache = () =>
    cache.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match(request, { ignoreSearch: true }));

  const timeout = new Promise((resolve) => setTimeout(resolve, NAVIGATION_TIMEOUT_MS, "timeout"));

  try {
    const first = await Promise.race([network, timeout]);
    if (first !== "timeout") return first;
    const cached = await fromCache();
    if (cached) {
      network.catch(() => {});
      return cached;
    }
    return await network;
  } catch {
    const cached = await fromCache();
    if (cached) return cached;
    const offline = await cache.match("/offline.html");
    return (
      offline ||
      new Response("<h1>Hors ligne</h1>", { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } })
    );
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
      data: { url, id }, // on stocke l'id dans data
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
