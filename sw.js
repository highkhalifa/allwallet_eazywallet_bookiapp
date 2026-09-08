const BUILD_VERSION = "0.39.3";
const CACHE = "wallet-v80";

/* Tell every open page which build just arrived.

   The page used to have to ask — by message port, then by fetching this file —
   and both routes ran through the OLD worker, which answered from its own
   cache with its own version. Announcing from here is the only direction that
   cannot be intercepted: this code IS the new build. */
async function announce() {
  const cs = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  cs.forEach((c) => c.postMessage({ type: "VERSION_WAITING", version: BUILD_VERSION }));
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.add(new Request(new URL("./", self.registration.scope), { cache: "reload" })))
      .catch(() => {})          // never block activation
      .then(announce)           // and say who we are
      .catch(() => {})
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  // sw.js must always come from the network, or a stale copy reports a stale
  // version and the update prompt lies about what it's offering
  if (url.pathname.endsWith("sw.js")) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => {
          c.put(e.request, copy).catch(() => {});
          if (e.request.mode === "navigate") {
            c.put(new URL("./", self.registration.scope).pathname, res.clone()).catch(() => {});
          }
        }).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((hit) =>
          hit || caches.match(new URL("./", self.registration.scope).pathname))
      )
  );
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
  // the waiting worker reports its version so the page can name the update
  if (e.data && e.data.type === "WHICH_VERSION") {
    if (e.ports && e.ports[0]) e.ports[0].postMessage({ version: BUILD_VERSION });
    else announce();
  }
});
