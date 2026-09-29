const CACHE_NAME = "att-shell-v5";
const BASE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const APP_SHELL = [
  `${BASE_PATH}/`,
  `${BASE_PATH}/manifest.webmanifest`,
  `${BASE_PATH}/icon.svg`,
];

async function updateShell(request, cached) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      await caches.open(CACHE_NAME).then((cache) => cache.put(`${BASE_PATH}/`, copy));
    }
    return response;
  } catch {
    return cached;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" }))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      caches.match(`${BASE_PATH}/`).then((cached) => {
        const network = updateShell(request, cached);
        if (cached) {
          // Return the cached app shell immediately while refreshing it in the background.
          event.waitUntil(network.then(() => undefined));
          return cached;
        }
        return network;
      }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    }),
  );
});
