// 開発用: ひな形をすべて SVG にして 1 枚の HTML に並べる (node tools/templates.mjs 出力 [theme] [labels])
import { writeFileSync } from "node:fs";
import "../js/parts/index.js";
import { TEMPLATES, instantiate } from "../js/templates.js";
import { solve } from "../js/scene.js";
import { composeFigure, figureSvgDocument } from "../js/compose.js";

const [out = "templates.html", theme = "line", labels = "number", only] = process.argv.slice(2);
let html = "";
for (const t of TEMPLATES) {
  if (only && t.id !== only) continue;
  const doc = instantiate(t, { theme, labels, width: Number(process.env.W || 120) });
  const fig = composeFigure(doc, solve(doc), { uid: t.id });
  html += `<figure><figcaption>${t.name} (${fig.widthMm.toFixed(0)}×${fig.heightMm.toFixed(0)} mm)</figcaption>${figureSvgDocument(fig).replace(/^<\?xml[^>]*>/, "")}</figure>`;
}
writeFileSync(out, `<!doctype html><meta charset="utf-8"><style>body{margin:8px;font:12px sans-serif;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}figure{margin:0;border:1px solid #ccc;padding:6px}svg{display:block;width:${process.env.PX || "480px"};height:auto}</style>${html}`);
console.log("wrote", out);
