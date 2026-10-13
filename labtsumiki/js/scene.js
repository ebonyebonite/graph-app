/* 図全体のデータ (doc) と、つながりから各部品の位置を決める計算 (solve)。
 *
 * doc = {
 *   version, seq,
 *   parts: [{ id, type, params, x, y, rot, flip, label: { show, text }, placed }],
 *   links: [{ a: { id, port }, b: { id, port } }]   … すり合わせなど、固くつながる接続
 *   tubes: [{ id, a: { id, port }, b: { id, port }, arrow, label }] … ホース (柔らかい接続)
 *   settings: { ... 書き出しの体裁 }
 * }
 * 部品の x, y, rot, flip は「部品の座標の原点」が全体のどこにあるか。つながった部品の位置は
 * 根 (root) の部品から順に計算し直して書き戻すので、いつも互いに矛盾しない。 */

import { getDef, hasDef, withDefaults } from "./parts/registry.js";
import { mat, mul, inv, apply, decompose, worldDir, normAngle, emptyBox, addBox, transformBox } from "./geom.js";

export const DEFAULT_SETTINGS = {
  theme: "line",     // 描き方 (今は線画だけ)
  liquidFill: false, // 液体を薄い灰色で塗る (ふだんは液面の線だけ)
  width: 85,         // 書き出す図の幅 (mm)
  lw: 0.25,          // 線の太さ (mm)
  font: 8,           // 文字の大きさ (pt)
  labels: "number",  // number (番号と凡例) | numberOnly (番号だけ) | name (名前を直接) | none
  lang: "ja",        // ラベルの言語 ja | en
  bench: false,      // 机の線を描く
  autoTidy: true,    // つないだ・動かした後に自動で床に揃える
  clips: false,      // すり合わせのクリップをすべてに描く (つながりごとに変えられる)
};

export function newDoc() {
  return { version: 1, seq: 1, parts: [], links: [], tubes: [], settings: { ...DEFAULT_SETTINGS } };
}

/** 読み込んだデータを今の形に整える (足りない値を補い、知らない部品は捨てる) */
export function normalizeDoc(d) {
  const doc = newDoc();
  if (!d || typeof d !== "object") return doc;
  doc.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  const ids = new Set();
  for (const p of d.parts || []) {
    if (!p || !hasDef(p.type) || ids.has(p.id)) continue;
    ids.add(p.id);
    doc.parts.push({
      id: String(p.id), type: p.type, params: withDefaults(getDef(p.type), p.params || {}),
      x: +p.x || 0, y: +p.y || 0, rot: +p.rot || 0, flip: !!p.flip,
      label: { show: p.label?.show ?? null, text: p.label?.text || "", side: p.label?.side || null, pos: cleanPos(p.label?.pos) },
      placed: !!p.placed,
    });
  }
  const okEnd = (e) => e && ids.has(e.id) && typeof e.port === "string";
  doc.links = (d.links || []).filter((l) => okEnd(l.a) && okEnd(l.b)).map((l) => ({ a: { ...l.a }, b: { ...l.b }, clip: typeof l.clip === "boolean" ? l.clip : null }));
  doc.tubes = (d.tubes || []).filter((t) => okEnd(t.a) && okEnd(t.b)).map((t) => ({
    id: String(t.id), a: { ...t.a }, b: { ...t.b }, arrow: t.arrow || "auto",
    label: { show: !!t.label?.show, text: t.label?.text || "", side: t.label?.side || null, pos: cleanPos(t.label?.pos) },
  }));
  let max = 0;
  for (const x of [...doc.parts, ...doc.tubes]) max = Math.max(max, Number(String(x.id).replace(/\D/g, "")) || 0);
  doc.seq = Math.max(Number(d.seq) || 1, max + 1);
  return doc;
}

/** ラベルを手で動かした位置 (引き出し線の根元からのずれ) */
function cleanPos(v) {
  return Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) ? [v[0], v[1]] : null;
}

/** すり合わせのクリップを描くか (つながりごとの指定が無ければ図全体の設定) */
export function linkHasClip(doc, l) {
  return l.clip ?? !!doc.settings.clips;
}

export function addPart(doc, type, params = {}, x = 0, y = 0) {
  const def = getDef(type);
  const part = {
    id: `p${doc.seq++}`, type, params: withDefaults(def, params),
    x, y, rot: 0, flip: false, label: { show: null, text: "" }, placed: false,
  };
  doc.parts.push(part);
  return part;
}

export function getPart(doc, id) {
  return doc.parts.find((p) => p.id === id);
}

export function removePart(doc, id) {
  doc.parts = doc.parts.filter((p) => p.id !== id);
  doc.links = doc.links.filter((l) => l.a.id !== id && l.b.id !== id);
  doc.tubes = doc.tubes.filter((t) => t.a.id !== id && t.b.id !== id);
}

/** 部品につながったすり合わせ等をすべて外す */
export function detachPart(doc, id) {
  doc.links = doc.links.filter((l) => l.a.id !== id && l.b.id !== id);
}

