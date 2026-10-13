// 位置の計算・接続・整列・ひな形の基本の動きを確かめる (node --test tests/)
import { test } from "node:test";
import assert from "node:assert/strict";
import "../js/parts/index.js";
import { allDefs, withDefaults } from "../js/parts/registry.js";
import { newDoc, addPart, solve, canMate, itemPort, normalizeDoc, transformParts, componentOf } from "../js/scene.js";
import { tidy } from "../js/layout.js";
import { TEMPLATES, instantiate } from "../js/templates.js";
import { composeFigure, figureSvgDocument } from "../js/compose.js";
import { runChecks } from "../js/checks.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("すべての部品が既定値で形を作れ、接続口の id が重ならない", () => {
  for (const def of allDefs()) {
    const sh = def.build(withDefaults(def, {}), {});
    assert.ok(sh.items.length > 0, def.type);
    const ids = sh.ports.map((q) => q.id);
    assert.equal(new Set(ids).size, ids.length, def.type);
    for (const q of sh.ports) assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.dir), `${def.type}.${q.id}`);
  }
});

test("つないだ口は同じ点で向かい合う", () => {
  const doc = newDoc();
  const f = addPart(doc, "rbf", {}, 10, 20);
  const h = addPart(doc, "stillHead", {}, 300, 0);
  const c = addPart(doc, "liebig", {}, 0, 300);
  doc.links.push({ a: { id: f.id, port: "neck" }, b: { id: h.id, port: "bottom" } });
  doc.links.push({ a: { id: h.id, port: "arm" }, b: { id: c.id, port: "in" } });
  const sv = solve(doc);
  for (const [a, pa, b, pb] of [[f.id, "neck", h.id, "bottom"], [h.id, "arm", c.id, "in"]]) {
    const qa = itemPort(sv.items.get(a), pa), qb = itemPort(sv.items.get(b), pb);
    close(qa.wx, qb.wx);
    close(qa.wy, qb.wy);
    close(Math.abs(((qa.wdir - qb.wdir + 540) % 360) - 180), 180);
  }
  // 根 (先に置いたフラスコ) は動かない
  assert.equal(f.x, 10);
  assert.equal(f.y, 20);
});

test("すり合わせはオスとメス、同じ大きさのときだけ (大きさ違いは調整扱い)", () => {
  assert.deepEqual(canMate({ kind: "joint", gender: "M", size: "24/40" }, { kind: "joint", gender: "F", size: "24/40" }), { adjust: false });
  assert.deepEqual(canMate({ kind: "joint", gender: "M", size: "14/20" }, { kind: "joint", gender: "F", size: "24/40" }), { adjust: true });
  assert.equal(canMate({ kind: "joint", gender: "M", size: "24/40" }, { kind: "joint", gender: "M", size: "24/40" }), null);
  assert.ok(canMate({ kind: "base" }, { kind: "stage" }));
  assert.equal(canMate({ kind: "base" }, { kind: "base" }), null);
});

test("容量を変えると、台に合わせて上の部品が動く", () => {
  const doc = newDoc();
  const m = addPart(doc, "mantle");
  const f = addPart(doc, "rbf", { volume: 100 });
  const h = addPart(doc, "stillHead");
  doc.links.push({ a: { id: m.id, port: "stage" }, b: { id: f.id, port: "base" } }, { a: { id: f.id, port: "neck" }, b: { id: h.id, port: "bottom" } });
  const y1 = (solve(doc), h.y);
  f.params.volume = 500;
  const sv = solve(doc);
  assert.ok(h.y < y1 - 20, "大きいフラスコでヘッドが上へ");
  close(sv.items.get(m.id).ctx.fit, itemPort(sv.items.get(f.id), "base").width, 0.1);
  assert.equal(m.x, 0);
});

test("減圧アダプターの出口は自動で鉛直になる", () => {
  const doc = instantiate(TEMPLATES.find((t) => t.id === "vacuumDistillation"));
  const sv = solve(doc);
  const vad = [...sv.items.values()].find((it) => it.def.type === "vacAdapter");
  close(itemPort(vad, "out").wdir, 90, 0.5);
});

test("温度計の球部は枝管の高さに自動で入る", () => {
  const doc = newDoc();
  const h = addPart(doc, "stillHead");
  const t = addPart(doc, "thermometer");
  doc.links.push({ a: { id: h.id, port: "top" }, b: { id: t.id, port: "joint" } });
  const sv = solve(doc);
  const probe = sv.items.get(t.id).ctx.probe;
  const arm = itemPort(sv.items.get(h.id), "arm"), top = itemPort(sv.items.get(h.id), "top");
  assert.ok(probe > 0);
  assert.ok(top.wy + probe > arm.wy - 20 && top.wy + probe < arm.wy + 10, "枝管の付け根の近く");
});

test("左右反転してもつながりは保たれる", () => {
  const doc = instantiate(TEMPLATES.find((t) => t.id === "simpleDistillation"));
  const any = doc.parts[0].id;
  transformParts(doc, componentOf(doc, any), [-1, 0, 0, 1, 0, 0]);
  const sv = solve(doc);
  for (const l of doc.links) {
    const qa = itemPort(sv.items.get(l.a.id), l.a.port), qb = itemPort(sv.items.get(l.b.id), l.b.port);
    close(qa.wx, qb.wx, 1e-4);
    close(qa.wy, qb.wy, 1e-4);
  }
});

