const CACHE_NAME = "ljudr-shell-v1.0.0-rc.18";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./src/app.js",
  "./src/dsp-core.js",
  "./src/local-gain.js",
  "./src/analysis-worker.js",
  "./src/wav.js",
  "./src/export-worker.js",
  "./src/project.js",
  "./src/sha256.js",
  "./src/release-meta.js",
  "./src/analysis-exchange.js",
  "./src/podcast-workflow.js",
  "./validation-manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)));
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const shellRequest = SHELL.some(path => new URL(path, self.registration.scope).pathname === url.pathname);
  if (event.request.mode !== "navigate" && !shellRequest) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(event.request, { cache: "no-store" });
      if (response.ok && response.type === "basic" && (event.request.mode === "navigate" || shellRequest)) {
        await cache.put(event.request.mode === "navigate" ? new Request(new URL("./", self.registration.scope)) : event.request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await cache.match(event.request)
        || (event.request.mode === "navigate" ? await cache.match(new URL("./", self.registration.scope)) : null);
      if (cached) return cached;
      throw error;
    }
  })());
});
