/* Build replaces these declarations with a content-addressed shell manifest. */
const PRECACHE = []; // ledger-precache
const CACHE_NAME = "ledger-shell-runtime-v1"; // ledger-version
const SHELL = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE.length ? PRECACHE : [SHELL, "/manifest.webmanifest"]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      const updating = names.some((name) => name.startsWith("ledger-shell-") && name !== CACHE_NAME);
      await Promise.all(
        names
          .filter((name) => name.startsWith("ledger-shell-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
      if (updating) {
        for (const client of await self.clients.matchAll({ type: "window" })) {
          client.postMessage({ type: "LEDGER_SW_UPDATED" });
        }
      }
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const response = await fetch(request);
          if (response.ok) {
            await cache.put(SHELL, response.clone());
            return response;
          }
          return (await cache.match(SHELL)) ?? response;
        } catch (error) {
          const cached = await cache.match(SHELL);
          if (cached) return cached;
          throw error;
        }
      })(),
    );
    return;
  }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/static/") || PRECACHE.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      })(),
    );
  }
});
