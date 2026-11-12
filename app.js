/* グラフ生成アプリ (Web 版) — 画面の動作
 *
 * プロジェクトは PC 版の .gproj と同じ JSON 形式で保持する。
 * グラフ描画・近似計算・ファイル解析は worker.js 内の Python (PC 版と同じコード) が行う。 */
"use strict";

const $ = (id) => document.getElementById(id);
const AUTOSAVE_KEY = "graphapp.web.project";
const EXPORT_KEY = "graphapp.web.export";
const ROW_LIMIT = 200;      // データ表に一度に表示する行数 (それ以上は「すべて表示」)
const MERGE_MS = 1500;      // 同じ項目の連続入力は 1 回の「元に戻す」にまとめる

/* ======================================================================
 * Worker (Python) との通信
 * ==================================================================== */
const worker = new Worker("worker.js?v=2.4.0-202611121200");
let rpcSeq = 0;
const pending = new Map();
worker.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === "progress") {
    if (!state.ready) $("splash-text").textContent = m.text || "準備しています…";
    else if (m.text) toast(m.text);
    return;
  }
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
};
worker.onerror = (e) => showFatal(e.message || "読み込みに失敗しました");
function rpc(cmd, args) {
  return new Promise((resolve, reject) => {
    const id = ++rpcSeq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, cmd, args });
  });
}

/* ======================================================================
 * 状態
 * ==================================================================== */
const state = {
  ready: false,
  defaults: null,
  docs: [],           // 開いているグラフ (タブ) ごとの状態。編集中のものは下の項目に展開してある
  active: 0,
  closed: [],         // 閉じたグラフ (メニューから復元できる。新しいものが後ろ)
  project: null,
  selectedId: null,
  undo: [], redo: [],
  lastKey: null, lastTime: 0,
  results: [], messages: [], stats: [],
  xlim: null, ylim: null, axes: null,
  showAllRows: false,
  fileName: "graph.gproj",
  previewSrc: null,
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const getDs = (id) => state.project.datasets.find((d) => d.id === id) || null;
const curDs = () => (state.selectedId == null ? null : getDs(state.selectedId));

function toNum(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).normalize("NFKC").trim().replace(/[−–]/g, "-");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function fmtNum(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  return String(Number(v.toPrecision(15)));
}
function fmtG(v, n = 6) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  return String(Number(v.toPrecision(n)));
}
function fmtP(p) {   // p 値 ("p = 0.012" / "p < 0.0001")
  if (p === null || p === undefined) return "";
  return p < 1e-4 ? "p < 0.0001" : `p = ${fmtG(p, 3)}`;
}
const SUPERSCRIPT = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const sup = (n) => String(n).replace(/[-0-9]/g, (c) => SUPERSCRIPT[c]);
const fmtPct = (level) => `${fmtG(level * 100, 3)} %`;
function fmtPM(v, err) {
  // 値と誤差を、誤差の有効数字 2 桁の位にそろえる。 [値, 誤差] の文字列を返す (例: ["6.93", "0.12"])
  if (v === null || v === undefined || !Number.isFinite(v)) return ["", ""];
  if (err === null || err === undefined || !(err > 0) || !Number.isFinite(err)) return [fmtG(v, 6), ""];
  const exp = Math.floor(Math.log10(err));   // 誤差の最上位の位
  const big = Math.max(Math.abs(v), err);
  if (big >= 1e-4 && big < 1e6) {
    const dec = Math.min(Math.max(1 - exp, 0), 12);
    return [v.toFixed(dec), err.toFixed(dec)];
  }
  const e10 = Math.floor(Math.log10(big));   // 共通の指数でくくる
  const dec = Math.min(Math.max(e10 - exp + 1, 0), 12);
  const tail = `×10${sup(e10)}`;
  return [(v / 10 ** e10).toFixed(dec) + tail, (err / 10 ** e10).toFixed(dec) + tail];
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const safeName = (name) => (String(name).trim().replace(/[\\/:*?"<>|]/g, "_") || "data");
function csvBlob(rows) {   // Excel でそのまま開けるよう BOM 付き UTF-8
  const cell = (c) => { const t = c === null || c === undefined ? "" : String(c); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return new Blob(["\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv" });
}
function nPoints(ds) {
  let n = 0;
  for (let i = 0; i < ds.x.length; i++) {
    if (Number.isFinite(ds.x[i]) && Number.isFinite(ds.y[i])) n++;
  }
  return n;
}
const hasYerr = (ds) => ds.yerr.some((v) => v !== null && v !== undefined);

function savgolParams(wl, po) {   // graphapp.fitting.savgol_params と同じ規則
  wl = Math.trunc(wl); po = Math.trunc(po);
  if (wl % 2 === 0) wl += 1;
  if (wl <= po) { wl = po + 1; if (wl % 2 === 0) wl += 1; }
  return [wl, po];
}

/* ======================================================================
 * 変更・元に戻す・自動保存
 * ==================================================================== */
function commit(desc, mutate, { mergeKey = null, refresh = "auto" } = {}) {
  const before = JSON.stringify(state.project);
  const beforeSel = state.selectedId;
  const ret = mutate(state.project);
  const after = JSON.stringify(state.project);
  if (before === after) return;
  const now = Date.now();
  const merge = mergeKey && mergeKey === state.lastKey && now - state.lastTime < MERGE_MS && state.undo.length;
  if (!merge) state.undo.push({ snap: before, sel: beforeSel, desc });
  if (state.undo.length > 200) state.undo.shift();
  state.redo = [];
  state.lastKey = mergeKey;
  state.lastTime = now;
  if (typeof ret === "number") state.selectedId = ret;
  if (state.selectedId != null && !getDs(state.selectedId)) {
    state.selectedId = state.project.datasets.length ? state.project.datasets[0].id : null;
  }
  afterChange(refresh === "all");
}

function afterChange(full) {
  renderList();
  if (full) { renderEditor(); renderSettings(); }
  updateUndoButtons();
  scheduleAutosave();
  scheduleRender();
}

function undoRedo(from, to) {
  const item = from.pop();
  if (!item) return;
  to.push({ snap: JSON.stringify(state.project), sel: state.selectedId, desc: item.desc });
  state.project = JSON.parse(item.snap);
  state.selectedId = item.sel != null && getDs(item.sel) ? item.sel
    : (state.project.datasets[0] ? state.project.datasets[0].id : null);
  state.lastKey = null;
  afterChange(true);
  toast((from === state.undo ? "元に戻しました: " : "やり直しました: ") + item.desc);
}
function updateUndoButtons() {
  $("btn-undo").disabled = !state.undo.length;
  $("btn-redo").disabled = !state.redo.length;
}

let autosaveTimer = 0, autosaveWarned = false;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    stashDoc();
    const docs = state.docs.map((d) => ({ project: d.project, name: d.fileName }));
    const save = (closed) => localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ docs, active: state.active, closed }));
    try { save(state.closed); }
    catch (e) {
      try { save([]); }   // 容量が足りないときは、閉じたグラフを省いてもう一度
      catch (e2) {
        if (!autosaveWarned) toast("このブラウザに自動保存できませんでした。「プロジェクトを保存」でファイルに残してください。");
        autosaveWarned = true;
      }
    }
  }, 400);
}

function setPath(obj, path, value) {
  const parts = path.split(".");
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p];
  o[parts[parts.length - 1]] = value;
}
function getPath(obj, path) {
  return path.split(".").reduce((o, p) => (o == null ? o : o[p]), obj);
}

/* ======================================================================
 * 複数のグラフ (タブ)
 *  編集中のグラフの状態は state 直下に展開し、切り替えるときに docs[] と入れ替える。
 *  元に戻す履歴・選択中のデータセット・近似結果などはグラフごとに別々に持つ。
 * ==================================================================== */
const DOC_KEYS = ["project", "fileName", "selectedId", "undo", "redo", "lastKey", "lastTime",
  "results", "messages", "stats", "xlim", "ylim", "axes", "showAllRows", "previewSrc"];
let docSeq = 0;

function makeDoc(project, fileName) {
  return {
    uid: ++docSeq, project, fileName,
    selectedId: project.datasets.length ? project.datasets[0].id : null,
    undo: [], redo: [], lastKey: null, lastTime: 0,
    results: [], messages: [], stats: [], xlim: null, ylim: null, axes: null, showAllRows: false, previewSrc: null,
  };
}
const curDoc = () => state.docs[state.active];
const docLabel = (d) => (d.fileName || "graph.gproj").replace(/\.gproj$/i, "");
function stashDoc() {
  const d = curDoc();
  if (d) for (const k of DOC_KEYS) d[k] = state[k];
}
function loadDoc(i) {
  state.active = i;
  const d = curDoc();
  for (const k of DOC_KEYS) state[k] = d[k];
}
function uniqueFileName(base = "graph") {
  const used = new Set(state.docs.map(docLabel));
  if (!used.has(base)) return `${base}.gproj`;
  for (let n = 2; ; n++) if (!used.has(`${base}${n}`)) return `${base}${n}.gproj`;
}
const isBlankDoc = () => !state.project.datasets.length && !state.undo.length && !state.redo.length;

function refreshAll() {
  // グラフを切り替えた・読み込んだときに画面全体を描き直す
  const img = $("preview-img");
  if (state.previewSrc) { img.src = state.previewSrc; img.hidden = false; $("preview-empty").hidden = true; }
  else { img.hidden = true; img.removeAttribute("src"); $("preview-empty").hidden = false; }
  renderTabs();
  renderResults();
  afterChange(true);
  scheduleRender(0);
}

function switchDoc(i) {
  if (i === state.active || !state.docs[i]) return;
  stashDoc();
  loadDoc(i);
  refreshAll();
}

function openDoc(project, fileName) {
  stashDoc();
  state.docs.push(makeDoc(project, fileName || uniqueFileName()));
  loadDoc(state.docs.length - 1);
  refreshAll();
}

function newDoc() {
  const fresh = clone(state.defaults.project);
  fresh.settings = clone(state.project.settings);   // グラフ設定は引き継ぐ
  openDoc(fresh);
  if (!window.matchMedia("(min-width: 900px)").matches) setTab("data");
}

function duplicateDoc() {
  openDoc(clone(state.project), uniqueFileName(`${docLabel(curDoc())} のコピー`));
  toast("グラフを複製しました");
}

function closeDoc(i) {
  stashDoc();
  const [d] = state.docs.splice(i, 1);
  if (d.project.datasets.length) {   // 中身のあるグラフは、間違えて閉じても戻せるようにとっておく
    state.closed.push({ project: d.project, name: d.fileName });
    if (state.closed.length > 5) state.closed.shift();
    toast(`「${docLabel(d)}」を閉じました (メニューの「閉じたグラフを復元」で戻せます)`);
  }
  if (!state.docs.length) state.docs.push(makeDoc(clone(state.defaults.project), "graph.gproj"));
  loadDoc(Math.min(i < state.active ? state.active - 1 : state.active, state.docs.length - 1));
  refreshAll();
}

