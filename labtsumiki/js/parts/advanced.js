/* 抽出・精製・不活性ガス操作の器具: ソックスレー抽出器、ロータリーエバポレーター、
 * カラムクロマトグラフィー、分配器、シュレンクライン (シュレンクフラスコ・バブラー・ガスボンベ) */

import { define, pJoint, pSelect, pBool, pRange, pLevel, pColor, volOptions } from "./registry.js";
import { Shape, P, tubeSeg, socket, cone, jdim, barbShapes, roundRect, rect, poly, line, circle } from "../draw.js";
import { stopcock } from "./adapters.js";
import { DEG, normAngle } from "../geom.js";

/** 入口の向きを自動で決め、本体をまっすぐ立てたままにする (減圧アダプターと同じ考え方) */
function adaptUpright(p, info) {
  if (!p.autoVert || info.port !== "in") return null;
  let phi = normAngle(info.flip ? -info.parentDir : info.parentDir + 180);
  if (phi >= 0) return null;
  phi = Math.min(-2, Math.max(-178, phi));
  return { inAngle: Math.round(phi * 10) / 10 };
}

/* ---- ソックスレー抽出器 ---- */
define({
  type: "soxhlet",
  name: { ja: "ソックスレー抽出器", en: "Soxhlet extractor" },
  cat: "purify",
  params: [
    pJoint("joint", "下のすり合わせ"),
    pJoint("topJoint", "上のすり合わせ"),
    pSelect("size", "大きさ", [[0.8, "小"], [1, "中"], [1.3, "大"]], 1),
    pLevel("level", "溶媒の量 (サイホンに対して)", 0.5),
    pBool("thimble", "円筒ろ紙と試料", true),
  ],
  build(p) {
    const sh = new Shape();
    const j = jdim(p.joint), jt = jdim(p.topJoint), s = Number(p.size);
    const W = 42 * s, H = 110 * s;
    const yb = -34, yt = yb - H;                 // 抽出室の底と上
    const ys = yb - H * 0.72;                    // サイホンのいちばん上
    const xv = -W / 2 - 9, xs = W / 2 + 8;       // 蒸気の管・サイホンの管の位置
    const chamber = rect(-W / 2, yt, W, H);
    sh.union([
      tubeSeg(0, 0, 0, yb + 8, j.wt),
      poly([[-j.wt / 2, yb + 8], [j.wt / 2, yb + 8], [W / 2, yb], [-W / 2, yb]]),
      chamber,
      tubeSeg(0, yt, 0, yt - 22 - jt.ls * 0.3, jt.wt),
      // 蒸気の上がる管 (左)
      tubeSeg(0, -14, xv, -14, 9), tubeSeg(xv, -14, xv, yt + 8, 9), tubeSeg(xv, yt + 8, 0, yt + 8, 9),
      // サイホン (右)
      tubeSeg(W / 2 - 6, yb + 2, xs, yb + 2, 5), tubeSeg(xs, yb + 2, xs, ys, 5),
      tubeSeg(xs, ys, xs + 9, ys, 5), tubeSeg(xs + 9, ys, xs + 9, -20, 5), tubeSeg(xs + 9, -20, 0, -20, 5),
    ]);
    if (p.level > 0) sh.liquid([chamber], yb - (yb - ys) * p.level, 0, {});
    if (p.thimble) {
      const tw = W - 12, th = H * 0.8;
      const t = new P().M(-tw / 2, yb - th).L(-tw / 2, yb - 6).Q(-tw / 2, yb - 2, -tw / 2 + 4, yb - 2).L(tw / 2 - 4, yb - 2).Q(tw / 2, yb - 2, tw / 2, yb - 6).L(tw / 2, yb - th);
      sh.path(t, "thin");
      for (let y = yb - 8, k = 0; y > yb - th * 0.45; y -= 6, k++) {
        for (let x = -tw / 2 + 5 + (k % 2) * 3; x < tw / 2 - 3; x += 6) sh.path(circle(x, y, 0.8), "ink");
      }
    }
    const ytop = yt - 22 - jt.ls * 0.3;
    socket(sh, 0, ytop, -90, p.topJoint);
    cone(sh, 0, 0, 90, p.joint);
    sh.port("bottom", "joint", 0, 0, 90, { size: p.joint, gender: "M", param: "joint" });
    sh.port("top", "joint", 0, ytop, -90, { size: p.topJoint, gender: "F", param: "topJoint" });
    sh.port("grip", "grip", xv - 4.5, yt + H * 0.4, 180, { width: W + 20 });
    sh.anchor = [W * 0.25, yb - H * 0.6];
    return sh;
  },
});

