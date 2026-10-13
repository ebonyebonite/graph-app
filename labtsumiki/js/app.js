/* 画面の操作: 部品一覧・キャンバス (ドラッグでつなぐ)・設定欄・書き出し */

import "./parts/index.js";
import { CATEGORIES, allDefs, getDef, withDefaults, partLabel } from "./parts/registry.js";
import {
  newDoc, normalizeDoc, addPart, getPart, removePart, detachPart, addTube, canMate, solve, componentOf,
  transformParts, moveParts, snapTransform, buildShape, itemPort, compBox, linkHasClip,
} from "./scene.js";
import { composeFigure, labelText, tubeGeometry } from "./compose.js";
import { tidy } from "./layout.js";
import { TEMPLATES, instantiate } from "./templates.js";
import { runChecks } from "./checks.js";
import { shapeToSvg } from "./render.js";
import { THEMES } from "./theme.js";
import { mul, mat, n2, dist } from "./geom.js";
import { exportSvg, exportPng, printFigure, saveJson } from "./export.js";

const $ = (id) => document.getElementById(id);
const STORE = "labtsumiki-doc-v1";
const SNAP_KINDS = new Set(["joint", "stem", "mouth", "base", "stage", "grip"]);
const KIND_NAMES = { joint: "すり合わせ", stem: "足", mouth: "口", base: "底", stage: "台", grip: "クランプ", hose: "ホース口", rod: "支柱" };
const PORT_NAMES = {
  neck: "口", neck2: "右の口", neck3: "左の口", base: "底", grip: "挟む所", bottom: "下", top: "上", top1: "上 (まっすぐ)", top2: "上 (枝)",
  arm: "枝管", in: "入口", out: "出口", hose: "ホース口", waterIn: "冷却水 入口", waterOut: "冷却水 出口", stage: "台", mouth: "口",
  stem: "足", joint: "差し込み", rod: "支柱", floor: "床", a: "口 A", b: "口 B", c: "口 C",
};

const state = {
  doc: newDoc(), solved: null, fig: null, sel: null,
  view: { k: 2, tx: 0, ty: 0 },
  hose: false, hoseStart: null, pointer: null,
  drag: null, pointers: new Map(), pinch: null,
  past: [], future: [], name: "labtsumiki",
};
let saved = "";

/* ================= 履歴・保存 ================= */

function snapshot() {
  return JSON.stringify(state.doc);
}

function commit() {
  const s = snapshot();
  if (s === saved) return;
  state.past.push(saved);
  if (state.past.length > 150) state.past.shift();
  state.future = [];
  saved = s;
  persist();
  updateUndo();
}

function loadSnapshot(s) {
  state.doc = normalizeDoc(JSON.parse(s));
  saved = s;
  if (state.sel && !(state.sel.type === "part" ? getPart(state.doc, state.sel.id) : state.doc.tubes.find((t) => t.id === state.sel.id))) state.sel = null;
  persist();
  updateUndo();
  refresh();
}

function undo() {
  if (!state.past.length) return;
  state.future.push(saved);
  loadSnapshot(state.past.pop());
}

function redo() {
  if (!state.future.length) return;
  state.past.push(saved);
  loadSnapshot(state.future.pop());
}

function updateUndo() {
  $("btn-undo").disabled = !state.past.length;
  $("btn-redo").disabled = !state.future.length;
}

function persist() {
  try { localStorage.setItem(STORE, saved); } catch { /* 保存できなくても動かす */ }
}

function replaceDoc(doc, name) {
  state.doc = doc;
  if (name) state.name = name;
  state.sel = null;
  state.hoseStart = null;
  commit();
  refresh();
  fitView();
}

/* ================= 描画 ================= */

function refresh({ inspector = true } = {}) {
  state.solved = solve(state.doc);
  state.fig = composeFigure(state.doc, state.solved, { overlay: true, uid: "v" });
  $("scene").innerHTML = state.fig.svg;
  const b = state.fig.box, paper = $("paper");
  const has = state.doc.parts.length > 0;
  paper.setAttribute("x", b.x0);
  paper.setAttribute("y", b.y0);
  paper.setAttribute("width", b.x1 - b.x0);
  paper.setAttribute("height", b.y1 - b.y0);
  paper.setAttribute("stroke-width", 1 / state.view.k);
  paper.style.display = has ? "" : "none";
  $("paper-size").textContent = has ? `図の大きさ ${state.fig.widthMm.toFixed(0)} × ${state.fig.heightMm.toFixed(0)} mm (線 ${state.doc.settings.lw} mm・文字 ${state.doc.settings.font} pt)` : "";
  $("empty").hidden = has;
  drawOverlay();
  if (inspector) renderInspector();
}

function applyView() {
  const { k, tx, ty } = state.view;
  $("viewport").setAttribute("transform", `translate(${n2(tx)} ${n2(ty)}) scale(${k})`);
  $("paper").setAttribute("stroke-width", 1 / k);
  drawOverlay();
}

function fitView() {
  const r = $("canvas").getBoundingClientRect();
  const b = state.fig?.box;
  if (!b || !state.doc.parts.length) {
    state.view = { k: 2, tx: r.width / 2, ty: r.height / 2 };
  } else {
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    const k = Math.min((r.width - 60) / w, (r.height - 60) / h, 8);
    state.view = { k, tx: r.width / 2 - k * (b.x0 + w / 2), ty: r.height / 2 - k * (b.y0 + h / 2) };
  }
  applyView();
}

function toScene(e) {
  const r = $("canvas").getBoundingClientRect();
  return [(e.clientX - r.left - state.view.tx) / state.view.k, (e.clientY - r.top - state.view.ty) / state.view.k];
}