async function reopenDoc() {
  const c = state.closed[state.closed.length - 1];
  if (!c) return;
  const r = await rpc("normalize", { project: c.project });
  if (!r.ok) { toast(r.error); return; }
  const i = state.closed.indexOf(c);
  if (i < 0) return;   // 待つ間に復元済み (二度押し)
  state.closed.splice(i, 1);
  openDoc(r.project, c.name);
}

function moveDoc(from, to) {
  if (from === to || !state.docs[from] || !state.docs[to]) return;
  stashDoc();
  const cur = curDoc();
  const [d] = state.docs.splice(from, 1);
  state.docs.splice(to, 0, d);
  state.active = state.docs.indexOf(cur);
  renderTabs();
  scheduleAutosave();
}

function renameDoc() {
  const cur = docLabel(state);
  const v = prompt("グラフの名前 (保存・書き出しのファイル名になります)", cur);
  if (v === null || !v.trim() || v.trim() === cur) return;
  state.fileName = v.trim().replace(/[\\/:*?"<>|]/g, "_") + ".gproj";
  renderTabs();
  scheduleAutosave();
}

let dragTab = -1;   // ドラッグ中のタブの番号
function renderTabs() {
  stashDoc();
  const bar = $("doc-tabs");
  bar.textContent = "";
  state.docs.forEach((d, i) => {
    const active = i === state.active;
    const tab = document.createElement("div");
    tab.className = "doctab" + (active ? " active" : "");
    tab.draggable = state.docs.length > 1;   // ドラッグで並べ替え
    tab.addEventListener("dragstart", (e) => {
      dragTab = i;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", docLabel(d));
      tab.classList.add("dragging");
    });
    tab.addEventListener("dragend", () => { dragTab = -1; renderTabs(); });
    tab.addEventListener("dragover", (e) => {
      if (dragTab < 0 || dragTab === i) return;
      e.preventDefault();
      tab.classList.add(dragTab < i ? "drop-after" : "drop-before");
    });
    tab.addEventListener("dragleave", () => tab.classList.remove("drop-before", "drop-after"));
    tab.addEventListener("drop", (e) => {
      if (dragTab < 0) return;
      e.preventDefault();
      e.stopPropagation();
      moveDoc(dragTab, i);
    });
    const name = document.createElement("button");
    name.type = "button";
    name.className = "doctab-name";
    name.setAttribute("role", "tab");
    name.setAttribute("aria-selected", String(active));
    name.textContent = docLabel(d);
    name.title = active ? `${docLabel(d)} (もう一度押すと名前を変更)` : docLabel(d);
    name.onclick = () => (active ? renameDoc() : switchDoc(i));
    const close = document.createElement("button");
    close.type = "button";
    close.className = "doctab-close";
    close.textContent = "×";
    close.title = "このグラフを閉じる";
    close.setAttribute("aria-label", `「${docLabel(d)}」を閉じる`);
    close.onclick = () => closeDoc(i);
    tab.append(name, close);
    bar.append(tab);
  });
  const cur = bar.children[state.active];
  if (cur) cur.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/* ======================================================================
 * データセット操作
 * ==================================================================== */
function newDataset(p, fields = {}) {
  const ds = clone(state.defaults.dataset);
  ds.id = p.next_id;
  ds.name = `データ${p.next_id}`;   // 色・マーカーは既定値 (黒の白抜き丸)
  p.next_id += 1;
  Object.assign(ds, fields);
  const n = Math.max(ds.x.length, ds.y.length);
  for (const k of ["x", "y", "yerr", "xerr"]) {
    ds[k] = (ds[k] || []).slice(0, n);
    while (ds[k].length < n) ds[k].push(null);
  }
  return ds;
}

function addDatasets(items, desc) {
  commit(desc, (p) => {
    let last = null;
    for (const it of items) {
      const ds = newDataset(p, it);
      p.datasets.push(ds);
      last = ds.id;
    }
    return last;
  }, { refresh: "all" });
}

/* ======================================================================
 * データセット一覧
 * ==================================================================== */
function fitLabel(kind, degree) {
  if (kind === "none") return "";
  const f = state.defaults.fit_kinds.find((k) => k[1] === kind);
  const label = f ? f[0].replace(/ \(.*\)$/, "") : kind;
  return kind === "poly" && degree ? `${degree} 次${label}` : label;
}

function renderList() {
  const ul = $("ds-list");
  ul.textContent = "";
  for (const ds of state.project.datasets) {
    const li = document.createElement("li");
    li.className = "ds-item" + (ds.id === state.selectedId ? " selected" : "") + (ds.visible ? "" : " hidden-ds");
    li.dataset.id = ds.id;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = ds.visible;
    cb.title = "表示 / 非表示";
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", () => commit("表示を切り替え", (p) => { getDsIn(p, ds.id).visible = cb.checked; }));
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = ds.color;
    const name = document.createElement("span");
    name.className = "ds-name";
    name.textContent = ds.name;
    const meta = document.createElement("span");
    meta.className = "ds-meta";
    const fl = fitLabel(ds.fit.kind, ds.fit.degree);
    meta.textContent = `${nPoints(ds)} 点` + (fl ? ` · ${fl}` : "");
    li.append(cb, sw, name, meta);
    li.addEventListener("click", () => select(ds.id));
    ul.append(li);
  }
  $("ds-empty").hidden = state.project.datasets.length > 0;
  $("editor").hidden = curDs() === null;
}
const getDsIn = (p, id) => p.datasets.find((d) => d.id === id);

function select(id) {
  if (state.selectedId === id) return;
  state.selectedId = id;
  state.showAllRows = false;
  renderList();
  renderEditor();
}

/* ======================================================================
 * エディタ: データ表
 * ==================================================================== */
const COLS = ["x", "y", "yerr", "xerr"];

function renderEditor() {
  const ds = curDs();
  $("editor").hidden = !ds;
  if (!ds) return;
  const nm = $("ed-name");
  if (document.activeElement !== nm) nm.value = ds.name;
  renderTable();
  renderProps();
}

function makeRow(ds, r, blank) {
  const tr = document.createElement("tr");
  tr.dataset.r = r;
  const th = document.createElement("td");
  th.className = "rn";
  th.textContent = blank ? "＋" : String(r + 1);
  tr.append(th);
  COLS.forEach((k, c) => {
    const td = document.createElement("td");
    const inp = document.createElement("input");
    inp.inputMode = "decimal";
    inp.autocomplete = "off";
    inp.dataset.c = c;
    inp.value = blank ? "" : fmtNum(ds[k][r]);
    inp.setAttribute("aria-label", `${r + 1} 行目 ${["X", "Y", "Y誤差", "X誤差"][c]}`);
    td.append(inp);
    tr.append(td);
  });
  const tdDel = document.createElement("td");
  tdDel.className = "rn";
  if (!blank) {
    const b = document.createElement("button");
    b.className = "rowdel";
    b.type = "button";
    b.textContent = "×";
    b.title = "この行を削除";
    b.dataset.del = "1";
    tdDel.append(b);
  }
  tr.append(tdDel);
  return tr;
}

function renderTable() {
  const ds = curDs();
  const tbody = $("data-table").tBodies[0];
  tbody.textContent = "";
  const n = ds.x.length;
  const shown = state.showAllRows ? n : Math.min(n, ROW_LIMIT);
  const frag = document.createDocumentFragment();
  for (let r = 0; r < shown; r++) frag.append(makeRow(ds, r, false));
  if (shown === n) frag.append(makeRow(ds, n, true));
  tbody.append(frag);
  $("btn-more").hidden = shown === n;
  $("btn-more").textContent = `すべての行を表示 (${n} 行)`;
  updateDataInfo();
}

function updateDataInfo() {
  const ds = curDs();
  if (!ds) return;
  let t = `有効な点: ${nPoints(ds)} / ${ds.x.length} 行`;
  if (hasYerr(ds) || ds.xerr.some((v) => v != null)) t += " (誤差棒あり)";
  const s = ds.source;
  if (s && s.type === "formula") {
    t += s.mode === "x_const" ? ` / 生成元: X = ${s.x_const} (Y: ${s.min} 〜 ${s.max}, ${s.n} 点)`
      : ` / 生成元: y = ${s.expr} (X: ${s.min} 〜 ${s.max}, ${s.n} 点)`;
  } else if (s && s.type === "file") {
    t += ` / 読込元: ${s.file}`;
  }
  $("data-info").textContent = t;
}

function onCellChange(inp) {
  const tr = inp.closest("tr");
  const r = Number(tr.dataset.r);
  const c = Number(inp.dataset.c);
  const ds = curDs();
  const text = inp.value;
  const v = toNum(text);
  inp.classList.toggle("bad", text.trim() !== "" && v === null);
  const id = ds.id;
  const isBlank = r >= ds.x.length;
  if (isBlank && text.trim() === "") return;
  commit(isBlank ? "行を追加" : "セルを編集", (p) => {
    const d = getDsIn(p, id);
    if (r >= d.x.length) for (const k of COLS) d[k].push(null);
    d[COLS[c]][r] = v;
  });
  if (isBlank) {
    // 空行を通常の行にして、新しい空行を足す (表全体は作り直さず、入力中のフォーカスを保つ)
    tr.firstChild.textContent = String(r + 1);
    const del = tr.lastChild;
    const b = document.createElement("button");
    b.className = "rowdel"; b.type = "button"; b.textContent = "×"; b.title = "この行を削除"; b.dataset.del = "1";
    del.append(b);
    tr.parentNode.append(makeRow(curDs(), r + 1, true));
  }
  updateDataInfo();
  updatePropsAvailability();
}

/* ======================================================================
 * エディタ: 表示・近似
 * ==================================================================== */
function fillSelect(sel, pairs) {
  sel.textContent = "";
  for (const [label, value] of pairs) {
    const o = document.createElement("option");
    o.value = typeof value === "string" ? value : JSON.stringify(value);
    o.textContent = label;
    sel.append(o);
  }
}

function renderProps() {
  const ds = curDs();
  if (!ds) return;
  const set = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
  $("p-color").value = ds.color;
  $("p-style").value = ds.style;
  $("p-marker").value = ds.marker;
  $("p-filled").checked = ds.filled;
  set("p-msize", ds.marker_size);
  set("p-lw", ds.line_width);
  $("p-fit").value = ds.fit.kind;
  set("p-eq", ds.fit.equation);
  set("p-wl", ds.fit.window_length);
  set("p-po", ds.fit.polyorder);
  set("p-fitlabel", ds.fit.label);
  $("p-r2").checked = ds.fit.show_r2;
  $("p-formula").checked = ds.fit.show_formula;
  $("p-weighted").checked = ds.fit.weighted;
  set("p-sig", ds.fit.sig_figs);
  set("p-degree", ds.fit.degree);
  set("p-xmin", ds.fit.x_min ?? "");
  set("p-xmax", ds.fit.x_max ?? "");
  $("p-band").value = ds.fit.band;
  $("p-extend").checked = ds.fit.extend;
  $("p-template").value = templateOf(ds.fit.equation);
  updatePropsAvailability();
  validateEq();
}

// 数式がテンプレート (空白の違いは無視) ならその式、そうでなければ ""
const squeeze = (t) => String(t || "").replace(/\s+/g, "");
function templateOf(equation) {
  const t = state.defaults.fit_templates.find(([, expr]) => squeeze(expr) === squeeze(equation));
  return t ? t[1] : "";
}

async function applyTemplate(expr) {
  const ds = curDs();
  if (!ds || !expr) return;
  const doc = curDoc();
  const r = await rpc("guessP0", { dataset: ds, equation: expr });
  if (doc !== curDoc() || curDs() !== ds) { renderProps(); return; }   // 待つ間に別のグラフ・データに移った
  const p0 = (r.ok && r.p0) || {};
  commit("近似式のテンプレートを設定", (p) => {
    const f = getDsIn(p, ds.id).fit;
    f.equation = expr;
    f.p0 = p0;
  }, { refresh: "all" });
  toast(Object.keys(p0).length ? "初期値をデータから推定しました" : "初期値を推定できませんでした (1 のままです)");
}

function renderP0(params) {
  // 非線形 (カスタム) の初期値の入力欄。入力中の欄は作り直さない
  const ds = curDs();
  const box = $("p-p0");
  $("p-p0-box").hidden = !ds || !params.length;
  if (!ds || !params.length) { box.textContent = ""; box.dataset.key = ""; return; }
  const key = `${ds.id}:${params.join(",")}`;
  if (box.dataset.key !== key) {
    box.textContent = "";
    box.dataset.key = key;
    for (const name of params) {
      const lb = el("label");
      const inp = el("input");
      inp.type = "number"; inp.step = "any"; inp.inputMode = "decimal";
      inp.dataset.p = name;
      inp.setAttribute("aria-label", `${name} の初期値`);
      lb.append(el("span", "", name), inp);
      box.append(lb);
    }
  }
  const p0 = ds.fit.p0 || {};
  for (const inp of box.querySelectorAll("input")) {
    if (document.activeElement !== inp) inp.value = fmtNum(Number(p0[inp.dataset.p] ?? 1));
  }
  $("p-p0-auto").hidden = !templateOf(ds.fit.equation);
}

function updatePropsAvailability() {
  const ds = curDs();
  if (!ds) return;
  const kind = ds.fit.kind;
  const custom = kind === "custom", savgol = kind === "savgol", any = kind !== "none";
  $("p-poly-box").hidden = kind !== "poly";
  $("p-custom-box").hidden = !custom;
  $("p-sg-box").hidden = !savgol;
  $("p-param-box").hidden = !any || savgol;   // 式による近似だけの設定 (範囲・帯・延長)
  $("p-fitlabel").disabled = !any;
  $("p-r2").disabled = !any || savgol;
  $("p-formula").disabled = !any || savgol;
  $("p-sig").disabled = !any;
  $("p-weighted").disabled = !any || savgol || !hasYerr(ds);
  const marker = ds.style !== "line";
  for (const id of ["p-marker", "p-filled", "p-msize"]) $(id).disabled = !marker;
  $("p-lw").disabled = ds.style === "points";
  if (savgol) {
    const [wl] = savgolParams(ds.fit.window_length, ds.fit.polyorder);
    const msgs = [];
    if (wl !== Math.trunc(ds.fit.window_length)) msgs.push(`実際のウィンドウ長は ${wl} になります (奇数かつ次数より大きい必要があります)`);
    const n = nPoints(ds);
    if (n < wl) msgs.push(`データ点数 (${n}) がウィンドウ長より少ないため、平滑化されません`);
    const st = $("p-sg-status");
    st.textContent = msgs.join(" / ");
    st.className = "status" + (n < wl ? " err" : "");
  }
}

let eqTimer = 0;
function validateEq() {
  clearTimeout(eqTimer);
  const ds = curDs();
  if (!ds || ds.fit.kind !== "custom") return;
  const expr = ds.fit.equation;
  eqTimer = setTimeout(async () => {
    const r = await rpc("validateFit", { expr });
    const st = $("p-eq-status");
    if (curDs() && curDs().fit.equation !== expr) return;
    st.textContent = r.ok ? `✔ パラメータ: ${r.params.join(", ")}` : `✖ ${r.error}`;
    st.className = "status " + (r.ok ? "ok" : "err");
    $("p-eq").classList.toggle("invalid", !r.ok);
    renderP0(r.ok ? r.params : []);
  }, 250);
}

function bindProp(id, path, kind, desc) {
  const el = $(id);
  const ev = kind === "check" || kind === "select" || kind === "color" ? "change" : "input";
  el.addEventListener(ev, () => {
    const ds = curDs();
    if (!ds) return;
    let v;
    if (kind === "check") v = el.checked;
    else if (kind === "numnull") v = toNum(el.value);   // 空欄 = 指定なし
    else if (kind === "num" || kind === "int") {
      v = toNum(el.value);
      if (v === null) return;
      if (kind === "int") v = Math.round(v);
      if (path === "fit.degree") v = Math.max(1, Math.min(state.defaults.max_poly_degree, v));
    } else v = el.value;
    commit(desc, (p) => { setPath(getDsIn(p, ds.id), path, v); },
      { mergeKey: kind === "check" || kind === "select" ? null : `ds:${ds.id}:${path}` });
    if (path === "name") renderList();
    if (path === "fit.equation") $("p-template").value = templateOf(v);
    updatePropsAvailability();
    if (path === "fit.equation" || path === "fit.kind") validateEq();
  });
}

/* ======================================================================
 * グラフ設定
 * ==================================================================== */
function renderSettings() {
  const s = state.project.settings;
  const set = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
  set("s-w", s.width_cm); set("s-h", s.height_cm);
  $("s-font").value = s.font_style;
  set("s-fs", s.font_size);
  set("s-xlabel", s.xlabel); set("s-ylabel", s.ylabel); set("s-title", s.title);
  $("s-showtitle").checked = s.show_title;
  $("s-title").disabled = !s.show_title;
  $("s-sci").checked = s.sci_notation;
  set("s-xsig", s.x_sig_figs); set("s-ysig", s.y_sig_figs);
  $("s-xsig").disabled = $("s-ysig").disabled = !s.sci_notation;
  $("s-legend").checked = s.legend;
  $("s-datalegend").checked = s.data_legend;
  $("s-legloc").value = s.legend_loc;
  $("s-legframe").checked = s.legend_frame;
  $("s-grid").checked = s.grid;
  $("s-conf").value = String(s.conf_level);
  $("s-resid").checked = s.residuals;
  set("s-residlabel", s.residual_label);
  $("s-residlabel").disabled = !s.residuals;
  for (const fs of document.querySelectorAll("fieldset[data-axis]")) {
    const ax = s[fs.dataset.axis];
    fs.querySelector('[data-k="auto"]').checked = ax.auto;
    fs.querySelector('[data-k="log"]').checked = ax.log;
    const step = fs.querySelector('[data-k="step"]');
    step.disabled = ax.log;
    if (document.activeElement !== step) step.value = ax.step > 0 ? fmtNum(ax.step) : "";
    for (const k of ["min", "max"]) {
      const el = fs.querySelector(`[data-k="${k}"]`);
      el.disabled = ax.auto;
      if (!ax.auto && document.activeElement !== el) el.value = fmtNum(ax[k]);
    }
  }
  showAutoLimits();
  syncPreset();
}

function showAutoLimits() {
  const s = state.project.settings;
  for (const [axis, lim] of [["x_axis", state.xlim], ["y_axis", state.ylim]]) {
    if (!lim || !s[axis].auto) continue;
    const fs = document.querySelector(`fieldset[data-axis="${axis}"]`);
    fs.querySelector('[data-k="min"]').value = fmtG(lim[0], 6);
    fs.querySelector('[data-k="max"]').value = fmtG(lim[1], 6);
  }
}

function syncPreset() {
  const s = state.project.settings;
  const sel = $("s-preset");
  const i = state.defaults.presets.findIndex(([, w, h, fs]) =>
    Math.abs(w - s.width_cm) < 1e-6 && Math.abs(h - s.height_cm) < 1e-6 && Math.abs(fs - s.font_size) < 1e-6);
  sel.value = i >= 0 ? String(i) : "custom";
}

function bindSetting(id, path, kind, desc) {
  const el = $(id);
  const choice = kind === "check" || kind === "select" || kind === "selnum";
  el.addEventListener(choice ? "change" : "input", () => {
    let v;
    if (kind === "check") v = el.checked;
    else if (kind === "selnum") v = Number(el.value);
    else if (kind === "num" || kind === "int") {
      v = toNum(el.value);
      if (v === null) return;
      if (kind === "int") v = Math.max(1, Math.round(v));
    } else v = el.value;
    commit(desc, (p) => { setPath(p.settings, path, v); }, { mergeKey: choice ? null : `set:${path}` });
    renderSettings();
  });
}

/* ======================================================================
 * プレビュー描画
 * ==================================================================== */
let renderTimer = 0, rendering = false, renderAgain = false, lastPreviewW = 0;
function scheduleRender(delay = 120) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(doRender, delay);
}
async function doRender() {
  if (!state.ready) return;
  if (rendering) { renderAgain = true; return; }
  const box = $("preview");
  let cssW = box.clientWidth;
  if (cssW < 10) {   // プレビューが非表示 (スマホで別のタブ)
    if (document.body.dataset.tab !== "results") { renderAgain = false; state.needsRender = true; return; }
    cssW = lastPreviewW || Math.max(240, window.innerWidth - 44);   // 結果タブでは近似結果・統計が要るので描く
  } else lastPreviewW = cssW;
  state.needsRender = false;
  const s = state.project.settings;
  const dpr = window.devicePixelRatio || 1;
  let dpi = (cssW * dpr) / (s.width_cm / 2.54);
  const maxDpi = Math.sqrt(12e6 / ((s.width_cm / 2.54) * (s.height_cm / 2.54)));   // 画素数の上限
  dpi = Math.max(20, Math.min(dpi, maxDpi, 600));
  rendering = true;
  $("preview-busy").hidden = false;
  const doc = curDoc();
  try {
    const r = await rpc("render", { project: state.project, fmt: "png", dpi });
    if (doc !== curDoc()) { renderAgain = true; return; }   // 描画中に別のグラフへ切り替えた
    if (!r.ok) throw new Error(r.error);
    const img = $("preview-img");
    if (r.empty) {
      img.hidden = true;
      $("preview-empty").hidden = false;
      $("preview-empty").textContent = state.project.datasets.length
        ? "表示するデータがありません (すべて非表示です)" : "データを追加するとここにグラフが表示されます";
      state.results = []; state.stats = []; state.xlim = state.ylim = state.axes = null; state.previewSrc = null;
    } else {
      state.previewSrc = img.src = "data:image/png;base64," + r.image;
      img.hidden = false;
      $("preview-empty").hidden = true;
      state.results = r.results; state.stats = r.stats || [];
      state.xlim = r.xlim; state.ylim = r.ylim; state.axes = r.axes || null;
    }
    state.messages = r.messages || [];
    renderResults();
    showAutoLimits();
  } catch (e) {
    if (doc !== curDoc()) { renderAgain = true; return; }
    state.messages = [String(e.message || e)];
    renderResults();
  } finally {
    rendering = false;
    $("preview-busy").hidden = true;
    if (renderAgain) { renderAgain = false; scheduleRender(0); }
  }
}

function showCoord(e) {
  // ポインタの位置のグラフ上の座標 (描画時に受け取ったグラフ領域と軸の範囲から換算する)
  const a = state.axes, out = $("preview-coord"), img = $("preview-img");
  if (!a || !state.xlim || !state.ylim || img.hidden) { out.hidden = true; return; }
  const rc = img.getBoundingClientRect();
  const [x0, y0, x1, y1] = a.box;
  const u = ((e.clientX - rc.left) / rc.width - x0) / (x1 - x0);
  const v = (1 - (e.clientY - rc.top) / rc.height - y0) / (y1 - y0);
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) { out.hidden = true; return; }
  const at = ([lo, hi], t, log) => {
    if (log) return fmtG(10 ** (Math.log10(lo) + t * (Math.log10(hi) - Math.log10(lo))), 3);
    const q = 10 ** Math.floor(Math.log10(Math.abs(hi - lo) / 500));   // 表示幅の 1/500 程度に丸める
    return fmtG(Math.round((lo + t * (hi - lo)) / q) * q, 6);
  };
  out.textContent = `x = ${at(state.xlim, u, a.xlog)}　y = ${at(state.ylim, v, a.ylog)}`;
  out.hidden = false;
}

/* ======================================================================
 * 近似結果・統計
 * ==================================================================== */
function renderResults() {
  const box = $("fit-cards");
  box.textContent = "";
  for (const r of state.results) {
    const card = el("div", "card fit-card");
    const head = el("div", "fit-head");
    head.append(el("b", "", r.name), el("span", "tag", fitKindText(r)));
    if (r.weighted) head.append(el("span", "tag", "Y 誤差で重み付け"));
    card.append(head);
    if (!r.ok) {
      card.append(el("p", "fit-fail", r.message || "近似できませんでした"));
      box.append(card);
      continue;
    }
    card.append(el("div", "fit-eq", r.equation));
    const withErr = r.params.some((p) => p.err !== null), withCi = r.params.some((p) => p.ci !== null);
    const table = el("table", "res-table");
    const hr = table.createTHead().insertRow();
    for (const h of ["パラメータ", "値", ...(withErr ? ["標準誤差"] : []), ...(withCi ? [`${fmtPct(r.level)} 信頼区間`] : [])]) hr.append(el("th", "", h));
    const tb = table.createTBody();
    for (const p of r.params) {
      const [v, e] = fmtPM(p.value, p.err);
      const tr = tb.insertRow();
      tr.append(el("td", "", p.name), el("td", "", v));
      if (withErr) tr.append(el("td", "", e));
      if (withCi) tr.append(el("td", "", p.ci === null ? "" : `± ${fmtPM(p.value, p.ci)[1]}`));
    }
    const wrap = el("div", "table-wrap");
    wrap.append(table);
    card.append(wrap);
    if (r.parametric) {
      const st = el("div", "fit-stats");
      const item = (label, text) => { if (text === "") return; const sp = el("span", "", `${label} = `); sp.append(el("b", "", text)); st.append(sp); };
      item("R²", fmtG(r.r2, 5));
      item("補正 R²", fmtG(r.r2_adj, 5));
      item("残差の標準偏差", fmtG(r.resid_sd, 4));
      item("χ²/自由度", fmtG(r.chi2_red, 4));
      item("点数", `${r.n}` + (r.dof !== null ? ` (自由度 ${r.dof})` : ""));
      card.append(st);
    }
    box.append(card);
  }
  $("res-empty").hidden = state.results.length > 0;

  // 基本統計量
  const stb = $("stat-table").tBodies[0], extra = $("stat-extra");
  stb.textContent = "";
  extra.textContent = "";
  for (const s of state.stats) {
    for (const [k, label] of [["x", "X"], ["y", "Y"]]) {
      const d = s[k], tr = stb.insertRow();
      for (const c of [k === "x" ? s.name : "", label, d.n, fmtG(d.mean), fmtG(d.sd), fmtG(d.se), fmtG(d.median), fmtG(d.min), fmtG(d.max)]) tr.append(el("td", "", String(c)));
    }
    const parts = [];
    if (s.r !== null) parts.push(`相関係数 r = ${fmtG(s.r, 5)}` + (s.r_p !== null ? ` (${fmtP(s.r_p)})` : ""));
    if (s.area !== null) parts.push(`面積 ∫y dx = ${fmtG(s.area, 6)}`);
    if (parts.length) extra.append(el("li", "", `${s.name}: ${parts.join("、")}`));
  }
  $("stat-empty").hidden = state.stats.length > 0;

  const ul = $("msg-list");
  ul.textContent = "";
  for (const m of state.messages) ul.append(el("li", "", m));
  for (const id of ["msg-badge", "msg-badge2"]) {
    $(id).hidden = !state.messages.length;
    $(id).textContent = state.messages.length;
  }
  $("graph-msg").textContent = state.messages.length ? `⚠ ${state.messages[0]}` : "";
  syncCalc();
  syncTtest();
}
const fitKindText = (r) => fitLabel(r.kind, r.kind === "poly" && r.ok ? r.params.length - 1 : 0) || r.kind;

function resultsRows() {
  // コピー・CSV 保存用の表 (数値は丸めすぎない)
  const num = (v) => (v === null || v === undefined ? "" : fmtG(v, 10));
  const level = state.results.length ? state.results[0].level : state.project.settings.conf_level;
  const rows = [["データ", "近似", "パラメータ", "値", "標準誤差", `${fmtPct(level)} 信頼区間 (±)`, "R²", "補正 R²",
    "残差の標準偏差", "点数", "自由度", "χ²/自由度"]];
  for (const r of state.results) {
    if (!r.ok) { rows.push([r.name, fitKindText(r), "(失敗)", r.message]); continue; }
    r.params.forEach((p, i) => rows.push([i ? "" : r.name, i ? "" : fitKindText(r), p.name, num(p.value), num(p.err), num(p.ci),
      ...(i ? [] : [num(r.r2), num(r.r2_adj), num(r.resid_sd), r.n, r.dof ?? "", num(r.chi2_red)])]));
  }
  if (state.stats.length) {
    rows.push([], ["データ", "列", "点数", "平均", "標準偏差", "標準誤差", "中央値", "最小", "最大", "相関係数 r", "面積 ∫y dx"]);
    for (const s of state.stats) {
      for (const k of ["x", "y"]) {
        const d = s[k];
        rows.push([k === "x" ? s.name : "", k.toUpperCase(), d.n, num(d.mean), num(d.sd), num(d.se), num(d.median), num(d.min), num(d.max),
          ...(k === "x" ? [num(s.r), num(s.area)] : [])]);
      }
    }
  }
  return rows;
}
const resultsTsv = () => resultsRows().map((r) => r.join("\t")).join("\n");

/* ---------- 近似式で計算 (x → y の予測、y → x の逆算) ---------- */
let calcTimer = 0, calcSeq = 0;
function syncCalc() {
  const fits = state.results.filter((r) => r.ok && r.parametric);
  $("calc-box").hidden = !fits.length;
  const sel = $("calc-ds"), prev = sel.value;
  fillSelect(sel, fits.map((r) => [`${r.name} (${fitKindText(r)})`, String(r.dataset_id)]));
  if (fits.some((r) => String(r.dataset_id) === prev)) sel.value = prev;
  scheduleCalc(0);
}
function scheduleCalc(delay = 250) {
  clearTimeout(calcTimer);
  calcTimer = setTimeout(runCalc, delay);
}
async function runCalc() {
  const ds = getDs(Number($("calc-ds").value));
  const x = toNum($("calc-x").value), y = toNum($("calc-y").value), yErr = toNum($("calc-yerr").value);
  const outY = $("calc-y-out"), outX = $("calc-x-out");
  const seq = ++calcSeq;
  outY.className = outX.className = "calc-out";
  if (!ds || $("calc-box").hidden || (x === null && y === null)) { outY.textContent = outX.textContent = ""; return; }
  const r = await rpc("predict", { dataset: ds, level: state.project.settings.conf_level, x, y, y_err: yErr });
  if (seq !== calcSeq) return;
  if (!r.ok) {
    outY.textContent = x === null ? "" : r.error;
    outX.textContent = y === null ? "" : r.error;
    outY.className = outX.className = "calc-out err";
    return;
  }
  const pct = fmtPct(r.level);
  const pm = (v, se, ci) => {
    const [a, b] = fmtPM(v, se);
    return b ? `${a} ± ${b}` + (ci !== null ? ` (${pct} 信頼区間 ±${fmtPM(v, ci)[1]})` : "") : a;
  };
  const p = r.predict;
  if (!p) outY.textContent = "";
  else if (p.y === null) outY.textContent = "この x では値を計算できません。";
  else outY.textContent = `y = ${pm(p.y, p.se, p.ci)}` + (p.pi !== null ? `\n新しい測定値が入る範囲 (予測区間): ±${fmtPM(p.y, p.pi)[1]}` : "");
  if (!r.solve) outX.textContent = "";
  else if (!r.solve.length) outX.textContent = "この y になる x は、データの範囲とその前後には見つかりませんでした。";
  else outX.textContent = r.solve.map((q) => `x = ${pm(q.x, q.se, q.ci)}` + (q.extrapolated ? "  ※ データの範囲の外 (外挿)" : "")).join("\n");
}

/* ---------- 平均の比較 (t 検定) ---------- */
let ttSeq = 0;
function syncTtest() {
  const list = state.project.datasets;
  $("tt-box").hidden = list.length < 2;
  if (list.length < 2) return;
  const opts = list.map((d) => [d.name, String(d.id)]);
  for (const [id, fallback] of [["tt-a", 0], ["tt-b", 1]]) {
    const sel = $(id), prev = sel.value;
    fillSelect(sel, opts);
    sel.value = list.some((d) => String(d.id) === prev) ? prev : String(list[fallback].id);
  }
  runTtest();
}
async function runTtest() {
  const a = getDs(Number($("tt-a").value)), b = getDs(Number($("tt-b").value));
  const out = $("tt-out"), col = $("tt-col").value, paired = $("tt-paired").checked;
  const seq = ++ttSeq;
  out.className = "calc-out";
  if (!a || !b || a === b) { out.textContent = a && a === b ? "別々のデータを選んでください。" : ""; return; }
  const r = await rpc("ttest", { a: a[col], b: b[col], paired, level: state.project.settings.conf_level });
  if (seq !== ttSeq) return;
  if (!r.ok) { out.textContent = r.error; out.className = "calc-out err"; return; }
  const [d, se] = fmtPM(r.diff, r.se);
  const alpha = fmtG((1 - r.level) * 100, 3);
  out.textContent = `平均: ${a.name} = ${fmtG(r.mean_a)} (${r.n_a} 点)、${b.name} = ${fmtG(r.mean_b)} (${r.n_b} 点)\n`
    + `差 = ${d} ± ${se} (${fmtPct(r.level)} 信頼区間 ${fmtG(r.diff - r.ci, 4)} 〜 ${fmtG(r.diff + r.ci, 4)})\n`
    + `t = ${fmtG(r.t, 4)}、自由度 = ${fmtG(r.df, 4)}、${fmtP(r.p)} (${r.paired ? "対応のある t 検定" : "Welch の t 検定"})\n`
    + `→ 有意水準 ${alpha} % で、平均に差が${r.p < 1 - r.level ? "あるといえます" : "あるとはいえません"}。`;
}

/* ======================================================================
 * ファイル: 保存・開く・書き出し
 * ==================================================================== */
const isTouch = () => window.matchMedia("(pointer: coarse)").matches;

async function saveBlob(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (isTouch() && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

function saveProject() {
  const blob = new Blob([JSON.stringify(state.project, null, 1)], { type: "application/json" });
  let name = state.fileName || "graph.gproj";
  if (!/\.gproj$/i.test(name)) name += ".gproj";
  saveBlob(blob, name);
}

async function loadProjectText(text, name) {
  let data;
  try { data = JSON.parse(text); } catch (e) { toast("プロジェクトファイルの形式が正しくありません"); return; }
  const r = await rpc("normalize", { project: data });
  if (!r.ok) { toast(r.error); return; }
  name = name || uniqueFileName();
  if (isBlankDoc()) {   // 空のタブはそのまま使い、そうでなければ新しいタブで開く
    stashDoc();
    state.docs[state.active] = makeDoc(r.project, name);
    loadDoc(state.active);
    refreshAll();
  } else {
    openDoc(r.project, name);
  }
  toast(`${name} を開きました`);
}

function wipeLocalData() {
  // 共用端末向け: 自動保存した作業内容・書き出し設定を消し、画面も空にする
  if (!confirm("このブラウザに保存された作業内容を消去して、空の状態に戻しますか? (元に戻せません)")) return;
  clearTimeout(autosaveTimer);
  try { localStorage.removeItem(AUTOSAVE_KEY); localStorage.removeItem(EXPORT_KEY); } catch (e) { /* 無視 */ }
  state.docs = [makeDoc(clone(state.defaults.project), "graph.gproj")];
  state.closed = [];
  loadDoc(0);
  refreshAll();
  clearTimeout(autosaveTimer);
  toast("保存データを消去しました");
}

function b64FromBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function blobFromB64(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
const MIME = { png: "image/png", pdf: "application/pdf", svg: "image/svg+xml", eps: "application/postscript", tiff: "image/tiff" };

/* ---------- 書き出しダイアログ ---------- */
function loadExportPrefs() {
  try { return JSON.parse(localStorage.getItem(EXPORT_KEY)) || {}; } catch (e) { return {}; }
}
function openExport() {
  if (!state.project.datasets.some((d) => d.visible)) { toast("表示するデータがありません"); return; }
  const prefs = loadExportPrefs();
  $("ex-fmt").value = prefs.fmt || "png";
  $("ex-dpi").value = prefs.dpi || 300;
  $("ex-tight").checked = !!prefs.tight;
  $("ex-error").textContent = "";
  $("ex-share").hidden = !(navigator.canShare && isTouch());
  updateExportInfo();
  $("dlg-export").showModal();
}
function updateExportInfo() {
  const s = state.project.settings;
  const dpi = toNum($("ex-dpi").value) || 300;
  const fmt = $("ex-fmt").value;
  const vector = ["pdf", "svg", "eps"].includes(fmt);
  $("ex-dpi").disabled = vector;
  $("ex-size").textContent = vector
    ? `図のサイズ ${s.width_cm} × ${s.height_cm} cm (ベクター形式: 拡大しても劣化しません)`
    : `図のサイズ ${s.width_cm} × ${s.height_cm} cm → ${Math.round(s.width_cm / 2.54 * dpi)} × ${Math.round(s.height_cm / 2.54 * dpi)} px`;
  $("ex-copy").hidden = fmt !== "png" || !(navigator.clipboard && window.ClipboardItem);
}
async function exportImage(action) {
  const fmt = $("ex-fmt").value;
  const dpi = Math.max(72, Math.min(1200, toNum($("ex-dpi").value) || 300));
  const tight = $("ex-tight").checked;
  try { localStorage.setItem(EXPORT_KEY, JSON.stringify({ fmt, dpi, tight })); } catch (e) { /* 無視 */ }
  $("ex-error").textContent = "作成しています…";
  try {
    const r = await rpc("render", { project: state.project, fmt, dpi, tight });
    if (!r.ok || r.empty) throw new Error(r.error || "表示するデータがありません");
    const blob = blobFromB64(r.image, MIME[fmt]);
    const base = (state.fileName || "graph").replace(/\.gproj$/i, "");
    const name = `${base}.${fmt === "tiff" ? "tif" : fmt}`;
    if (action === "copy") {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("グラフをクリップボードにコピーしました");
    } else if (action === "share") {
      const file = new File([blob], name, { type: blob.type });
      await navigator.share({ files: [file], title: name });
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    }
    $("ex-error").textContent = "";
    $("dlg-export").close();
  } catch (e) {
    if (e.name === "AbortError") { $("ex-error").textContent = ""; return; }
    $("ex-error").textContent = String(e.message || e);
  }
}

/* ---------- 取り込みダイアログ ---------- */
const imp = { filename: "" };
async function startImport(file) {
  if (/\.gproj$/i.test(file.name)) { loadProjectText(await file.text(), file.name); return; }
  imp.filename = file.name;
  const b64 = b64FromBuffer(await file.arrayBuffer());
  toast("読み込んでいます…");
  const r = await rpc("parseTable", { filename: file.name, b64, sheet: "", headerMode: 0 });
  if (!r.ok) { toast(r.error); return; }
  $("imp-file").textContent = file.name;
  const sheetSel = $("imp-sheet");
  fillSelect(sheetSel, r.sheets.map((n) => [n, n]));
  $("imp-sheet-row").hidden = !r.sheets.length;
  $("imp-header").value = "0";
  fillImport(r, true);
  $("dlg-import").showModal();
}
async function reparseImport() {
  const r = await rpc("parseTable", { filename: imp.filename, b64: "", sheet: $("imp-sheet").value,
    headerMode: Number($("imp-header").value) });
  if (!r.ok) { $("imp-error").textContent = r.error; return; }
  fillImport(r, true);
}
function fillImport(r, resetCols) {
  imp.names = r.names;
  $("imp-error").textContent = "";
  $("imp-detected").textContent = $("imp-header").value === "0" ? `判定結果: ${r.detected ? "ヘッダあり" : "ヘッダなし"} (${r.rows} 行)` : `${r.rows} 行`;
  const opts = r.names.map((n, i) => [n, String(i)]);
  fillSelect($("imp-x"), opts);
  fillSelect($("imp-yerr"), [["Y誤差: なし", "-1"], ...opts]);
  fillSelect($("imp-xerr"), [["X誤差: なし", "-1"], ...opts]);
  if (resetCols) $("imp-yerr").value = String(r.yerr_guess);
  const box = $("imp-y");
  box.textContent = "";
  r.names.forEach((n, i) => {
    const lb = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.value = i;
    cb.checked = r.names.length === 1 ? true : i === 1 && i !== r.yerr_guess;
    lb.append(cb, document.createTextNode(n));
    box.append(lb);
  });
  const t = $("imp-preview");
  t.textContent = "";
  const thead = t.createTHead().insertRow();
  for (const n of r.names) { const th = document.createElement("th"); th.textContent = n; thead.append(th); }
  const tb = t.createTBody();
  for (const row of r.preview) {
    const tr = tb.insertRow();
    for (const c of row) tr.insertCell().textContent = c;
  }
}
async function finishImport() {
  const ycols = [...$("imp-y").querySelectorAll("input:checked")].map((c) => Number(c.value));
  if (!ycols.length) { $("imp-error").textContent = "Y 列を 1 つ以上選んでください。"; return false; }
  const r = await rpc("importColumns", {
    xcol: Number($("imp-x").value), ycols,
    yerr: Number($("imp-yerr").value), xerr: Number($("imp-xerr").value),
  });
  if (!r.ok || !r.datasets.length) { $("imp-error").textContent = r.error || "取り込める列がありません。"; return false; }
  const style = $("imp-style").value;
  addDatasets(r.datasets.map((d) => ({ ...d, style })), `${imp.filename} を取り込み`);
  return true;
}

/* ---------- 数式ダイアログ ---------- */
let fxMode = "y_fx", fxTimer = 0;
function openFormula() {
  const ds = curDs();
  const src = ds && ds.source && ds.source.type === "formula" ? ds.source : null;
  setFxMode(src ? src.mode : "y_fx");
  if (src && src.mode === "y_fx") {
    $("fx-expr").value = src.expr; $("fx-xmin").value = src.min; $("fx-xmax").value = src.max; $("fx-xn").value = src.n;
  } else if (src) {
    $("fx-xc").value = src.x_const; $("fx-ymin").value = src.min; $("fx-ymax").value = src.max; $("fx-yn").value = src.n;
  }
  $("fx-replace").checked = false;
  $("fx-replace").disabled = !ds;
  $("fx-error").textContent = "";
  validateFx();
  $("dlg-formula").showModal();
}
function setFxMode(m) {
  fxMode = m;
  for (const b of document.querySelectorAll("[data-fmode]")) b.classList.toggle("active", b.dataset.fmode === m);
  $("fx-yfx").hidden = m !== "y_fx";
  $("fx-xconst").hidden = m !== "x_const";
}
function validateFx() {
  clearTimeout(fxTimer);
  const expr = $("fx-expr").value;
  fxTimer = setTimeout(async () => {
    const r = await rpc("validateGen", { expr });
    if ($("fx-expr").value !== expr) return;
    $("fx-status").textContent = r.ok ? "✔ OK" : `✖ ${r.error}`;
    $("fx-status").className = "status " + (r.ok ? "ok" : "err");
  }, 250);
}
async function finishFormula() {
  const args = fxMode === "y_fx"
    ? { mode: "y_fx", expr: $("fx-expr").value, min: toNum($("fx-xmin").value), max: toNum($("fx-xmax").value), n: toNum($("fx-xn").value) }
    : { mode: "x_const", x_const: toNum($("fx-xc").value), min: toNum($("fx-ymin").value), max: toNum($("fx-ymax").value), n: toNum($("fx-yn").value) };
  if ([args.min, args.max, args.n].some((v) => v === null) || args.n < 2 || args.n > 1e6) {
    $("fx-error").textContent = "範囲と点数 (2 以上) を数値で入力してください。"; return false;
  }
  const r = await rpc("generate", args);
  if (!r.ok) { $("fx-error").textContent = r.error; return false; }
  const ds = curDs();
  if ($("fx-replace").checked && ds) {
    commit("数式でデータを置き換え", (p) => {
      const d = getDsIn(p, ds.id);
      d.x = r.x; d.y = r.y; d.yerr = r.x.map(() => null); d.xerr = r.x.map(() => null); d.source = r.source;
    }, { refresh: "all" });
  } else {
    addDatasets([{ name: r.name, x: r.x, y: r.y, style: "line", source: r.source }], "数式からデータを生成");
  }
  return true;
}

/* ---------- テキスト編集・貼り付け ---------- */
function openTextEditor(prefill, title) {
  $("txt-title").textContent = title;
  $("txt-area").value = prefill;
  $("dlg-text").showModal();
}
function dataAsText(ds) {
  const lines = [];
  for (let r = 0; r < ds.x.length; r++) {
    const cells = COLS.map((k) => fmtNum(ds[k][r]));
    while (cells.length > 2 && cells[cells.length - 1] === "") cells.pop();
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}
async function applyText(mode) {
  const ds = curDs();
  if (!ds) return;
  const r = await rpc("parsePaste", { text: $("txt-area").value });
  const rows = r.rows || [];
  commit(mode === "append" ? `${rows.length} 行を追加` : "データを置き換え", (p) => {
    const d = getDsIn(p, ds.id);
    if (mode !== "append") for (const k of COLS) d[k] = [];
    for (const row of rows) COLS.forEach((k, c) => d[k].push(row[c] === undefined ? null : row[c]));
  }, { refresh: "all" });
}

/* ---------- データの加工 ---------- */
const OPS_DESC = {
  expr: "X と Y を式で計算し直します。直線になる形に変換して近似するときなどに使います。",
  sort: "X の小さい順に並べ替えます。",
  mean: "同じ X の点を 1 点にまとめ、Y の平均をとります (繰り返し測定の整理)。",
  diff: "となり合う点から傾き dy/dx を求めます (滴定曲線の当量点を探すときなど)。",
  integ: "台形則で、最初の点からの面積を積み上げます。",
  norm: "Y の値を基準の値で割って、比べやすくします。",
  crop: "指定した範囲の外にある点を取り除きます。",
  swap: "X と Y (と誤差) を入れ替えます。",
};
function syncOps() {
  const op = $("ops-op").value;
  for (const d of document.querySelectorAll("#dlg-ops [data-op]")) d.hidden = d.dataset.op !== op;
  $("ops-desc").textContent = OPS_DESC[op] || "";
  $("ops-error").textContent = "";
}
function openOps() {
  const ds = curDs();
  if (!ds) return;
  $("ops-name").textContent = ds.name;
  $("ops-preset").value = "";
  $("ops-xexpr").value = "x";
  $("ops-yexpr").value = "y";
  $("ops-min").value = $("ops-max").value = "";
  $("ops-dest").value = "new";
  syncOps();
  $("dlg-ops").showModal();
}
async function finishOps() {
  const ds = curDs();
  if (!ds) return false;
  const opt = {
    x_expr: $("ops-xexpr").value, y_expr: $("ops-yexpr").value, err: $("ops-meanerr").value,
    mode: $("ops-norm").value, min: toNum($("ops-min").value), max: toNum($("ops-max").value),
  };
  const doc = curDoc();
  const r = await rpc("transform", { dataset: ds, op: $("ops-op").value, opt });
  if (doc !== curDoc() || curDs() !== ds) return true;
  if (!r.ok) { $("ops-error").textContent = r.error; return false; }
  const cols = { x: r.x, y: r.y, yerr: r.yerr, xerr: r.xerr };
  const undoCount = state.undo.length, dest = $("ops-dest").value;
  const { color, style, marker, filled, marker_size, line_width } = ds;   // 見た目は元のデータに合わせる
  const item = { ...cols, name: `${ds.name} (${r.suffix})`, color, style, marker, filled, marker_size, line_width };
  if (dest === "tab") {
    // 軸の意味が変わる変換 (アレニウスプロットなど) は、別のグラフに分けたほうが見やすい
    const fresh = clone(state.defaults.project);
    fresh.settings = clone(state.project.settings);
    fresh.settings.x_axis.auto = fresh.settings.y_axis.auto = true;
    fresh.datasets.push(newDataset(fresh, item));
    openDoc(fresh);
    toast(r.note || "新しいグラフに作りました");
    return true;
  }
  if (dest === "new") addDatasets([item], `データを加工 (${r.suffix})`);
  else commit(`データを加工 (${r.suffix})`, (p) => { Object.assign(getDsIn(p, ds.id), cols, { source: null }); }, { refresh: "all" });
  toast(state.undo.length === undoCount ? "データは変わりませんでした" : r.note || "加工しました (元に戻すで戻せます)");
  return true;
}

function saveDatasetCsv() {
  const ds = curDs();
  if (!ds) return;
  const rows = [["X", "Y", "Y誤差", "X誤差"]];
  for (let r = 0; r < ds.x.length; r++) rows.push(COLS.map((k) => fmtNum(ds[k][r])));
  saveBlob(csvBlob(rows), `${safeName(ds.name)}.csv`);
}

/* ---------- 別のグラフ (タブ) へコピー ---------- */
function openCopyTo() {
  const ds = curDs();
  if (!ds) return;
  stashDoc();
  $("copyto-name").textContent = ds.name;
  const list = $("copyto-list");
  list.textContent = "";
  const add = (label, action) => {
    const b = el("button", "menu-item", label);
    b.type = "button";
    b.onclick = () => { $("dlg-copyto").close(); action(); };
    list.append(b);
  };
  state.docs.forEach((d, i) => { if (i !== state.active) add(docLabel(d), () => copyDatasetTo(ds, i)); });
  add("＋ 新しいグラフ", () => {
    const fresh = clone(state.defaults.project);
    fresh.settings = clone(state.project.settings);
    fresh.datasets.push({ ...clone(ds), id: fresh.next_id++ });
    openDoc(fresh);
  });
  $("dlg-copyto").showModal();
}
function copyDatasetTo(ds, i) {
  // 開いていないグラフを直接書き換えるので、そのグラフの「元に戻す」にも記録する
  const doc = state.docs[i];
  doc.undo.push({ snap: JSON.stringify(doc.project), sel: doc.selectedId, desc: `「${ds.name}」をコピー` });
  doc.redo = [];
  doc.lastKey = null;
  const copy = { ...clone(ds), id: doc.project.next_id++ };
  doc.project.datasets.push(copy);
  doc.selectedId = copy.id;
  scheduleAutosave();
  toast(`「${docLabel(doc)}」にコピーしました`);
}

/* ======================================================================
 * 画面の切り替え・ちょっとした表示
 * ==================================================================== */
function setTab(tab) {
  document.body.dataset.tab = tab;
  if (tab === "settings" || tab === "results") document.body.dataset.rtab = tab;
  for (const b of document.querySelectorAll(".tabbar button")) b.classList.toggle("active", b.dataset.tab === tab);
  for (const b of document.querySelectorAll(".rtabs button")) b.classList.toggle("active", b.dataset.rtab === document.body.dataset.rtab);
  if ((tab === "graph" || tab === "results") && state.needsRender) scheduleRender(0);
  window.scrollTo(0, 0);
}

let toastTimer = 0;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}
function showFatal(msg) {
  $("splash").classList.add("error");
  $("splash-text").textContent = "起動できませんでした: " + msg + " (通信状態を確認して再読み込みしてください)";
  document.querySelector("#splash .spinner").hidden = true;
}

/* ======================================================================
 * イベントの登録
 * ==================================================================== */
function wireUp() {
  const d = state.defaults;
  fillSelect($("p-style"), d.styles);
  fillSelect($("p-marker"), d.markers);
  fillSelect($("p-fit"), d.fit_kinds);
  fillSelect($("s-font"), d.font_styles);
  fillSelect($("s-legloc"), d.legend_locs);
  fillSelect($("imp-style"), d.styles);
  fillSelect($("s-preset"), [...d.presets.map((p, i) => [p[0], String(i)]), ["カスタム", "custom"]]);
  fillSelect($("p-template"), [["選ぶ…", ""], ...d.fit_templates]);
  fillSelect($("p-band"), d.fit_bands);
  fillSelect($("s-conf"), d.conf_levels);
  fillSelect($("ops-op"), d.data_ops);
  fillSelect($("ops-preset"), [["選ぶ…", ""], ...d.expr_presets.map((p, i) => [p[0], String(i)])]);
  fillSelect($("ops-norm"), d.norm_modes);
  fillSelect($("ops-meanerr"), d.mean_errors);
  $("p-degree").max = d.max_poly_degree;

  $("btn-undo").onclick = () => undoRedo(state.undo, state.redo);
  $("btn-redo").onclick = () => undoRedo(state.redo, state.undo);
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key.toLowerCase() === "s") { e.preventDefault(); saveProject(); return; }   // Ctrl+S で保存
    if (e.target.matches("input, textarea")) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); undoRedo(state.undo, state.redo); }
    else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); undoRedo(state.redo, state.undo); }
  });

  for (const b of document.querySelectorAll(".tabbar button")) b.onclick = () => setTab(b.dataset.tab);
  for (const b of document.querySelectorAll(".rtabs button")) b.onclick = () => {
    document.body.dataset.rtab = b.dataset.rtab;
    for (const x of document.querySelectorAll(".rtabs button")) x.classList.toggle("active", x === b);
  };
  for (const b of document.querySelectorAll("[data-etab]")) b.onclick = () => {
    for (const x of document.querySelectorAll("[data-etab]")) x.classList.toggle("active", x === b);
    $("etab-table").hidden = b.dataset.etab !== "table";
    $("etab-props").hidden = b.dataset.etab !== "props";
  };

  // メニュー
  $("btn-menu").onclick = () => {
    $("menu-reopen").disabled = !state.closed.length;
    $("dlg-menu").showModal();
  };
  $("dlg-menu").addEventListener("close", () => {
    const v = $("dlg-menu").returnValue;
    $("dlg-menu").returnValue = "";
    ({
      new: newDoc, dup: duplicateDoc, rename: renameDoc, reopen: reopenDoc,
      open: () => $("file-open").click(), save: saveProject,
      import: () => $("file-import").click(), formula: openFormula, export: openExport,
      help: () => $("dlg-help").showModal(),
      wipe: wipeLocalData,
    }[v] || (() => {}))();
  });
  $("btn-save").onclick = saveProject;
  $("btn-export").onclick = openExport;
  $("file-open").onchange = async (e) => {
    const files = [...e.target.files]; e.target.value = "";
    for (const f of files) await loadProjectText(await f.text(), f.name);   // 複数選ぶとそれぞれ別のタブで開く
  };
  $("btn-newdoc").onclick = newDoc;
  $("file-import").onchange = (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (f) startImport(f).catch((err) => toast(String(err.message || err)));
  };

  // データセット
  $("btn-add").onclick = () => {
    commit("データセットを追加", (p) => { const ds = newDataset(p); p.datasets.push(ds); return ds.id; }, { refresh: "all" });
    document.querySelector('[data-etab="table"]').click();
    setTimeout(() => { const i = $("data-table").querySelector("input"); if (i) i.focus(); }, 50);
  };
  $("btn-import").onclick = () => $("file-import").click();
  $("btn-formula").onclick = openFormula;
  $("btn-dup").onclick = () => {
    const ds = curDs(); if (!ds) return;
    commit("データセットを複製", (p) => {
      const copy = clone(getDsIn(p, ds.id));
      copy.id = p.next_id++; copy.name = `${ds.name} のコピー`;
      p.datasets.splice(p.datasets.findIndex((x) => x.id === ds.id) + 1, 0, copy);
      return copy.id;
    }, { refresh: "all" });
  };
  $("btn-del").onclick = () => {
    const ds = curDs(); if (!ds) return;
    const idx = state.project.datasets.indexOf(ds);
    commit(`「${ds.name}」を削除`, (p) => {
      p.datasets = p.datasets.filter((x) => x.id !== ds.id);
      return p.datasets.length ? p.datasets[Math.min(idx, p.datasets.length - 1)].id : undefined;
    }, { refresh: "all" });
    toast("削除しました (元に戻すで戻せます)");
  };
  const move = (delta) => {
    const ds = curDs(); if (!ds) return;
    const i = state.project.datasets.indexOf(ds), j = i + delta;
    if (j < 0 || j >= state.project.datasets.length) return;
    commit("並べ替え", (p) => { const [x] = p.datasets.splice(i, 1); p.datasets.splice(j, 0, x); return ds.id; });
  };
  $("btn-up").onclick = () => move(-1);
  $("btn-down").onclick = () => move(1);

  $("ed-name").addEventListener("input", () => {
    const ds = curDs(); const v = $("ed-name").value;
    if (!ds || !v.trim()) return;
    commit("名前を変更", (p) => { getDsIn(p, ds.id).name = v; }, { mergeKey: `ds:${ds.id}:name` });
  });

  // データ表
  const tbody = $("data-table").tBodies[0];
  tbody.addEventListener("change", (e) => { if (e.target.matches("input")) onCellChange(e.target); });
  tbody.addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]");
    if (!b) return;
    const r = Number(b.closest("tr").dataset.r);
    const ds = curDs();
    commit("行を削除", (p) => { const d = getDsIn(p, ds.id); for (const k of COLS) d[k].splice(r, 1); });
    renderTable();
    updatePropsAvailability();
  });
  tbody.addEventListener("keydown", (e) => {   // Enter で下のセルへ
    if (e.key !== "Enter" || !e.target.matches("input")) return;
    e.preventDefault();
    const tr = e.target.closest("tr"), c = e.target.dataset.c;
    e.target.blur();
    setTimeout(() => {
      const next = tr.nextElementSibling || tbody.lastElementChild;
      const inp = next && next.querySelector(`input[data-c="${c}"]`);
      if (inp) inp.focus();
    }, 0);
  });
  tbody.addEventListener("paste", async (e) => {   // Excel などの複数セルを、選んだセルから貼り付ける
    if (!e.target.matches("input")) return;
    const text = (e.clipboardData || window.clipboardData).getData("text");
    if (!/[\t\n]/.test(text.trim())) return;   // 値が 1 つだけなら、そのセルへのふつうの貼り付け
    e.preventDefault();
    const ds = curDs(), doc = curDoc();
    const r0 = Number(e.target.closest("tr").dataset.r), c0 = Number(e.target.dataset.c);
    const res = await rpc("parsePaste", { text });
    if (doc !== curDoc() || curDs() !== ds) return;   // 待つ間に別のグラフ・データに移った
    const rows = res.rows || [];
    if (!rows.length) { toast("貼り付けられる数値がありませんでした"); return; }
    commit(`${rows.length} 行を貼り付け`, (p) => {
      const d = getDsIn(p, ds.id);
      rows.forEach((row, i) => {
        while (d.x.length <= r0 + i) for (const k of COLS) d[k].push(null);
        row.slice(0, COLS.length - c0).forEach((v, j) => { d[COLS[c0 + j]][r0 + i] = v; });
      });
    }, { refresh: "all" });
    toast(`${rows.length} 行を貼り付けました`);
  });
  $("btn-more").onclick = () => { state.showAllRows = true; renderTable(); };
  $("btn-ops").onclick = openOps;
  $("btn-csv").onclick = saveDatasetCsv;
  $("btn-copyto").onclick = openCopyTo;
  $("ops-op").onchange = syncOps;
  $("ops-preset").onchange = () => {
    const preset = state.defaults.expr_presets[Number($("ops-preset").value)];
    if ($("ops-preset").value === "" || !preset) return;
    $("ops-xexpr").value = preset[1];
    $("ops-yexpr").value = preset[2];
  };
  $("ops-ok").addEventListener("click", async (e) => {
    e.preventDefault();
    if (await finishOps()) $("dlg-ops").close();
  });
  $("btn-addrow").onclick = () => {
    const ds = curDs(); if (!ds) return;
    commit("行を追加", (p) => { const d = getDsIn(p, ds.id); for (const k of COLS) d[k].push(null); });
    state.showAllRows = true;
    renderTable();
    const rows = tbody.rows;
    const inp = rows[rows.length - 2] && rows[rows.length - 2].querySelector("input");
    if (inp) inp.focus();
  };
  $("btn-clear").onclick = () => {
    const ds = curDs(); if (!ds || !ds.x.length) return;
    commit("データを全消去", (p) => { const d = getDsIn(p, ds.id); for (const k of COLS) d[k] = []; }, { refresh: "all" });
    toast("全消去しました (元に戻すで戻せます)");
  };
  $("btn-textedit").onclick = () => { const ds = curDs(); if (ds) openTextEditor(dataAsText(ds), "テキストで編集"); };
  $("btn-paste").onclick = async () => {
    let text = "";
    try { if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText(); } catch (e) { /* 許可がない */ }
    openTextEditor(text, text ? "貼り付け (内容を確認してください)" : "貼り付け (ここに貼り付けてください)");
  };
  $("dlg-text").addEventListener("close", () => {
    const v = $("dlg-text").returnValue;
    $("dlg-text").returnValue = "";
    if (v === "replace" || v === "append") applyText(v);
  });

  // 表示・近似
  bindProp("p-color", "color", "color", "色を変更");
  bindProp("p-style", "style", "select", "描き方を変更");
  bindProp("p-marker", "marker", "select", "マーカーを変更");
  bindProp("p-filled", "filled", "check", "マーカーの塗りを変更");
  bindProp("p-msize", "marker_size", "num", "マーカーの大きさを変更");
  bindProp("p-lw", "line_width", "num", "線の太さを変更");
  bindProp("p-fit", "fit.kind", "select", "近似の種類を変更");
  bindProp("p-eq", "fit.equation", "text", "近似式を変更");
  bindProp("p-wl", "fit.window_length", "int", "ウィンドウ長を変更");
  bindProp("p-po", "fit.polyorder", "int", "多項式次数を変更");
  bindProp("p-fitlabel", "fit.label", "text", "近似線の凡例名を変更");
  bindProp("p-r2", "fit.show_r2", "check", "R² 表示を切り替え");
  bindProp("p-formula", "fit.show_formula", "check", "近似式表示を切り替え");
  bindProp("p-weighted", "fit.weighted", "check", "重み付けを切り替え");
  bindProp("p-sig", "fit.sig_figs", "int", "有効数字を変更");
  bindProp("p-degree", "fit.degree", "int", "多項式の次数を変更");
  bindProp("p-xmin", "fit.x_min", "numnull", "近似に使う範囲を変更");
  bindProp("p-xmax", "fit.x_max", "numnull", "近似に使う範囲を変更");
  bindProp("p-band", "fit.band", "select", "区間の帯を変更");
  bindProp("p-extend", "fit.extend", "check", "近似線の延長を切り替え");
  $("p-degree").addEventListener("change", () => { const ds = curDs(); if (ds) $("p-degree").value = ds.fit.degree; });
  $("p-template").onchange = () => applyTemplate($("p-template").value);
  $("p-p0-auto").onclick = () => { const ds = curDs(); if (ds) applyTemplate(templateOf(ds.fit.equation)); };
  $("p-p0").addEventListener("input", (e) => {
    const ds = curDs(), name = e.target.dataset.p, v = toNum(e.target.value);
    if (!ds || !name || v === null) return;
    commit("初期値を変更", (p) => { const f = getDsIn(p, ds.id).fit; f.p0 = { ...(f.p0 || {}), [name]: v }; },
      { mergeKey: `ds:${ds.id}:p0:${name}` });
  });
  $("p-color").addEventListener("change", renderList);

  // よく使う色
  for (const c of ["#000000", ...d.colors]) {
    const b = el("button");
    b.type = "button";
    b.style.background = c;
    b.title = c;
    b.setAttribute("aria-label", `色 ${c}`);
    b.onclick = () => {
      const ds = curDs();
      if (!ds) return;
      commit("色を変更", (p) => { getDsIn(p, ds.id).color = c; });
      $("p-color").value = c;
    };
    $("p-swatches").append(b);
  }

  // ラベルに記号を入れる (最後に選んだラベル欄のカーソル位置へ)。[表示, 前に入れる文字, 後ろに入れる文字]
  const symbols = [["上付き", "$^{", "}$"], ["下付き", "$_{", "}$"], ["斜体", "$", "$"], ["⁻¹", "$^{-1}$", ""],
    ["°C", "°C", ""], ["µ", "µ", ""], ["Å", "Å", ""], ["λ", "λ", ""], ["θ", "θ", ""], ["Δ", "Δ", ""], ["·", "·", ""], ["×", "×", ""]];
  let symTarget = $("s-xlabel");
  for (const id of ["s-xlabel", "s-ylabel", "s-title", "s-residlabel"]) $(id).addEventListener("focus", () => { symTarget = $(id); });
  for (const [label, before, after] of symbols) {
    const b = el("button", "chip", label);
    b.type = "button";
    b.addEventListener("pointerdown", (e) => e.preventDefault());   // 入力欄の選択範囲を保つ
    b.onclick = () => {
      const t = symTarget.disabled ? $("s-xlabel") : symTarget;
      const a = t.selectionStart ?? t.value.length, z = t.selectionEnd ?? a;
      const inner = t.value.slice(a, z);
      t.setRangeText(before + inner + after, a, z, "end");
      if (after) t.setSelectionRange(a + before.length + inner.length, a + before.length + inner.length);   // カーソルを中へ
      t.focus();
      t.dispatchEvent(new Event("input", { bubbles: true }));
    };
    $("sym-bar").append(b);
  }

  // グラフ設定
  $("s-preset").addEventListener("change", () => {
    const v = $("s-preset").value;
    if (v === "custom") return;
    const [name, w, h, fs] = state.defaults.presets[Number(v)];
    commit(`図のサイズを「${name}」に変更`, (p) => {
      Object.assign(p.settings, { width_cm: w, height_cm: h, font_size: fs });
      if (name.startsWith("v1")) Object.assign(p.settings, { font_style: "gothic", grid: true, show_title: true });
    });
    renderSettings();
  });
  bindSetting("s-w", "width_cm", "num", "図の幅を変更");
  bindSetting("s-h", "height_cm", "num", "図の高さを変更");
  bindSetting("s-font", "font_style", "select", "フォントを変更");
  bindSetting("s-fs", "font_size", "num", "文字サイズを変更");
  bindSetting("s-xlabel", "xlabel", "text", "X軸ラベルを変更");
  bindSetting("s-ylabel", "ylabel", "text", "Y軸ラベルを変更");
  bindSetting("s-showtitle", "show_title", "check", "図題の表示を切り替え");
  bindSetting("s-title", "title", "text", "図題を変更");
  bindSetting("s-sci", "sci_notation", "check", "指数表記を切り替え");
  bindSetting("s-xsig", "x_sig_figs", "int", "X軸の有効数字を変更");
  bindSetting("s-ysig", "y_sig_figs", "int", "Y軸の有効数字を変更");
  bindSetting("s-legend", "legend", "check", "凡例表示を切り替え");
  bindSetting("s-datalegend", "data_legend", "check", "データ点凡例を切り替え");
  bindSetting("s-legloc", "legend_loc", "select", "凡例の位置を変更");
  bindSetting("s-legframe", "legend_frame", "check", "凡例の枠を切り替え");
  bindSetting("s-grid", "grid", "check", "グリッド表示を切り替え");
  bindSetting("s-conf", "conf_level", "selnum", "信頼水準を変更");
  bindSetting("s-resid", "residuals", "check", "残差の表示を切り替え");
  bindSetting("s-residlabel", "residual_label", "text", "残差の軸ラベルを変更");
  for (const fs of document.querySelectorAll("fieldset[data-axis]")) {
    const axis = fs.dataset.axis, nm = axis === "x_axis" ? "X軸" : "Y軸";
    const get = (k) => fs.querySelector(`[data-k="${k}"]`);
    get("auto").addEventListener("change", () => {
      const auto = get("auto").checked;
      const mn = toNum(get("min").value), mx = toNum(get("max").value);
      commit(`${nm}の範囲指定を切り替え`, (p) => {
        const ax = p.settings[axis];
        ax.auto = auto;
        if (!auto && mn !== null && mx !== null) { ax.min = mn; ax.max = mx; }   // 表示中の範囲をそのまま採用
      });
      renderSettings();
    });
    get("log").addEventListener("change", () => {
      commit(`${nm}の対数表示を切り替え`, (p) => { p.settings[axis].log = get("log").checked; });
      renderSettings();
    });
    get("step").addEventListener("input", () => {   // 空欄・0 は自動
      const v = toNum(get("step").value);
      commit(`${nm}の目盛り間隔を変更`, (p) => { p.settings[axis].step = v !== null && v > 0 ? v : 0; },
        { mergeKey: `set:${axis}.step` });
    });
    for (const k of ["min", "max"]) {
      get(k).addEventListener("input", () => {
        const v = toNum(get(k).value);
        if (v === null) return;
        commit(`${nm}の${k === "min" ? "最小値" : "最大値"}を変更`, (p) => { p.settings[axis][k] = v; },
          { mergeKey: `set:${axis}.${k}` });
      });
    }
  }

  // 結果
  $("btn-copyres").onclick = async () => {
    try { await navigator.clipboard.writeText(resultsTsv()); toast("結果をコピーしました (Excel に貼り付けできます)"); }
    catch (e) { toast("コピーできませんでした"); }
  };
  $("btn-saveres").onclick = () => saveBlob(csvBlob(resultsRows()), `${safeName(docLabel(state))}_結果.csv`);
  $("calc-ds").onchange = () => scheduleCalc(0);
  for (const id of ["calc-x", "calc-y", "calc-yerr"]) $(id).addEventListener("input", () => scheduleCalc());
  for (const id of ["tt-a", "tt-b", "tt-col", "tt-paired"]) $(id).onchange = runTtest;

  // 取り込み
  $("imp-sheet").onchange = reparseImport;
  $("imp-header").onchange = reparseImport;
  $("imp-ok").addEventListener("click", async (e) => {
    e.preventDefault();
    if (await finishImport()) $("dlg-import").close();
  });

  // 数式
  for (const b of document.querySelectorAll("[data-fmode]")) b.onclick = () => setFxMode(b.dataset.fmode);
  $("fx-expr").addEventListener("input", validateFx);
  $("fx-ok").addEventListener("click", async (e) => {
    e.preventDefault();
    if (await finishFormula()) $("dlg-formula").close();
  });

  // 書き出し
  $("ex-fmt").onchange = updateExportInfo;
  $("ex-dpi").oninput = updateExportInfo;
  $("ex-download").onclick = () => exportImage("download");
  $("ex-share").onclick = () => exportImage("share");
  $("ex-copy").onclick = () => exportImage("copy");

  // ダイアログの外側をタップしたら閉じる
  for (const dlg of document.querySelectorAll("dialog")) {
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close("cancel"); });
    // 入力欄で Enter を押したら主ボタン (実行・生成など) を押す。何もしないと先頭の「キャンセル」が働いてしまう
    dlg.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing || !e.target.matches("input:not([type=checkbox])")) return;
      const ok = dlg.querySelector("button.primary");
      if (ok) { e.preventDefault(); ok.click(); }
    });
  }

  // ファイルのドラッグ&ドロップ (PC)
  document.addEventListener("dragover", (e) => { e.preventDefault(); });
  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    const projects = files.filter((f) => /\.gproj$/i.test(f.name));
    try {
      for (const f of projects) await loadProjectText(await f.text(), f.name);
      if (!projects.length && files[0]) await startImport(files[0]);
    } catch (err) { toast(String(err.message || err)); }
  });

  // プレビュー上の座標を読む
  const pv = $("preview-img");
  let coordTimer = 0;
  const hideCoord = () => { $("preview-coord").hidden = true; };
  pv.addEventListener("pointermove", showCoord);
  pv.addEventListener("pointerdown", (e) => { clearTimeout(coordTimer); showCoord(e); });
  pv.addEventListener("pointerleave", (e) => {
    // マウスは離れたらすぐ消す。タッチは指を離した後もしばらく読めるように残す
    clearTimeout(coordTimer);
    if (e.pointerType === "mouse") hideCoord(); else coordTimer = setTimeout(hideCoord, 4000);
  });

  // プレビューの大きさが変わったら描き直す
  new ResizeObserver(() => scheduleRender(150)).observe($("preview"));
}

