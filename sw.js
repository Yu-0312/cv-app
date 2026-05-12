const CACHE_NAME = "cv-studio-cache-v10";
const ASSETS = [
  "./manifest.json",
  "./icon.svg",
  "./config.js",
  "./university-data.js",
  "./data/app/gsat-external-data.js",
  "./data/app/university-tw-app-data.js"
];
const HTML_ASSETS = ["./", "./index.html"];
const NETWORK_FIRST_ASSETS = ASSETS.map((asset) => asset.replace(/^\./, ""));

function isSameOrigin(requestUrl) {
  return requestUrl.origin === self.location.origin;
}

function isNetworkFirstAsset(requestUrl) {
  return isSameOrigin(requestUrl) && NETWORK_FIRST_ASSETS.some((assetPath) => requestUrl.pathname.endsWith(assetPath));
}

function cacheSuccessfulResponse(cacheKey, response) {
  if (!response.ok) return;
  caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, response.clone()));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        [...HTML_ASSETS, ...ASSETS].map((url) =>
          fetch(url, { cache: "no-cache" }).then((response) => {
            if (response.ok) {
              cache.put(url, response.clone());
            }
            return response;
          }).catch(() => {})
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const isHtml = url.pathname.endsWith(".html") || url.pathname === "/" || url.pathname === "";

  if (isHtml) {
    /* Network-first for HTML — always get latest code */
    event.respondWith(
      fetch(event.request, { cache: "no-cache" })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put("./", copy.clone());
              cache.put("./index.html", copy);
            });
          }
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  if (isNetworkFirstAsset(url)) {
    event.respondWith(
      fetch(event.request, { cache: "no-cache" })
        .then((response) => {
          if (isSameOrigin(url)) {
            cacheSuccessfulResponse(event.request, response);
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          return cached || new Response("Offline", { status: 503, statusText: "Offline" });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (isSameOrigin(url)) {
            cacheSuccessfulResponse(event.request, response);
          }
          return response;
        })
        .catch(() => new Response("Offline", { status: 503, statusText: "Offline" }));
    })
  );
});