/** 画面だけに出す印: 選択・接続口・ホースの下書き */
function drawOverlay() {
  const sv = state.solved;
  if (!sv) return;
  const k = state.view.k, r = 4.5 / k, sw = 1.5 / k;
  let s = "";
  const mark = (q, cls) => `<circle class="port-mark ${cls}" cx="${n2(q.wx)}" cy="${n2(q.wy)}" r="${n2(r)}" stroke-width="${n2(sw)}"/>`;

  if (state.sel?.type === "part") {
    const it = sv.items.get(state.sel.id);
    if (it) {
      const b = it.box, p = 3 / k;
      s += `<rect class="sel-box" x="${n2(b.x0 - p)}" y="${n2(b.y0 - p)}" width="${n2(b.x1 - b.x0 + 2 * p)}" height="${n2(b.y1 - b.y0 + 2 * p)}" stroke-width="${n2(sw)}"/>`;
      if (!state.drag?.moved) for (const q of it.ports) if (!q.link && SNAP_KINDS.has(q.kind)) s += mark(q, "");
    }
  } else if (state.sel?.type === "tube") {
    const t = state.doc.tubes.find((x) => x.id === state.sel.id);
    const g = t && tubeGeometry(sv, t);
    if (g) s += `<path class="sel-tube" d="M${g.p0.map(n2).join(" ")}C${[...g.p1, ...g.p2, ...g.p3].map(n2).join(" ")}" stroke-width="${n2(14)}"/>`;
  }

  // ドラッグ中: つなげる相手の口と、吸い付く先
  const d = state.drag;
  if (d?.kind === "part" && d.moved) {
    for (const t of d.targets || []) s += mark(t, "");
    if (d.snap) s += `<circle class="snap-ring" cx="${n2(d.snap.t.wx)}" cy="${n2(d.snap.t.wy)}" r="${n2(r * 2.6)}" stroke-width="${n2(sw * 1.4)}"/>`;
  }

  // ホースの道具: すべての空いたホース口
  if (state.hose) {
    const used = usedHosePorts();
    for (const it of sv.items.values()) {
      for (const q of it.ports) {
        if (q.kind !== "hose") continue;
        const on = state.hoseStart && state.hoseStart.id === it.part.id && state.hoseStart.port === q.id;
        s += mark(q, `hose${on ? " target" : ""}${used.has(`${it.part.id}:${q.id}`) && !on ? " bad" : ""}`);
      }
    }
    if (state.hoseStart && state.pointer) {
      const q = itemPort(sv.items.get(state.hoseStart.id), state.hoseStart.port);
      if (q) s += `<path class="hose-preview" d="M${n2(q.wx)} ${n2(q.wy)}L${n2(state.pointer[0])} ${n2(state.pointer[1])}" stroke-width="${n2(sw)}" stroke-dasharray="${n2(5 / k)} ${n2(4 / k)}"/>`;
    }
  }
  $("overlay").innerHTML = s;
}

function usedHosePorts() {
  return new Set(state.doc.tubes.flatMap((t) => [`${t.a.id}:${t.a.port}`, `${t.b.id}:${t.b.port}`]));
}

/* ================= 通知 ================= */

let toastTimer = 0;
function toast(msg, ms = 2600) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

function hint(msg) {
  const el = $("hint-bar");
  el.textContent = msg || "";
  el.classList.toggle("show", !!msg);
}

/* ================= 吸い付き (すり合わせをつなぐ) ================= */

/** 動かしている部品の集まり ids の空いた口のうち、他の部品の空いた口に近いものを探す */
function findSnap(sv, ids, thr) {
  let best = null;
  const targets = [];
  const mine = [];
  for (const id of ids) for (const q of sv.items.get(id).ports) if (!q.link && SNAP_KINDS.has(q.kind)) mine.push({ id, q });
  for (const it of sv.items.values()) {
    if (ids.has(it.part.id)) continue;
    for (const t of it.ports) {
      if (t.link || !SNAP_KINDS.has(t.kind)) continue;
      let shown = false;
      for (const { id, q } of mine) {
        const m = canMate(q, t);
        if (!m || (m.adjust && !q.param)) continue;
        if (!shown) { targets.push(t); shown = true; }
        const dd = dist(q.wx, q.wy, t.wx, t.wy);
        if (dd < thr && (!best || dd < best.d)) best = { id, q, t, tid: it.part.id, adjust: m.adjust, d: dd };
      }
    }
  }
  return { best, targets };
}

/** 吸い付き先が決まったら、つながりを登録する (すり合わせの大きさ違いは自動で合わせる) */
function makeLink(snap) {
  const part = getPart(state.doc, snap.id);
  if (snap.adjust && snap.q.param) {
    part.params[snap.q.param] = snap.t.size;
    toast(`すり合わせを ${snap.t.size} に合わせました`);
  }
  state.doc.links.push({ a: { id: snap.id, port: snap.q.id }, b: { id: snap.tid, port: snap.t.id } });
}

function afterEdit() {
  if (state.doc.settings.autoTidy) tidy(state.doc);
}

/* ================= キャンバスの操作 ================= */

function onPointerDown(e) {
  const canvas = $("canvas");
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(e.pointerId);
  state.pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (state.pointers.size === 2) {
    cancelDrag();
    const [a, b] = [...state.pointers.values()];
    state.pinch = { d: dist(...a, ...b), k: state.view.k, tx: state.view.tx, ty: state.view.ty, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2 };
    return;
  }
  if (e.button !== undefined && e.button > 1) return;
  const pt = toScene(e);
  if (e.button === 1) {
    state.drag = { kind: "pan", sx: e.clientX, sy: e.clientY, tx: state.view.tx, ty: state.view.ty };
    return;
  }
  if (state.hose) {
    hoseClick(pt);
    return;
  }
  const lid = e.target.closest?.("[data-label]")?.dataset.label;
  if (lid) {
    const L = state.fig.labels.find((x) => x.id === lid);
    const owner = labelOwner(lid);
    if (L && owner) {
      state.sel = getPart(state.doc, lid) ? { type: "part", id: lid } : { type: "tube", id: lid };
      state.drag = { kind: "label", id: lid, start: pt, sx: e.clientX, sy: e.clientY, base: [L.ex - L.ax, L.ly - L.ay], moved: false };
      drawOverlay();
      renderInspector();
      return;
    }
  }
  const pid = e.target.closest?.("[data-id]")?.dataset.id;
  const tid = e.target.closest?.("[data-tube]")?.dataset.tube;
  if (pid) {
    state.sel = { type: "part", id: pid };
    const detach = e.altKey;
    const ids = detach ? new Set([pid]) : componentOf(state.doc, pid);
    const orig = new Map(state.doc.parts.filter((p) => ids.has(p.id)).map((p) => [p.id, { x: p.x, y: p.y, rot: p.rot, flip: p.flip }]));
    state.drag = { kind: "part", pid, ids, start: pt, sx: e.clientX, sy: e.clientY, orig, moved: false, snap: null, detach };
    drawOverlay();
    renderInspector();
  } else if (tid) {
    state.sel = { type: "tube", id: tid };
    state.drag = null;
    drawOverlay();
    renderInspector();
  } else {
    if (state.sel) {
      state.sel = null;
      drawOverlay();
      renderInspector();
    }
    state.drag = { kind: "pan", sx: e.clientX, sy: e.clientY, tx: state.view.tx, ty: state.view.ty };
    canvas.classList.add("panning");
  }
}

