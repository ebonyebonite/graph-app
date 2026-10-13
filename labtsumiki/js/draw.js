/* 部品を描くための道具: パス組み立て (P)、部品の形 (Shape)、すり合わせなどの共通の形。
 * 部品の中の座標の単位は mm (実物に近い寸法) で、y は下向き。 */

import { DEG, mat, apply, emptyBox, addPt, addBox, n2 } from "./geom.js";

/** パスの組み立て。m を渡すと、すべての点をその行列で変換してから書く */
export class P {
  constructor(m = null) {
    this.m = m;
    this.s = [];
    this.box = emptyBox();
    this.flipSweep = m ? m[0] * m[3] - m[1] * m[2] < 0 : false;
  }
  _t(x, y) {
    if (this.m) [x, y] = apply(this.m, x, y);
    return [x, y];
  }
  _pt(x, y) {
    const [X, Y] = this._t(x, y);
    addPt(this.box, X, Y);
    return `${n2(X)} ${n2(Y)}`;
  }
  M(x, y) { this.s.push("M" + this._pt(x, y)); this.x = x; this.y = y; return this; }
  L(x, y) { this.s.push("L" + this._pt(x, y)); this.x = x; this.y = y; return this; }
  C(x1, y1, x2, y2, x, y) {
    this.s.push(`C${this._pt(x1, y1)} ${this._pt(x2, y2)} ${this._pt(x, y)}`);
    this.x = x; this.y = y; return this;
  }
  Q(x1, y1, x, y) {
    this.s.push(`Q${this._pt(x1, y1)} ${this._pt(x, y)}`);
    this.x = x; this.y = y; return this;
  }
  /** 中心 (cx, cy)・半径 r の円弧を、角度 a0 から a1 まで描く (現在位置は a0 の点にある前提) */
  arc(cx, cy, r, a0, a1) {
    const steps = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 170));
    const scale = this.m ? Math.hypot(this.m[0], this.m[1]) : 1;
    let sweep = a1 > a0 ? 1 : 0;
    if (this.flipSweep) sweep = 1 - sweep;
    for (let i = 1; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      const x = cx + r * Math.cos(a * DEG), y = cy + r * Math.sin(a * DEG);
      this.s.push(`A${n2(r * scale)} ${n2(r * scale)} 0 0 ${sweep} ${this._pt(x, y)}`);
      this.x = x; this.y = y;
    }
    // 外接矩形は円弧上の点で見積もる
    const n = Math.ceil(Math.abs(a1 - a0) / 10);
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      addPt(this.box, ...this._t(cx + r * Math.cos(a * DEG), cy + r * Math.sin(a * DEG)));
    }
    return this;
  }
  Z() { this.s.push("Z"); return this; }
  get d() { return this.s.join(""); }
}

/* ---- 基本の形 ---- */

export function circle(cx, cy, r, m = null) {
  return new P(m).M(cx + r, cy).arc(cx, cy, r, 0, 360).Z();
}

export function ellipse(cx, cy, rx, ry, m = null) {
  // 4 本の 3 次ベジェで近似する
  const k = 0.5523, p = new P(m);
  p.M(cx + rx, cy)
    .C(cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry)
    .C(cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy)
    .C(cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry)
    .C(cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy);
  return p.Z();
}

export function rect(x, y, w, h, m = null) {
  return new P(m).M(x, y).L(x + w, y).L(x + w, y + h).L(x, y + h).Z();
}

export function roundRect(x, y, w, h, r, m = null) {
  r = Math.min(r, w / 2, h / 2);
  const p = new P(m);
  p.M(x + r, y).L(x + w - r, y).arc(x + w - r, y + r, r, -90, 0)
    .L(x + w, y + h - r).arc(x + w - r, y + h - r, r, 0, 90)
    .L(x + r, y + h).arc(x + r, y + h - r, r, 90, 180)
    .L(x, y + r).arc(x + r, y + r, r, 180, 270);
  return p.Z();
}

export function poly(pts, m = null, closed = true) {
  const p = new P(m);
  pts.forEach(([x, y], i) => (i ? p.L(x, y) : p.M(x, y)));
  return closed ? p.Z() : p;
}

export function line(x1, y1, x2, y2, m = null) {
  return new P(m).M(x1, y1).L(x2, y2);
}

/** 線分 (x1,y1)-(x2,y2) を太さ w の管にした四角形 */
export function tubeSeg(x1, y1, x2, y2, w, m = null) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = (-(y2 - y1) / len) * (w / 2), ny = ((x2 - x1) / len) * (w / 2);
  return poly([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]], m);
}

/** 円 (cx,cy,r) に外の点 q から引いた 2 本の接線の接点 [左回り側, 右回り側] */
export function tangentPoints(cx, cy, r, qx, qy) {
  const dx = qx - cx, dy = qy - cy, dd = Math.hypot(dx, dy);
  const th = Math.atan2(dy, dx), al = Math.acos(Math.min(1, r / dd));
  return [
    [cx + r * Math.cos(th - al), cy + r * Math.sin(th - al)],
    [cx + r * Math.cos(th + al), cy + r * Math.sin(th + al)],
  ];
}

