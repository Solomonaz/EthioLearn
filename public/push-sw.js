// Development-only worker: push notifications without the caching layer
// (which breaks Turbopack hot reload — see components/pwa-init.tsx).
importScripts("/push-handlers.js");
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
