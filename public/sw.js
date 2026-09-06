// Bumping this name purges every older cache on activate. Raise it whenever
// the caching rules below change — v1 cached the app shell cache-first, which
// left returning visitors on stale HTML pointing at deleted build chunks.
const CACHE_NAME = "ethiolearn-v2";
const OFFLINE_URL = "/offline";
const STATIC_ASSETS = ["/offline", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only GETs are cacheable; let everything else straight through.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // ── API: network-first, with an explicit offline payload ──────────────────
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(JSON.stringify({ error: "Offline" }), {
            headers: { "Content-Type": "application/json" },
          })
      )
    );
    return;
  }

  // ── Page loads: network-first ─────────────────────────────────────────────
  // Never serve HTML from cache while online. The HTML names the build's JS
  // chunks, so a stale copy asks for chunk files that no longer exist after a
  // deploy and the app dies with ChunkLoadError. Cache is the offline path only.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || (await caches.match(OFFLINE_URL)) || Response.error();
        })
    );
    return;
  }

  // ── Build assets: cache-first ─────────────────────────────────────────────
  // Safe because these filenames are content-hashed — a changed file gets a new
  // name, so a cache hit is always the right bytes.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
    return;
  }

  // ── Everything else (icons, audio, manifest): cache-first, network fallback.
  event.respondWith(
    caches.match(request).then(
      (cached) => cached || fetch(request).catch(() => caches.match(OFFLINE_URL))
    )
  );
});
