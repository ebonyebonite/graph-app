/* 形 (Shape) を SVG の文字列にする */

import { paint, unionStroke, unionFill, liquidFill } from "./theme.js";
import { n2 } from "./geom.js";

export const LAYERS = ["under", "body", "over"];

/**
 * 部品 1 つ分を層ごとの SVG 文字列にする (座標は部品の中の座標のまま)。
 * opts: th (描き方), lw (線の太さ), uid (clipPath の id に使う), rot / flip (液面を水平に保つため)
 */
export function renderShapeLayers(shape, opts) {
  const { th, lw, uid = "p", rot = 0, flip = false, fillLiquid = false } = opts;
  const out = { under: "", body: "", over: "" };
  let k = 0;
  for (const it of shape.items) {
    let s = "";
    if (it.t === "union") {
      const st = unionStroke(it.style, th, lw), fl = unionFill(it.style, th);
      s = `<g>${it.ds.map((d) => `<path d="${d}" ${st}/>`).join("")}${it.ds.map((d) => `<path d="${d}" ${fl}/>`).join("")}</g>`;
    } else if (it.t === "path") {
      s = `<path d="${it.d}" ${paint(it.style, th, lw)}/>`;
    } else if (it.t === "liquid") {
      const id = `${uid}-c${k++}`;
      const a = n2(flip ? rot : -rot), cx = n2(it.cx), ly = n2(it.level);
      const tr = `transform="rotate(${a} ${cx} ${ly})"`;
      s = `<clipPath id="${id}">${it.clip.map((d) => `<path d="${d}"/>`).join("")}</clipPath>`
        + `<g clip-path="url(#${id})"><rect x="${n2(it.cx - 3000)}" y="${ly}" width="6000" height="${it.depth != null ? n2(it.depth) : 6000}" ${tr} ${liquidFill(it, th, fillLiquid)}/>`
        + (it.surface ? `<path d="M${n2(it.cx - 3000)} ${ly}H${n2(it.cx + 3000)}" ${tr} ${paint("thin", th, lw)}/>` : "")
        + `</g>`;
    }
    out[it.layer] += s;
  }
  return out;
}

/** 部品 1 つだけの SVG (部品一覧の見本など) */
export function shapeToSvg(shape, opts) {
  const { pad = 4, width, height } = opts;
  const b = shape.box;
  const L = renderShapeLayers(shape, opts);
  const vb = `${n2(b.x0 - pad)} ${n2(b.y0 - pad)} ${n2(b.x1 - b.x0 + 2 * pad)} ${n2(b.y1 - b.y0 + 2 * pad)}`;
  const size = (width ? ` width="${width}"` : "") + (height ? ` height="${height}"` : "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${size}>${L.under}${L.body}${L.over}</svg>`;
}
