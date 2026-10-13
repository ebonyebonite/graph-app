/* 加熱・撹拌・台・スタンド・減圧装置など、ガラス以外の機器 */

import { define, pSelect, pBool, pRange, volOptions } from "./registry.js";
import { Shape, P, rect, roundRect, poly, line, circle, ellipse, tubeSeg, barbShapes } from "../draw.js";

/** 台に載せる相手の幅 (自動) または手で決めた容量から半径を決める */
function fitRadius(p, ctx) {
  if (p.size === "auto" && ctx.fit) return ctx.fit / 2;
  const v = p.size === "auto" ? 100 : Number(p.size);
  return 10 * Math.cbrt((3 * v) / (4 * Math.PI)) * 1.12;
}

const pFitSize = pSelect("size", "大きさ", [["auto", "載せた物に合わせる"], ...volOptions([50, 100, 200, 300, 500, 1000])], "auto");

/* ---- マントルヒーター ---- */
define({
  type: "mantle",
  name: { ja: "マントルヒーター", en: "heating mantle" },
  cat: "heat",
  grounded: true,
  params: [pFitSize],
  build(p, ctx = {}) {
    const sh = new Shape();
    const R = fitRadius(p, ctx) + 1;
    const W = 2 * R + 20, yr = -R * 0.95, yb = 12;
    const bowl = new P();
    bowl.M(-W / 2, yr).L(-W / 2, yb - 10).Q(-W / 2, yb, -W / 2 + 10, yb).L(W / 2 - 10, yb).Q(W / 2, yb, W / 2, yb - 10).L(W / 2, yr).Q(0, yr + 7, -W / 2, yr).Z();
    sh.path(bowl, "panel", "over");
    const bw = Math.max(W + 10, 90), bh = 24;
    sh.path(rect(-bw / 2, yb, bw, bh), "solid");
    sh.path(circle(bw / 2 - 13, yb + bh / 2, 5), "solid");
    sh.port("stage", "stage", 0, 0, -90, {});
    sh.port("base", "base", 0, yb + bh, 90, { width: bw });
    sh.anchor = [-W * 0.3, (yr + yb) / 2];
    return sh;
  },
});

/* ---- 湯浴・油浴・氷浴 ---- */
const BATHS = { oil: ["オイルバス", "oil bath"], water: ["水浴", "water bath"], ice: ["氷浴", "ice bath"], dryice: ["ドライアイス浴", "dry ice bath"] };
define({
  type: "bath",
  name: { ja: "オイルバス・水浴", en: "bath" },
  cat: "heat",
  grounded: true,
  params: [
    pSelect("medium", "中身", Object.entries(BATHS).map(([k, v]) => [k, v[0]]), "oil"),
    pFitSize,
    pRange("depth", "浸かる深さ", 0.2, 1, 0.05, 0.6, "%"),
  ],
  label: (p, lang) => BATHS[p.medium][lang === "en" ? 1 : 0],
  build(p, ctx = {}) {
    const sh = new Shape();
    const R = fitRadius(p, ctx);
    const W = Math.max(2 * R * 1.55, 70), floor = 6;
    const level = -2 * R * p.depth;
    const H = floor - level + 12;
    const top = floor - H;
    const wall = new P();
    wall.M(-W / 2, top).L(-W / 2, floor - 4).Q(-W / 2, floor + 3, -W / 2 + 7, floor + 3).L(W / 2 - 7, floor + 3).Q(W / 2, floor + 3, W / 2, floor - 4).L(W / 2, top);
    const medium = p.medium === "oil" ? "oil" : p.medium === "dryice" ? "n2" : "water";
    // 奥 (フラスコより先に描く) と、手前の半透明の液 (沈んだ部分が透けて見える)
    sh.path(wall, "glass", "under");
    sh.liquid([wall], level, 0, { fill: medium, alpha: 1 }, "under");
    sh.liquid([wall], level, 0, { fill: medium, alpha: 0.4 }, "over");
    if (p.medium === "ice" || p.medium === "dryice") {
      const pts = [[-0.38, 0.35], [0.36, 0.5], [-0.3, 0.75], [0.3, 0.2], [0.42, 0.8]];
      for (const [fx, fy] of pts) {
        const x = fx * W, y = level + (floor - level) * fy;
        sh.path(roundRect(x - 4, y - 4, 8, 8, 1.5), "thin", "over");
      }
    }
    sh.path(wall, "line", "over");
    sh.port("stage", "stage", 0, 0, -90, {});
    sh.port("base", "base", 0, floor + 3, 90, { width: W });
    sh.anchor = [W * 0.38, (level + floor) / 2];
    return sh;
  },
});

