/* サービスワーカー: 一度読み込んだらオフラインでも起動できるようにする。
 *  - アプリ本体 (このサイトのファイル): バージョンごとのキャッシュ。HTML は通信できればいつも最新を取る
 *  - Pyodide (jsDelivr) と openpyxl (PyPI): 取得したものをそのまま保存して再利用 */
"use strict";

const VERSION = "2.3.0-202610122327";
const APP_CACHE = `graphapp-app-${VERSION}`;
const RUNTIME_CACHE = "graphapp-runtime-v1";
const PRECACHE = ["./", "index.html", "style.css?v=2.3.0-202610122327", "app.js?v=2.3.0-202610122327", "worker.js?v=2.3.0-202610122327", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "assets/fonts/ipaexg.ttf", "py/graphapp/__init__.py?v=2.3.0-202610122327", "py/graphapp/model.py?v=2.3.0-202610122327", "py/graphapp/fitting.py?v=2.3.0-202610122327", "py/graphapp/numerics.py?v=2.3.0-202610122327", "py/graphapp/safe_expr.py?v=2.3.0-202610122327", "py/graphapp/texfmt.py?v=2.3.0-202610122327", "py/graphapp/plot_core.py?v=2.3.0-202610122327", "py/graphapp/io_utils.py?v=2.3.0-202610122327", "py/webapi.py?v=2.3.0-202610122327"];
const RUNTIME_HOSTS = ["cdn.jsdelivr.net", "pypi.org", "files.pythonhosted.org"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("graphapp-app-") && key !== APP_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
    if (hit) return hit;
    throw e;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // HTML とファイル一覧は最新を優先、それ以外 (?v= 付きの本体・フォント・アイコン) はキャッシュ優先
    const fresh = req.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith(".html")
      || url.pathname.endsWith("manifest.json") || url.pathname.endsWith(".webmanifest");
    event.respondWith(fresh ? networkFirst(req) : cacheFirst(req, APP_CACHE));
  } else if (RUNTIME_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
  }
});
