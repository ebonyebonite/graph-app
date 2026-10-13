/* 自動の整列: 見やすく、実際の配置としてもおかしくないように部品の集まりを動かす。
 *  - ラボジャッキの高さを、吊り下がった受け器が机に当たらない高さにする
 *  - 机に置く物 (grounded) を含む集まりを同じ床の高さに揃える
 *  - スタンドをクランプの位置に合わせて置く
 *  - (full) 集まり同士を左から順に、一定の間隔で並べる
 *  - ホースだけでつながる小物 (蛇口など) を相手の近くに置く */

import { solve, compBox, moveParts, itemPort } from "./scene.js";
import { unitVec } from "./geom.js";

const GAP = 18;

export function tidy(doc, { full = false } = {}) {
  let sv = solve(doc);

  // 1) ラボジャッキの高さ
  let changed = false;
  for (const comp of sv.comps) {
    const root = sv.items.get(comp[0]);
    if (root.def.type !== "jack" || !root.part.params.autoHeight || comp.length < 2) continue;
    let lowest = -Infinity;
    for (const id of comp) if (id !== root.part.id) lowest = Math.max(lowest, sv.items.get(id).box.y1);
    const bottom = root.box.y1;
    const h = Math.round(Math.min(250, Math.max(20, root.part.params.height + lowest + 12 - bottom)));
    if (h !== root.part.params.height) { root.part.params.height = h; changed = true; }
  }
  if (changed) sv = solve(doc);

  const groundedComps = sv.comps.filter((c) => c.some((id) => sv.items.get(id).def.grounded));
  const isStand = (c) => c.length === 1 && sv.items.get(c[0]).def.type === "stand";

  // 2) 床に揃える (いちばん部品の多い集まりの底を床とする)
  if (groundedComps.length) {
    const main = groundedComps.filter((c) => !isStand(c)).sort((a, b) => b.length - a.length)[0] || groundedComps[0];
    const floor = compBox(sv, main).y1;
    for (const c of groundedComps) {
      if (isStand(c)) continue;
      const dy = floor - compBox(sv, c).y1;
      if (Math.abs(dy) > 0.01) moveParts(doc, new Set(c), 0, dy);
    }
    sv = solve(doc);

    // 3) 左から順に一定の間隔で並べる
    if (full) {
      const list = groundedComps.filter((c) => !isStand(c)).map((c) => ({ c, b: compBox(sv, c) }));
      list.sort((a, b) => a.b.x0 - b.b.x0);
      let right = -Infinity;
      for (const e of list) {
        const dx = right === -Infinity ? 0 : right + GAP - e.b.x0;
        if (dx) { moveParts(doc, new Set(e.c), dx, 0); e.b.x0 += dx; e.b.x1 += dx; }
        right = Math.max(right, e.b.x1);
      }
      sv = solve(doc);
    }

    // 4) スタンドをクランプに合わせる
    const clamps = [...sv.items.values()].filter((it) => it.def.type === "clamp" && itemPort(it, "grip")?.link);
    const stands = [...sv.items.values()].filter((it) => it.def.type === "stand" && it.part.params.auto);
    if (stands.length && clamps.length) {
      const groups = new Map(stands.map((s) => [s.part.id, []]));
      for (const c of clamps) {
        const rod = itemPort(c, "rod");
        let best = null, bd = Infinity;
        for (const s of stands) {
          const d = Math.abs(s.part.x - rod.wx);
          if (d < bd) { bd = d; best = s; }
        }
        groups.get(best.part.id).push(rod);
      }
      for (const s of stands) {
        const rods = groups.get(s.part.id);
        if (!rods.length) continue;
        const top = Math.min(...rods.map((r) => r.wy));
        s.part.x = rods[0].wx;
        s.part.y = floor;
        s.part.rot = 0;
        s.part.flip = false;
        s.part.params.height = Math.round(Math.min(800, Math.max(150, floor - top + 30)));
      }
      sv = solve(doc);
    }
  }

  // 5) ホースだけでつながる小物を相手の近くへ
  const singles = new Set(sv.comps.filter((c) => c.length === 1).map((c) => c[0]));
  const taken = [];
  for (const it of sv.items.values()) {
    if (!it.def.autoPlace || !singles.has(it.part.id) || (it.part.placed && !full)) continue;
    const mates = [];
    for (const t of doc.tubes) {
      const other = t.a.id === it.part.id ? t.b : t.b.id === it.part.id ? t.a : null;
      if (!other || other.id === it.part.id) continue;
      const o = sv.items.get(other.id);
      const q = o && itemPort(o, other.port);
      if (q) mates.push(q);
    }
    if (!mates.length) continue;
    const own = itemPort(it, it.shape.ports.find((q) => q.kind === "hose")?.id);
    if (!own) continue;
    let tx, ty;
    if (mates.length === 1) {
      // 相手の口の向きに少し出た所の、横か下に置く (ホースが U 字に曲がって届く)
      const [ux, uy] = unitVec(mates[0].wdir);
      tx = mates[0].wx + ux * 45 + (Math.abs(ux) > 0.7 ? 0 : 35);
      ty = mates[0].wy + uy * 45 + 40;
    } else {
      tx = mates.reduce((s, q) => s + q.wx, 0) / mates.length;
      ty = Math.min(...mates.map((q) => q.wy)) - 30;
    }
    // 他の小物と重ならないよう、横にずらす
    while (taken.some(([x, y]) => Math.abs(x - tx) < 26 && Math.abs(y - ty) < 40)) tx += 30;
    taken.push([tx, ty]);
    moveParts(doc, new Set([it.part.id]), tx - own.wx, ty - own.wy);
  }
  return solve(doc);
}