/* ---- カラムクロマトグラフィー ---- */
define({
  type: "column",
  name: { ja: "クロマトグラフィー管 (カラム)", en: "chromatography column" },
  cat: "purify",
  params: [
    pSelect("diameter", "内径", [[15, "15 mm"], [20, "20 mm"], [30, "30 mm"], [40, "40 mm"]], 20),
    pSelect("length", "長さ", [[200, "200 mm"], [300, "300 mm"], [400, "400 mm"]], 300),
    pRange("packing", "充てん剤の高さ", 0.2, 0.85, 0.05, 0.6, "%"),
    pSelect("bands", "成分の帯", [[0, "なし"], [1, "1 本"], [2, "2 本"], [3, "3 本"]], 2),
    pRange("solvent", "上の溶媒", 0, 0.3, 0.02, 0.1, "%"),
    pBool("reservoir", "上に溶媒だめ", true),
  ],
  label: (p, lang) => (lang === "en" ? "chromatography column" : "カラム (シリカゲル)"),
  build(p) {
    const sh = new Shape();
    const D = Number(p.diameter) + 4, L = Number(p.length);
    const yc = -46, ytop = yc - L;
    const body = rect(-D / 2, ytop, D, L + 2);
    const pieces = [
      poly([[-1.4, 0], [1.4, 0], [3, -16], [-3, -16]]), tubeSeg(0, -16, 0, -36, 7),
      poly([[-3.5, -36], [3.5, -36], [D / 2, yc], [-D / 2, yc]]), body,
    ];
    let yTopEnd = ytop;
    if (p.reservoir) {
      const R = D * 0.6 + 8;
      pieces.push(circle(0, ytop - R * 0.7, R), tubeSeg(0, ytop - R * 1.4, 0, ytop - R * 1.7 - 10, jdim("24/40").wt));
      yTopEnd = ytop - R * 1.7 - 10;
    }
    sh.union(pieces);
    // 中身 (下から): 綿・砂・充てん剤・成分の帯・砂、その上に溶媒
    const yPackTop = yc - L * p.packing;
    const inner = [body];
    if (p.solvent > 0) sh.liquid(inner, yPackTop - 4 - L * p.solvent, 0, {});
    sh.path(line(-D / 2, yc - 4, D / 2, yc - 4), "thin");
    sh.path(line(-D / 2, yc - 9, D / 2, yc - 9), "thin");
    sh.path(line(-D / 2, yPackTop, D / 2, yPackTop), "line");
    sh.path(line(-D / 2, yPackTop - 4, D / 2, yPackTop - 4), "thin");
    for (let y = yc - 14, k = 0; y > yPackTop + 3; y -= 7, k++) {
      for (let x = -D / 2 + 3 + (k % 2) * 3; x < D / 2 - 2; x += 6) sh.path(circle(x, y, 0.55), "ink");
    }
    const nb = Number(p.bands);
    for (let i = 0; i < nb; i++) {
      const y = yPackTop + (yc - yPackTop) * (0.2 + i * 0.27);
      sh.path(rect(-D / 2 + 0.6, y, D - 1.2, 5), "frost");
      for (let x = -D / 2 + 2; x < D / 2 - 1; x += 2.2) sh.path(line(x, y + 0.8, x + 1.4, y + 4.2), "thin");
    }
    stopcock(sh, 0, -24, -90, 6);
    if (p.reservoir) socket(sh, 0, yTopEnd, -90, "24/40");
    sh.port("stem", "stem", 0, -10, 90, { width: 6 });
    if (p.reservoir) sh.port("top", "joint", 0, yTopEnd, -90, { size: "24/40", gender: "F" });
    sh.port("grip", "grip", -D / 2, ytop + L * 0.3, 180, { width: D });
    sh.anchor = [0, (yPackTop + yc) / 2];
    return sh;
  },
});

