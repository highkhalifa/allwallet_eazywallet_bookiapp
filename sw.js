/* Keeps the app on the phone.

   Once installed, tapping the home screen icon works with no connection:
   on a plane, underground, or with the PC switched off.

   Install deliberately caches one thing only. Asking for a file that isn't
   there fails the whole install and leaves you with no offline support at
   all — which is exactly what went wrong before. */

const CACHE = "wallet-v42";

// let the page ask us to activate immediately when the user taps "Update now"
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("install", (e) => {
  // Deliberately NOT calling skipWaiting() here. A new build must sit in the
  // "waiting" state until the user taps Update now, otherwise it activates on
  // its own and the choice is meaningless.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.add(new Request(new URL("./", self.registration.scope), { cache: "reload" })))
      .catch(() => {}) // never block activation
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
  const url = new URL(e.request.url);

  if (e.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;   // API calls go straight out
  if (url.pathname.startsWith("/api/")) return;

  const isPage =
    e.request.mode === "navigate" ||
    url.pathname === "/" ||
    url.pathname.endsWith(".html");

  if (isPage) {
    // Network first so updates arrive, cache second so it works on a plane.
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => {
              c.put(new URL("./", self.registration.scope).pathname, copy.clone());
              c.put(e.request, copy);
            });
          }
          return res;
        })
        .catch(() =>
          caches.match(e.request).then((hit) =>
            hit || caches.match(new URL("./", self.registration.scope).pathname))
        )
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit ||
      fetch(e.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => hit)
    )
  );
});