export function addTube(doc, a, b) {
  const t = { id: `t${doc.seq++}`, a: { ...a }, b: { ...b }, arrow: "auto", label: { show: false, text: "" } };
  doc.tubes.push(t);
  return t;
}

/* ---- 接続の相性 ---- */

/** 2 つの接続口をつなげるか。つなげなければ null、つなげれば { adjust } (すり合わせの大きさ違いなら true) */
export function canMate(pa, pb) {
  if (pa.kind === "joint" && pb.kind === "joint") {
    if (!pa.gender || !pb.gender || pa.gender === pb.gender) return null;
    return { adjust: pa.size !== pb.size };
  }
  const pair = new Set([pa.kind, pb.kind]);
  if (pair.size === 2 && pair.has("stem") && pair.has("mouth")) return { adjust: false };
  // 内すりは、すり合わせの無い口 (三角フラスコなど) にも差し込める
  const male = pa.kind === "joint" ? pa : pb.kind === "joint" ? pb : null;
  if (pair.size === 2 && pair.has("joint") && pair.has("mouth") && male.gender === "M") return { adjust: false };
  if (pair.size === 2 && pair.has("base") && pair.has("stage")) return { adjust: false };
  if (pa.kind === "grip" && pb.kind === "grip" && (pa.gender === "C") !== (pb.gender === "C")) return { adjust: false };
  return null;
}

/* ---- 形を作る (同じ値ならキャッシュを使う) ---- */

const shapeCache = new Map();

export function buildShape(def, params, ctx = {}) {
  const key = `${def.type}|${JSON.stringify(params)}|${JSON.stringify(ctx)}`;
  let sh = shapeCache.get(key);
  if (!sh) {
    sh = def.build(params, ctx);
    if (shapeCache.size > 800) shapeCache.clear();
    shapeCache.set(key, sh);
  }
  return sh;
}

export function portOf(shape, id) {
  return shape.ports.find((q) => q.id === id) || null;
}

export function partMatrix(part) {
  return mat(part.x, part.y, part.rot, part.flip);
}

/** 部品の接続口 q を、全体の点 (X, Y)・向き D にぴったり合わせる位置 */
export function alignTo(part, q, X, Y, D) {
  const rot = normAngle(D + 180 - (part.flip ? 180 - q.dir : q.dir));
  const [px, py] = apply(mat(0, 0, rot, part.flip), q.x, q.y);
  return { x: X - px, y: Y - py, rot };
}

/** 部品の集まり ids を行列 T で動かす */
export function transformParts(doc, ids, T) {
  for (const p of doc.parts) {
    if (!ids.has(p.id)) continue;
    const d = decompose(mul(T, partMatrix(p)));
    p.x = d.x; p.y = d.y; p.rot = d.rot; p.flip = d.flip;
  }
}

/** 部品を (dx, dy) だけ動かす */
export function moveParts(doc, ids, dx, dy) {
  for (const p of doc.parts) if (ids.has(p.id)) { p.x += dx; p.y += dy; }
}

/* ---- つながりの計算 ---- */

function adjacency(doc) {
  const adj = new Map(doc.parts.map((p) => [p.id, []]));
  for (const l of doc.links) {
    adj.get(l.a.id)?.push({ my: l.a.port, other: l.b.id, their: l.b.port });
    adj.get(l.b.id)?.push({ my: l.b.port, other: l.a.id, their: l.a.port });
  }
  return adj;
}

/** つながった部品の集まり (連結成分) の一覧 */
export function components(doc) {
  const adj = adjacency(doc);
  const seen = new Set(), comps = [];
  for (const p of doc.parts) {
    if (seen.has(p.id)) continue;
    const comp = [], stack = [p.id];
    seen.add(p.id);
    while (stack.length) {
      const id = stack.pop();
      comp.push(id);
      for (const e of adj.get(id)) if (!seen.has(e.other)) { seen.add(e.other); stack.push(e.other); }
    }
    comps.push(comp);
  }
  return comps;
}

export function componentOf(doc, id) {
  return new Set(components(doc).find((c) => c.includes(id)) || [id]);
}

/**
 * つながりにしたがって全部品の位置を計算し直す。結果:
 *   items: Map(id → { part, def, shape, m, ports: [{...接続口, wx, wy, wdir, link}], box })
 *   comps: 連結成分の一覧 (根が先頭)
 */
