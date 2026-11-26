// Bumping this name purges every older cache on activate. Raise it whenever
// the caching rules below change — v1 cached the app shell cache-first, which
// left returning visitors on stale HTML pointing at deleted build chunks.
// v2 purges signed-in pages that v1 cached (shared phones could show the last
// user's page offline) and error responses.
const CACHE_NAME = "abugida-v2";

// Signed-in areas: never stored (a shared device must not show one user's
// page to the next), they are useless offline anyway — their data is all API.
const PRIVATE_PREFIXES = ["/student", "/play", "/teacher", "/secondary-teacher", "/school-admin", "/admin"];
const isPrivate = (path) => PRIVATE_PREFIXES.some((p) => path === p || path.startsWith(p + "/") || path.startsWith(p + "?"));

// Study-reminder notifications (push + notificationclick).
importScripts("/push-handlers.js");
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
  // Other sites (fonts, analytics, …) go straight to the network, untouched.
  if (url.origin !== self.location.origin) return;

  // ── API: network-first, with an explicit offline payload ──────────────────
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).catch(
        () =>
          // 503, not the default 200: callers check res.ok, and an "Offline"
          // body must not look like a successful answer.
          new Response(JSON.stringify({ error: "Offline", code: "OFFLINE" }), {
            status: 503,
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
          // Only good, public pages are kept for offline (never errors, never
          // a signed-in page).
          if (response.ok && !response.redirected && !isPrivate(url.pathname)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
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
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
    return;
  }

  // ── Everything else (icons, audio, manifest): cache-first, network fallback.
  event.respondWith(
    caches.match(request).then(
      // Offline, an image or a sound fails as a network error — not with the
      // offline HTML page in its place.
      (cached) => cached || fetch(request).catch(() => Response.error())
    )
  );
});