function onPointerMove(e) {
  if (state.pointers.has(e.pointerId)) state.pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (state.pinch && state.pointers.size === 2) {
    const [a, b] = [...state.pointers.values()];
    const P = state.pinch, f = dist(...a, ...b) / P.d;
    const r = $("canvas").getBoundingClientRect();
    const cx = (a[0] + b[0]) / 2 - r.left, cy = (a[1] + b[1]) / 2 - r.top;
    const k = Math.min(40, Math.max(0.2, P.k * f));
    const sx = (P.cx - r.left - P.tx) / P.k, sy = (P.cy - r.top - P.ty) / P.k;
    state.view = { k, tx: cx - sx * k, ty: cy - sy * k };
    applyView();
    return;
  }
  const d = state.drag;
  if (state.hose && state.hoseStart) {
    state.pointer = toScene(e);
    drawOverlay();
  }
  if (!d) return;
  if (d.kind === "pan") {
    state.view.tx = d.tx + e.clientX - d.sx;
    state.view.ty = d.ty + e.clientY - d.sy;
    applyView();
    return;
  }
  if (d.kind === "label") {
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return;
    d.moved = true;
    const pt = toScene(e);
    labelOwner(d.id).pos = [d.base[0] + pt[0] - d.start[0], d.base[1] + pt[1] - d.start[1]];
    refresh({ inspector: false });
    return;
  }
  if (d.kind !== "part") return;
  if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
  if (!d.moved) {
    d.moved = true;
    if (d.detach) detachPart(state.doc, d.pid);
  }
  const pt = toScene(e);
  for (const p of state.doc.parts) {
    const o = d.orig.get(p.id);
    if (o) Object.assign(p, o);
  }
  moveParts(state.doc, d.ids, pt[0] - d.start[0], pt[1] - d.start[1]);
  const sv = solve(state.doc);
  const { best, targets } = findSnap(sv, d.ids, 16 / state.view.k);
  d.targets = targets;
  d.snap = best;
  if (best) transformParts(state.doc, d.ids, snapTransform(getPart(state.doc, best.id), best.q, best.t));
  hint(best ? (best.adjust ? `離すとつながります (すり合わせを ${best.t.size} に合わせます)` : "離すとつながります") : "");
  refresh({ inspector: false });
}

function onPointerUp(e) {
  state.pointers.delete(e.pointerId);
  if (state.pinch) {
    if (state.pointers.size < 2) state.pinch = null;
    return;
  }
  const d = state.drag;
  state.drag = null;
  $("canvas").classList.remove("panning");
  hint("");
  if (d?.kind === "label") {
    if (d.moved) { commit(); refresh(); }
    return;
  }
  if (!d || d.kind !== "part") return;
  if (!d.moved) return;
  if (d.snap) makeLink(d.snap);
  for (const id of d.ids) {
    const p = getPart(state.doc, id);
    if (getDef(p.type).autoPlace) p.placed = true;
  }
  afterEdit();
  commit();
  refresh();
}

/** ラベルの持ち主 (部品かホース) の label */
function labelOwner(id) {
  return (getPart(state.doc, id) || state.doc.tubes.find((t) => t.id === id))?.label || null;
}

function posControl(label) {
  if (!label.pos) return el("p", { class: "hint" }, "ラベルはドラッグで好きな位置に動かせます。");
  const b = el("button", { type: "button", class: "btn sm" }, "自動の位置に戻す");
  b.addEventListener("click", () => { label.pos = null; commit(); refresh(); });
  return el("div", { class: "btn-row" }, [b]);
}

function cancelDrag() {
  const d = state.drag;
  if (d?.kind === "part" && d.moved) {
    for (const p of state.doc.parts) {
      const o = d.orig.get(p.id);
      if (o) Object.assign(p, o);
    }
    if (d.detach) state.doc = normalizeDoc(JSON.parse(saved));
    refresh();
  }
  state.drag = null;
  hint("");
}

function onWheel(e) {
  e.preventDefault();
  const r = $("canvas").getBoundingClientRect();
  const cx = e.clientX - r.left, cy = e.clientY - r.top;
  const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
  const k = Math.min(40, Math.max(0.2, state.view.k * f));
  const sx = (cx - state.view.tx) / state.view.k, sy = (cy - state.view.ty) / state.view.k;
  state.view = { k, tx: cx - sx * k, ty: cy - sy * k };
  applyView();
}

/* ---- ホースの道具 ---- */

function setHoseMode(on) {
  state.hose = on;
  state.hoseStart = null;
  $("btn-hose").setAttribute("aria-pressed", String(on));
  $("canvas").classList.toggle("hose-mode", on);
  hint(on ? "ホース口 (青い丸) を 2 つ順に押すとホースでつなぎます。Esc で終了" : "");
  drawOverlay();
}

