/* 2 次元の幾何計算。
 * 行列は SVG の matrix(a b c d e f) と同じ並び: x' = a x + c y + e, y' = b x + d y + f
 * 角度は度で、0 = 右, 90 = 下 (SVG の y 軸は下向き)。 */

export const DEG = Math.PI / 180;

/** 位置・回転・左右反転から行列を作る (反転 → 回転 → 平行移動の順に適用) */
export function mat(x = 0, y = 0, rot = 0, flip = false) {
  const c = Math.cos(rot * DEG), s = Math.sin(rot * DEG), f = flip ? -1 : 1;
  return [c * f, s * f, -s, c, x, y];
}

export const IDENTITY = [1, 0, 0, 1, 0, 0];

export function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function inv(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** mat() の逆: 行列から位置・回転・反転を取り出す */
export function decompose(m) {
  const flip = m[0] * m[3] - m[1] * m[2] < 0;
  return { x: m[4], y: m[5], rot: normAngle(Math.atan2(-m[2], m[3]) / DEG), flip };
}

/** 角度を (-180, 180] に収める */
export function normAngle(a) {
  a = ((a % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
}

/** 部品の中の向き d を、部品の回転・反転を通して全体の向きに直す */
export function worldDir(rot, flip, d) {
  return normAngle(rot + (flip ? 180 - d : d));
}

export function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

export function unitVec(deg) {
  return [Math.cos(deg * DEG), Math.sin(deg * DEG)];
}

/* ---- 外接矩形 ---- */

export function emptyBox() {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}

export function isEmpty(b) {
  return !(b.x1 >= b.x0 && b.y1 >= b.y0);
}

export function addPt(b, x, y) {
  if (x < b.x0) b.x0 = x;
  if (y < b.y0) b.y0 = y;
  if (x > b.x1) b.x1 = x;
  if (y > b.y1) b.y1 = y;
  return b;
}

export function addBox(b, o) {
  if (isEmpty(o)) return b;
  addPt(b, o.x0, o.y0);
  return addPt(b, o.x1, o.y1);
}

export function transformBox(b, m) {
  const r = emptyBox();
  if (isEmpty(b)) return r;
  for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]]) addPt(r, ...apply(m, x, y));
  return r;
}

export function padBox(b, p) {
  return { x0: b.x0 - p, y0: b.y0 - p, x1: b.x1 + p, y1: b.y1 + p };
}

export function boxesOverlap(a, b, gap = 0) {
  return a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;
}

/** 数値を SVG 用に短く書く */
export function n2(v) {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}

export function matStr(m) {
  return `matrix(${m.map(n2).join(" ")})`;
}