/* ---- 分配器 (牛の角) ---- */
define({
  type: "cowReceiver",
  name: { ja: "分配器 (牛の角)", en: "cow receiver" },
  cat: "adapter",
  params: [
    pJoint(),
    pSelect("outlets", "受け口の数", [[3, "3"], [4, "4"]], 3),
    pBool("autoVert", "本体を自動でまっすぐ立てる", true),
    pRange("inAngle", "入口の向き", -178, -2, 1, -165, "°"),
    pBool("barb", "吸引口 (ホース口)", true),
  ],
  adapt: adaptUpright,
  build(p) {
    const sh = new Shape();
    const j = jdim(p.joint);
    const phi = Number(p.inAngle), Li = 46, Lo = 54, R = 17;
    const ix = Li * Math.cos(phi * DEG), iy = Li * Math.sin(phi * DEG);
    const n = Number(p.outlets);
    const angs = n === 4 ? [52, 77, 103, 128] : [58, 90, 122];
    const outs = angs.map((a) => [Lo * Math.cos(a * DEG), Lo * Math.sin(a * DEG), a]);
    const left = ix < 0;
    const pieces = [circle(0, 0, R), tubeSeg(0, 0, ix, iy, j.wt), ...outs.map(([x, y]) => tubeSeg(0, 0, x, y, j.wt * 0.85))];
    let barb = null;
    if (p.barb) {
      barb = barbShapes(left ? R * 0.6 : -R * 0.6, -R * 0.75, left ? -50 : 230, 14, 7);
      pieces.push(...barb.ps);
    }
    sh.union(pieces);
    socket(sh, ix, iy, phi, p.joint);
    sh.port("in", "joint", ix, iy, phi, { size: p.joint, gender: "F", param: "joint" });
    outs.forEach(([x, y, a], i) => {
      cone(sh, x, y, a, p.joint);
      sh.port(`out${i + 1}`, "joint", x, y, a, { size: p.joint, gender: "M", param: "joint" });
    });
    if (barb) sh.port("hose", "hose", ...barb.tip, left ? -50 : 230, { medium: "vacuum" });
    sh.anchor = [0, 0];
    return sh;
  },
});

/* ---- ロータリーエバポレーター ---- */
define({
  type: "rotavap",
  name: { ja: "ロータリーエバポレーター", en: "rotary evaporator" },
  cat: "purify",
  grounded: true,
  params: [
    pJoint("joint", "フラスコのすり合わせ"),
    pJoint("recvJoint", "受け器のすり合わせ"),
    pRange("tilt", "フラスコの傾き", 15, 45, 5, 30, "°"),
    pRange("lift", "フラスコを上げる", 0, 80, 5, 0, "mm"),
    pSelect("bath", "加熱浴", [["water", "水浴"], ["none", "なし"]], "water"),
    pBool("arrow", "回転の矢印", true),
  ],
  build(p) {
    const sh = new Shape();
    const j = jdim(p.joint), tilt = Number(p.tilt), lift = Number(p.lift);
    const d = 180 - tilt;                               // ベーパーダクトの向き (左下)
    const ux = Math.cos(d * DEG), uy = Math.sin(d * DEG);
    const hx = 40, hy = -215 - lift;                     // モーター部の中心
    const rodX = 175;
    const L = 108, px = hx + ux * L, py = hy + uy * L;   // フラスコをつなぐ口

    // 本体の台と支柱 (奥)
    sh.path(rect(rodX - 6, -330 - lift * 0.3, 12, 306 + lift * 0.3), "solid", "under");
    sh.path(rect(60, -24, 170, 24), "solid");
    sh.path(circle(205, -12, 5), "solid");
    sh.path(rect(hx + 10, hy - 7, rodX - hx - 10, 14), "solid", "under");

    // ガラス: ダクト・冷却管・受け器への管
    const Wc = 44, cBot = hy - 34, cTop = hy - 200;
    const rx = hx + 52, ry = hy + 6;
    const wIn = barbShapes(hx + Wc / 2 - 1, cTop + 22, 0, 13, 7);
    const wOut = barbShapes(hx + Wc / 2 - 1, cTop + 42, 0, 13, 7);
    const vac = barbShapes(hx, cTop, -90, 14, 7);
    const jacket = rect(hx - Wc / 2, cTop, Wc, cBot - cTop);
    sh.union([
      tubeSeg(hx, hy, px, py, j.wt),
      tubeSeg(hx, hy - 10, hx, cBot, 16), jacket,
      tubeSeg(hx + 8, cBot - 4, rx, cBot + 14, 9), tubeSeg(rx, cBot + 14, rx, ry, 12),
      ...wIn.ps, ...wOut.ps, ...vac.ps,
    ]);
    // 冷却管の中のらせん (ジグザグ)
    const coil = new P().M(hx - Wc / 2 + 6, cTop + 14);
    for (let y = cTop + 14, k = 0; y < cBot - 12; y += 14, k++) coil.L(k % 2 ? hx - Wc / 2 + 6 : hx + Wc / 2 - 6, y + 14);
    sh.path(coil, "thin");
    cone(sh, px, py, d, p.joint);
    cone(sh, rx, ry, 90, p.recvJoint);

    // モーター部 (ダクトの付け根を覆う箱)
    // ダクトの向きを +x とする座標で四角を描く
    const box = (x0, y0, w, h) => {
      const pts = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]].map(([a, b]) => {
        return [hx + a * ux - b * uy, hy + a * uy + b * ux];
      });
      return poly(pts);
    };
    sh.path(box(-34, -22, 60, 44), "solid");
    sh.path(box(26, -11, 20, 22), "solid");
    if (p.arrow) {
      const ax = 64, rr = j.wt / 2 + 6;
      const pt = (a, b) => [hx + a * ux - b * uy, hy + a * uy + b * ux];
      const arc = new P().M(...pt(ax, -rr)).Q(...pt(ax + 9, 0), ...pt(ax, rr));
      const head = new P().M(...pt(ax + 4, rr - 1)).L(...pt(ax, rr)).L(...pt(ax + 3, rr + 4));
      sh.path(arc, "thin");
      sh.path(head, "thin");
    }

    // 加熱浴 (手前の液面の線)
    if (p.bath !== "none") {
      const bx0 = -215, bx1 = -20, top = -150, floor = -28;
      const wall = new P().M(bx0, top).L(bx0, floor).L(bx1, floor).L(bx1, top);
      sh.path(rect(bx0 - 6, floor, bx1 - bx0 + 12, 28), "solid");
      sh.path(wall, "glass", "under");
      sh.liquid([wall], -128, (bx0 + bx1) / 2, {}, "over");
      sh.path(wall, "line", "over");
    }

    sh.port("flask", "joint", px, py, d, { size: p.joint, gender: "M", param: "joint" });
    sh.port("recv", "joint", rx, ry, 90, { size: p.recvJoint, gender: "M", param: "recvJoint" });
    sh.port("waterIn", "hose", ...wIn.tip, 0, { medium: "water", flow: "in" });
    sh.port("waterOut", "hose", ...wOut.tip, 0, { medium: "water", flow: "out" });
    sh.port("vac", "hose", ...vac.tip, -90, { medium: "vacuum" });
    sh.port("base", "base", 100, 0, 90, { width: 300 });
    sh.anchor = [hx, (cTop + cBot) / 2];
    return sh;
  },
});