function hoseClick(pt) {
  let best = null, bd = 14 / state.view.k;
  for (const it of state.solved.items.values()) {
    for (const q of it.ports) {
      if (q.kind !== "hose") continue;
      const d = dist(pt[0], pt[1], q.wx, q.wy);
      if (d < bd) { bd = d; best = { id: it.part.id, port: q.id }; }
    }
  }
  if (!best) {
    toast("ホース口 (青い丸) を押してください");
    return;
  }
  if (usedHosePorts().has(`${best.id}:${best.port}`)) {
    toast("その口にはもうホースがつながっています");
    return;
  }
  if (!state.hoseStart) {
    state.hoseStart = best;
    hint("つなぐ先のホース口を押してください");
  } else if (state.hoseStart.id === best.id && state.hoseStart.port === best.port) {
    state.hoseStart = null;
    hint("ホース口 (青い丸) を 2 つ順に押すとホースでつなぎます。Esc で終了");
  } else {
    const t = addTube(state.doc, state.hoseStart, best);
    state.hoseStart = null;
    state.sel = { type: "tube", id: t.id };
    afterEdit();
    commit();
    hint("つなぎました。続けて別のホース口を押せます。Esc で終了");
  }
  refresh();
}

/* ================= 部品の追加 ================= */

function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/** 新しい部品 newId を、選んでいる部品 (の集まり) の空いた口に自動でつなぐ */
function autoConnect(newId, selId) {
  const sv = solve(state.doc);
  const comp = componentOf(state.doc, selId);
  const nit = sv.items.get(newId);
  let best = null;
  nit.ports.forEach((q, qi) => {
    if (!SNAP_KINDS.has(q.kind)) return;
    for (const id of comp) {
      sv.items.get(id).ports.forEach((t, ti) => {
        if (t.link || !SNAP_KINDS.has(t.kind)) return;
        const m = canMate(q, t);
        if (!m || (m.adjust && !q.param)) return;
        // 選んだ部品そのものの口 → 大きさの合う口 → 一覧で先の口、の順に選ぶ
        const score = [id === selId ? 0 : 1, m.adjust ? 1 : 0, qi, ti];
        if (!best || lexLess(score, best.score)) {
          best = { score, id: newId, q, t, tid: id, adjust: m.adjust };
        }
      });
    }
  });
  if (!best) return false;
  transformParts(state.doc, new Set([newId]), snapTransform(getPart(state.doc, newId), best.q, best.t));
  makeLink(best);
  return true;
}

function addFromPalette(type, at = null) {
  const doc = state.doc;
  const part = addPart(doc, type, {}, 0, 0);
  let connected = false;
  if (!at && state.sel?.type === "part" && getPart(doc, state.sel.id)) connected = autoConnect(part.id, state.sel.id);
  if (!connected) {
    // 置く場所: ドロップした所、なければ今の図の右
    const sh = solve(doc).items.get(part.id);
    const [ax, ay] = [(sh.box.x0 + sh.box.x1) / 2, (sh.box.y0 + sh.box.y1) / 2];
    let tx, ty;
    if (at) [tx, ty] = at;
    else if (state.fig && doc.parts.length > 1) {
      tx = state.fig.box.x1 + (sh.box.x1 - sh.box.x0) / 2 + 20;
      ty = state.fig.box.y1 - (sh.box.y1 - sh.box.y0) / 2;
    } else [tx, ty] = [0, 0];
    moveParts(doc, new Set([part.id]), tx - ax, ty - ay);
    if (at) {
      const { best } = findSnap(solve(doc), new Set([part.id]), 30 / state.view.k);
      if (best) {
        transformParts(doc, new Set([part.id]), snapTransform(part, best.q, best.t));
        makeLink(best);
        connected = true;
      }
    }
  }
  state.sel = { type: "part", id: part.id };
  afterEdit();
  commit();
  refresh();
  if (!connected && state.sel && doc.parts.length > 1 && !at) toast("つなげる口が無かったので横に置きました。ドラッグしてつなげます");
  if (doc.parts.length === 1) fitView();
  closePanels();
}

/* ================= 部品の一覧 ================= */

function buildPalette() {
  const list = $("palette-list");
  list.innerHTML = "";
  const q = $("palette-search").value.trim().toLowerCase();
  for (const [cat, catName] of CATEGORIES) {
    const defs = allDefs().filter((d) => d.cat === cat && (!q || d.name.ja.toLowerCase().includes(q) || d.name.en.toLowerCase().includes(q) || d.type.toLowerCase().includes(q)));
    if (!defs.length) continue;
    const sec = el("div", { class: "cat" }, [el("h3", {}, catName)]);
    const grid = el("div", { class: "cat-grid" });
    for (const def of defs) {
      const sh = buildShape(def, withDefaults(def, {}), {});
      const size = Math.max(sh.box.x1 - sh.box.x0, sh.box.y1 - sh.box.y0);
      const thumb = el("span", { class: "thumb" });
      thumb.innerHTML = shapeToSvg(sh, { th: THEMES.line, lw: size / 55, uid: `pal-${def.type}`, pad: size * 0.04, width: 48, height: 48 });
      const btn = el("button", { class: "pal-item", type: "button", draggable: "true", title: `${def.name.ja} (${def.name.en})` }, [thumb, el("span", {}, def.name.ja)]);
      btn.addEventListener("click", () => addFromPalette(def.type));
      btn.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/x-labtsumiki-part", def.type);
        e.dataTransfer.effectAllowed = "copy";
      });
      grid.appendChild(btn);
    }
    sec.appendChild(grid);
    list.appendChild(sec);
  }
}

/* ================= 設定欄 ================= */

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "text") e.textContent = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of [].concat(children)) if (c != null) e.append(c);
  return e;
}

function row(label, control, cls = "") {
  return el("label", { class: `row ${cls}` }, [el("span", {}, label), control]);
}

