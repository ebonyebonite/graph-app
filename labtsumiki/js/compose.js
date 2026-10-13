/* 図全体の組み立て: 部品・ホース・ラベル・凡例を並べて 1 枚の SVG にする。
 * 図の幅 (mm) を決めると縮尺が決まり、線の太さと文字の大きさは書き出した図の上で指定どおりになる。 */

import { THEMES, paint } from "./theme.js";
import { renderShapeLayers, LAYERS } from "./render.js";
import { partLabel } from "./parts/registry.js";
import { itemPort, linkHasClip } from "./scene.js";
import { P, frame, jdim } from "./draw.js";
import { apply, emptyBox, addBox, addPt, isEmpty, n2, matStr, unitVec } from "./geom.js";

const PT = 0.3528; // 1 pt = 0.3528 mm
export const FONT_FAMILY = "Helvetica, Arial, 'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', sans-serif";
const HOSE_W = 6;

/* ---- 文字幅の見積もり ---- */
let ctx2d = null;
export function measureText(text, size) {
  if (typeof document !== "undefined") {
    ctx2d ||= document.createElement("canvas").getContext("2d");
    ctx2d.font = `100px ${FONT_FAMILY}`;
    return (ctx2d.measureText(text).width / 100) * size;
  }
  let w = 0;
  for (const ch of text) w += /[\u0000-\u00ff]/.test(ch) ? 0.58 : 1.05;
  return w * size;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

/* ---- ホース ---- */

/** ホースの道筋 (3 次ベジェ)。端はホース口に少しかぶせる */
export function tubeGeometry(solved, t) {
  const ia = solved.items.get(t.a.id), ib = solved.items.get(t.b.id);
  const pa = ia && itemPort(ia, t.a.port), pb = ib && itemPort(ib, t.b.port);
  if (!pa || !pb) return null;
  const [ax, ay] = unitVec(pa.wdir), [bx, by] = unitVec(pb.wdir);
  const back = 8;
  const p0 = [pa.wx - ax * back, pa.wy - ay * back], p3 = [pb.wx - bx * back, pb.wy - by * back];
  const d = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  const k = Math.min(160, Math.max(30, d * 0.45));
  const p1 = [pa.wx + ax * k, pa.wy + ay * k], p2 = [pb.wx + bx * k, pb.wy + by * k];
  return { p0, p1, p2, p3, pa, pb };
}

function bezierAt(g, t) {
  const u = 1 - t;
  const f = (i) => u * u * u * g.p0[i] + 3 * u * u * t * g.p1[i] + 3 * u * t * t * g.p2[i] + t * t * t * g.p3[i];
  const df = (i) => 3 * u * u * (g.p1[i] - g.p0[i]) + 6 * u * t * (g.p2[i] - g.p1[i]) + 3 * t * t * (g.p3[i] - g.p2[i]);
  return { x: f(0), y: f(1), dx: df(0), dy: df(1) };
}

/** ホースの中身 (水・真空・ガス) と流れの向き (+1: a→b, -1: b→a, 0: なし) */
export function tubeFlow(g, t) {
  const medium = g.pa.medium || g.pb.medium || "plain";
  let dir = 0;
  if (t.arrow === "ab") dir = 1;
  else if (t.arrow === "ba") dir = -1;
  else if (t.arrow === "auto") {
    if (g.pa.flow === "out" || g.pb.flow === "in") dir = 1;
    else if (g.pa.flow === "in" || g.pb.flow === "out") dir = -1;
  }
  return { medium, dir };
}

function tubeBox(g) {
  const b = emptyBox();
  for (let i = 0; i <= 16; i++) {
    const p = bezierAt(g, i / 16);
    addPt(b, p.x - HOSE_W, p.y - HOSE_W);
    addPt(b, p.x + HOSE_W, p.y + HOSE_W);
  }
  return b;
}

function renderTube(g, t, th, lw) {
  const d = `M${n2(g.p0[0])} ${n2(g.p0[1])}C${n2(g.p1[0])} ${n2(g.p1[1])} ${n2(g.p2[0])} ${n2(g.p2[1])} ${n2(g.p3[0])} ${n2(g.p3[1])}`;
  const { dir } = tubeFlow(g, t);
  let s = `<path d="${d}" fill="none" stroke="${th.hoseEdge}" stroke-width="${n2(HOSE_W + lw * 2)}" stroke-linecap="butt"/>`;
  s += `<path d="${d}" fill="none" stroke="${th.hose}" stroke-width="${n2(HOSE_W)}" stroke-linecap="butt"/>`;
  if (dir) {
    // 流れの向きの矢印 (ホースの真ん中)
    const p = bezierAt(g, 0.5);
    let ux = p.dx * dir, uy = p.dy * dir;
    const L = Math.hypot(ux, uy) || 1;
    ux /= L; uy /= L;
    const a = HOSE_W * 0.42, h = HOSE_W * 1.1;
    const pts = [[p.x + ux * h * 0.6, p.y + uy * h * 0.6], [p.x - ux * h * 0.4 - uy * a, p.y - uy * h * 0.4 + ux * a], [p.x - ux * h * 0.4 + uy * a, p.y - uy * h * 0.4 - ux * a]];
    s += `<path d="M${pts.map((q) => q.map(n2).join(" ")).join("L")}Z" fill="${th.stroke}"/>`;
  }
  return s;
}

/* ---- ラベル ---- */

export function labelShown(item) {
  const s = item.part.label?.show;
  return s == null ? item.def.labelDefault !== false : !!s;
}

export function labelText(item, lang) {
  return item.part.label?.text || partLabel(item.def, item.part.params, lang);
}

/* ---- すり合わせのクリップ ---- */

/** メスの口 q の所に、口をはさむ C 字形のクリップを描く (口の右側) */
function renderClip(q, th, lw) {
  const j = jdim(q.size), m = frame(q.wx, q.wy, q.wdir);
  const xr = j.wt / 2 + 1.6, h = Math.min(12, j.ls * 0.45);
  const x0 = j.wt / 2 + 0.4, xo = xr + 3.4;
  const p = new P(m).M(x0, -7).L(xo, -7).L(xo, h + 3).L(xr - 1.4, h + 3).L(xr - 1.4, h + 0.9)
    .L(xr + 0.9, h + 0.9).L(xr + 0.9, -4.8).L(x0, -4.8).Z();
  return `<path d="${p.d}" ${paint("solid", th, lw)}/>`;
}

/* ---- ラベル ---- */

/** ラベルの位置決め: 図の左右に振り分け、上下に重ならないよう詰める。
 *  手で動かしたラベル (pos あり) はその位置のまま */
function layoutLabels(all, core, fs) {
  const cx = (core.x0 + core.x1) / 2;
  const gap = fs * 1.45;
  const sides = { left: [], right: [] };
  const entries = all.filter((e) => !e.pos);
  for (const e of entries) sides[e.side === "left" || e.side === "right" ? e.side : e.ax < cx ? "left" : "right"].push(e);
  // 片側に偏りすぎたら、真ん中に近いもの (向きを指定していないもの) を反対側へ
  const balance = (from, to) => {
    while (sides[from].filter((e) => !e.side).length && sides[from].length > sides[to].length + 3) {
      sides[from].sort((a, b) => !!a.side - !!b.side || Math.abs(a.ax - cx) - Math.abs(b.ax - cx));
      sides[to].push(sides[from].shift());
    }
  };
  balance("left", "right");
  balance("right", "left");
  for (const [side, list] of Object.entries(sides)) {
    list.sort((a, b) => a.ay - b.ay);
    const ys = list.map((e) => e.ay);
    for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + gap);
    // 下にはみ出す分は上へ戻す
    const over = ys.length ? ys[ys.length - 1] - (core.y1 + gap) : 0;
    if (over > 0) {
      ys[ys.length - 1] -= over;
      for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.min(ys[i], ys[i + 1] - gap);
    }
    const ex = side === "left" ? core.x0 - fs * 2.2 : core.x1 + fs * 2.2;
    list.forEach((e, i) => { e.at = side; e.ly = ys[i]; e.ex = ex; });
  }
  for (const e of all) {
    if (!e.pos) continue;
    e.at = e.pos[0] < 0 ? "left" : "right";
    e.ex = e.ax + e.pos[0];
    e.ly = e.ay + e.pos[1];
    sides[e.at].push(e);
  }
  for (const list of Object.values(sides)) list.sort((a, b) => a.ly - b.ly);
  return sides;
}