/* ---- マグネチックスターラー (ホットスターラー) ---- */
define({
  type: "stirrer",
  name: { ja: "マグネチックスターラー", en: "magnetic stirrer" },
  cat: "heat",
  grounded: true,
  params: [pBool("heat", "加熱付き (ホットスターラー)", true)],
  label: (p, lang) => (p.heat ? (lang === "en" ? "hot-plate stirrer" : "ホットスターラー") : lang === "en" ? "magnetic stirrer" : "マグネチックスターラー"),
  build(p) {
    const sh = new Shape();
    const W = 120, H = 42;
    sh.path(rect(-W / 2 + 6, 0, W - 12, 5), "solid");
    sh.path(rect(-W / 2, 5, W, H), "solid");
    const ky = 5 + H / 2;
    sh.path(circle(-W / 2 + 20, ky, 6), "solid");
    if (p.heat) sh.path(circle(W / 2 - 20, ky, 6), "solid");
    sh.port("stage", "stage", 0, 0, -90, {});
    sh.port("base", "base", 0, 5 + H, 90, { width: W });
    sh.anchor = [-W * 0.3, 5 + H * 0.65];
    return sh;
  },
});

/* ---- ラボジャッキ ---- */
define({
  type: "jack",
  name: { ja: "ラボジャッキ", en: "lab jack" },
  cat: "heat",
  grounded: true,
  labelDefault: false,
  params: [
    pBool("autoHeight", "高さを自動で合わせる (整列時)", true),
    pRange("height", "高さ", 20, 250, 1, 50, "mm"),
  ],
  build(p) {
    const sh = new Shape();
    const W = 110, h = Number(p.height), t = 6;
    sh.path(rect(-W / 2, 0, W, t), "metal");
    sh.path(rect(-W / 2, t + h, W, t), "metal");
    const xa = W * 0.36;
    sh.path(line(-xa, t, xa, t + h), "line");
    sh.path(line(xa, t, -xa, t + h), "line");
    sh.path(line(-W / 2 + 4, t + h / 2, W / 2 - 4, t + h / 2), "thin");
    sh.path(circle(0, t + h / 2, 2.4), "metal");
    sh.port("stage", "stage", 0, 0, -90, {});
    sh.port("base", "base", 0, 2 * t + h, 90, { width: W });
    sh.anchor = [-W * 0.3, t + h / 2];
    return sh;
  },
});

/* ---- 三脚と金網 ---- */
define({
  type: "tripod",
  name: { ja: "三脚と金網", en: "tripod with wire gauze" },
  cat: "heat",
  grounded: true,
  params: [pRange("height", "高さ", 100, 250, 10, 170, "mm")],
  build(p) {
    const sh = new Shape();
    const h = Number(p.height), W = 120;
    sh.path(rect(-W / 2, 0, W, 2.5), "metal");
    sh.path(roundRect(-W * 0.36, 3, W * 0.72, 5, 2), "metal");
    for (const x of [-W * 0.33, W * 0.33, 0]) {
      const x1 = x * 1.35;
      sh.path(tubeSeg(x, 6, x1, h, 4), x === 0 ? "thin" : "metal");
    }
    sh.port("stage", "stage", 0, 0, -90, {});
    sh.port("base", "base", 0, h, 90, { width: W });
    // 三脚の真下の床 (バーナーを置く所)
    sh.port("floor", "stage", 0, h, -90, {});
    sh.anchor = [W * 0.22, h * 0.5];
    return sh;
  },
});

/* ---- ガスバーナー ---- */
define({
  type: "burner",
  name: { ja: "ガスバーナー", en: "Bunsen burner" },
  cat: "heat",
  grounded: true,
  params: [pBool("flame", "炎", true)],
  build(p) {
    const sh = new Shape();
    const H = 110;
    sh.path(roundRect(-30, H - 10, 60, 10, 3), "metal");
    sh.path(rect(-7, 0, 14, H - 10), "metal");
    sh.path(roundRect(-10, H * 0.55, 20, 10, 2), "metal");
    sh.path(roundRect(-14, H * 0.82, 28, 8, 2), "dark");
    if (p.flame) {
      const f = new P();
      f.M(-6, -1).C(-10, -18, -3, -34, 0, -50).C(3, -34, 10, -18, 6, -1).Z();
      sh.path(f, "flame");
      const g = new P();
      g.M(-3.5, -1).C(-5, -10, -2, -18, 0, -24).C(2, -18, 5, -10, 3.5, -1).Z();
      sh.path(g, "thin");
    }
    sh.port("base", "base", 0, H, 90, { width: 60 });
    sh.anchor = [-5, H * 0.4];
    return sh;
  },
});

