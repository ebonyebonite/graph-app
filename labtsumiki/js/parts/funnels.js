/* ロート類とビュレット */

import { define, pJoint, pSelect, pBool, pColor, pLevel, volOptions } from "./registry.js";
import { Shape, P, tubeSeg, socket, cone, jdim, poly, rect, roundRect, line, circle, tangentPoints } from "../draw.js";
import { stopcock } from "./adapters.js";

/* ---- 滴下ロート (圧力平衡管付き) ---- */
define({
  type: "dropFunnel",
  name: { ja: "滴下ロート", en: "addition funnel" },
  cat: "funnel",
  params: [
    pSelect("volume", "容量", volOptions([50, 100, 200, 500]), 100),
    pJoint(),
    pBool("equalizer", "圧力平衡管", true),
    pLevel("level", "液量", 0.6),
    pColor("color", "液体の色", "#f2c14e"),
  ],
  label: (p, lang) => `${lang === "en" ? "pressure-equalizing addition funnel" : "滴下ロート"} (${p.volume} mL)`,
  build(p) {
    const sh = new Shape();
    const j = jdim(p.joint);
    const s = Number(p.volume) / 100;
    const W = 38 * Math.sqrt(s), Hb = 88 * Math.pow(s, 0.5);
    const yc = -48, yt = yc - 14 - Hb, yn = yt - 12, ytop = yn - j.ls - 6;
    const body = poly([[-3.5, yc], [-W / 2, yc - 14], [-W / 2, yt], [-j.wt / 2, yn], [j.wt / 2, yn], [W / 2, yt], [W / 2, yc - 14], [3.5, yc]]);
    const pieces = [
      tubeSeg(0, 0, 0, -10, j.wt), poly([[-j.wt / 2, -10], [j.wt / 2, -10], [3.5, -17], [-3.5, -17]]),
      tubeSeg(0, -17, 0, yc + 1, 7), body, tubeSeg(0, yn + 2, 0, ytop, j.wt),
    ];
    if (p.equalizer) {
      const xe = W / 2 + 8, ya = yn - 6;
      pieces.push(tubeSeg(0, ya, xe, ya, 6), tubeSeg(xe, ya, xe, -8, 6), tubeSeg(xe, -8, 0, -8, 6));
    }
    sh.union(pieces);
    if (p.level > 0) sh.liquid([body], yc - 14 - Hb * p.level, 0, { color: p.color });
    stopcock(sh, 0, -32, -90, 6.5);
    socket(sh, 0, ytop, -90, p.joint);
    cone(sh, 0, 0, 90, p.joint);
    sh.port("bottom", "joint", 0, 0, 90, { size: p.joint, gender: "M", param: "joint" });
    sh.port("top", "joint", 0, ytop, -90, { size: p.joint, gender: "F", param: "joint" });
    sh.port("grip", "grip", -W / 2, yc - 14 - Hb / 2, 180, { width: W });
    sh.anchor = [-W * 0.15, yc - 14 - Hb * 0.35];
    return sh;
  },
});

/* ---- 分液ロート ---- */
define({
  type: "sepFunnel",
  name: { ja: "分液ロート", en: "separatory funnel" },
  cat: "funnel",
  params: [
    pSelect("volume", "容量", volOptions([100, 200, 300, 500]), 200),
    pLevel("level", "下の層", 0.25),
    pColor("color", "下の層の色", "#7fb8e6"),
    pLevel("level2", "上の層", 0.55),
    pColor("color2", "上の層の色", "#f2c14e"),
    pBool("stopper", "栓", true),
  ],
  label: (p, lang) => `${lang === "en" ? "separatory funnel" : "分液ロート"} (${p.volume} mL)`,
  build(p) {
    const sh = new Shape();
    const s = Math.cbrt(Number(p.volume) / 200);
    const R = 30 * s, qy = -76;
    const yc = qy - R * 2.0;
    const [tl] = tangentPoints(0, yc, R, -4, qy).sort((a, b) => a[0] - b[0]);
    const [, tr] = tangentPoints(0, yc, R, 4, qy).sort((a, b) => a[0] - b[0]);
    const j = jdim("19/22");
    const yn = yc - R + 4, ytop = yn - 18;
    const bulb = [circle(0, yc, R), poly([[-4, qy], tl, tr, [4, qy]])];
    sh.union([tubeSeg(0, 0, 0, qy + 1, 7), poly([[-1.6, 0], [1.6, 0], [3.5, -8], [-3.5, -8]]), ...bulb, tubeSeg(0, yn, 0, ytop, j.wt)]);
    const yTopBody = yc - R;
    const y1 = qy + (yTopBody - qy) * p.level, y2 = qy + (yTopBody - qy) * Math.max(p.level2, p.level);
    if (y2 < y1) sh.liquid(bulb, y2, 0, { color: p.color2, tone: 0.08, depth: y1 - y2 });
    if (p.level > 0) sh.liquid(bulb, y1, 0, { color: p.color, tone: 0.22 });
    stopcock(sh, 0, -64, -90, 6.5);
    socket(sh, 0, ytop, -90, "19/22");
    if (p.stopper) sh.path(roundRect(-j.wt / 2 - 2, ytop - 11, j.wt + 4, 9, 3), "glass");
    sh.port("stem", "stem", 0, -16, 90, { width: 7 });
    sh.port("grip", "grip", -R, yc + R * 0.55, 180, { width: R * 1.4, ring: true });
    sh.anchor = [R * 0.35, yc + R * 0.3];
    return sh;
  },
});