function selectEl(options, value, onChange) {
  const s = el("select");
  for (const [v, l] of options) {
    const o = el("option", { value: String(v) }, l);
    if (String(v) === String(value)) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

function numberEl(value, min, max, step, onChange) {
  const i = el("input", { type: "number", min, max, step, value, inputmode: "decimal" });
  i.addEventListener("change", () => {
    const v = Number(i.value);
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
  });
  return i;
}

function checkEl(value, onChange) {
  const i = el("input", { type: "checkbox" });
  i.checked = !!value;
  i.addEventListener("change", () => onChange(i.checked));
  return i;
}

/** 部品の調整項目 1 つ分 */
function paramControl(part, q) {
  const v = part.params[q.key];
  const set = (val, final = true) => {
    part.params[q.key] = val;
    if (final) { afterEdit(); commit(); }
    refresh({ inspector: final });
  };
  if (q.type === "select") {
    const numeric = typeof q.default === "number";
    return row(q.label, selectEl(q.options, v, (s) => set(numeric ? Number(s) : s)));
  }
  if (q.type === "bool") {
    return el("label", { class: "row check" }, [checkEl(v, (c) => set(c)), el("span", {}, q.label)]);
  }
  if (q.type === "range") {
    const fmt = (x) => (q.unit === "%" ? `${Math.round(x * 100)}%` : `${x}${q.unit || ""}`);
    const out = el("output", {}, fmt(v));
    const i = el("input", { type: "range", min: q.min, max: q.max, step: q.step, value: v });
    i.addEventListener("input", () => { out.textContent = fmt(Number(i.value)); set(Number(i.value), false); });
    i.addEventListener("change", () => set(Number(i.value)));
    return el("label", { class: "row range" }, [el("span", {}, q.label), i, out]);
  }
  if (q.type === "color" && !state.doc.settings.liquidFill) return null;
  if (q.type === "color") {
    const box = el("div", { class: "swatches" });
    for (const [c, name] of q.options) {
      const b = el("button", { type: "button", class: `swatch${c === v ? " on" : ""}`, title: name, "aria-label": name });
      b.addEventListener("click", () => set(c));
      // 色見本の色は CSSOM で付ける (style 属性は CSP で使えない)
      b.style.background = c;
      box.appendChild(b);
    }
    const custom = el("input", { type: "color", value: v, title: "ほかの色", "aria-label": "ほかの色" });
    custom.addEventListener("change", () => set(custom.value));
    box.appendChild(custom);
    return el("div", { class: "row" }, [el("span", {}, q.label), box]);
  }
  return null;
}

function renderInspector() {
  const box = $("inspector");
  box.innerHTML = "";
  const sv = state.solved;
  if (state.sel?.type === "part" && sv?.items.get(state.sel.id)) box.append(...partInspector(sv.items.get(state.sel.id)));
  else if (state.sel?.type === "tube" && state.doc.tubes.find((t) => t.id === state.sel.id)) box.append(...tubeInspector(state.doc.tubes.find((t) => t.id === state.sel.id)));
  else box.append(...docInspector());
}

function partInspector(it) {
  const { part, def } = it;
  const lang = state.doc.settings.lang;
  const nodes = [el("h2", {}, partLabel(def, part.params, "ja")), el("div", { class: "sub" }, def.name.en)];

  if (def.params.length) {
    const fs = el("fieldset", {}, [el("legend", {}, "形と中身")]);
    for (const q of def.params) {
      const c = paramControl(part, q);
      if (c) fs.appendChild(c);
    }
    nodes.push(fs);
  }

  // ラベル
  const lf = el("fieldset", {}, [el("legend", {}, "ラベル")]);
  const show = part.label.show == null ? "auto" : part.label.show ? "on" : "off";
  lf.appendChild(row("表示", selectEl([["auto", `自動 (${def.labelDefault === false ? "出さない" : "出す"})`], ["on", "出す"], ["off", "出さない"]], show, (v) => {
    part.label.show = v === "auto" ? null : v === "on";
    commit(); refresh();
  })));
  const txt = el("input", { type: "text", value: part.label.text, placeholder: labelText({ part: { ...part, label: {} }, def }, lang) });
  txt.addEventListener("change", () => { part.label.text = txt.value.trim(); commit(); refresh(); });
  lf.appendChild(el("label", { class: "row col" }, [el("span", {}, "文字 (空欄なら自動)"), txt]));
  lf.appendChild(row("置く側", selectEl([["auto", "自動"], ["left", "左"], ["right", "右"]], part.label.side || "auto", (v) => {
    part.label.side = v === "auto" ? null : v;
    part.label.pos = null;
    commit(); refresh();
  })));
  lf.appendChild(posControl(part.label));
  nodes.push(lf);

  // つながり
  const cf = el("fieldset", {}, [el("legend", {}, "つながり")]);
  const ul = el("ul", { class: "conn-list" });
  const tubesHere = state.doc.tubes.filter((t) => t.a.id === part.id || t.b.id === part.id);
  for (const q of it.ports) {
    if (q.kind === "rod") continue;
    const name = PORT_NAMES[q.id] || q.id;
    const kind = q.kind === "joint" ? `${q.size} ${q.gender === "M" ? "オス" : "メス"}` : KIND_NAMES[q.kind];
    let right;
    const tube = tubesHere.find((t) => (t.a.id === part.id && t.a.port === q.id) || (t.b.id === part.id && t.b.port === q.id));
    if (q.link) {
      const other = state.solved.items.get(q.link.id);
      const b = el("button", { type: "button", class: "btn sm" }, "外す");
      b.addEventListener("click", () => {
        state.doc.links = state.doc.links.filter((l) => !((l.a.id === part.id && l.a.port === q.id) || (l.b.id === part.id && l.b.port === q.id)));
        nudgeApart(part.id);
        commit(); refresh();
      });
      const kids = [`${other ? partLabel(other.def, other.part.params, "ja").replace(/ \(.*\)$/, "") : "?"} `];
      const link = state.doc.links.find((l) => (l.a.id === part.id && l.a.port === q.id) || (l.b.id === part.id && l.b.port === q.id));
      const otherPort = other && itemPort(other, q.link.port);
      if (q.kind === "joint" && otherPort?.kind === "joint" && link) {
        const c = checkEl(linkHasClip(state.doc, link), (v) => { link.clip = v; commit(); refresh(); });
        kids.push(el("label", { class: "clip-check", title: "すり合わせを固定するクリップを描く" }, [c, "クリップ "]));
      }
      kids.push(b);
      right = el("span", {}, kids);
    } else if (tube) {
      const oid = tube.a.id === part.id ? tube.b.id : tube.a.id;
      const other = state.solved.items.get(oid);
      right = el("span", {}, `ホース → ${other ? other.def.name.ja : "?"}`);
    } else {
      right = el("span", { class: "free" }, "空き");
    }
    ul.appendChild(el("li", {}, [el("span", {}, `${name} (${kind})`), right]));
  }
  cf.appendChild(ul);
  nodes.push(cf);

  // 動かす
  const tf = el("fieldset", {}, [el("legend", {}, "向き・並び")]);
  const btns = el("div", { class: "btn-row" });
  const mk = (label, title, fn) => {
    const b = el("button", { type: "button", class: "btn sm", title }, label);
    b.addEventListener("click", fn);
    btns.appendChild(b);
  };
  mk("⟲ 15°", "左に回す (Shift+R)", () => rotateSel(-15));
  mk("⟳ 15°", "右に回す (R)", () => rotateSel(15));
  mk("左右反転", "左右を反転 (F)", () => flipSel());
  mk("切り離す", "この部品だけを外す (Alt を押しながらドラッグでも)", () => {
    detachPart(state.doc, part.id);
    nudgeApart(part.id);
    afterEdit(); commit(); refresh();
  });
  mk("複製", "複製 (Ctrl+D)", () => duplicateSel());
  mk("前へ", "手前に描く", () => reorder(1));
  mk("後ろへ", "奥に描く", () => reorder(-1));
  const del = el("button", { type: "button", class: "btn sm danger", title: "削除 (Delete)" }, "削除");
  del.addEventListener("click", () => deleteSel());
  btns.appendChild(del);
  tf.appendChild(btns);
  tf.appendChild(el("p", { class: "hint" }, "回転・反転は、つながった部品全体に効きます。"));
  nodes.push(tf);
  return nodes;
}

function tubeInspector(t) {
  const g = tubeGeometry(state.solved, t);
  const ia = state.solved.items.get(t.a.id), ib = state.solved.items.get(t.b.id);
  const nodes = [el("h2", {}, "ホース"), el("div", { class: "sub" }, `${ia?.def.name.ja} ↔ ${ib?.def.name.ja}`)];
  const fs = el("fieldset", {}, [el("legend", {}, "流れ")]);
  fs.appendChild(row("矢印", selectEl([
    ["auto", "自動"], ["none", "なし"], ["ab", `${ia?.def.name.ja} → ${ib?.def.name.ja}`], ["ba", `${ib?.def.name.ja} → ${ia?.def.name.ja}`],
  ], t.arrow, (v) => { t.arrow = v; commit(); refresh(); })));
  if (g) fs.appendChild(el("p", { class: "hint" }, { water: "冷却水のホース", vacuum: "減圧 (肉厚) ホース", gas: "ガスのホース" }[g.pa.medium || g.pb.medium] || "ホース"));
  nodes.push(fs);
  const lf = el("fieldset", {}, [el("legend", {}, "ラベル")]);
  lf.appendChild(el("label", { class: "row check" }, [checkEl(t.label.show, (c) => { t.label.show = c; commit(); refresh(); }), el("span", {}, "ラベルを出す")]));
  const txt = el("input", { type: "text", value: t.label.text, placeholder: "空欄なら自動" });
  txt.addEventListener("change", () => { t.label.text = txt.value.trim(); commit(); refresh(); });
  lf.appendChild(el("label", { class: "row col" }, [el("span", {}, "文字"), txt]));
  if (t.label.show) lf.appendChild(posControl(t.label));
  nodes.push(lf);
  const del = el("button", { type: "button", class: "btn sm danger" }, "ホースを削除");
  del.addEventListener("click", () => deleteSel());
  nodes.push(el("div", { class: "btn-row" }, del));
  return nodes;
}

function docInspector() {
  const S = state.doc.settings;
  const set = (k, v) => { S[k] = v; if (k === "autoTidy" && v) tidy(state.doc); commit(); refresh(); };
  const nodes = [el("h2", {}, "図の体裁"), el("div", { class: "sub" }, "部品を押すと、その部品の設定に切り替わります。")];
  const fs = el("fieldset", {}, [el("legend", {}, "見た目")]);
  fs.appendChild(row("図の幅", selectEl([[85, "1 段 (85 mm)"], [120, "1.5 段 (120 mm)"], [175, "2 段 (175 mm)"], ...([85, 120, 175].includes(S.width) ? [] : [[S.width, `${S.width} mm`]])], S.width, (v) => set("width", Number(v)))));
  fs.appendChild(row("線の太さ (mm)", numberEl(S.lw, 0.05, 2, 0.05, (v) => set("lw", v))));
  fs.appendChild(row("文字 (pt)", numberEl(S.font, 4, 24, 0.5, (v) => set("font", v))));
  fs.appendChild(el("label", { class: "row check" }, [checkEl(S.bench, (c) => set("bench", c)), el("span", {}, "机の線を描く")]));
  fs.appendChild(el("label", { class: "row check" }, [checkEl(S.liquidFill, (c) => set("liquidFill", c)), el("span", {}, "液体を薄い灰色で塗る")]));
  fs.appendChild(el("label", { class: "row check" }, [checkEl(S.clips, (c) => {
    for (const l of state.doc.links) l.clip = null;
    set("clips", c);
  }), el("span", {}, "すり合わせのクリップを描く (すべて)")]));
  nodes.push(fs);
  const lf = el("fieldset", {}, [el("legend", {}, "ラベル")]);
  lf.appendChild(row("付け方", selectEl([["number", "番号 + 凡例"], ["numberOnly", "番号だけ (説明は本文へ)"], ["name", "名前を直接"], ["none", "付けない"]], S.labels, (v) => set("labels", v))));
  lf.appendChild(row("言語", selectEl([["ja", "日本語"], ["en", "English"]], S.lang, (v) => set("lang", v))));
  if (S.labels.startsWith("number") && state.fig?.legendText?.length) {
    // 図の説明 (キャプション) に貼る用の文
    const sep = S.lang === "en" ? "; " : "，";
    const cap = state.fig.legendText.map((t) => t.replace(/^(\d+) /, "($1) ")).join(sep);
    const b = el("button", { type: "button", class: "btn sm" }, "番号の説明をコピー");
    b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(cap); toast("コピーしました。図の説明文に貼り付けられます"); } catch { toast(cap, 8000); }
    });
    lf.appendChild(el("div", { class: "btn-row" }, b));
  }
  nodes.push(lf);
  const af = el("fieldset", {}, [el("legend", {}, "自動調整")]);
  af.appendChild(el("label", { class: "row check" }, [checkEl(S.autoTidy, (c) => set("autoTidy", c)), el("span", {}, "動かした後に床へ揃える・ジャッキとスタンドを合わせる")]));
  nodes.push(af);

  // 確認
  const cf = el("fieldset", {}, [el("legend", {}, "装置の確認")]);
  const ul = el("ul", { class: "checks" });
  const res = state.doc.parts.length ? runChecks(state.doc, state.solved) : [];
  if (!res.length) ul.appendChild(el("li", { class: "ok" }, state.doc.parts.length ? "気になる所はありません。" : "部品がまだありません。"));
  for (const r of res) {
    const b = el("button", { type: "button", class: "btn sm" }, "見る");
    b.addEventListener("click", () => { state.sel = { type: "part", id: r.ids[0] }; refresh(); });
    ul.appendChild(el("li", {}, [r.text, b]));
  }
  cf.appendChild(ul);
  nodes.push(cf);

  const kf = el("fieldset", {}, [el("legend", {}, "操作")]);
  const keys = el("div", { class: "keys" });
  for (const [k, d] of [
    ["ドラッグ", "部品を動かす (近くの口に吸い付いてつながる)"], ["Alt+ドラッグ", "1 つだけ外して動かす"], ["背景をドラッグ", "画面を動かす"], ["ホイール / 2 本指", "拡大・縮小"],
    ["R / Shift+R", "回す"], ["F", "左右反転"], ["H", "ホースの道具"], ["Delete", "削除"], ["Ctrl+Z / Ctrl+Y", "元に戻す / やり直し"], ["Ctrl+D", "複製"], ["0", "全体を表示"],
  ]) keys.append(el("div", {}, [el("kbd", {}, k), ` ${d}`]));
  kf.appendChild(keys);
  nodes.push(kf);
  nodes.push(el("p", { class: "hint small" }, "作った図は CC0 (パブリックドメイン) です。論文・レポート・授業資料に自由に使えます。"));
  return nodes;
}

