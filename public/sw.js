/*
 * Mise service worker: keeps the app usable with no connection.
 *
 * - Page loads: network first, falling back to the cached page, so a deploy is
 *   picked up at once but the app still opens in a shop with no signal.
 * - Hashed build files, fonts, icons and sample pictures (including the resized
 *   copies the image optimiser serves): cache first, since their URLs change
 *   when their contents do. The nutrition table is compiled into those build
 *   files, so it is cached with them.
 * - API calls are never cached or intercepted. A plan the visitor already has
 *   is kept in localStorage by the page itself.
 */
const VERSION = "mise-v2";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isStatic(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/_next/image" ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/samples/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/icon.png" ||
    url.pathname === "/apple-icon.png"
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put("/", response.clone());
    return response;
  } catch {
    const cached = await cache.match("/");
    if (cached) return cached;
    throw new Error("offline and not cached");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  // Prefetch and RSC requests carry special headers; let the framework handle those itself.
  if (request.mode === "navigate") event.respondWith(networkFirst(request));
  else if (isStatic(url)) event.respondWith(cacheFirst(request));
});
