// Bei jedem Deploy hochzaehlen -> zwingt alle Geraete zum Neuladen der App-Shell.
const CACHE_NAME = "bierlogger-v7";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .catch((err) => console.error("SW install cache.addAll failed:", err))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-First fuer die App-Shell: neue Version wird sofort angezeigt,
// Cache dient nur als Fallback wenn komplett offline.
// API-Aufrufe an Google Apps Script werden NIE gecacht -> jede Buchung
// geht garantiert live raus (oder schlaegt sauber fehl, statt gecacht zu werden).
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = req.url;

  if (url.includes("script.google.com")) {
    return; // nicht abfangen, direkt ans Netz durchreichen
  }

  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(req))
  );
});
