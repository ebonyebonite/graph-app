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
const worker = new Worker("worker.js?v=2.3.0-202610122327");
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
  project: null,
  selectedId: null,
  undo: [], redo: [],
  lastKey: null, lastTime: 0,
  results: [], messages: [],
  xlim: null, ylim: null,
  showAllRows: false,
  fileName: "graph.gproj",
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

let autosaveTimer = 0;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ project: state.project, name: state.fileName })); }
    catch (e) { /* 保存できない環境 (プライベートモード等) は無視 */ }
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
 * データセット操作
 * ==================================================================== */
function newDataset(p, fields = {}) {
  const ds = clone(state.defaults.dataset);
  ds.id = p.next_id;
  ds.name = `データ${p.next_id}`;
  ds.color = state.defaults.colors[(p.next_id - 1) % state.defaults.colors.length];
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
function fitLabel(kind) {
  if (kind === "none") return "";
  const f = state.defaults.fit_kinds.find((k) => k[1] === kind);
  return f ? f[0].replace(/ \(.*\)$/, "") : kind;
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
    const fl = fitLabel(ds.fit.kind);
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
  updatePropsAvailability();
  validateEq();
}

function updatePropsAvailability() {
  const ds = curDs();
  if (!ds) return;
  const kind = ds.fit.kind;
  const custom = kind === "custom", savgol = kind === "savgol", any = kind !== "none";
  $("p-custom-box").hidden = !custom;
  $("p-sg-box").hidden = !savgol;
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
    else if (kind === "num" || kind === "int") {
      v = toNum(el.value);
      if (v === null) return;
      if (kind === "int") v = Math.round(v);
    } else v = el.value;
    commit(desc, (p) => { setPath(getDsIn(p, ds.id), path, v); },
      { mergeKey: kind === "text" || kind === "num" || kind === "int" || kind === "color" ? `ds:${ds.id}:${path}` : null });
    if (path === "name") renderList();
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
  for (const fs of document.querySelectorAll("fieldset[data-axis]")) {
    const ax = s[fs.dataset.axis];
    fs.querySelector('[data-k="auto"]').checked = ax.auto;
    fs.querySelector('[data-k="log"]').checked = ax.log;
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
  const ev = kind === "check" || kind === "select" ? "change" : "input";
  el.addEventListener(ev, () => {
    let v;
    if (kind === "check") v = el.checked;
    else if (kind === "num" || kind === "int") {
      v = toNum(el.value);
      if (v === null) return;
      if (kind === "int") v = Math.max(1, Math.round(v));
    } else v = el.value;
    commit(desc, (p) => { setPath(p.settings, path, v); },
      { mergeKey: kind === "check" || kind === "select" ? null : `set:${path}` });
    renderSettings();
  });
}

/* ======================================================================
 * プレビュー描画
 * ==================================================================== */
let renderTimer = 0, rendering = false, renderAgain = false;
function scheduleRender(delay = 120) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(doRender, delay);
}
async function doRender() {
  if (!state.ready) return;
  if (rendering) { renderAgain = true; return; }
  const box = $("preview");
  const cssW = box.clientWidth;
  if (cssW < 10) { renderAgain = false; state.needsRender = true; return; }   // 非表示中 (スマホで別タブ)
  state.needsRender = false;
  const s = state.project.settings;
  const dpr = window.devicePixelRatio || 1;
  let dpi = (cssW * dpr) / (s.width_cm / 2.54);
  const maxDpi = Math.sqrt(12e6 / ((s.width_cm / 2.54) * (s.height_cm / 2.54)));   // 画素数の上限
  dpi = Math.max(20, Math.min(dpi, maxDpi, 600));
  rendering = true;
  $("preview-busy").hidden = false;
  try {
    const r = await rpc("render", { project: state.project, fmt: "png", dpi });
    if (!r.ok) throw new Error(r.error);
    const img = $("preview-img");
    if (r.empty) {
      img.hidden = true;
      $("preview-empty").hidden = false;
      $("preview-empty").textContent = state.project.datasets.length
        ? "表示するデータがありません (すべて非表示です)" : "データを追加するとここにグラフが表示されます";
      state.results = []; state.xlim = state.ylim = null;
    } else {
      img.src = "data:image/png;base64," + r.image;
      img.hidden = false;
      $("preview-empty").hidden = true;
      state.results = r.results; state.xlim = r.xlim; state.ylim = r.ylim;
    }
    state.messages = r.messages || [];
    renderResults();
    showAutoLimits();
  } catch (e) {
    state.messages = [String(e.message || e)];
    renderResults();
  } finally {
    rendering = false;
    $("preview-busy").hidden = true;
    if (renderAgain) { renderAgain = false; scheduleRender(0); }
  }
}

/* ======================================================================
 * 近似結果
 * ==================================================================== */
function renderResults() {
  const tbody = $("res-table").tBodies[0];
  tbody.textContent = "";
  for (const r of state.results) {
    const kind = fitLabel(r.kind) || r.kind;
    const rows = r.ok ? r.params.map((p, i) => [i ? "" : r.name, i ? "" : kind, p.name, fmtG(p.value),
      fmtG(p.err), i ? "" : fmtG(r.r2)]) : [[r.name, kind, "(失敗)", r.message, "", ""]];
    for (const cells of rows) {
      const tr = document.createElement("tr");
      for (const c of cells) { const td = document.createElement("td"); td.textContent = c; tr.append(td); }
      tbody.append(tr);
    }
  }
  $("res-empty").hidden = state.results.length > 0;
  const ul = $("msg-list");
  ul.textContent = "";
  for (const m of state.messages) { const li = document.createElement("li"); li.textContent = m; ul.append(li); }
  for (const id of ["msg-badge", "msg-badge2"]) {
    $(id).hidden = !state.messages.length;
    $(id).textContent = state.messages.length;
  }
  $("graph-msg").textContent = state.messages.length ? `⚠ ${state.messages[0]}` : "";
}

function resultsTsv() {
  const lines = [["データ", "近似", "パラメータ", "値", "標準誤差", "R²"].join("\t")];
  for (const tr of $("res-table").tBodies[0].rows) lines.push([...tr.cells].map((td) => td.textContent).join("\t"));
  return lines.join("\n");
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
  state.project = r.project;
  state.fileName = name || "graph.gproj";
  state.undo = []; state.redo = []; state.lastKey = null;
  state.selectedId = state.project.datasets.length ? state.project.datasets[0].id : null;
  afterChange(true);
  toast(`${state.fileName} を開きました`);
}

function newProject() {
  if (state.project.datasets.length && !confirm("新しいプロジェクトを作りますか? (今の内容は「元に戻す」で戻せます)")) return;
  commit("新しいプロジェクト", (p) => {
    const fresh = clone(state.defaults.project);
    fresh.settings = clone(p.settings);   // グラフ設定は引き継ぐ
    for (const k of Object.keys(p)) delete p[k];
    Object.assign(p, fresh);
  }, { refresh: "all" });
  state.fileName = "graph.gproj";
}

function wipeLocalData() {
  // 共用端末向け: 自動保存した作業内容・書き出し設定を消し、画面も空にする
  if (!confirm("このブラウザに保存された作業内容を消去して、空の状態に戻しますか? (元に戻せません)")) return;
  clearTimeout(autosaveTimer);
  try { localStorage.removeItem(AUTOSAVE_KEY); localStorage.removeItem(EXPORT_KEY); } catch (e) { /* 無視 */ }
  state.project = clone(state.defaults.project);
  state.fileName = "graph.gproj";
  state.undo = []; state.redo = []; state.lastKey = null;
  state.selectedId = null;
  renderList(); renderEditor(); renderSettings(); updateUndoButtons(); scheduleRender(0);
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

/* ======================================================================
 * 画面の切り替え・ちょっとした表示
 * ==================================================================== */
function setTab(tab) {
  document.body.dataset.tab = tab;
  if (tab === "settings" || tab === "results") document.body.dataset.rtab = tab;
  for (const b of document.querySelectorAll(".tabbar button")) b.classList.toggle("active", b.dataset.tab === tab);
  for (const b of document.querySelectorAll(".rtabs button")) b.classList.toggle("active", b.dataset.rtab === document.body.dataset.rtab);
  if (tab === "graph" && state.needsRender) scheduleRender(0);
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

  $("btn-undo").onclick = () => undoRedo(state.undo, state.redo);
  $("btn-redo").onclick = () => undoRedo(state.redo, state.undo);
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.target.matches("input, textarea")) return;
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
  $("btn-menu").onclick = () => $("dlg-menu").showModal();
  $("dlg-menu").addEventListener("close", () => {
    const v = $("dlg-menu").returnValue;
    $("dlg-menu").returnValue = "";
    ({
      new: newProject, open: () => $("file-open").click(), save: saveProject,
      import: () => $("file-import").click(), formula: openFormula, export: openExport,
      help: () => $("dlg-help").showModal(),
      wipe: wipeLocalData,
    }[v] || (() => {}))();
  });
  $("btn-save").onclick = saveProject;
  $("btn-export").onclick = openExport;
  $("file-open").onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (f) loadProjectText(await f.text(), f.name);
  };
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
  $("btn-more").onclick = () => { state.showAllRows = true; renderTable(); };
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
  $("p-color").addEventListener("change", renderList);

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
    try { await navigator.clipboard.writeText(resultsTsv()); toast("近似結果をコピーしました (Excel に貼り付けできます)"); }
    catch (e) { toast("コピーできませんでした"); }
  };

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
  }

  // ファイルのドラッグ&ドロップ (PC)
  document.addEventListener("dragover", (e) => { e.preventDefault(); });
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) startImport(f).catch((err) => toast(String(err.message || err)));
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
    $("help-version").textContent = `グラフ生成アプリ Web 版 (計算部 v${r.version}) / ビルド 2.3.0-202610122327`;
  } catch (e) {
    showFatal(e.message);
    return;
  }
  state.project = clone(state.defaults.project);
  try {
    const saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || "null");
    if (saved && saved.project) {
      const n = await rpc("normalize", { project: saved.project });
      if (n.ok) { state.project = n.project; state.fileName = saved.name || "graph.gproj"; }
    }
  } catch (e) { /* 復元できなければ新規 */ }
  state.selectedId = state.project.datasets.length ? state.project.datasets[0].id : null;
  wireUp();
  state.ready = true;
  afterChange(true);
  $("splash").classList.add("done");
  setTimeout(() => $("splash").remove(), 400);
  if (!state.project.datasets.length) setTab(window.matchMedia("(min-width: 900px)").matches ? "graph" : "data");
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* オフライン非対応でも動作はする */ });
}
start();