/* ---- ロート (自然ろ過) ---- */
define({
  type: "funnel",
  name: { ja: "ロート (ろ紙付き)", en: "funnel with filter paper" },
  cat: "funnel",
  params: [pSelect("size", "口径", [[45, "45 mm"], [60, "60 mm"], [75, "75 mm"]], 60), pBool("paper", "ろ紙", true)],
  label: (p, lang) => (lang === "en" ? "funnel" : "ロート"),
  build(p) {
    const sh = new Shape();
    const D = Number(p.size), h = D * 0.87;
    const yc = -26;
    sh.union([
      poly([[-D / 2, yc - h], [D / 2, yc - h], [3.5, yc], [-3.5, yc]]),
      tubeSeg(0, yc + 1, 0, 14, 7),
      poly([[-3.5, 14], [3.5, 14], [1, 18], [-1, 18]]),
    ]);
    if (p.paper) sh.path(poly([[-D / 2 + 4, yc - h + 4], [0, yc - 6], [D / 2 - 4, yc - h + 4]], null, false), "thin");
    sh.port("stem", "stem", 0, 0, 90, { width: 7 });
    sh.anchor = [D * 0.2, yc - h * 0.5];
    return sh;
  },
});

/* ---- ブフナーロート (ゴムアダプター付き) ---- */
define({
  type: "buchner",
  name: { ja: "ブフナーロート", en: "Büchner funnel" },
  cat: "funnel",
  params: [pSelect("size", "目皿の径", [[40, "40 mm"], [60, "60 mm"], [90, "90 mm"]], 60), pBool("cake", "ろ物", true)],
  build(p) {
    const sh = new Shape();
    const D = Number(p.size), W = D + 8, Hc = D * 0.55;
    const yp = -26;
    // 足 (口の中に入る部分) は手前に描く
    sh.union([tubeSeg(0, -6, 0, 26, 9), poly([[-4.5, 26], [4.5, 26], [1.5, 32], [-4.5, 30]])], "ceramic", "over");
    sh.path(poly([[-11, 2], [11, 2], [15, -10], [-15, -10]]), "rubber", "over");
    const bowl = new P();
    bowl.M(-W / 2, yp - Hc).L(-W / 2, yp).Q(-W / 2, yp + 10, -7, yp + 14).L(-5, -6).L(5, -6).L(7, yp + 14).Q(W / 2, yp + 10, W / 2, yp).L(W / 2, yp - Hc).Z();
    sh.union([bowl, rect(-W / 2 - 1.5, yp - Hc - 3, W + 3, 4)], "ceramic", "over");
    sh.path(line(-W / 2 + 3, yp, W / 2 - 3, yp), "line", "over");
    if (p.cake) sh.path(line(-W / 2 + 2, yp - 6, W / 2 - 2, yp - 6), "thin", "over");
    sh.port("stem", "stem", 0, 0, 90, { width: 22 });
    sh.anchor = [W * 0.25, yp - Hc * 0.5];
    return sh;
  },
});

/* ---- ビュレット ---- */
define({
  type: "burette",
  name: { ja: "ビュレット", en: "burette" },
  cat: "funnel",
  params: [pLevel("level", "液量", 0.8), pColor("color", "液体の色", "#8e6bbf")],
  build(p) {
    const sh = new Shape();
    const L = 260, w = 11, y0 = -34, yt = y0 - L;
    const tube = rect(-w / 2, yt, w, L + 2);
    sh.union([poly([[-1.3, 0], [1.3, 0], [3, -16], [-3, -16]]), tubeSeg(0, -16, 0, y0 + 2, 6), tube]);
    if (p.level > 0) sh.liquid([tube], y0 - L * p.level, 0, { color: p.color });
    for (let i = 0; i <= 5; i++) {
      const y = yt + 16 + i * ((L - 26) / 5);
      sh.path(line(-w / 2, y, -w / 2 + 3.5, y), "thin");
    }
    stopcock(sh, 0, -24, -90, 6);
    sh.port("stem", "stem", 0, -8, 90, { width: 6 });
    sh.port("grip", "grip", -w / 2, yt + L * 0.35, 180, { width: w });
    sh.anchor = [0, yt + L * 0.6];
    return sh;
  },
});
