/* 書き出し: SVG・PNG・印刷 (PDF) と、保存データ (JSON) */

import { solve } from "./scene.js";
import { composeFigure, figureSvgDocument } from "./compose.js";

export function buildExportSvg(doc, bg = null) {
  const fig = composeFigure(doc, solve(doc), { uid: "x" });
  return { fig, svg: figureSvgDocument(fig, bg) };
}

export function download(name, blob) {
  // 環境によっては日本語のファイル名が使えず "download" になるので、英数字以外は _ にする
  const dot = name.lastIndexOf(".");
  let base = name.slice(0, dot).replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  if (!/[A-Za-z0-9]/.test(base)) base = "labtsumiki";
  name = base + name.slice(dot);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportSvg(doc, name) {
  const { svg } = buildExportSvg(doc);
  download(`${name}.svg`, new Blob([svg], { type: "image/svg+xml" }));
}

export async function exportPng(doc, name, dpi = 600, white = true) {
  const { fig, svg } = buildExportSvg(doc, white ? "#ffffff" : null);
  const w = Math.round((fig.widthMm / 25.4) * dpi), h = Math.round((fig.heightMm / 25.4) * dpi);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    if (!blob) throw new Error("PNG を作れませんでした (図が大きすぎる可能性があります)");
    download(`${name}.png`, blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 図だけを実寸で印刷する (印刷画面で「PDF に保存」を選べば PDF になる) */
export function printFigure(doc) {
  const { svg } = buildExportSvg(doc);
  const area = document.getElementById("print-area");
  area.innerHTML = svg.replace(/^<\?xml[^>]*>\s*/, "");
  const done = () => { area.innerHTML = ""; window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  window.print();
}

export function saveJson(doc, name) {
  const data = JSON.stringify({ app: "labtsumiki", ...doc }, null, 1);
  download(`${name}.json`, new Blob([data], { type: "application/json" }));
}
