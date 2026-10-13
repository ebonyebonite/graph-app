/* 描き方 (線画・カラー) と、部品が使う塗り方の名前 → SVG 属性 */

export const THEMES = {
  line: {
    label: "線画 (白黒)",
    stroke: "#000000", glass: "#ffffff", frost: "#ececec", solid: "#ffffff", panel: "#ececec",
    dark: "#2a2a2a", metal: "#d4d4d4", rubber: "#555555", ceramic: "#ffffff", coolant: "#ffffff",
    heat: "#000000", ink: "#000000", mercury: "#000000", flame: "#ffffff",
    oil: "#9a9a9a", water: "#b5b5b5", n2: "#d8d8d8",
    hose: { water: "#ffffff", vacuum: "#ffffff", gas: "#ffffff", plain: "#ffffff" },
    hoseEdge: "#000000",
    mono: true,
  },
  color: {
    label: "カラー",
    stroke: "#1d2733", glass: "#f0f7fc", frost: "#d5e2ea", solid: "#eef1f4", panel: "#d3dae1",
    dark: "#38424c", metal: "#b8c1c9", rubber: "#5e646b", ceramic: "#fbfaf6", coolant: "#d3ebfa",
    heat: "#d9534f", ink: "#1d2733", mercury: "#c0392b", flame: "#7fb2f0",
    oil: "#e5a93a", water: "#6fb3e6", n2: "#bcdcf5",
    hose: { water: "#8cc6ee", vacuum: "#4d545b", gas: "#a5d6a7", plain: "#e8b27b" },
    hoseEdge: "#1d2733",
    mono: false,
  },
};

/** 塗り方の名前 → [塗り, 線, 線の太さの倍率] */
function paintOf(style, th) {
  switch (style) {
    case "glass": return [th.glass, th.stroke, 1];
    case "frost": return [th.frost, th.stroke, 0.7];
    case "line": return ["none", th.stroke, 1];
    case "thin": return ["none", th.stroke, 0.6];
    case "hair": return ["none", th.stroke, 0.4];
    case "solid": return [th.solid, th.stroke, 1];
    case "panel": return [th.panel, th.stroke, 1];
    case "dark": return [th.dark, th.stroke, 0.8];
    case "metal": return [th.metal, th.stroke, 1];
    case "rubber": return [th.rubber, th.stroke, 0.8];
    case "ceramic": return [th.ceramic, th.stroke, 1];
    case "white": return ["#ffffff", th.stroke, 1];
    case "coolant": return [th.coolant, "none", 0];
    case "mask": return [th.glass, "none", 0];
    case "ink": return [th.ink, "none", 0];
    case "heat": return ["none", th.heat, 0.6];
    case "mercury": return ["none", th.mercury, 1.4];
    case "flame": return [th.flame, th.stroke, 0.6];
    default: return [th.glass, th.stroke, 1];
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

/** 液体の塗り。線画では灰色の濃さ (tone)、カラーでは指定色 */
export function liquidFill(item, th) {
  if (item.fill) return `fill="${th[item.fill]}" fill-opacity="${item.alpha}"`;
  if (th.mono) {
    const v = Math.round(255 * (1 - item.tone));
    return `fill="rgb(${v},${v},${v})"`;
  }
  return `fill="${item.color}" fill-opacity="0.55"`;
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}
