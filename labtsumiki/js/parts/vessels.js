/* フラスコ・ビーカーなどの容器 */

import { define, pJoint, pSelect, pBool, pColor, pLevel, volOptions } from "./registry.js";
import { Shape, P, circle, rect, roundRect, poly, line, tubeSeg, tangentPoints, socket, jdim, barbShapes } from "../draw.js";
import { DEG } from "../geom.js";

/** 容量 (mL) から球の半径 (mm) を見積もる */
function sphereR(vol, k = 1.12) {
  return 10 * Math.cbrt((3 * vol) / (4 * Math.PI)) * k;
}

/** 液量 (0〜1) を、底 y0 から上端 y1 までの高さに直す */
function levelY(y0, y1, level) {
  return y0 + (y1 - y0) * level;
}

function addStirbar(sh, halfW, yBottom) {
  sh.path(roundRect(-halfW, yBottom - 3.6, halfW * 2, 3.6, 1.8), "dark");
}

function addChips(sh, r) {
  const pts = [[-0.32, 0.12], [-0.12, 0.05], [0.1, 0.06], [0.28, 0.13]];
  for (const [fx, fy] of pts) {
    const x = fx * r, y = -(r - Math.sqrt(r * r - x * x)) - 1.6 - fy * 4;
    sh.path(poly([[x - 1.6, y + 1.2], [x - 0.4, y - 1.4], [x + 1.6, y - 0.6], [x + 1.0, y + 1.3]]), "ink");
  }
}

/* ---- 丸底フラスコ (一口・二口・三口) ---- */
define({
  type: "rbf",
  name: { ja: "丸底フラスコ", en: "round-bottom flask" },
  cat: "vessel",
  params: [
    pSelect("volume", "容量", volOptions([10, 25, 50, 100, 200, 300, 500, 1000]), 100),
    pSelect("necks", "口の数", [[1, "一口"], [2, "二口"], [3, "三口"]], 1),
    pJoint(),
    pJoint("sideJoint", "横の口のすり合わせ", "24/40"),
    pSelect("sideStyle", "横の口の向き", [["angled", "斜め"], ["parallel", "まっすぐ"]], "angled"),
    pLevel(),
    pColor(),
    pBool("stirbar", "撹拌子"),
    pBool("chips", "沸騰石"),
  ],
  label(p, lang) {
    const n = Number(p.necks);
    const ja = n === 3 ? "三口フラスコ" : n === 2 ? "二口フラスコ" : "丸底フラスコ";
    const en = n === 3 ? "three-neck flask" : n === 2 ? "two-neck flask" : "round-bottom flask";
    return `${lang === "en" ? en : ja} (${p.volume} mL)`;
  },
  build(p) {
    const sh = new Shape();
    const r = sphereR(Number(p.volume));
    const j = jdim(p.joint), js = jdim(p.sideJoint);
    const cy = -r;
    const yTop = -2 * r - j.ls - 12;
    const pieces = [circle(0, cy, r), tubeSeg(0, cy, 0, yTop, j.wt)];
    const sockets = [["neck", 0, yTop, -90, p.joint]];
    const n = Number(p.necks);
    const sides = n === 3 ? [1, -1] : n === 2 ? [1] : [];
    for (const s of sides) {
      const id = s > 0 ? "neck2" : "neck3";
      if (p.sideStyle === "parallel") {
        const x = s * r * 0.62, yT = yTop + 8;
        pieces.push(tubeSeg(x, cy, x, yT, js.wt));
        sockets.push([id, x, yT, -90, p.sideJoint]);
      } else {
        const a = 30, len = r + js.ls + 8;
        const x = s * Math.sin(a * DEG) * len, y = cy - Math.cos(a * DEG) * len;
        pieces.push(tubeSeg(0, cy, x, y, js.wt));
        sockets.push([id, x, y, -90 + s * a, p.sideJoint]);
      }
    }
    sh.union(pieces);
    if (p.level > 0) sh.liquid(pieces, levelY(0, -2 * r, p.level), 0, { color: p.color });
    if (p.stirbar) addStirbar(sh, r * 0.3, -(r - Math.sqrt(r * r - 0.09 * r * r)) - 1);
    if (p.chips) addChips(sh, r);
    for (const [id, x, y, dir, size] of sockets) {
      socket(sh, x, y, dir, size);
      const depth = id === "neck" ? -r * 0.45 - y : 0;
      sh.port(id, "joint", x, y, dir, { size, gender: "F", param: id === "neck" ? "joint" : "sideJoint", probe: depth ? { depth } : null });
    }
    sh.port("base", "base", 0, 0, 90, { width: 2 * r });
    sh.port("grip", "grip", 0, yTop + j.ls * 0.5, 180, { width: j.wo });
    sh.anchor = [r * 0.5, -r * 0.6];
    return sh;
  },
});