/* ================= 選んだ物への操作 ================= */

function selComp() {
  return state.sel?.type === "part" ? componentOf(state.doc, state.sel.id) : null;
}

function selCenter() {
  const it = state.solved.items.get(state.sel.id);
  const b = compBox(state.solved, selComp());
  return it ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] : [0, 0];
}

function rotateSel(deg) {
  const ids = selComp();
  if (!ids) return;
  const [cx, cy] = selCenter();
  const T = mul(mat(cx, cy, deg), mat(-cx, -cy));
  transformParts(state.doc, ids, T);
  commit();
  refresh();
}

function flipSel() {
  const ids = selComp();
  if (!ids) return;
  const [cx] = selCenter();
  transformParts(state.doc, ids, [-1, 0, 0, 1, 2 * cx, 0]);
  commit();
  refresh();
}

function deleteSel() {
  if (!state.sel) return;
  if (state.sel.type === "part") removePart(state.doc, state.sel.id);
  else state.doc.tubes = state.doc.tubes.filter((t) => t.id !== state.sel.id);
  state.sel = null;
  afterEdit();
  commit();
  refresh();
}

function duplicateSel() {
  if (state.sel?.type !== "part") return;
  const src = getPart(state.doc, state.sel.id);
  const p = addPart(state.doc, src.type, structuredClone(src.params), src.x + 30, src.y);
  p.rot = src.rot;
  p.flip = src.flip;
  p.label = { ...src.label };
  state.sel = { type: "part", id: p.id };
  commit();
  refresh();
}