/* ---- シュレンクライン (二重マニホールド) ---- */
define({
  type: "schlenkLine",
  name: { ja: "シュレンクライン", en: "Schlenk line" },
  cat: "vacuum",
  params: [pSelect("taps", "コックの数", [[2, "2"], [3, "3"], [4, "4"], [5, "5"]], 3)],
  build(p) {
    const sh = new Shape();
    const n = Number(p.taps), gap = 50, Lx = (n + 1) * gap;
    const yG = 0, yV = 50;
    const pieces = [tubeSeg(0, yG, Lx, yG, 12), tubeSeg(6, yV, Lx, yV, 12)];
    const taps = [];
    for (let i = 1; i <= n; i++) {
      const x = i * gap;
      const b = barbShapes(x, yV + 6, 90, 22, 7);
      pieces.push(tubeSeg(x, yG, x, yV, 7), ...b.ps);
      taps.push([x, b]);
    }
    const gIn = barbShapes(0, yG, 180, 14, 7), gOut = barbShapes(Lx, yG, 0, 14, 7), vac = barbShapes(Lx, yV, 0, 14, 8);
    pieces.push(...gIn.ps, ...gOut.ps, ...vac.ps);
    sh.union(pieces);
    taps.forEach(([x, b], i) => {
      sh.path(circle(x, yV + 14, 6), "glass");
      sh.path(rect(x - 18, yV + 12, 12, 4), "solid");
      sh.port(`tap${i + 1}`, "hose", ...b.tip, 90, { medium: "gas" });
    });
    sh.port("gasIn", "hose", ...gIn.tip, 180, { medium: "gas", flow: "in" });
    sh.port("gasOut", "hose", ...gOut.tip, 0, { medium: "gas", flow: "out" });
    sh.port("vac", "hose", ...vac.tip, 0, { medium: "vacuum" });
    sh.anchor = [gap * 0.5, yG];
    return sh;
  },
});