/* ---- ナス型フラスコ ---- */
define({
  type: "pear",
  name: { ja: "ナス型フラスコ", en: "pear-shaped flask" },
  cat: "vessel",
  params: [
    pSelect("volume", "容量", volOptions([10, 25, 50, 100, 200, 300, 500]), 50),
    pJoint(),
    pLevel("level", "液量", 0.15),
    pColor(),
    pBool("stirbar", "撹拌子"),
  ],
  label: (p, lang) => `${lang === "en" ? "pear-shaped flask" : "ナス型フラスコ"} (${p.volume} mL)`,
  build(p) {
    const sh = new Shape();
    const r = sphereR(Number(p.volume), 1.0);
    const j = jdim(p.joint);
    const cy = -r, qy = -r - r * 1.5;
    const [tl] = tangentPoints(0, cy, r, -j.wt / 2, qy).sort((a, b) => a[0] - b[0]);
    const [, tr] = tangentPoints(0, cy, r, j.wt / 2, qy).sort((a, b) => a[0] - b[0]);
    const yTop = qy - j.ls - 6;
    const pieces = [circle(0, cy, r), poly([[-j.wt / 2, qy], tl, tr, [j.wt / 2, qy]]), tubeSeg(0, qy + 2, 0, yTop, j.wt)];
    sh.union(pieces);
    if (p.level > 0) sh.liquid(pieces, levelY(0, qy, p.level), 0, { color: p.color });
    if (p.stirbar) addStirbar(sh, r * 0.3, -(r - Math.sqrt(r * r - 0.09 * r * r)) - 1);
    socket(sh, 0, yTop, -90, p.joint);
    sh.port("neck", "joint", 0, yTop, -90, { size: p.joint, gender: "F", param: "joint", probe: { depth: -r * 0.4 - yTop } });
    sh.port("base", "base", 0, 0, 90, { width: 2 * r });
    sh.port("grip", "grip", 0, yTop + j.ls * 0.5, 180, { width: j.wo });
    sh.anchor = [r * 0.45, -r * 0.7];
    return sh;
  },
});

/* ---- 三角フラスコ・吸引瓶 ---- */
function erlenmeyerOutline(vol) {
  const s = Math.cbrt(vol / 100);
  const H = 105 * s, B = 64 * s, wn = 22 * Math.pow(s, 0.6), nh = 22 * s;
  const p = new P();
  p.M(-wn / 2, -H).L(-wn / 2, -H + nh).L(-B / 2 + 2.5, -8).Q(-B / 2, 0, -B / 2 + 9, 0)
    .L(B / 2 - 9, 0).Q(B / 2, 0, B / 2 - 2.5, -8).L(wn / 2, -H + nh).L(wn / 2, -H).Z();
  return { p, H, B, wn, nh };
}

define({
  type: "erlenmeyer",
  grounded: true,
  name: { ja: "三角フラスコ", en: "Erlenmeyer flask" },
  cat: "vessel",
  params: [
    pSelect("volume", "容量", volOptions([50, 100, 200, 300, 500]), 100),
    pLevel("level", "液量", 0.25),
    pColor(),
    pBool("stirbar", "撹拌子"),
  ],
  label: (p, lang) => `${lang === "en" ? "Erlenmeyer flask" : "三角フラスコ"} (${p.volume} mL)`,
  build(p) {
    const sh = new Shape();
    const { p: body, H, B, wn, nh } = erlenmeyerOutline(Number(p.volume));
    const lip = rect(-wn / 2 - 1.5, -H, wn + 3, 3);
    sh.union([body, lip]);
    if (p.level > 0) sh.liquid([body], levelY(0, -H, p.level), 0, { color: p.color });
    if (p.stirbar) addStirbar(sh, B * 0.16, -1);
    sh.port("mouth", "mouth", 0, -H, -90, { width: wn });
    sh.port("base", "base", 0, 0, 90, { width: B });
    sh.port("grip", "grip", 0, -H + nh * 0.5, 180, { width: wn });
    sh.anchor = [B * 0.18, -H * 0.25];
    return sh;
  },
});