/** 点 (x, y) にあって向き dir (外向き) を上 (-y) とみなす座標系 */
export function frame(x, y, dir) {
  return mat(x, y, dir + 90, false);
}

/* ---- すり合わせ (共通テーパー) ---- */

export const JOINT_SIZES = ["14/20", "15/25", "19/22", "19/38", "24/40", "29/42"];

export function jdim(size) {
  const [d, L] = String(size).split("/").map(Number);
  return {
    d, L,
    wo: d + 4,            // 外すり (メス) の外径
    wt: d * 0.82 + 1.5,   // つながる管の外径
    ls: L * 0.6,          // 外すりとして描く長さ
    lc: L * 0.56,         // 内すり (オス) の円すいの長さ
  };
}

/* ---- 部品の形 ---- */

/** 部品 1 つ分の描画内容と接続口 */
export class Shape {
  constructor() {
    this.items = [];
    this.ports = [];
    this.box = emptyBox();
    this.anchor = [0, 0];   // ラベルの引き出し線をつなぐ点
  }
  _add(item, ps) {
    for (const p of ps) addBox(this.box, p.box);
    this.items.push(item);
    return this;
  }
  /** 複数の閉じた形をまとめて 1 つのガラス器具として描く (重なった内側の線は消える) */
  union(ps, style = "glass", layer = "body") {
    return this._add({ t: "union", layer, style, ds: ps.map((p) => p.d) }, ps);
  }
  path(p, style = "line", layer = "body") {
    return this._add({ t: "path", layer, style, d: p.d }, [p]);
  }
  /** 液体: clip の形の内側を、高さ level (部品座標の y) から下まで塗る。液面はいつも水平。
   *  opts.fill に描き方の色の名前 (oil など) を渡すと、液体の色の代わりにそれを使う。
   *  opts.depth を渡すと、液面からその深さまでの層だけを塗る (2 層に分かれた液体の上の層など) */
  liquid(clipPs, level, cx, opts = {}, layer = "body") {
    return this._add({
      t: "liquid", layer, clip: clipPs.map((p) => p.d), level, cx,
      color: opts.color || "#7fb8e6", tone: opts.tone ?? 0.16, surface: opts.surface !== false,
      fill: opts.fill || null, alpha: opts.alpha ?? 1, depth: opts.depth ?? null,
    }, []);
  }
  /** 接続口: kind = joint (すり合わせ) | stem (足) | mouth (口) | base (底) | stage (台) | hose (ホース口) | grip (クランプで挟む所) */
  port(id, kind, x, y, dir, extra = {}) {
    this.ports.push({ id, kind, x, y, dir, ...extra });
    return this;
  }
}

/** 外すり (メス): 点 (x,y) が口、dir が外向き。口の所を少し太い帯にするだけの素朴な描き方。
 *  上に重ねて描くので union の後に呼ぶ */
export function socket(sh, x, y, dir, size, layer = "body") {
  const j = jdim(size), m = frame(x, y, dir);
  const w = j.wt / 2 + 1.6, h = Math.min(12, j.ls * 0.45);
  sh.path(poly([[-w, 0], [w, 0], [w, h], [-w, h]], m), "frost", layer);
  return j;
}

/** 内すり (オス): 点 (x,y) が肩、dir の向きに円すいが伸びる */
export function cone(sh, x, y, dir, size) {
  const j = jdim(size), m = frame(x, y, dir);
  sh.path(poly([[-j.wt / 2, 0], [j.wt / 2, 0], [j.wt * 0.4, -j.lc], [-j.wt * 0.4, -j.lc]], m), "frost", "under");
  return j;
}

/** ホース口: 付け根 (x,y) から dir の向きに len だけ伸びる。union に入れる形を返す */
export function barbShapes(x, y, dir, len = 13, w = 6) {
  const [ux, uy] = [Math.cos(dir * DEG), Math.sin(dir * DEG)];
  const tx = x + ux * len, ty = y + uy * len;
  const m = frame(tx, ty, dir);
  return {
    ps: [tubeSeg(x, y, tx, ty, w), poly([[-w / 2, 0], [w / 2, 0], [w / 2 + 1.3, 4.5], [-w / 2 - 1.3, 4.5]], m)],
    tip: [tx, ty],
  };
}

/** 液体の色の候補 */
export const LIQUID_COLORS = [
  ["#7fb8e6", "青 (水溶液)"],
  ["#f2c14e", "黄"],
  ["#e8833a", "橙"],
  ["#d9534f", "赤"],
  ["#8e6bbf", "紫"],
  ["#5cb85c", "緑"],
  ["#c9d3dc", "無色"],
  ["#6b4f3a", "褐色"],
];
