/* 蒸留ヘッド・クライゼンヘッド・減圧アダプターなどの接続部品 */

import { define, pJoint, pRange, pBool } from "./registry.js";
import { Shape, circle, tubeSeg, socket, cone, jdim, barbShapes, roundRect, rect, poly, frame } from "../draw.js";
import { DEG, normAngle } from "../geom.js";

/** 栓 (コック) を管の途中に描く。x,y が中心、dir が管の向き */
export function stopcock(sh, x, y, dir, w, layer = "body") {
  const m = frame(x, y, dir);
  sh.path(roundRect(-w * 0.9, -w * 0.55, w * 1.8, w * 1.1, w * 0.3, m), "glass", layer);
  sh.path(roundRect(w * 0.9, -w * 0.25, w * 1.4, w * 0.5, w * 0.2, m), "solid", layer);
  sh.path(roundRect(w * 2.1, -w * 0.75, w * 0.5, w * 1.5, w * 0.2, m), "solid", layer);
}

/* ---- 蒸留ヘッド (ト字管) ---- */
define({
  type: "stillHead",
  name: { ja: "蒸留ヘッド (ト字管)", en: "distillation head" },
  cat: "adapter",
  params: [
    pJoint("joint", "下と枝管のすり合わせ"),
    pJoint("topJoint", "上のすり合わせ", "14/20"),
    pRange("arm", "枝管の傾き", 0, 40, 5, 15, "°"),
  ],
  build(p) {
    const sh = new Shape();
    const j = jdim(p.joint), jt = jdim(p.topJoint);
    const H = 78, jy = -H * 0.6, La = 52, a = Number(p.arm);
    const ex = La * Math.cos(a * DEG), ey = jy + La * Math.sin(a * DEG);
    sh.union([tubeSeg(0, 0, 0, -H, j.wt), tubeSeg(0, jy, ex, ey, j.wt)]);
    socket(sh, 0, -H, -90, p.topJoint);
    cone(sh, 0, 0, 90, p.joint);
    cone(sh, ex, ey, a, p.joint);
    sh.port("bottom", "joint", 0, 0, 90, { size: p.joint, gender: "M", param: "joint" });
    sh.port("top", "joint", 0, -H, -90, { size: p.topJoint, gender: "F", param: "topJoint", probe: { depth: H + jy + j.wt / 2 + 3 } });
    sh.port("arm", "joint", ex, ey, a, { size: p.joint, gender: "M", param: "joint" });
    sh.anchor = [-j.wt * 0.2, -H + jt.ls + 10];
    return sh;
  },
});

/* ---- クライゼンヘッド ---- */
define({
  type: "claisen",
  name: { ja: "クライゼンヘッド", en: "Claisen adapter" },
  cat: "adapter",
  params: [pJoint("joint", "下のすり合わせ"), pJoint("topJoint", "上のすり合わせ")],
  build(p) {
    const sh = new Shape();
    const j = jdim(p.joint), jt = jdim(p.topJoint);
    const H = 78, dx = 40, by = -50;
    const w = Math.max(j.wt, jt.wt);
    sh.union([
      tubeSeg(0, 0, 0, -H, w),
      tubeSeg(0, -24, dx, by, w),
      tubeSeg(dx, by, dx, -H, jt.wt),
      circle(dx, by, w / 2),
    ]);
    socket(sh, 0, -H, -90, p.topJoint);
    socket(sh, dx, -H, -90, p.topJoint);
    cone(sh, 0, 0, 90, p.joint);
    sh.port("bottom", "joint", 0, 0, 90, { size: p.joint, gender: "M", param: "joint" });
    sh.port("top1", "joint", 0, -H, -90, { size: p.topJoint, gender: "F", param: "topJoint", probe: { depth: H, through: "bottom" } });
    sh.port("top2", "joint", dx, -H, -90, { size: p.topJoint, gender: "F", param: "topJoint" });
    sh.anchor = [dx * 0.5, -37];
    return sh;
  },
});