test("ひな形はすべて組み立てられ、机に置く物は同じ床に揃う", () => {
  for (const tpl of TEMPLATES) {
    const doc = instantiate(tpl);
    const sv = solve(doc);
    assert.equal(doc.links.length, tpl.links.length, `${tpl.id}: つながりが減っていない`);
    const floors = sv.comps
      .filter((c) => c.some((id) => sv.items.get(id).def.grounded) && !(c.length === 1 && sv.items.get(c[0]).def.type === "stand"))
      .map((c) => Math.max(...c.map((id) => sv.items.get(id).box.y1)));
    for (const y of floors) close(y, floors[0], 1e-3);
    const fig = composeFigure(doc, sv);
    assert.ok(fig.widthMm > 84 && fig.widthMm < 86, `${tpl.id}: 図の幅 ${fig.widthMm}`);
    const svg = figureSvgDocument(fig);
    assert.ok(!/NaN|undefined|Infinity/.test(svg), `${tpl.id}: SVG に壊れた値がない`);
    assert.ok(!/style=/.test(svg), `${tpl.id}: style 属性を使わない (CSP)`);
  }
});

test("ひな形には確認の警告が出ない", () => {
  for (const tpl of TEMPLATES) {
    const doc = instantiate(tpl);
    const warns = runChecks(doc, solve(doc)).filter((r) => r.level === "warn");
    assert.deepEqual(warns.map((w) => w.text), [], tpl.id);
  }
});

test("冷却水を逆につなぐと警告が出る", () => {
  const doc = instantiate(TEMPLATES.find((t) => t.id === "reflux"));
  const t = doc.tubes.find((x) => [x.a.port, x.b.port].includes("waterIn"));
  t.arrow = t.a.port === "waterIn" ? "ab" : "ba";
  assert.ok(runChecks(doc, solve(doc)).some((r) => r.text.includes("向きが逆")));
});

test("密閉した装置の加熱は警告が出る", () => {
  const doc = newDoc();
  const m = addPart(doc, "mantle"), f = addPart(doc, "rbf"), s = addPart(doc, "stopper");
  doc.links.push({ a: { id: m.id, port: "stage" }, b: { id: f.id, port: "base" } }, { a: { id: f.id, port: "neck" }, b: { id: s.id, port: "joint" } });
  assert.ok(runChecks(doc, solve(doc)).some((r) => r.text.includes("密閉")));
});

test("保存データを読み直しても同じ図になる", () => {
  const doc = instantiate(TEMPLATES[0]);
  const a = figureSvgDocument(composeFigure(doc, solve(doc)));
  const doc2 = normalizeDoc(JSON.parse(JSON.stringify(doc)));
  const b = figureSvgDocument(composeFigure(doc2, solve(doc2)));
  assert.equal(a, b);
});

test("整列をくり返しても位置が変わらない", () => {
  const doc = instantiate(TEMPLATES[0]);
  const before = JSON.stringify(doc.parts.map((p) => [p.x.toFixed(3), p.y.toFixed(3)]));
  tidy(doc, { full: true });
  tidy(doc);
  assert.equal(JSON.stringify(doc.parts.map((p) => [p.x.toFixed(3), p.y.toFixed(3)])), before);
});

test("クリップは設定・つながりごとの指定に従って描かれる", () => {
  const doc = instantiate(TEMPLATES.find((t) => t.id === "simpleDistillation"));
  const count = () => (figureSvgDocument(composeFigure(doc, solve(doc))).match(/<path d="[^"]*"[^>]*>/g) || []).length;
  const base = count();
  doc.settings.clips = true;
  const all = count();
  const joints = doc.links.filter((l) => {
    const sv = solve(doc);
    return itemPort(sv.items.get(l.a.id), l.a.port).kind === "joint" && itemPort(sv.items.get(l.b.id), l.b.port).kind === "joint";
  }).length;
  assert.equal(all - base, joints);
  doc.links[2].clip = false;
  assert.ok(count() <= all);
});

test("手で動かしたラベルはその位置に描かれる", () => {
  const doc = instantiate(TEMPLATES.find((t) => t.id === "reflux"), { labels: "name" });
  const flask = doc.parts.find((p) => p.type === "rbf");
  flask.label.pos = [-40, -15];
  const fig = composeFigure(doc, solve(doc));
  const L = fig.labels.find((e) => e.id === flask.id);
  close(L.ex - L.ax, -40);
  close(L.ly - L.ay, -15);
  assert.equal(L.at, "left");
  const doc2 = normalizeDoc(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(doc2.parts.find((p) => p.id === flask.id).label.pos, [-40, -15]);
});

test("新しい器具のひな形: 分配器の受け器と、ロータリーエバポレーターのフラスコ", () => {
  const doc = instantiate(TEMPLATES.find((t) => t.id === "fractionalVacuum"));
  const sv = solve(doc);
  const cow = [...sv.items.values()].find((it) => it.def.type === "cowReceiver");
  close(cow.part.rot, 0, 0.5);
  assert.equal(cow.ports.filter((q) => q.id.startsWith("out") && q.link).length, 3);
  const d2 = instantiate(TEMPLATES.find((t) => t.id === "rotavap"));
  const s2 = solve(d2);
  const flask = [...s2.items.values()].find((it) => it.def.type === "pear");
  const evap = [...s2.items.values()].find((it) => it.def.type === "rotavap");
  assert.ok(flask.box.y1 > evap.box.y0 && flask.box.y1 < evap.box.y1, "フラスコは装置の高さの中");
});