export function solve(doc) {
  const defs = new Map(doc.parts.map((p) => [p.id, getDef(p.type)]));
  const byId = new Map(doc.parts.map((p) => [p.id, p]));

  // 1) まず周りに関係なく形を作り、無くなった接続口へのつながりを捨てる
  const pre = new Map();
  for (const p of doc.parts) pre.set(p.id, buildShape(defs.get(p.id), p.params, {}));
  const hasPort = (e) => pre.has(e.id) && portOf(pre.get(e.id), e.port);
  doc.links = doc.links.filter((l) => hasPort(l.a) && hasPort(l.b));
  doc.tubes = doc.tubes.filter((t) => hasPort(t.a) && hasPort(t.b));
  const adj = adjacency(doc);
  const linkOf = new Map();
  for (const l of doc.links) {
    linkOf.set(`${l.a.id}:${l.a.port}`, l.b);
    linkOf.set(`${l.b.id}:${l.b.port}`, l.a);
  }

  // 2) 周りから決まる値 (台の大きさ・差し込む深さ)
  const probeDepth = (id, portId, guard = 0) => {
    const q = portOf(pre.get(id), portId);
    if (!q?.probe || guard > 8) return 0;
    let d = q.probe.depth;
    if (q.probe.through) {
      const mate = linkOf.get(`${id}:${q.probe.through}`);
      if (mate) d += probeDepth(mate.id, mate.port, guard + 1);
    }
    return d;
  };
  const ctxOf = new Map();
  for (const p of doc.parts) {
    const ctx = {};
    for (const q of pre.get(p.id).ports) {
      const mate = linkOf.get(`${p.id}:${q.id}`);
      if (!mate) continue;
      const mq = portOf(pre.get(mate.id), mate.port);
      if ((q.kind === "stage" || (q.kind === "grip" && q.gender === "C")) && mq.width) ctx.fit = Math.round(mq.width * 10) / 10;
      if (q.kind === "joint" && q.gender === "M" && mq.probe) ctx.probe = Math.round(probeDepth(mate.id, mate.port) * 10) / 10;
    }
    ctxOf.set(p.id, ctx);
  }
  const shapes = new Map();
  for (const p of doc.parts) shapes.set(p.id, buildShape(defs.get(p.id), p.params, ctxOf.get(p.id)));

  // 3) 連結成分ごとに根を選び、根から順に位置を決める
  const comps = components(doc).map((comp) => {
    const score = (id) => {
      const def = defs.get(id);
      if (!def.grounded) return 2;
      const base = portOf(shapes.get(id), "base");
      return base && linkOf.has(`${id}:base`) ? 1 : 0;
    };
    const order = new Map(doc.parts.map((p, i) => [p.id, i]));
    comp.sort((a, b) => score(a) - score(b) || order.get(a) - order.get(b));
    return comp;
  });

  const mats = new Map();
  for (const comp of comps) {
    const root = byId.get(comp[0]);
    mats.set(root.id, partMatrix(root));
    const queue = [root.id], seen = new Set([root.id]);
    while (queue.length) {
      const id = queue.shift();
      const cur = byId.get(id), m = mats.get(id);
      for (const e of adj.get(id)) {
        if (seen.has(e.other)) continue;
        seen.add(e.other);
        const nb = byId.get(e.other), def = defs.get(e.other);
        const pq = portOf(shapes.get(id), e.my);
        const [X, Y] = apply(m, pq.x, pq.y);
        const D = worldDir(cur.rot, cur.flip, pq.dir);
        if (def.adapt) {
          const patch = def.adapt(nb.params, { port: e.their, parentDir: D, flip: nb.flip });
          if (patch && Object.entries(patch).some(([k, v]) => nb.params[k] !== v)) {
            Object.assign(nb.params, patch);
            shapes.set(nb.id, buildShape(def, nb.params, ctxOf.get(nb.id)));
          }
        }
        const nq = portOf(shapes.get(nb.id), e.their);
        Object.assign(nb, alignTo(nb, nq, X, Y, D));
        mats.set(nb.id, partMatrix(nb));
        queue.push(nb.id);
      }
    }
  }

  // 4) 全体の座標での接続口と外接矩形
  const items = new Map();
  for (const p of doc.parts) {
    const shape = shapes.get(p.id), m = mats.get(p.id) || partMatrix(p);
    const ports = shape.ports.map((q) => {
      const [wx, wy] = apply(m, q.x, q.y);
      return { ...q, wx, wy, wdir: worldDir(p.rot, p.flip, q.dir), link: linkOf.get(`${p.id}:${q.id}`) || null };
    });
    items.set(p.id, { part: p, def: defs.get(p.id), shape, m, ports, box: transformBox(shape.box, m), ctx: ctxOf.get(p.id) });
  }
  return { items, comps };
}

export function itemPort(item, id) {
  return item.ports.find((q) => q.id === id) || null;
}

export function compBox(solved, ids) {
  const b = emptyBox();
  for (const id of ids) {
    const it = solved.items.get(id);
    if (it) addBox(b, it.box);
  }
  return b;
}

/** 部品の集まりを、接続口 q (集まりの中の部品 part のもの) が相手の接続口 t に合う位置へ動かす行列 */
export function snapTransform(part, q, t) {
  const target = alignTo(part, q, t.wx, t.wy, t.wdir);
  const after = mat(target.x, target.y, target.rot, part.flip);
  return mul(after, inv(partMatrix(part)));
}