function reorder(dir) {
  if (state.sel?.type !== "part") return;
  const arr = state.doc.parts, i = arr.findIndex((p) => p.id === state.sel.id);
  const j = dir > 0 ? arr.length - 1 : 0;
  if (i < 0 || i === j) return;
  const [p] = arr.splice(i, 1);
  if (dir > 0) arr.push(p); else arr.unshift(p);
  commit();
  refresh();
}

/** 外した部品を少しずらして、外れたことが見えるようにする */
function nudgeApart(id) {
  const it = solve(state.doc).items.get(id);
  if (!it) return;
  moveParts(state.doc, componentOf(state.doc, id), 12, -12);
}

/* ================= メニュー ================= */

function showMenu(anchor, items) {
  const m = $("menu");
  m.innerHTML = "";
  for (const it of items) {
    if (it === "-") { m.appendChild(el("div", { class: "sep" })); continue; }
    const b = el("button", { type: "button", role: "menuitem" }, it.label);
    b.addEventListener("click", () => { hideMenu(); it.action(); });
    m.appendChild(b);
  }
  const r = anchor.getBoundingClientRect();
  m.hidden = false;
  m.style.left = `${Math.min(r.left, window.innerWidth - m.offsetWidth - 8)}px`;
  m.style.top = `${r.bottom + 4}px`;
  m.querySelector("button")?.focus();
}

function hideMenu() {
  $("menu").hidden = true;
}

function templateMenu(anchor) {
  showMenu(anchor, TEMPLATES.map((t) => ({
    label: t.name,
    action: () => {
      if (state.doc.parts.length && !confirm(`今の図を「${t.name}」で置き換えます。よろしいですか? (元に戻すで戻せます)`)) return;
      // ファイル名は環境によって日本語が使えないので英字にする
      replaceDoc(instantiate(t, state.doc.settings), `labtsumiki-${t.id}`);
      toast(`「${t.name}」を読み込みました。部品を押すと大きさなどを変えられます`);
    },
  })));
}

function fileMenu(anchor) {
  showMenu(anchor, [
    { label: "新しい図", action: () => { if (!state.doc.parts.length || confirm("今の図を消して新しく始めます。よろしいですか? (元に戻すで戻せます)")) { const d = newDoc(); d.settings = { ...state.doc.settings }; replaceDoc(d, "labtsumiki"); } } },
    { label: "開く (.json)…", action: () => $("file-input").click() },
    { label: "保存 (.json)", action: () => saveJson(state.doc, state.name) },
    "-",
    { label: "SVG を書き出す", action: () => exportSvg(state.doc, state.name) },
  ]);
}