/* ---- シュレンクフラスコ ---- */
define({
  type: "schlenkFlask",
  name: { ja: "シュレンクフラスコ", en: "Schlenk flask" },
  cat: "vessel",
  params: [
    pSelect("volume", "容量", volOptions([25, 50, 100, 200]), 50),
    pJoint(),
    pLevel("level", "液量", 0.3),
    pColor(),
    pBool("stirbar", "撹拌子", true),
  ],
  label: (p, lang) => `${lang === "en" ? "Schlenk flask" : "シュレンクフラスコ"} (${p.volume} mL)`,
  build(p) {
    const sh = new Shape();
    const r = 10 * Math.cbrt((3 * Number(p.volume)) / (4 * Math.PI)) * 1.1;
    const j = jdim(p.joint);
    const yTop = -2 * r - 52;
    const ya = -2 * r - 20;
    const b = barbShapes(j.wt / 2 + 22, ya, 0, 14, 7);
    const pieces = [circle(0, -r, r), tubeSeg(0, -r, 0, yTop, j.wt), tubeSeg(0, ya, j.wt / 2 + 22, ya, 7), ...b.ps];
    sh.union(pieces);
    if (p.level > 0) sh.liquid(pieces.slice(0, 2), -2 * r * p.level, 0, {});
    if (p.stirbar) sh.path(roundRect(-r * 0.3, -(r - Math.sqrt(r * r - 0.09 * r * r)) - 4.6, r * 0.6, 3.6, 1.8), "dark");
    stopcock(sh, j.wt / 2 + 12, ya, 0, 5);
    socket(sh, 0, yTop, -90, p.joint);
    sh.port("neck", "joint", 0, yTop, -90, { size: p.joint, gender: "F", param: "joint", probe: { depth: -r * 0.45 - yTop } });
    sh.port("hose", "hose", ...b.tip, 0, { medium: "gas" });
    sh.port("base", "base", 0, 0, 90, { width: 2 * r });
    sh.port("grip", "grip", 0, ya - 12, 180, { width: j.wt });
    sh.anchor = [r * 0.5, -r * 0.6];
    return sh;
  },
});

/* ---- オイルバブラー ---- */
define({
  type: "bubbler",
  name: { ja: "バブラー", en: "oil bubbler" },
  cat: "vacuum",
  autoPlace: true,
  params: [],
  build() {
    const sh = new Shape();
    const W = 26, H = 70;
    const body = new P().M(-W / 2, -H).L(-W / 2, -6).Q(-W / 2, 0, -W / 2 + 6, 0).L(W / 2 - 6, 0).Q(W / 2, 0, W / 2, -6).L(W / 2, -H).Z();
    const inB = barbShapes(0, -H - 8, -90, 14, 7), outB = barbShapes(W / 2 - 1, -H + 12, 0, 14, 7);
    sh.union([body, rect(-W / 2 - 2, -H - 8, W + 4, 8), ...inB.ps, ...outB.ps]);
    sh.liquid([body], -H * 0.35, 0, {});
    sh.path(new P().M(-2.5, -H).L(-2.5, -12).M(2.5, -H).L(2.5, -12), "thin");
    for (const [x, y] of [[0, -9], [2, -16], [-1, -22]]) sh.path(circle(x, y, 1.6), "thin");
    sh.port("in", "hose", ...inB.tip, -90, { medium: "gas", flow: "in" });
    sh.port("out", "hose", ...outB.tip, 0, { medium: "gas", flow: "out" });
    sh.anchor = [W * 0.2, -H * 0.6];
    return sh;
  },
});

/* ---- ガスボンベ ---- */
define({
  type: "gasCylinder",
  name: { ja: "ガスボンベ", en: "gas cylinder" },
  cat: "vacuum",
  grounded: true,
  params: [pSelect("gas", "ガス", [["N2", "N₂"], ["Ar", "Ar"]], "N2")],
  label: (p, lang) => `${p.gas === "Ar" ? "Ar" : "N₂"} ${lang === "en" ? "cylinder" : "ボンベ"}`,
  build() {
    const sh = new Shape();
    const W = 50, H = 230;
    sh.path(new P().M(-W / 2, 0).L(-W / 2, -H + 20).Q(-W / 2, -H, -8, -H).L(8, -H).Q(W / 2, -H, W / 2, -H + 20).L(W / 2, 0).Z(), "solid");
    sh.path(rect(-6, -H - 16, 12, 16), "solid");
    sh.path(circle(0, -H - 26, 10), "solid");
    sh.path(rect(-14, -H - 44, 28, 7), "solid");
    const b = barbShapes(10, -H - 26, 0, 16, 7);
    sh.union(b.ps, "solid");
    sh.port("hose", "hose", ...b.tip, 0, { medium: "gas", flow: "out" });
    sh.port("base", "base", 0, 0, 90, { width: W });
    sh.anchor = [0, -H * 0.5];
    return sh;
  },
});