/* ---- スタンド ---- */
define({
  type: "stand",
  name: { ja: "スタンド", en: "retort stand" },
  cat: "support",
  grounded: true,
  labelDefault: false,
  params: [
    pBool("auto", "クランプに合わせて置く (整列時)", true),
    pRange("height", "支柱の高さ", 150, 800, 10, 400, "mm"),
  ],
  build(p) {
    const sh = new Shape();
    const h = Number(p.height);
    sh.path(roundRect(-40, -8, 120, 8, 2), "metal", "under");
    sh.path(rect(-4, -h, 8, h - 8), "metal", "under");
    sh.path(circle(0, -h, 4), "metal", "under");
    sh.port("base", "base", 20, 0, 90, { width: 120 });
    sh.port("rod", "rod", 0, -h * 0.5, 0, {});
    sh.anchor = [0, -h * 0.3];
    sh.rod = { x: 0, y0: -h, y1: -8 };
    return sh;
  },
});

/* ---- クランプ (自在クランプ・リング) ---- */
define({
  type: "clamp",
  name: { ja: "クランプ", en: "clamp" },
  cat: "support",
  labelDefault: false,
  params: [
    pSelect("kind", "種類", [["clamp", "クランプ"], ["ring", "リング"]], "clamp"),
    pRange("arm", "腕の長さ", 30, 200, 5, 70, "mm"),
  ],
  label: (p, lang) => (p.kind === "ring" ? (lang === "en" ? "support ring" : "リング") : lang === "en" ? "clamp" : "クランプ"),
  build(p, ctx = {}) {
    const sh = new Shape();
    const w = (ctx.fit || 24) + 3, arm = Number(p.arm);
    // 腕は -x の向きに伸び、x = 0 が挟む物の外側
    if (p.kind === "ring") {
      const rx = w / 2 + 3;
      sh.path(ellipse(rx - 1, 0, rx, 3.5), "line", "over");
      sh.path(rect(-arm, -2, arm - 1, 4), "metal", "over");
    } else {
      const jaw = new P();
      jaw.M(-2, -w / 2 - 3).L(w * 0.75, -w / 2 - 3).Q(w * 0.95, -w / 2 - 3, w * 0.95, -w / 2 + 1)
        .L(w * 0.95, -w / 2 + 2.5).L(w * 0.6, -w / 2 + 0.2).L(-2, -w / 2 + 0.2);
      const jaw2 = new P();
      jaw2.M(-2, w / 2 + 3).L(w * 0.75, w / 2 + 3).Q(w * 0.95, w / 2 + 3, w * 0.95, w / 2 - 1)
        .L(w * 0.95, w / 2 - 2.5).L(w * 0.6, w / 2 - 0.2).L(-2, w / 2 - 0.2);
      sh.path(jaw, "metal", "over");
      sh.path(jaw2, "metal", "over");
      sh.path(rect(-14, -w / 2 - 4, 12, w + 8), "metal", "over");
      sh.path(rect(-arm, -2.5, arm - 14, 5), "metal", "over");
    }
    sh.path(roundRect(-arm - 8, -8, 16, 16, 2), "metal", "over");
    sh.path(circle(-arm, 0, 4.3), "white", "over");
    sh.path(rect(-arm - 2, -14, 4, 6), "metal", "over");
    sh.port("grip", "grip", 0, 0, 0, { gender: "C" });
    sh.port("rod", "rod", -arm, 0, 180, {});
    sh.anchor = [-arm * 0.5, 0];
    return sh;
  },
});

