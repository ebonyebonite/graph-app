"""開発用サーバー: 静的ファイルと、ネイティブの Python で動く RPC。

ブラウザの Pyodide の代わりに、同じ py/webapi.py をこのプロセスで実行する
(Pyodide の CDN に届かない環境でも、画面と計算部をつないで試せる)。

    pip install numpy matplotlib openpyxl
    python3 dev/serve.py [port]        → http://localhost:8765/

worker.js は /rpc に転送するスタブに差し替え、sw.js は 404 にする (キャッシュさせない)。
"""
from __future__ import annotations

import json
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

sys.dont_write_bytecode = True  # py/ に __pycache__ を作らない (公開されるフォルダのため)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "py"))

from matplotlib import font_manager  # noqa: E402

font_manager.fontManager.addfont(os.path.join(ROOT, "assets", "fonts", "ipaexg.ttf"))
import webapi  # noqa: E402

STUB_WORKER = """
self.onmessage = async (ev) => {
  const { id, cmd, args } = ev.data;
  try {
    const r = await fetch("/rpc", { method: "POST", body: JSON.stringify({ cmd, args: args || {} }) });
    self.postMessage({ id, ...(await r.json()) });
  } catch (e) { self.postMessage({ id, ok: false, error: String(e) }); }
};
"""


def call(cmd: str, a: dict) -> str:
    """worker.js の handlers と同じ対応で webapi を呼ぶ。"""
    if cmd == "init":
        return webapi.init()
    if cmd == "render":
        return webapi.render(json.dumps(a["project"]), a.get("fmt") or "png", a.get("dpi") or 100, bool(a.get("tight")))
    if cmd == "normalize":
        return webapi.normalize(json.dumps(a["project"]))
    if cmd == "validateFit":
        return webapi.validate_fit(a["expr"])
    if cmd == "validateGen":
        return webapi.validate_gen(a["expr"])
    if cmd == "savgolInfo":
        return webapi.savgol_info(a["wl"], a["po"])
    if cmd == "parseTable":
        return webapi.parse_table(a["filename"], a.get("b64") or "", a.get("sheet") or "", a.get("headerMode") or 0)
    if cmd == "parsePaste":
        return webapi.parse_paste(a["text"])
    name = {"generate": "generate", "importColumns": "import_columns", "predict": "predict",
            "guessP0": "guess_p0", "transform": "transform", "ttest": "ttest"}[cmd]
    return getattr(webapi, name)(json.dumps(a))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kw):
        super().__init__(*args, directory=ROOT, **kw)

    def log_message(self, *args):  # 静かに
        pass

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/worker.js":
            return self._send(200, STUB_WORKER.encode(), "application/javascript")
        if path == "/sw.js":
            return self._send(404, b"", "text/plain")
        return super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        try:
            out = {"ok": True, "result": json.loads(call(req["cmd"], req.get("args") or {}))}
        except Exception as e:  # noqa: BLE001
            out = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        self._send(200, json.dumps(out).encode(), "application/json")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"http://localhost:{port}/")
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
