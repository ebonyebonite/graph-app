/* サービスワーカー: 通信できればいつも最新を取り、取れないときは前に取った物で動く (オフライン対応)。
 * サイト直下のグラフアプリのワーカーより範囲が狭いので、このフォルダの中はこちらが受け持つ。 */
"use strict";

const CACHE = "labtsumiki-v1.0.0";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req, { cache: "no-cache" });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw e;
    }
  })());
});