/* ---- 真空ポンプ・アスピレーター ---- */
define({
  type: "pump",
  name: { ja: "真空ポンプ", en: "vacuum pump" },
  cat: "vacuum",
  grounded: true,
  params: [pSelect("kind", "種類", [["rotary", "油回転ポンプ"], ["diaphragm", "ダイアフラムポンプ"], ["aspirator", "アスピレーター"]], "rotary")],
  label: (p, lang) => ({
    rotary: lang === "en" ? "rotary vane pump" : "真空ポンプ",
    diaphragm: lang === "en" ? "diaphragm pump" : "ダイアフラムポンプ",
    aspirator: lang === "en" ? "aspirator" : "アスピレーター",
  })[p.kind],
  build(p) {
    const sh = new Shape();
    if (p.kind === "aspirator") {
      sh.path(roundRect(-40, -70, 80, 70, 4), "solid");
      sh.path(rect(-34, -40, 68, 34), "glass");
      sh.liquid([rect(-34, -40, 68, 34)], -28, 0, {});
      sh.path(rect(-34, -40, 68, 34), "line");
      const b = barbShapes(20, -70, -90, 16, 7);
      sh.union([rect(14, -76, 12, 8), ...b.ps]);
      sh.port("in", "hose", ...b.tip, -90, { medium: "vacuum" });
      sh.anchor = [-20, -20];
      return sh;
    }
    const W = 120, H = 66;
    sh.path(roundRect(-W / 2, -6, W, 6, 2), "dark");
    if (p.kind === "rotary") {
      sh.path(roundRect(-W / 2 + 6, -H, 54, H - 6, 4), "solid");
      sh.path(roundRect(-W / 2 + 60, -H + 10, 54, H - 16, 12), "solid");
    } else {
      sh.path(roundRect(-W / 2 + 6, -H, W - 12, H - 6, 4), "solid");
      sh.path(circle(W * 0.18, -H * 0.5, 14), "solid");
    }
    const b = barbShapes(-W / 2 + 26, -H, -90, 18, 8);
    sh.union([rect(-W / 2 + 19, -H - 6, 14, 7), ...b.ps]);
    sh.port("in", "hose", ...b.tip, -90, { medium: "vacuum" });
    sh.anchor = [W * 0.25, -H * 0.35];
    return sh;
  },
});

/* ---- コールドトラップ (デュワー瓶入り) ---- */
const COOLANTS = { n2: ["液体窒素", "liquid N₂"], dryice: ["ドライアイス/アセトン", "dry ice/acetone"], ice: ["氷水", "ice water"] };
define({
  type: "coldTrap",
  name: { ja: "コールドトラップ", en: "cold trap" },
  cat: "vacuum",
  grounded: true,
  params: [pSelect("coolant", "冷媒", Object.entries(COOLANTS).map(([k, v]) => [k, v[0]]), "n2")],
  label: (p, lang) => `${lang === "en" ? "cold trap" : "コールドトラップ"} (${COOLANTS[p.coolant][lang === "en" ? 1 : 0]})`,
  build(p) {
    const sh = new Shape();
    const W = 64, H = 150, tw = 30;
    // トラップ本体 (デュワーの後ろに描く)
    const trap = rect(-tw / 2, -H - 22, tw, H - 8);
    const inB = barbShapes(0, -H - 40, -90, 14, 7);
    const outB = barbShapes(tw / 2 - 1, -H - 12, 0, 16, 7);
    sh.union([trap, tubeSeg(0, -H - 22, 0, -H - 40, 9), ...inB.ps, ...outB.ps]);
    sh.path(new P().M(-3.2, -H - 22).L(-3.2, -24).M(3.2, -H - 22).L(3.2, -24), "thin");
    sh.path(rect(-tw / 2 - 3, -H - 25, tw + 6, 6), "frost");
    // デュワー瓶 (手前、冷媒が透けて見える)
    const dewar = new P();
    dewar.M(-W / 2, -H).L(-W / 2, -10).Q(-W / 2, 0, -W / 2 + 10, 0).L(W / 2 - 10, 0).Q(W / 2, 0, W / 2, -10).L(W / 2, -H);
    sh.liquid([dewar], -H * 0.8, 0, { fill: p.coolant === "ice" ? "water" : "n2", alpha: 0.45 }, "over");
    sh.path(dewar, "line", "over");
    sh.path(new P().M(-W / 2 + 4, -H).L(-W / 2 + 4, -13).Q(-W / 2 + 4, -4, -W / 2 + 13, -4).L(W / 2 - 13, -4).Q(W / 2 - 4, -4, W / 2 - 4, -13).L(W / 2 - 4, -H), "thin", "over");
    sh.path(rect(-W / 2 - 1, -H - 3, W + 2, 4), "solid", "over");
    sh.port("in", "hose", ...inB.tip, -90, { medium: "vacuum" });
    sh.port("out", "hose", ...outB.tip, 0, { medium: "vacuum" });
    sh.port("base", "base", 0, 0, 90, { width: W });
    sh.anchor = [-W * 0.25, -H * 0.4];
    return sh;
  },
});