define({
  type: "suctionFlask",
  grounded: true,
  name: { ja: "吸引瓶", en: "filter flask" },
  cat: "vessel",
  params: [
    pSelect("volume", "容量", volOptions([250, 500, 1000]), 500),
    pLevel("level", "液量", 0.1),
    pColor("color", "ろ液の色", "#c9d3dc"),
  ],
  label: (p, lang) => `${lang === "en" ? "filter flask" : "吸引瓶"} (${p.volume} mL)`,
  build(p) {
    const sh = new Shape();
    const { p: body, H, B, wn, nh } = erlenmeyerOutline(Number(p.volume) * 0.8);
    const lip = rect(-wn / 2 - 1.5, -H, wn + 3, 3);
    const yb = -H + nh * 0.45;
    const barb = barbShapes(wn / 2 - 1, yb, 12, 18, 7);
    sh.union([body, lip, ...barb.ps]);
    if (p.level > 0) sh.liquid([body], levelY(0, -H, p.level), 0, { color: p.color });
    sh.port("mouth", "mouth", 0, -H, -90, { width: wn });
    sh.port("hose", "hose", ...barb.tip, 12, { medium: "vacuum" });
    sh.port("base", "base", 0, 0, 90, { width: B });
    sh.port("grip", "grip", 0, -H + nh * 0.5, 180, { width: wn });
    sh.anchor = [-B * 0.2, -H * 0.25];
    return sh;
  },
});

/* ---- ビーカー ---- */
define({
  type: "beaker",
  grounded: true,
  name: { ja: "ビーカー", en: "beaker" },
  cat: "vessel",
  params: [
    pSelect("volume", "容量", volOptions([50, 100, 200, 300, 500, 1000]), 200),
    pLevel("level", "液量", 0.4),
    pColor(),
    pBool("marks", "目盛り", false),
  ],
  label: (p, lang) => `${lang === "en" ? "beaker" : "ビーカー"} (${p.volume} mL)`,
  build(p) {
    const sh = new Shape();
    const s = Math.cbrt(Number(p.volume) / 100);
    const D = 50 * s, H = 68 * s;
    const body = new P();
    body.M(-D / 2 - 2.5, -H - 0.8).L(-D / 2, -H + 2.5).L(-D / 2, -4).Q(-D / 2, 0, -D / 2 + 4, 0)
      .L(D / 2 - 4, 0).Q(D / 2, 0, D / 2, -4).L(D / 2, -H + 1.5).L(D / 2 + 1.2, -H);
    sh.union([body]);
    if (p.level > 0) sh.liquid([body], levelY(0, -H, p.level), 0, { color: p.color });
    if (p.marks) {
      for (let i = 1; i <= 4; i++) {
        const y = -H * 0.18 * i;
        sh.path(line(D * 0.18, y, D * 0.18 + (i % 2 ? 4 : 7), y), "hair");
      }
    }
    sh.port("mouth", "mouth", 0, -H, -90, { width: D });
    sh.port("base", "base", 0, 0, 90, { width: D });
    sh.anchor = [-D * 0.2, -H * 0.3];
    return sh;
  },
});

/* ---- 試験管 ---- */
define({
  type: "testTube",
  name: { ja: "試験管", en: "test tube" },
  cat: "vessel",
  params: [
    pSelect("size", "大きさ", [[15, "φ15 × 150"], [18, "φ18 × 180"], [24, "φ24 × 200"]], 18),
    pLevel("level", "液量", 0.25),
    pColor(),
  ],
  build(p) {
    const sh = new Shape();
    const w = Number(p.size), L = w * 10, r = w / 2;
    const body = new P();
    body.M(-r - 1, -L).L(-r, -L + 2).L(-r, -r).arc(0, -r, r, 180, 0).L(r, -L + 2).L(r + 1, -L);
    sh.union([body]);
    if (p.level > 0) sh.liquid([body], levelY(0, -L, p.level), 0, { color: p.color });
    sh.port("mouth", "mouth", 0, -L, -90, { width: w });
    sh.port("base", "base", 0, 0, 90, { width: w });
    sh.port("grip", "grip", 0, -L * 0.8, 180, { width: w });
    sh.anchor = [0, -L * 0.45];
    return sh;
  },
});