/* ---- 減圧アダプター (曲がり・吸引口付き) ---- */
define({
  type: "vacAdapter",
  name: { ja: "減圧アダプター", en: "vacuum adapter" },
  cat: "adapter",
  params: [
    pJoint(),
    pBool("autoVert", "出口を自動で鉛直にする", true),
    pRange("inAngle", "入口の向き", -178, -2, 1, -165, "°"),
    pBool("barb", "吸引口 (ホース口)", true),
  ],
  adapt(p, info) {
    if (!p.autoVert || info.port !== "in") return null;
    let phi = normAngle(info.flip ? -info.parentDir : info.parentDir + 180);
    if (phi >= 0) return null;
    phi = Math.min(-2, Math.max(-178, phi));
    return { inAngle: Math.round(phi * 10) / 10 };
  },
  build(p) {
    const sh = new Shape();
    const j = jdim(p.joint);
    const phi = Number(p.inAngle), Li = 46, Lo = 34;
    const ix = Li * Math.cos(phi * DEG), iy = Li * Math.sin(phi * DEG);
    const left = ix < 0;
    const pieces = [tubeSeg(0, 0, ix, iy, j.wt), tubeSeg(0, 0, 0, Lo, j.wt), circle(0, 0, j.wt / 2)];
    let barb = null;
    if (p.barb) {
      barb = barbShapes(left ? j.wt / 2 - 1 : -j.wt / 2 + 1, 6, left ? -8 : 188, 14, 7);
      pieces.push(...barb.ps);
    }
    sh.union(pieces);
    socket(sh, ix, iy, phi, p.joint);
    cone(sh, 0, Lo, 90, p.joint);
    sh.port("in", "joint", ix, iy, phi, { size: p.joint, gender: "F", param: "joint" });
    sh.port("out", "joint", 0, Lo, 90, { size: p.joint, gender: "M", param: "joint" });
    if (barb) sh.port("hose", "hose", ...barb.tip, left ? -8 : 188, { medium: "vacuum" });
    sh.anchor = [0, Lo * 0.4];
    return sh;
  },
});

/* ---- 変換アダプター (すり合わせの大きさを変える) ---- */
define({
  type: "reducer",
  name: { ja: "変換アダプター", en: "reducing adapter" },
  cat: "adapter",
  params: [pJoint("joint", "下 (オス)", "24/40"), pJoint("topJoint", "上 (メス)", "14/20")],
  label: (p, lang) => `${lang === "en" ? "reducing adapter" : "変換アダプター"} (${p.joint} → ${p.topJoint})`,
  labelDefault: false,
  build(p) {
    const sh = new Shape();
    const j = jdim(p.joint), jt = jdim(p.topJoint);
    const H = 24 + jt.ls;
    sh.union([tubeSeg(0, 0, 0, -10, j.wt), poly([[-j.wt / 2, -10], [j.wt / 2, -10], [jt.wt / 2, -18], [-jt.wt / 2, -18]]), tubeSeg(0, -18, 0, -H, jt.wt)]);
    socket(sh, 0, -H, -90, p.topJoint);
    cone(sh, 0, 0, 90, p.joint);
    sh.port("bottom", "joint", 0, 0, 90, { size: p.joint, gender: "M", param: "joint" });
    sh.port("top", "joint", 0, -H, -90, { size: p.topJoint, gender: "F", param: "topJoint", probe: { depth: H, through: "bottom" } });
    sh.anchor = [0, -12];
    return sh;
  },
});

/* ---- ガス導入アダプター (コック付き) ---- */
define({
  type: "gasAdapter",
  name: { ja: "ガス導入アダプター", en: "gas inlet adapter" },
  cat: "vacuum",
  params: [pJoint(), pBool("valve", "コック", true)],
  build(p) {
    const sh = new Shape();
    const j = jdim(p.joint);
    const barb = barbShapes(0, -34, -90, 16, 7);
    sh.union([tubeSeg(0, 0, 0, -12, j.wt), poly([[-j.wt / 2, -12], [j.wt / 2, -12], [4, -22], [-4, -22]]), tubeSeg(0, -22, 0, -34, 8), ...barb.ps]);
    if (p.valve) stopcock(sh, 0, -28, -90, 7);
    cone(sh, 0, 0, 90, p.joint);
    sh.port("bottom", "joint", 0, 0, 90, { size: p.joint, gender: "M", param: "joint" });
    sh.port("hose", "hose", ...barb.tip, -90, { medium: "gas" });
    sh.anchor = [0, -10];
    return sh;
  },
});

/* ---- 共通: 管の途中で枝分かれする T 字管 (ホース用) ---- */
define({
  type: "teeTube",
  name: { ja: "T 字管 (ホース用)", en: "T-connector" },
  cat: "vacuum",
  labelDefault: false,
  params: [],
  build() {
    const sh = new Shape();
    const L = 14;
    const a = barbShapes(-4, 0, 180, L, 7), b = barbShapes(4, 0, 0, L, 7), c = barbShapes(0, -3, -90, L, 7);
    sh.union([rect(-6, -4.5, 12, 9), ...a.ps, ...b.ps, ...c.ps]);
    sh.port("a", "hose", ...a.tip, 180, {});
    sh.port("b", "hose", ...b.tip, 0, {});
    sh.port("c", "hose", ...c.tip, -90, {});
    sh.anchor = [0, 0];
    return sh;
  },
});
