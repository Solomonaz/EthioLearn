// Web push for study reminders. Imported by sw.js (production) and push-sw.js
// (development, where the caching worker is deliberately not registered).

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Abugida";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      tag: data.tag || "abugida",
      renotify: !!data.tag,
      data: { url: data.url || "/student" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/student", self.location.origin);
  // Only ever open our own site.
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === target.origin && "focus" in w) {
          return w.navigate(target.href).then((c) => (c || w).focus());
        }
      }
      return self.clients.openWindow(target.href);
    })
  );
});
