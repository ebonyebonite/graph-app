/* 冷却管とカラム。どれも上 (y=0) が入口のメス、下が出口のオスで、軸は +y 向き */

import { define, pJoint, pSelect, pBool, pRange } from "./registry.js";
import { Shape, P, tubeSeg, socket, cone, jdim, barbShapes, poly, line, rect } from "../draw.js";

const pSide = pSelect("side", "ホース口の側", [["right", "右"], ["left", "左"]], "right");

/** 外とう (ジャケット): 両端をすぼめた管 */
function jacket(w, wj, y0, y1, taper = 8) {
  return poly([
    [-w / 2, y0], [-wj / 2, y0 + taper], [-wj / 2, y1 - taper], [-w / 2, y1],
    [w / 2, y1], [wj / 2, y1 - taper], [wj / 2, y0 + taper], [w / 2, y0],
  ]);
}

/** 冷却管の共通部分。inner(sh, ...) で中の様子を描く */
function condenser(p, opts) {
  const sh = new Shape();
  const j = jdim(p.joint);
  const L = Number(p.length), ext = opts.ext ?? 26, T = L + ext * 2;
  const wj = j.wt + (opts.extraW ?? 16);
  const y0 = ext, y1 = ext + L;
  const s = p.side === "left" ? -1 : 1;
  const barbs = opts.barbs(y0, y1, wj, s).map(([id, y, side, flow]) => {
    const dir = side > 0 ? 0 : 180;
    return { id, flow, dir, ...barbShapes(side * (wj / 2 - 1), y, dir, 13, 7) };
  });
  const jk = jacket(j.wt, wj, y0, y1);
  sh.union([tubeSeg(0, 0, 0, T, j.wt), jk, ...barbs.flatMap((b) => b.ps)]);
  sh.path(jk, "coolant");
  opts.inner(sh, { j, wj, y0, y1, T });
  socket(sh, 0, 0, -90, p.joint);
  cone(sh, 0, T, 90, p.joint);
  sh.port("in", "joint", 0, 0, -90, { size: p.joint, gender: "F", param: "joint" });
  sh.port("out", "joint", 0, T, 90, { size: p.joint, gender: "M", param: "joint" });
  for (const b of barbs) sh.port(b.id, "hose", ...b.tip, b.dir, { medium: "water", flow: b.flow });
  sh.port("grip", "grip", -s * wj / 2, (y0 + y1) / 2, s > 0 ? 180 : 0, { width: wj });
  sh.anchor = [0, (y0 + y1) / 2];
  return sh;
}

/** 内管 (まっすぐ) を描く */
function innerTube(sh, j, y0, y1) {
  sh.path(rect(-j.wt / 2, y0 + 4, j.wt, y1 - y0 - 8), "mask");
  sh.path(line(-j.wt / 2, y0 + 4, -j.wt / 2, y1 - 4), "thin");
  sh.path(line(j.wt / 2, y0 + 4, j.wt / 2, y1 - 4), "thin");
}

/* ---- リービッヒ冷却管 ---- */
define({
  type: "liebig",
  name: { ja: "リービッヒ冷却管", en: "Liebig condenser" },
  cat: "condenser",
  params: [pJoint(), pSelect("length", "外とうの長さ", [[150, "150 mm"], [200, "200 mm"], [300, "300 mm"], [400, "400 mm"]], 200), pSide],
  build(p) {
    return condenser(p, {
      // 冷却水は下 (出口側) から入れて上から出す
      barbs: (y0, y1, wj, s) => [["waterIn", y1 - 14, s, "in"], ["waterOut", y0 + 14, s, "out"]],
      inner: (sh, { j, y0, y1 }) => innerTube(sh, j, y0, y1),
    });
  },
});

/* ---- アリン冷却管 (球入り) ---- */
define({
  type: "allihn",
  name: { ja: "アリン冷却管 (球入り)", en: "Allihn condenser" },
  cat: "condenser",
  params: [pJoint(), pSelect("length", "外とうの長さ", [[200, "200 mm"], [300, "300 mm"]], 200), pSide],
  build(p) {
    return condenser(p, {
      extraW: 22,
      barbs: (y0, y1, wj, s) => [["waterIn", y1 - 14, s, "in"], ["waterOut", y0 + 14, s, "out"]],
      inner: (sh, { j, y0, y1 }) => {
        const n = Math.max(3, Math.round((y1 - y0 - 30) / 34));
        const top = y0 + 14, bot = y1 - 14, h = (bot - top) / n;
        const rx = j.wt / 2 + 5;
        const pl = new P(), pr = new P();
        pl.M(-j.wt / 2, y0 + 4).L(-j.wt / 2, top);
        pr.M(j.wt / 2, y0 + 4).L(j.wt / 2, top);
        for (let i = 0; i < n; i++) {
          const a = top + h * i, b = a + h, m = (a + b) / 2;
          pl.C(-rx, a, -rx, m - h * 0.2, -rx, m).C(-rx, m + h * 0.2, -rx, b, -j.wt / 2, b);
          pr.C(rx, a, rx, m - h * 0.2, rx, m).C(rx, m + h * 0.2, rx, b, j.wt / 2, b);
        }
        pl.L(-j.wt / 2, y1 - 4);
        pr.L(j.wt / 2, y1 - 4);
        sh.path(pl, "thin");
        sh.path(pr, "thin");
      },
    });
  },
});

