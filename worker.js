/* Python (Pyodide) を動かす Web Worker。
 * 画面 (app.js) とは {id, cmd, args} / {id, ok, result | error} のメッセージでやりとりする。
 * グラフ描画・近似計算は PC 版と同じ graphapp の Python コードを使う。 */
"use strict";

const PYODIDE_VERSION = "0.29.3";
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

importScripts(PYODIDE_URL + "pyodide.js");

let pyodide = null;
let api = null;
let ready = null;

function progress(text) {
  self.postMessage({ type: "progress", text });
}

async function fetchText(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url} を読み込めませんでした (${r.status})`);
  return r.text();
}

async function boot() {
  progress("Python を読み込んでいます…");
  pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
  progress("数値計算・グラフ描画ライブラリを読み込んでいます…");
  await pyodide.loadPackage(["numpy", "matplotlib"]);

  progress("アプリ本体を読み込んでいます…");
  const manifest = JSON.parse(await fetchText("py/manifest.json"));
  const home = "/home/pyodide";
  for (const rel of manifest.files) {
    const dir = (home + "/" + rel).split("/").slice(0, -1).join("/");
    pyodide.FS.mkdirTree(dir);
    pyodide.FS.writeFile(home + "/" + rel, await fetchText("py/" + rel + "?v=" + manifest.version));
  }
  progress("日本語フォントを読み込んでいます…");
  const font = await fetch("assets/fonts/ipaexg.ttf");
  if (!font.ok) throw new Error("フォントを読み込めませんでした");
  pyodide.FS.mkdirTree(home + "/assets/fonts");
  pyodide.FS.writeFile(home + "/assets/fonts/ipaexg.ttf", new Uint8Array(await font.arrayBuffer()));

  progress("準備しています…");
  pyodide.runPython(`
import os, sys
os.environ["OPENBLAS_NUM_THREADS"] = "1"
sys.path.insert(0, "/home/pyodide")
import webapi
`);
  api = pyodide.globals.get("webapi");
  return JSON.parse(api.init());
}

let openpyxlReady = null;
async function ensureOpenpyxl() {
  // Excel の読み込みに必要なときだけ取得する (PyPI から, 約 0.3 MB)
  if (!openpyxlReady) {
    openpyxlReady = (async () => {
      progress("Excel 読み込み用のライブラリを取得しています…");
      await pyodide.loadPackage("micropip");
      const micropip = pyodide.pyimport("micropip");
      await micropip.install(["openpyxl"]);
      progress("");
    })();
  }
  return openpyxlReady;
}

const handlers = {
  init: () => ready,
  render: ({ project, fmt, dpi, tight }) =>
    JSON.parse(api.render(JSON.stringify(project), fmt || "png", dpi || 100, !!tight)),
  normalize: ({ project }) => JSON.parse(api.normalize(JSON.stringify(project))),
  validateFit: ({ expr }) => JSON.parse(api.validate_fit(expr)),
  validateGen: ({ expr }) => JSON.parse(api.validate_gen(expr)),
  savgolInfo: ({ wl, po }) => JSON.parse(api.savgol_info(wl, po)),
  generate: (args) => JSON.parse(api.generate(JSON.stringify(args))),
  parseTable: async ({ filename, b64, sheet, headerMode }) => {
    if (b64 && /\.(xlsx|xlsm)$/i.test(filename)) await ensureOpenpyxl();
    return JSON.parse(api.parse_table(filename, b64 || "", sheet || "", headerMode || 0));
  },
  importColumns: (args) => JSON.parse(api.import_columns(JSON.stringify(args))),
  parsePaste: ({ text }) => JSON.parse(api.parse_paste(text)),
};

ready = boot();

self.onmessage = async (ev) => {
  const { id, cmd, args } = ev.data;
  try {
    await ready;
    const result = await handlers[cmd](args || {});
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.message ? e.message : e) });
  }
};
