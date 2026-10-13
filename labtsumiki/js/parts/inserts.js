/* 差し込む物: 温度計・毛細管・栓・乾燥管 */

import { define, pJoint, pRange, pBool, pSelect } from "./registry.js";
import { Shape, tubeSeg, cone, jdim, roundRect, rect, poly, line, ellipse, circle } from "../draw.js";

const pAutoDepth = pBool("autoDepth", "差し込む深さを自動で合わせる", true);

/** 差し込む深さ: 自動なら相手の口から決まる値、無ければ手で決めた値 */
function depthOf(p, ctx) {
  return p.autoDepth && ctx.probe != null ? ctx.probe : Number(p.depth);
}

/** すり合わせ付きの短い首 (温度計アダプターなど) */
function collar(sh, j, h, layer) {
  sh.union([tubeSeg(0, 0, 0, -h, j.wt)], "glass", layer);
}

/* ---- 温度計 ---- */
define({
  type: "thermometer",
  name: { ja: "温度計", en: "thermometer" },
  cat: "insert",
  params: [
    pJoint("joint", "すり合わせ", "14/20"),
    pAutoDepth,
    pRange("depth", "差し込む深さ", 0, 250, 5, 40, "mm"),
    pRange("length", "上に出る長さ", 60, 250, 10, 130, "mm"),
  ],
  build(p, ctx = {}) {
    const sh = new Shape();
    const j = jdim(p.joint);
    const depth = depthOf(p, ctx), top = -Number(p.length);
    const yb = depth + 6;
    cone(sh, 0, 0, 90, p.joint);
    collar(sh, j, 12, "over");
    sh.union([tubeSeg(0, yb, 0, top, 5.5), ellipse(0, yb, 3.3, 7.5)], "glass", "over");
    sh.path(line(0, yb - 4, 0, top * 0.45), "thin", "over");
    sh.path(roundRect(-j.wt / 2 - 2, -20, j.wt + 4, 9, 2), "rubber", "over");
    sh.path(poly([[-1.6, top], [1.6, top], [1.2, top - 2], [-1.2, top - 2]]), "glass", "over");
    sh.port("joint", "joint", 0, 0, 90, { size: p.joint, gender: "M", param: "joint" });
    sh.anchor = [0, top * 0.6];
    return sh;
  },
});

/* ---- 毛細管 (減圧蒸留の突沸防止) ---- */
define({
  type: "capillary",
  name: { ja: "毛細管", en: "capillary bleed" },
  cat: "insert",
  params: [
    pJoint(),
    pAutoDepth,
    pRange("depth", "差し込む深さ", 0, 300, 5, 120, "mm"),
    pBool("clamp", "ピンチコック", true),
  ],
  build(p, ctx = {}) {
    const sh = new Shape();
    const j = jdim(p.joint);
    const depth = depthOf(p, ctx), top = -70;
    cone(sh, 0, 0, 90, p.joint);
    collar(sh, j, 14, "over");
    sh.union([tubeSeg(0, depth, 0, top + 20, 3.6)], "glass", "over");
    sh.path(line(0, depth, 0, top + 20), "hair", "over");
    sh.path(roundRect(-j.wt / 2 - 1.5, -22, j.wt + 3, 9, 2), "rubber", "over");
    sh.path(roundRect(-3.5, top - 4, 7, 26, 2), "rubber", "over");
    if (p.clamp) {
      sh.path(roundRect(-8, top + 4, 16, 3, 1), "metal", "over");
      sh.path(roundRect(-8, top + 10, 16, 3, 1), "metal", "over");
      sh.path(rect(5.5, top + 2, 2.5, 13), "metal", "over");
    }
    sh.port("joint", "joint", 0, 0, 90, { size: p.joint, gender: "M", param: "joint" });
    sh.anchor = [0, top + 30];
    return sh;
  },
});

/* ---- 共通すり合わせ栓 ---- */
define({
  type: "stopper",
  name: { ja: "栓", en: "stopper" },
  cat: "insert",
  labelDefault: false,
  params: [pJoint(), pSelect("kind", "種類", [["glass", "ガラス栓"], ["septum", "セプタム (ゴム)"]], "glass")],
  label: (p, lang) => (p.kind === "septum" ? (lang === "en" ? "septum" : "セプタム") : lang === "en" ? "stopper" : "栓"),
  build(p) {
    const sh = new Shape();
    const j = jdim(p.joint);
    if (p.kind === "septum") {
      sh.path(roundRect(-j.wo / 2 - 1.5, -14, j.wo + 3, 16, 3), "rubber");
      sh.path(roundRect(-j.wt / 2 + 2, -20, j.wt - 4, 7, 2), "rubber");
      sh.port("joint", "joint", 0, 0, 90, { size: p.joint, gender: "M", param: "joint" });
      sh.anchor = [0, -10];
      return sh;
    }
    cone(sh, 0, 0, 90, p.joint);
    sh.union([tubeSeg(0, 0, 0, -6, j.wt * 0.7), roundRect(-j.wt / 2 - 2, -15, j.wt + 4, 9, 3)]);
    sh.port("joint", "joint", 0, 0, 90, { size: p.joint, gender: "M", param: "joint" });
    sh.anchor = [0, -10];
    return sh;
  },
});

/* ---- 塩化カルシウム管 (乾燥管) ---- */
define({
  type: "dryingTube",
  name: { ja: "塩化カルシウム管", en: "drying tube" },
  cat: "insert",
  params: [pJoint()],
  build(p) {
    const sh = new Shape();
    const j = jdim(p.joint);
    const pieces = [tubeSeg(0, 0, 0, -16, j.wt * 0.55), circle(0, -28, 12), tubeSeg(0, -28, 0, -84, 15), rect(-5, -90, 10, 8)];
    sh.union(pieces);
    // 乾燥剤の粒 (まばらな点)
    for (let y = -40, k = 0; y > -76; y -= 7, k++) {
      for (const x of k % 2 ? [-3.5, 3.5] : [-5, 0, 5]) sh.path(circle(x, y, 0.9), "ink");
    }
    sh.path(line(-7.5, -80, 7.5, -80), "thin");
    cone(sh, 0, 0, 90, p.joint);
    sh.port("joint", "joint", 0, 0, 90, { size: p.joint, gender: "M", param: "joint" });
    sh.anchor = [0, -60];
    return sh;
  },
});
