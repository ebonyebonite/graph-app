/* 移転前に登録されたサービスワーカーを片付ける: 保存した物を消して、自分の登録を解除する */
"use strict";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("labtsumiki-")) await caches.delete(key);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: "window" })) c.navigate(c.url);
  })());
});