/* ---- 真空計 (圧力計) ---- */
define({
  type: "gauge",
  name: { ja: "真空計", en: "vacuum gauge" },
  cat: "vacuum",
  grounded: true,
  params: [],
  build() {
    const sh = new Shape();
    const R = 20, cy = -80;
    const a = barbShapes(-8, -8, 180, 16, 7), b = barbShapes(8, -8, 0, 16, 7);
    sh.union([rect(-10, -14, 20, 12), tubeSeg(0, -14, 0, cy + R, 7), ...a.ps, ...b.ps]);
    sh.path(rect(-30, -2, 60, 4), "metal");
    sh.path(circle(0, cy, R + 3), "solid");
    sh.path(circle(0, cy, R), "white");
    for (let k = 0; k <= 8; k += 2) {
      const ang = (150 + k * 30) * (Math.PI / 180);
      const c = Math.cos(ang), s = Math.sin(ang);
      sh.path(line(c * R * 0.78, cy + s * R * 0.78, c * R * 0.92, cy + s * R * 0.92), "hair");
    }
    sh.path(line(0, cy, R * 0.6, cy - R * 0.45), "line");
    sh.path(circle(0, cy, 2), "dark");
    sh.port("in", "hose", ...a.tip, 180, { medium: "vacuum" });
    sh.port("out", "hose", ...b.tip, 0, { medium: "vacuum" });
    sh.anchor = [R * 0.5, cy + R * 0.5];
    return sh;
  },
});

/* ---- 冷却水の入口・出口 (ホースの端と流れの矢印) ---- */
function waterEnd(out) {
  const sh = new Shape();
  // ホースの口金 (上向き) と、その下に流れの向きの太い矢印
  sh.union([rect(-5, 0, 10, 9), poly([[-3.5, 0], [3.5, 0], [4.5, -4], [-4.5, -4]])], "rubber");
  // 細い線の矢印 (流れの向き)
  const y0 = 13, y1 = 34;
  const a = new P().M(0, y0).L(0, y1);
  if (out) a.M(-4, y1 - 6).L(0, y1).L(4, y1 - 6);
  else a.M(-4, y0 + 6).L(0, y0).L(4, y0 + 6);
  sh.path(a, "line");
  sh.port("hose", "hose", 0, -4, -90, { medium: "water", flow: out ? "in" : "out" });
  sh.anchor = [0, (y0 + y1) / 2];
  return sh;
}

define({
  type: "waterIn",
  name: { ja: "冷却水 (入口)", en: "cooling water in" },
  cat: "vacuum",
  autoPlace: true,
  params: [],
  build: () => waterEnd(false),
});

define({
  type: "waterOut",
  name: { ja: "冷却水 (出口)", en: "cooling water out" },
  cat: "vacuum",
  autoPlace: true,
  params: [],
  build: () => waterEnd(true),
});

/* ---- 窒素などのガス (風船・ボンベ) ---- */
define({
  type: "gasSource",
  name: { ja: "不活性ガス (風船)", en: "inert gas balloon" },
  cat: "vacuum",
  autoPlace: true,
  params: [pSelect("gas", "ガス", [["N2", "N₂"], ["Ar", "Ar"]], "N2")],
  label: (p, lang) => `${p.gas === "Ar" ? "Ar" : "N₂"} ${lang === "en" ? "balloon" : "風船"}`,
  build() {
    const sh = new Shape();
    const b = new P();
    b.M(0, 0).C(-26, -10, -30, -60, 0, -66).C(30, -60, 26, -10, 0, 0).Z();
    sh.path(b, "glass");
    sh.path(roundRect(-4, -2, 8, 10, 2), "rubber");
    const t = barbShapes(0, 8, 90, 10, 6);
    sh.union(t.ps, "glass");
    sh.port("hose", "hose", ...t.tip, 90, { medium: "gas", flow: "out" });
    sh.anchor = [0, -34];
    return sh;
  },
});