/* ---- ジムロート冷却管 (らせん) ---- */
define({
  type: "dimroth",
  name: { ja: "ジムロート冷却管", en: "Dimroth condenser" },
  cat: "condenser",
  params: [pJoint(), pSelect("length", "外とうの長さ", [[200, "200 mm"], [300, "300 mm"]], 200), pSide],
  build(p) {
    return condenser(p, {
      extraW: 22,
      // らせん管の出入口はどちらも上にある
      barbs: (y0, y1, wj, s) => [["waterIn", y0 + 13, s, "in"], ["waterOut", y0 + 13, -s, "out"]],
      inner: (sh, { j, wj, y0, y1 }) => {
        const rx = wj / 2 - 4.5, top = y0 + 20, bot = y1 - 12;
        // らせんは 1 本のジグザグで素朴に表す
        const turns = Math.max(4, Math.round((bot - top) / 18));
        const h = (bot - top) / turns;
        const coil = new P().M(-rx, top);
        for (let i = 0; i < turns; i++) coil.L(rx, top + h * (i + 0.5)).L(-rx, top + h * (i + 1));
        sh.path(coil, "thin");
        sh.path(new P().M(-rx, top).L(-rx, y0 + 13).L(-wj / 2 + 1, y0 + 13), "thin");
        sh.path(new P().M(rx * 0.1, bot).L(rx * 0.1, y0 + 9).Q(rx * 0.1, y0 + 6, rx * 0.5, y0 + 6).L(wj / 2 - 1, y0 + 6), "thin");
      },
    });
  },
});

/* ---- ビグリューカラム ---- */
define({
  type: "vigreux",
  name: { ja: "ビグリューカラム", en: "Vigreux column" },
  cat: "condenser",
  params: [pJoint(), pSelect("length", "長さ", [[100, "100 mm"], [150, "150 mm"], [200, "200 mm"], [300, "300 mm"]], 150), pBool("jacket", "保温ジャケット", false)],
  build(p) {
    const sh = new Shape();
    const j = jdim(p.joint);
    const L = Number(p.length) + 30;
    const w = j.wt + 4;
    const pieces = [tubeSeg(0, 0, 0, L, w)];
    if (p.jacket) pieces.push(jacket(w, w + 14, 12, L - 12, 6));
    sh.union(pieces);
    // 内側へのくぼみ (左右交互)
    for (let y = 22, k = 0; y < L - 16; y += 13, k++) {
      const s = k % 2 ? 1 : -1;
      const x0 = s * (w / 2), x1 = s * (w / 2 - w * 0.36);
      sh.path(new P().M(x0, y - 4).L(x1, y).L(x0, y + 4), "thin");
    }
    socket(sh, 0, 0, -90, p.joint);
    cone(sh, 0, L, 90, p.joint);
    sh.port("in", "joint", 0, 0, -90, { size: p.joint, gender: "F", param: "joint", probe: { depth: L, through: "out" } });
    sh.port("out", "joint", 0, L, 90, { size: p.joint, gender: "M", param: "joint" });
    sh.port("grip", "grip", -w / 2, L / 2, 180, { width: w });
    sh.anchor = [0, L / 2];
    return sh;
  },
});

/* ---- 空冷管 / 還流用のまっすぐな管 ---- */
define({
  type: "airCondenser",
  name: { ja: "空冷管", en: "air condenser" },
  cat: "condenser",
  params: [pJoint(), pRange("length", "長さ", 80, 400, 10, 200, "mm")],
  build(p) {
    const sh = new Shape();
    const j = jdim(p.joint), L = Number(p.length);
    sh.union([tubeSeg(0, 0, 0, L, j.wt)]);
    socket(sh, 0, 0, -90, p.joint);
    cone(sh, 0, L, 90, p.joint);
    sh.port("in", "joint", 0, 0, -90, { size: p.joint, gender: "F", param: "joint" });
    sh.port("out", "joint", 0, L, 90, { size: p.joint, gender: "M", param: "joint" });
    sh.port("grip", "grip", -j.wt / 2, L / 2, 180, { width: j.wt });
    sh.anchor = [0, L / 2];
    return sh;
  },
});