/* ---- 図全体 ---- */

/**
 * 図を組み立てる。
 *   opts.overlay … 編集画面用 (部品ごとに data-id を付ける)
 * 返り値: { svg (中身), box (図の範囲, 部品座標), scale (mm/部品座標), widthMm, heightMm, labels }
 */
export function composeFigure(doc, solved, opts = {}) {
  const S = doc.settings;
  const th = THEMES[S.theme] || THEMES.line;
  const lang = S.lang;

  // 部品とホースの範囲
  const core = emptyBox();
  for (const it of solved.items.values()) addBox(core, it.box);
  const tubes = doc.tubes.map((t) => ({ t, g: tubeGeometry(solved, t) })).filter((x) => x.g);
  for (const { g } of tubes) addBox(core, tubeBox(g));
  if (isEmpty(core)) return { svg: "", box: { x0: -50, y0: -50, x1: 50, y1: 50 }, scale: 1, widthMm: S.width, heightMm: S.width, labels: [] };

  // 机の線
  let benchY = null;
  if (S.bench) {
    for (const it of solved.items.values()) if (it.def.grounded) benchY = Math.max(benchY ?? -Infinity, it.box.y1);
  }

  // ラベルの対象
  const entries = [];
  if (S.labels !== "none") {
    for (const it of solved.items.values()) {
      if (!labelShown(it)) continue;
      const [ax, ay] = apply(it.m, ...it.shape.anchor);
      entries.push({ id: it.part.id, text: labelText(it, lang), ax, ay, side: it.part.label?.side || null, pos: it.part.label?.pos || null });
    }
    for (const { t, g } of tubes) {
      if (!t.label?.show) continue;
      const p = bezierAt(g, 0.5);
      const medium = tubeFlow(g, t).medium;
      const def = { water: ["冷却水", "cooling water"], vacuum: ["減圧ライン", "to vacuum"], gas: ["ガス", "gas"] }[medium] || ["ホース", "tubing"];
      entries.push({ id: t.id, text: t.label.text || def[lang === "en" ? 1 : 0], ax: p.x, ay: p.y, side: t.label.side || null, pos: t.label.pos || null });
    }
  }

  // 縮尺は図の幅で決まり、図の幅は文字の大きさ (縮尺で変わる) で決まるので、数回くり返して合わせる
  let scale = S.width / Math.max(1, core.x1 - core.x0);
  let fig = null, sides = null, legend = null, fs = 0;
  for (let iter = 0; iter < 4; iter++) {
    fs = (S.font * PT) / scale;
    fig = { ...core };
    if (benchY != null) addPt(fig, core.x0 - fs, benchY + fs);
    sides = layoutLabels(entries, core, fs);
    const numbered = S.labels === "number" || S.labels === "numberOnly";
    let n = 0;
    for (const side of ["left", "right"]) {
      for (const e of sides[side]) {
        e.num = ++n;
        e.shown = numbered ? String(e.num) : e.text;
        const w = measureText(e.shown, fs);
        const tx = side === "left" ? e.ex - fs * 0.4 - w : e.ex + fs * 0.4;
        addPt(fig, tx, e.ly - fs * 0.8);
        addPt(fig, tx + w, e.ly + fs * 0.4);
      }
    }
    legend = null;
    if (S.labels === "number" && entries.length) {
      const all = [...sides.left, ...sides.right];
      const items = all.map((e) => ({ num: e.num, text: e.text, w: measureText(`${e.num}  ${e.text}`, fs) }));
      const colW = Math.max(...items.map((i) => i.w)) + fs * 1.2;
      const avail = fig.x1 - fig.x0;
      const ncol = Math.max(1, Math.min(items.length, Math.floor((avail + fs * 1.2) / colW)));
      const rows = Math.ceil(items.length / ncol);
      const y0 = fig.y1 + fs * 2;
      legend = { items, colW, ncol, rows, x0: fig.x0, y0, lh: fs * 1.3 };
      addPt(fig, fig.x0 + Math.min(ncol * colW, avail), y0 + (rows - 1) * legend.lh + fs * 0.4);
    }
    const pad = 1.5 / scale;
    fig = { x0: fig.x0 - pad, y0: fig.y0 - pad, x1: fig.x1 + pad, y1: fig.y1 + pad };
    const next = S.width / (fig.x1 - fig.x0);
    if (Math.abs(next - scale) / scale < 0.002) { scale = next; break; }
    scale = next;
  }
  fs = (S.font * PT) / scale;
  const lw = S.lw / scale;

  // 部品の描画 (層ごと)
  const layers = { under: "", body: "", over: "" };
  for (const it of solved.items.values()) {
    const L = renderShapeLayers(it.shape, { th, lw, uid: `${opts.uid || "c"}${it.part.id}`, rot: it.part.rot, flip: it.part.flip, fillLiquid: S.liquidFill });
    const attr = opts.overlay ? ` data-id="${it.part.id}"` : "";
    for (const k of LAYERS) if (L[k]) layers[k] += `<g transform="${matStr(it.m)}"${attr}>${L[k]}</g>`;
  }
  // すり合わせのクリップ (ガラスの上に重ねる)
  let clips = "";
  for (const l of doc.links) {
    if (!linkHasClip(doc, l)) continue;
    const qa = itemPort(solved.items.get(l.a.id), l.a.port), qb = itemPort(solved.items.get(l.b.id), l.b.port);
    const f = [qa, qb].find((q) => q?.kind === "joint" && q.gender === "F");
    if (f && qa.kind === "joint" && qb.kind === "joint") clips += renderClip(f, th, lw);
  }
  let svg = layers.under + layers.body + layers.over + clips;
  for (const { t, g } of tubes) svg += `<g${opts.overlay ? ` data-tube="${t.id}"` : ""}>${renderTube(g, t, th, lw)}</g>`;

  if (benchY != null) {
    const x0 = core.x0 - fs, x1 = core.x1 + fs;
    let b = `<path d="M${n2(x0)} ${n2(benchY)}H${n2(x1)}" ${paint("line", th, lw)}/>`;
    for (let x = x0 + fs * 0.6; x < x1; x += fs * 0.9) b += `<path d="M${n2(x)} ${n2(benchY)}l${n2(-fs * 0.6)} ${n2(fs * 0.6)}" ${paint("thin", th, lw)}/>`;
    svg = b + svg;
  }

  // ラベル
  const text = (x, y, s, anchor) =>
    `<text x="${n2(x)}" y="${n2(y)}" font-family="${FONT_FAMILY}" font-size="${n2(fs)}" fill="${th.stroke}"${anchor ? ` text-anchor="${anchor}"` : ""}>${esc(s)}</text>`;
  let lab = "";
  for (const side of ["left", "right"]) {
    for (const e of sides[side]) {
      const lead = `M${n2(e.ax)} ${n2(e.ay)}L${n2(e.ex)} ${n2(e.ly)}`;
      let g = `<path d="${lead}" fill="none" stroke="${th.stroke}" stroke-width="${n2(lw * 0.6)}"/>`;
      g += `<circle cx="${n2(e.ax)}" cy="${n2(e.ay)}" r="${n2(lw * 1.6)}" fill="${th.stroke}"/>`;
      const tx = side === "left" ? e.ex - fs * 0.4 : e.ex + fs * 0.4;
      g += text(tx, e.ly + fs * 0.35, e.shown, side === "left" ? "end" : null);
      if (opts.overlay) {
        // 画面ではラベルをつかみやすいよう、文字の周りに透明な当たり判定を置く
        const w = measureText(e.shown, fs) + fs * 0.8, x0 = side === "left" ? tx - w + fs * 0.4 : tx - fs * 0.4;
        g += `<rect x="${n2(x0)}" y="${n2(e.ly - fs * 0.9)}" width="${n2(w)}" height="${n2(fs * 1.6)}" fill="transparent"/>`;
      }
      lab += opts.overlay ? `<g data-label="${e.id}">${g}</g>` : g;
    }
  }
  if (legend) {
    legend.items.forEach((it, i) => {
      const col = Math.floor(i / legend.rows), row = i % legend.rows;
      const x = legend.x0 + col * legend.colW, y = legend.y0 + row * legend.lh;
      lab += text(x, y, `${it.num}`, null) + text(x + fs * (it.num > 9 ? 1.5 : 1.0), y, it.text, null);
    });
  }
  svg += `<g${opts.overlay ? ' data-labels="1"' : ""}>${lab}</g>`;

  return {
    svg, box: fig, scale, lw, fs,
    legendText: [...sides.left, ...sides.right].map((e) => `${e.num} ${e.text}`),
    widthMm: (fig.x1 - fig.x0) * scale, heightMm: (fig.y1 - fig.y0) * scale,
    labels: [...sides.left, ...sides.right],
  };
}

/** 書き出し用の完全な SVG 文書 */
export function figureSvgDocument(fig, bg = null) {
  const b = fig.box;
  const vb = `${n2(b.x0)} ${n2(b.y0)} ${n2(b.x1 - b.x0)} ${n2(b.y1 - b.y0)}`;
  const back = bg ? `<rect x="${n2(b.x0)}" y="${n2(b.y0)}" width="${n2(b.x1 - b.x0)}" height="${n2(b.y1 - b.y0)}" fill="${bg}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${n2(fig.widthMm)}mm" height="${n2(fig.heightMm)}mm" viewBox="${vb}">\n<!-- ラボつみき (LabTsumiki) で作成。この図は CC0 (パブリックドメイン) -->\n${back}${fig.svg}\n</svg>\n`;
}
