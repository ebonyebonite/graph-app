/* 描き方: 教科書の図のような、白黒の素朴な線画だけにする。
 * 部品はいろいろな塗り方の名前 (glass, metal など) を使うが、ここではほぼすべて
 * 「白で塗って黒い線」にまとめ、灰色の網かけや色は使わない。 */

export const THEMES = {
  line: {
    label: "線画",
    stroke: "#000000", paper: "#ffffff", ink: "#000000", liquid: "#e4e4e4",
    hose: "#ffffff", hoseEdge: "#000000",
  },
};

/** 塗り方の名前 → [塗り, 線, 線の太さの倍率] */
function paintOf(style, th) {
  switch (style) {
    case "line": return ["none", th.stroke, 1];
    case "thin": case "hair": case "heat": case "mercury": return ["none", th.stroke, 0.6];
    case "coolant": case "mask": return [th.paper, "none", 0];
    case "ink": return [th.ink, "none", 0];
    case "frost": return [th.paper, th.stroke, 0.8];
    default: return [th.paper, th.stroke, 1];
  }
}

/** SVG の属性の文字列 (線の太さ lw は部品座標の単位) */
export function paint(style, th, lw) {
  const [fill, stroke, k] = paintOf(style, th);
  let s = `fill="${fill}"`;
  if (stroke !== "none" && k > 0) s += ` stroke="${stroke}" stroke-width="${round(lw * k)}" stroke-linejoin="round" stroke-linecap="round"`;
  return s;
}

/** union の 1 回目 (外形線) 用: 線を 2 倍の太さで引き、2 回目の塗りで内側の半分を隠す */
export function unionStroke(style, th, lw) {
  const [, stroke, k] = paintOf(style, th);
  return `fill="none" stroke="${stroke}" stroke-width="${round(lw * k * 2)}" stroke-linejoin="round"`;
}

export function unionFill(style, th) {
  const [fill] = paintOf(style, th);
  return `fill="${fill}"`;
}

/** 液体の塗り。ふだんは塗らず液面の線だけ。fill が true なら薄い灰色で塗る */
export function liquidFill(item, th, fill) {
  return fill ? `fill="${th.liquid}"` : `fill="none"`;
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}