/* ======================================================================
 * 起動
 * ==================================================================== */
async function start() {
  try {
    const r = await rpc("init");
    state.defaults = r.defaults;
    $("help-version").textContent = `グラフ生成アプリ Web 版 (計算部 v${r.version}) / ビルド 2.4.0-202611121200`;
  } catch (e) {
    showFatal(e.message);
    return;
  }
  let active = 0;
  try {
    const saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || "null");
    // 以前の版はグラフ 1 つだけを { project, name } で保存していた
    const items = saved && Array.isArray(saved.docs) ? saved.docs : saved && saved.project ? [saved] : [];
    for (const it of items) {
      const n = await rpc("normalize", { project: it.project });
      if (n.ok) state.docs.push(makeDoc(n.project, it.name || "graph.gproj"));
    }
    if (saved && Number.isInteger(saved.active)) active = saved.active;
    if (saved && Array.isArray(saved.closed)) state.closed = saved.closed.filter((c) => c && c.project).slice(-5);
  } catch (e) { /* 復元できなければ新規 */ }
  if (!state.docs.length) state.docs.push(makeDoc(clone(state.defaults.project), "graph.gproj"));
  loadDoc(Math.max(0, Math.min(active, state.docs.length - 1)));
  wireUp();
  state.ready = true;
  renderTabs();
  afterChange(true);
  $("splash").classList.add("done");
  setTimeout(() => $("splash").remove(), 400);
  if (!state.project.datasets.length) setTab(window.matchMedia("(min-width: 900px)").matches ? "graph" : "data");
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* オフライン非対応でも動作はする */ });
}
start();
