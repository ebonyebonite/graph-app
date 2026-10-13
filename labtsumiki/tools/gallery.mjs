// 開発用: すべての部品を並べた HTML を書き出す (node tools/gallery.mjs [出力先] [theme])
import { writeFileSync } from "node:fs";
import "../js/parts/index.js";
import { allDefs, withDefaults } from "../js/parts/registry.js";
import { shapeToSvg } from "../js/render.js";
import { THEMES } from "../js/theme.js";

const out = process.argv[2] || "gallery.html";
const th = THEMES[process.argv[3] || "line"];
const variants = JSON.parse(process.argv[4] || "{}");
let cells = "", n = 0;
for (const def of allDefs()) {
  const list = [{}, ...(variants[def.type] || [])];
  for (const v of list) {
    const p = withDefaults(def, v);
    const sh = def.build(p, {});
    const svg = shapeToSvg(sh, { th, lw: 0.9, uid: `${def.type}${n++}`, height: 220 });
    cells += `<figure><div>${svg}</div><figcaption>${def.type} ${JSON.stringify(v)}</figcaption></figure>`;
  }
}
writeFileSync(out, `<!doctype html><meta charset="utf-8"><style>body{margin:8px;font:11px sans-serif;display:flex;flex-wrap:wrap;gap:8px}figure{margin:0;border:1px solid #ccc;padding:4px}svg{display:block;max-width:260px}</style>${cells}`);
console.log("wrote", out);