/* ================= 書き出しの画面 ================= */

function openExport() {
  const S = state.doc.settings;
  const presets = [[85, "1 段 (85 mm)"], [120, "1.5 段 (120 mm)"], [175, "2 段 (175 mm)"], ["custom", "その他"]];
  const sel = $("ex-width");
  sel.innerHTML = "";
  for (const [v, l] of presets) sel.appendChild(el("option", { value: v }, l));
  sel.value = [85, 120, 175].includes(S.width) ? String(S.width) : "custom";
  $("ex-width-mm").value = S.width;
  $("ex-lw").value = S.lw;
  $("ex-font").value = S.font;
  updateExportInfo();
  $("export-dialog").showModal();
}

function updateExportInfo() {
  const f = state.fig;
  $("ex-info").textContent = state.doc.parts.length ? `図の大きさ: ${f.widthMm.toFixed(1)} × ${f.heightMm.toFixed(1)} mm` : "部品がありません。";
}

function bindExport() {
  const S = () => state.doc.settings;
  const apply = () => { commit(); refresh(); updateExportInfo(); };
  $("ex-width").addEventListener("change", (e) => {
    if (e.target.value !== "custom") { S().width = Number(e.target.value); $("ex-width-mm").value = S().width; apply(); }
  });
  $("ex-width-mm").addEventListener("change", (e) => {
    const v = Number(e.target.value);
    if (v >= 20 && v <= 400) { S().width = v; $("ex-width").value = [85, 120, 175].includes(v) ? String(v) : "custom"; apply(); }
  });
  $("ex-lw").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { S().lw = v; apply(); } });
  $("ex-font").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { S().font = v; apply(); } });
  $("export-dialog").addEventListener("close", async () => {
    const v = $("export-dialog").returnValue;
    if (!state.doc.parts.length || !["svg", "png", "print"].includes(v)) return;
    try {
      if (v === "svg") exportSvg(state.doc, state.name);
      else if (v === "png") await exportPng(state.doc, state.name, Number($("ex-dpi").value), $("ex-bg").checked);
      else printFigure(state.doc);
    } catch (err) {
      toast(`書き出せませんでした: ${err.message}`, 5000);
    }
  });
}

/* ================= キーボード ================= */

function onKey(e) {
  const tag = e.target.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || $("export-dialog").open) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;
  if (mod && (k === "z" || k === "Z")) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && (k === "y" || k === "Y")) { e.preventDefault(); redo(); return; }
  if (mod && (k === "d" || k === "D")) { e.preventDefault(); duplicateSel(); return; }
  if (mod) return;
  if (k === "Delete" || k === "Backspace") { e.preventDefault(); deleteSel(); }
  else if (k === "Escape") {
    hideMenu();
    if (state.drag) cancelDrag();
    else if (state.hose) setHoseMode(false);
    else if (state.sel) { state.sel = null; refresh(); }
  } else if (k === "r" || k === "R") rotateSel(e.shiftKey ? -15 : 15);
  else if (k === "f" || k === "F") flipSel();
  else if (k === "h" || k === "H") setHoseMode(!state.hose);
  else if (k === "0") fitView();
  else if (k.startsWith("Arrow") && state.sel?.type === "part") {
    e.preventDefault();
    const s = e.shiftKey ? 10 : 1;
    const [dx, dy] = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[k];
    moveParts(state.doc, selComp(), dx, dy);
    commit();
    refresh();
  }
}

/* ================= 狭い画面の欄 ================= */

function closePanels() {
  document.body.classList.remove("show-palette", "show-inspector");
}

/* ================= 起動 ================= */

function init() {
  try {
    const s = localStorage.getItem(STORE);
    if (s) state.doc = normalizeDoc(JSON.parse(s));
  } catch { state.doc = newDoc(); }
  saved = snapshot();
  buildPalette();
  refresh();
  fitView();
  updateUndo();

  const canvas = $("canvas");
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", (e) => { state.pointers.delete(e.pointerId); cancelDrag(); state.pinch = null; });
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/x-labtsumiki-part")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
  canvas.addEventListener("drop", (e) => {
    const type = e.dataTransfer.getData("text/x-labtsumiki-part");
    if (!type) return;
    e.preventDefault();
    addFromPalette(type, toScene(e));
  });
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", () => applyView());
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#menu, #btn-templates, #btn-file")) hideMenu(); });

  $("palette-search").addEventListener("input", buildPalette);
  $("btn-templates").addEventListener("click", (e) => templateMenu(e.currentTarget));
  $("btn-empty-tpl").addEventListener("click", () => templateMenu($("btn-templates")));
  $("btn-file").addEventListener("click", (e) => fileMenu(e.currentTarget));
  $("btn-export").addEventListener("click", openExport);
  $("btn-undo").addEventListener("click", undo);
  $("btn-redo").addEventListener("click", redo);
  $("btn-hose").addEventListener("click", () => setHoseMode(!state.hose));
  $("btn-tidy").addEventListener("click", () => { tidy(state.doc, { full: true }); commit(); refresh(); fitView(); toast("床に揃えて、左から並べ直しました"); });
  $("btn-fit").addEventListener("click", fitView);
  $("btn-palette").addEventListener("click", () => { document.body.classList.remove("show-inspector"); document.body.classList.toggle("show-palette"); });
  $("btn-inspector").addEventListener("click", () => { document.body.classList.remove("show-palette"); document.body.classList.toggle("show-inspector"); });
  $("file-input").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const doc = normalizeDoc(JSON.parse(await f.text()));
      replaceDoc(doc, f.name.replace(/\.json$/i, ""));
    } catch {
      toast("読み込めませんでした (このアプリで保存した .json を選んでください)", 4000);
    }
  });
  bindExport();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();

// 動作確認用 (ブラウザのコンソールから触れる)
window.__labtsumiki = { state, refresh, addFromPalette, undo, redo };
