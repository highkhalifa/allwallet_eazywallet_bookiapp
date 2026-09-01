const BUILD_VERSION = "0.34.0";

/* Keeps the app on the phone.

   Once installed, tapping the home screen icon works with no connection:
   on a plane, underground, or with the PC switched off.

   Install deliberately caches one thing only. Asking for a file that isn't
   there fails the whole install and leaves you with no offline support at
   all — which is exactly what went wrong before. */

const CACHE = "wallet-v71";

// let the page ask us to activate immediately when the user taps "Update now"
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
  // the waiting worker reports its version so the page can name the update
  if (e.data && e.data.type === "WHICH_VERSION") {
    if (e.ports && e.ports[0]) e.ports[0].postMessage({ version: BUILD_VERSION });
    else announce();
  }
});

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
  // Deliberately NOT calling skipWaiting() here. A new build must sit in the
  // "waiting" state until the user taps Update now, otherwise it activates on
  // its own and the choice is meaningless.
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
  const url = new URL(e.request.url);

  if (e.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;   // API calls go straight out
  if (url.pathname.startsWith("/api/")) return;
  // sw.js must always come from the network, or a stale copy reports a stale
  // version and the update prompt lies about what it's offering
  if (url.pathname.endsWith("sw.js")) return;

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
